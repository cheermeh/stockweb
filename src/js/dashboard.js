// src/js/dashboard.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 登入狀態檢查：未通過驗證則中斷
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) {
    return;
  }

  // 取得使用者資訊與初始市場環境
  // 變數用途說明：username 使用者登入帳號名稱；market 預設或上次選取的市場環境代碼
  // 2026.10.08 feat: 移除市場別預設 TW (requireAuth 已確保有市場別)
  const { username = '', market = '' } = window.ClientAuth ? window.ClientAuth.getSessionInfo() : {};

  /**
   * [2026-10-06] 異動說明
   * 變數用途說明：
   * 1. currentActiveMarket: 記錄目前儀表板正在瀏覽的市場代碼 (例如 'TW', 'US')
   * 2. isMarketDropdownReady: 旗標，確保市場下拉選單只在首次由後端取得清單時初始化一次，防止重複重繪引發迴圈
   */
  let currentActiveMarket = String(market).toUpperCase();
  let isMarketDropdownReady = false;

  // 2026.10.08 feat: 幣別符號一律使用 $，不再依市場區分
  const CURRENCY_SYMBOL = '$';

  /**
   * [2026-10-09] 異動說明
   * 目的：支援儀表板收支流水明細分頁切片與序號累計計算
   * 變數用途說明：
   * 1. currentPage: 當前頁碼（由 1 開始之整數）
   * 2. pageSizeSetting: 每頁筆數設定字串（'10', '20', '50', '100', 'ALL'，預設 '10'）
   */
  let currentPage = 1;
  let pageSizeSetting = '10';

  /**
   * [2026-10-06] 異動說明
   * 目的：將帳號由遮罩 (che***) 改為明碼顯示
   * 實作說明：直接將 username 指派給 user-display 元素
   */
  // 變數用途說明：userDisplay 存放使用者帳號名稱的 DOM 元素
  const userDisplay = document.getElementById('user-display');
  if (userDisplay && username) {
    userDisplay.textContent = username;
  }

  // 變數用途說明：btnGotoTradinglog 跳轉至個股波段紀錄頁面的按鈕元素
  const btnGotoTradinglog = document.getElementById('btn-goto-tradinglog');
  if (btnGotoTradinglog) {
    btnGotoTradinglog.onclick = () => {
      // 跳轉時在 URL 帶入當前市場參數，確保 tradinglog.html 載入相同市場
      window.location.href = `tradinglog.html?market=${encodeURIComponent(currentActiveMarket)}`;
    };
  }

  // 變數用途說明：btnLogout 登出按鈕元素
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.onclick = () => {
      if (window.ClientAuth && typeof window.ClientAuth.logout === 'function') {
        window.ClientAuth.logout();
      } else {
        sessionStorage.clear();
        localStorage.clear();
        window.location.replace('index.html');
      }
    };
  }

  // 2026.10.09 feat: 分頁控制介面 DOM 快取 (頂部與底部)
  // 變數用途說明：selectPageSize 頂部每頁筆數下拉選單；btnPrevPage 頂部上一頁按鈕；btnNextPage 頂部下一頁按鈕；pageIndicator 頂部頁碼提示文字；countBadgeTop 頂部總筆數標籤
  const selectPageSize = document.getElementById('select-page-size');
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');
  const pageIndicator = document.getElementById('page-indicator');
  const countBadgeTop = document.getElementById('ledger-count');

  // 變數用途說明：selectPageSizeBottom 底部分頁筆數選單；btnPrevPageBottom 底部上一頁按鈕；btnNextPageBottom 底部下一頁按鈕；pageIndicatorBottom 底部頁碼提示文字；countBadgeBottom 底部總筆數標籤
  const selectPageSizeBottom = document.getElementById('select-page-size-bottom');
  const btnPrevPageBottom = document.getElementById('btn-prev-page-bottom');
  const btnNextPageBottom = document.getElementById('btn-next-page-bottom');
  const pageIndicatorBottom = document.getElementById('page-indicator-bottom');
  const countBadgeBottom = document.getElementById('ledger-count-bottom');

  // 變數用途說明：TYPE_CONFIG 定義各交易類別在表格上的中文顯示文字與徽章樣式類別
  // 2026.10.07 異動說明：將 INTEREST 類別的中文顯示文字由「利息」改為「銀行利息」
  // 2026.10.07 異動說明：出入金改為使用 badge-input 與 badge-output 樣式
  const TYPE_CONFIG = {
    INPUT: { label: '入金', badgeClass: 'badge-input' },
    OUTPUT: { label: '出金', badgeClass: 'badge-output' },
    BUY: { label: '買進', badgeClass: 'badge-buy' },
    SELL: { label: '賣出', badgeClass: 'badge-sell' },
    REVENUE: { label: '股利', badgeClass: 'badge-dividend' },
    INTEREST: { label: '銀行利息', badgeClass: 'badge-dividend' }
  };

  // 變數用途說明：isMasked 布林值，標記當前儀表板金額是否處於隱藏遮罩狀態
  let isMasked = false;
  // 變數用途說明：globalRecentLogs 陣列，暫存自後端拉取的最近 10 筆流水帳，供切換遮罩時無損重繪
  let globalRecentLogs = [];

  // 變數用途說明：formatAmount 函式，將數值格式化為含貨幣符號、千分位或隱藏星號之字串
  const formatAmount = (val, isPnL = false) => {
    if (isMasked) return '******';
    const sign = isPnL && val > 0 ? '+' : '';
    return `${sign}${CURRENCY_SYMBOL}${val.toLocaleString()}`;
  };

  /**
   * [2026-10-06] 異動說明
   * 目的：初始化頂部市場下拉選單 (只建立一次)
   * 實作說明：動態建立 option 選項，並綁定 change 事件即時同步 Session 與重新拉取數據
   * @param {Array<string>} marketList - 資料庫回傳存在標的之市場清單
   */
  function initMarketSelect(marketList) {
    // 變數用途說明：selectMarket 頂部導覽列市場下拉選單 DOM 元素
    const selectMarket = document.getElementById('select-market');
    if (!selectMarket || isMarketDropdownReady) return;

    // 變數用途說明：validMarkets 正規化後的市場代碼陣列 (轉大寫)，2026.10.08 feat: 完全來自後端資料庫，不再寫死 TW/US
    const validMarkets = (Array.isArray(marketList) ? marketList : [])
      .map(m => String(m).trim().toUpperCase());

    if (!validMarkets.includes(currentActiveMarket)) {
      validMarkets.push(currentActiveMarket);
    }

    selectMarket.innerHTML = '';
    validMarkets.forEach((mCode) => {
      // 變數用途說明：opt 新建立之市場選項 option 元素
      const opt = document.createElement('option');
      opt.value = mCode;
      opt.textContent = mCode;
      opt.className = 'bg-gray-800 text-white';
      selectMarket.appendChild(opt);
    });

    selectMarket.value = currentActiveMarket;

    // 監聽市場選單變更
    selectMarket.onchange = async (e) => {
      // 變數用途說明：selectedMarket 使用者從下拉選單所挑選的市場代碼
      const selectedMarket = e.target.value;
      if (!selectedMarket || selectedMarket === currentActiveMarket) return;

      currentActiveMarket = selectedMarket;

      // 同步寫入 Session，確保換頁時保持一致
      if (window.ClientAuth && typeof window.ClientAuth.setMarket === 'function') {
        window.ClientAuth.setMarket(currentActiveMarket);
      } else {
        sessionStorage.setItem('stockweb_session_market', currentActiveMarket);
      }

      // 2026.10.09 fix: 發送請求前立即鎖定，載入完畢後解除鎖定，避免請求期間被重複點擊
      selectMarket.disabled = true;
      try {
        await loadDashboardData(currentActiveMarket);
      } finally {
        selectMarket.disabled = false;
      }
    };

    isMarketDropdownReady = true;
    //2026.10.09：標的資料全部塞入完畢後，解除禁用，避免破圖
    selectMarket.disabled = false;
  }

  /**
   * [2026-10-06] 異動說明
   * 目的：載入指定市場之統計指標與明細數據
   * 實作說明：在 API 帶入 market 參數請求後端，更新 6 大 KPI 卡片與流水帳表格
   * @param {string} targetMarket - 目標市場代碼
   */
  async function loadDashboardData(targetMarket) {
    // 變數用途說明：serverStatus 頂部導覽列連線狀態顯示元素
    const serverStatus = document.getElementById('server-status');

    try {
      if (serverStatus) serverStatus.textContent = '載入中...';

      // 變數用途說明：res 發送至後端 summary API 之 fetch 回應物件
      // 2026.10.08 feat: 改用 authFetch 帶 Clerk Token
      const res = await window.ClientAuth.authFetch(`/api/dashboard/summary?market=${encodeURIComponent(targetMarket)}`);

      if (res.status === 401) {
        if (window.ClientAuth) window.ClientAuth.logout();
        return;
      }

      // 變數用途說明：result 後端回傳之 JSON 解析物件
      const result = await res.json();
      if (!result.success) throw new Error(result.message || '取得數據失敗');

      if (serverStatus) serverStatus.textContent = '連線正常';

      // 變數用途說明：summary 財務彙總數據；recentLogs 最近 10 筆流水明細；availableMarkets 資料庫市場清單
      const { summary = {}, recentLogs = [], availableMarkets = [] } = result.data || {};
      globalRecentLogs = recentLogs;
      currentPage = 1; // 2026.10.09 feat: 切換市場重新拉取數據時，重設頁碼為第 1 頁

      if (!isMarketDropdownReady) {
        initMarketSelect(availableMarkets);
      }

      /**
       * 變數用途說明：kpiValues 六大指標的數值陣列
       * 依序對應卡片 1 到卡片 6：
       *   索引 0: 入金合計 (totalDeposit)
       *   索引 1: 利息合計 (totalInterest)
       *   索引 2: 期望回收 (expectedReturnWithInterest)
       *   索引 3: 當前現金餘額 (currentCash)
       *   索引 4: 波段損益不含息 (pnlExcludingInterest)
       *   索引 5: 總體損益含息 (pnlIncludingInterest)
       */
      const kpiValues = [
        Number(summary.totalDeposit || 0),
        Number(summary.totalInterest || 0),
        Number(summary.expectedReturnWithInterest || 0),
        Number(summary.currentCash || 0),
        Number(summary.pnlExcludingInterest || 0),
        Number(summary.pnlIncludingInterest || 0)
      ];

      // 渲染 KPI 卡片數值
      document.querySelectorAll('.kpi-value').forEach((el, idx) => {
        // 變數用途說明：val 當前索引對應之指標數值
        const val = kpiValues[idx];
        el.dataset.raw = val;
        // 變數用途說明：isPnL 標記是否為損益類指標 (索引 4 與 5)，需套用紅綠配色
        const isPnL = idx >= 4;
        el.textContent = formatAmount(val, isPnL);
        if (isPnL) {
          el.className = `kpi-value text-xl font-bold mt-1 ${val >= 0 ? 'text-profit' : 'text-loss'}`;
        }
      });

      // 變數用途說明：totalDep 總入金數值，用於計算報酬率分母
      const totalDep = Number(summary.totalDeposit || 0);

      // 變數用途說明：renderRate 函式，計算百分比並渲染至指定元素
      const renderRate = (elemId, pnlValue) => {
        // 變數用途說明：el 呈現報酬率百分比之 DOM 元素
        const el = document.getElementById(elemId);
        if (!el) return;
        // 變數用途說明：rate 計算所得之報酬率字串
        const rate = totalDep > 0 ? ((pnlValue / totalDep) * 100).toFixed(2) : '0.00';
        // 變數用途說明：sign 正負號字串
        const sign = Number(rate) > 0 ? '+' : '';
        el.dataset.rawRate = `${sign}${rate}%`;
        el.textContent = `${sign}${rate}%`;
        el.className = `text-xs mt-1 ${Number(rate) >= 0 ? 'text-profit' : 'text-loss'}`;
      };

      renderRate('sub-pnl-noint', Number(summary.pnlExcludingInterest || 0));
      renderRate('sub-pnl-int', Number(summary.pnlIncludingInterest || 0));

      renderLedgerTable();

    } catch (err) {
      console.error('[Dashboard Error]:', err);
      if (serverStatus) serverStatus.textContent = '連線異常';
    }
  }

  /**
   * [2026-10-09] 異動說明
   * 目的：渲染收支流水明細清單，並依當前分頁設定進行陣列切片及自動累加序號
   * 變數用途說明：
   * 1. ledgerBody: 表格內容 tbody 元素
   * 2. totalCount: 流水紀錄總筆數
   * 3. isAll: 是否選擇全部顯示
   * 4. pageSizeNum: 數字型態的每頁顯示筆數
   * 5. totalPages: 總頁數
   * 6. startIndex: 當前頁面第一筆資料在整個陣列中的起始索引 (用於序號計算與 slice)
   * 7. currentRows: 當前分頁所屬之資料列陣列
   */
  function renderLedgerTable() {
    // 變數用途說明：ledgerBody 表格內容 tbody 元素
    const ledgerBody = document.getElementById('ledger-body');
    if (!ledgerBody) return;

    const totalCount = globalRecentLogs.length;
    if (totalCount === 0) {
      ledgerBody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">尚無任何交易流水記錄</td></tr>';
      updatePaginationControls(0, 1, 1);
      return;
    }

    const isAll = pageSizeSetting === 'ALL';
    const pageSizeNum = isAll ? totalCount : parseInt(pageSizeSetting, 10);
    const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalCount / pageSizeNum));

    // 當前頁碼邊界檢查
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * pageSizeNum;
    const currentRows = isAll ? globalRecentLogs : globalRecentLogs.slice(startIndex, startIndex + pageSizeNum);

    ledgerBody.innerHTML = currentRows.map((item, index) => {
      // 序號計算：(當前頁碼 - 1) * 每頁筆數 + 當頁索引 + 1
      const serialNumber = startIndex + index + 1;
      // 變數用途說明：typeConf 該筆紀錄對應之交易類別中文標籤與 CSS 樣式
      const typeConf = TYPE_CONFIG[item.trade_type] || { label: item.trade_type || '其他', badgeClass: 'badge-deposit' };
      // 變數用途說明：isIncome 判斷該交易類別是否屬於進款 (Net+)
      const isIncome = ['INPUT', 'SELL', 'REVENUE', 'INTEREST'].includes(item.trade_type);
      // 變數用途說明：netAmount 交易收付淨額數值
      const netAmount = Number(item.net_total || 0);
      // 變數用途說明：displayDate 格式化後之 YYYY-MM-DD 交易日期
      const displayDate = item.trade_date ? item.trade_date.slice(0, 10) : '-';
      // 變數用途說明：displayStock 標的代碼文字 (出入金顯示交割帳戶)
      const displayStock = item.stock_id || (['INPUT', 'OUTPUT'].includes(item.trade_type) ? '交割帳戶' : '-');

      return `
        <tr class="hover:bg-gray-800/30 transition-colors">
          <td class="px-4 py-4 text-center text-gray-400 font-mono text-xs">${serialNumber}</td>
          <td class="px-6 py-4">${displayDate}</td>
          <td class="px-6 py-4 font-mono font-medium text-white">${displayStock}</td>
          <td class="px-6 py-4"><span class="badge ${typeConf.badgeClass}">${typeConf.label}</span></td>
          <td class="px-6 py-4 text-right">${isIncome ? formatAmount(netAmount) : '-'}</td>
          <td class="px-6 py-4 text-right">${!isIncome ? formatAmount(netAmount) : '-'}</td>
          <td class="px-6 py-4 text-gray-400">${item.note || ''}</td>
        </tr>
      `;
    }).join('');

    updatePaginationControls(totalCount, currentPage, totalPages);
  }

  /**
   * [2026-10-09] 異動說明
   * 目的：同步更新頂部與底部分頁控制器之按鈕啟用狀態、總筆數與頁碼顯示
   * 變數用途說明：
   * 1. totalCount: 資料總筆數
   * 2. current: 當前頁碼
   * 3. totalPages: 總頁數
   * 4. countText: 顯示筆數文字
   * 5. pageText: 顯示頁碼文字
   * 6. prevDisabled: 上一頁按鈕是否禁用
   * 7. nextDisabled: 下一頁按鈕是否禁用
   */
  function updatePaginationControls(totalCount, current, totalPages) {
    const countText = `共 ${totalCount} 筆`;
    const pageText = `第 ${current} / ${totalPages} 頁`;
    const prevDisabled = (current <= 1 || totalCount === 0);
    const nextDisabled = (current >= totalPages || totalCount === 0);

    // 1. 同步總筆數
    if (countBadgeTop) countBadgeTop.textContent = countText;
    if (countBadgeBottom) countBadgeBottom.textContent = countText;

    // 2. 同步頁碼標籤
    if (pageIndicator) pageIndicator.textContent = pageText;
    if (pageIndicatorBottom) pageIndicatorBottom.textContent = pageText;

    // 3. 同步下拉選單數值
    if (selectPageSize && selectPageSize.value !== pageSizeSetting) {
      selectPageSize.value = pageSizeSetting;
    }
    if (selectPageSizeBottom && selectPageSizeBottom.value !== pageSizeSetting) {
      selectPageSizeBottom.value = pageSizeSetting;
    }

    // 4. 同步按鈕禁用狀態
    if (btnPrevPage) btnPrevPage.disabled = prevDisabled;
    if (btnPrevPageBottom) btnPrevPageBottom.disabled = prevDisabled;
    if (btnNextPage) btnNextPage.disabled = nextDisabled;
    if (btnNextPageBottom) btnNextPageBottom.disabled = nextDisabled;
  }

  // =========================================================================
  // 2026.10.09 feat: 分頁事件監聽處理函式（頂部與底部共用）
  // =========================================================================
  // 變數用途說明：changePageSize 處理每頁筆數變更之函式
  const changePageSize = (newSize) => {
    pageSizeSetting = newSize;
    currentPage = 1;
    renderLedgerTable();
  };

  // 變數用途說明：goToPrevPage 處理前往上一頁之函式
  const goToPrevPage = () => {
    if (currentPage > 1) {
      currentPage--;
      renderLedgerTable();
    }
  };

  // 變數用途說明：goToNextPage 處理前往下一頁之函式
  const goToNextPage = () => {
    const isAll = pageSizeSetting === 'ALL';
    const pageSizeNum = isAll ? globalRecentLogs.length : parseInt(pageSizeSetting, 10);
    const totalPages = isAll ? 1 : Math.ceil(globalRecentLogs.length / pageSizeNum);

    if (currentPage < totalPages) {
      currentPage++;
      renderLedgerTable();
    }
  };

  // 綁定頂部分頁控制器事件
  if (selectPageSize) selectPageSize.onchange = (e) => changePageSize(e.target.value);
  if (btnPrevPage) btnPrevPage.onclick = goToPrevPage;
  if (btnNextPage) btnNextPage.onclick = goToNextPage;

  // 綁定底部分頁控制器事件
  if (selectPageSizeBottom) selectPageSizeBottom.onchange = (e) => changePageSize(e.target.value);
  if (btnPrevPageBottom) btnPrevPageBottom.onclick = goToPrevPage;
  if (btnNextPageBottom) btnNextPageBottom.onclick = goToNextPage;

  // 變數用途說明：btnMaskToggle 隱藏/顯示金額之切換按鈕元素
  const btnMaskToggle = document.getElementById('btn-mask-toggle');
  if (btnMaskToggle) {
    btnMaskToggle.onclick = () => {
      isMasked = !isMasked;
      btnMaskToggle.textContent = isMasked ? '顯示金額' : '隱藏金額';

      document.querySelectorAll('.kpi-value').forEach((el, idx) => {
        el.textContent = formatAmount(Number(el.dataset.raw || 0), idx >= 4);
      });

      ['sub-pnl-noint', 'sub-pnl-int'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = isMasked ? '***%' : (el.dataset.rawRate || '--%');
      });

      renderLedgerTable();
    };
  }

  // 初始載入：抓取當前市場數據
  await loadDashboardData(currentActiveMarket);
});