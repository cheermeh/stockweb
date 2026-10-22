// src/js/dashboard.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 登入狀態檢查：未通過驗證則中斷
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) {
    return;
  }

  // 取得使用者資訊與初始市場環境
  // 變數用途說明：username 使用者登入帳號名稱；market 預設或上次選取的市場環境代碼
  // [2026-10-08] feat: 移除市場別預設 TW (requireAuth 已確保有市場別)
  const { username = '', market = '' } = window.ClientAuth ? window.ClientAuth.getSessionInfo() : {};

  /**
   * [2026-10-06] 異動說明
   * 變數用途說明：
   * 1. currentActiveMarket: 記錄目前儀表板正在瀏覽的市場代碼 (例如 'TW', 'US')
   * 2. isMarketDropdownReady: 旗標，確保市場下拉選單只在首次由後端取得清單時初始化一次，防止重複重繪引發迴圈
   */
  let currentActiveMarket = String(market).toUpperCase();
  let isMarketDropdownReady = false;

  // [2026-10-08] feat: 幣別符號一律使用 $，不再依市場區分
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

  // [2026-10-09] feat: 分頁控制介面 DOM 快取 (頂部與底部)
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

  /**
   * [2026-10-21] 異動說明
   * 目的：快取交易明細編輯開窗 DOM 元素 (比照 tradinglog.js 規格)
   * 變數用途說明：
   * 1. modalTrade: 交易明細彈窗外層容器
   * 2. modalTradeTitle: 交易明細彈窗標題
   * 3. tradeToast: 交易彈窗浮動提示列
   * 4. btnCloseTradeModal: 關閉交易明細彈窗按鈕
   * 5. btnSubmitTrade: 送出交易修改按鈕
   * 6. inputTradeId: 隱藏之交易記錄 ID 輸入框
   * 7. inputStockId: 標的代碼輸入框 (唯讀)
   * 8. inputRound: 回合整數輸入框 (唯讀)
   * 9. inputTradeDate: 交易日期選擇器 (唯讀)
   * 10. inputTradeType: 交易型態下拉選單 (唯讀)
   * 11. inputPrice: 單價輸入框 (唯讀)
   * 12. inputShares: 股數輸入框 (唯讀)
   * 13. inputFee: 手續費輸入框 (唯讀)
   * 14. inputTax: 證券交易稅輸入框 (唯讀)
   * 15. wrapNetTotal: 實收入帳外層區塊
   * 16. inputNetTotal: 實收入帳輸入框 (唯讀)
   * 17. inputNote: 備註輸入框 (唯一允許修改)
   */
  const modalTrade = document.getElementById('modal-add-trade');
  const modalTradeTitle = document.getElementById('modal-trade-title');
  const tradeToast = document.getElementById('trade-toast');
  const btnCloseTradeModal = document.getElementById('btn-close-trade-modal');
  const btnSubmitTrade = document.getElementById('btn-submit-trade');

  const inputTradeId = document.getElementById('input-trade-id');
  const inputStockId = document.getElementById('input-stock-id');
  const inputRound = document.getElementById('input-round');
  const inputTradeDate = document.getElementById('input-trade-date');
  const inputTradeType = document.getElementById('input-trade-type');
  const inputPrice = document.getElementById('input-price');
  const inputShares = document.getElementById('input-shares');
  const inputFee = document.getElementById('input-fee');
  const inputTax = document.getElementById('input-tax');
  const wrapNetTotal = document.getElementById('wrap-net-total');
  const inputNetTotal = document.getElementById('input-net-total');
  const inputNote = document.getElementById('input-note');

  // 變數用途說明：TYPE_CONFIG 定義各交易類別在表格上的中文顯示文字與徽章樣式類別
  // [2026-10-07] 異動說明：將 INTEREST 類別的中文顯示文字由「利息」改為「銀行利息」
  // [2026-10-07] 異動說明：出入金改為使用 badge-input 與 badge-output 樣式
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
  // 變數用途說明：globalRecentLogs 陣列，暫存自後端拉取的最近流水帳，供切換遮罩與編輯比對使用
  let globalRecentLogs = [];

  // 變數用途說明：formatAmount 函式，將數值格式化為含貨幣符號、千分位或隱藏星號之字串
  const formatAmount = (val, isPnL = false) => {
    if (isMasked) return '******';
    const sign = isPnL && val > 0 ? '+' : '';
    return `${sign}${CURRENCY_SYMBOL}${val.toLocaleString()}`;
  };

  /**
   * [2026-10-20] 異動說明
   * 目的：彈窗切換顯示/隱藏輔助函式
   * 變數用途說明：
   * 1. modalEl: 目標彈窗 DOM 元素
   * 2. show: 布林值，true 顯示，false 隱藏
   */
  const toggleModal = (modalEl, show) => {
    if (!modalEl) return;
    modalEl.classList.toggle('hidden', !show);
    modalEl.classList.toggle('flex', show);
  };

  /**
   * [2026-10-20] 異動說明
   * 目的：抽成彈窗共用 Toast 提示處理函式 (比照 tradinglog.js 規格)
   * 變數用途說明：
   * 1. toastEl: 目標 Toast DOM 元素
   * 2. message: 顯示的訊息字串
   * 3. isSuccess: 是否為成功樣式 (true: 綠色, false: 紅色)
   * 4. duration: 停留時間 (毫秒)
   * 5. onComplete: 提示倒數結束後的 callback
   */
  const showModalToast = (toastEl, message, isSuccess = true, duration = 1500, onComplete = null) => {
    if (!toastEl) return;

    toastEl.textContent = message;
    toastEl.classList.remove(
      'bg-emerald-950/95', 'border-emerald-500/70', 'text-emerald-300',
      'bg-red-950/95', 'border-red-500/70', 'text-red-300',
      'hidden'
    );

    if (isSuccess) {
      toastEl.classList.add('bg-emerald-950/95', 'border-emerald-500/70', 'text-emerald-300');
    } else {
      toastEl.classList.add('bg-red-950/95', 'border-red-500/70', 'text-red-300');
    }

    setTimeout(() => {
      toastEl.classList.add('hidden');
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }, duration);
  };

  /**
   * [2026-10-20] 異動說明
   * 目的：共用統一成功提示字詞處理函式
   * 變數用途說明：
   * 1. toastEl: 目標 Toast DOM 元素
   * 2. duration: 停留時間 (毫秒)
   * 3. onComplete: 倒數完的回呼函式
   * 4. message: 顯示的提示字串 (預設為 '✓ 新增成功')
   */
  const showSuccessToast = (toastEl, duration = 1500, onComplete = null, message = '✓ 新增成功') => {
    showModalToast(toastEl, message, true, duration, onComplete);
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

    // 變數用途說明：validMarkets 正規化後的市場代碼陣列 (轉大寫)，[2026-10-08] feat: 完全來自後端資料庫，不再寫死 TW/US
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

      // [2026-10-09] fix: 發送請求前立即鎖定，載入完畢後解除鎖定，避免請求期間被重複點擊
      selectMarket.disabled = true;
      try {
        await loadDashboardData(currentActiveMarket);
      } finally {
        selectMarket.disabled = false;
      }
    };

    isMarketDropdownReady = true;
    // [2026-10-09]：標的資料全部塞入完畢後，解除禁用，避免破圖
    selectMarket.disabled = false;
  }

  /**
   * [2026-10-06] 異動說明
   * 目的：載入指定市場之統計指標與明細數據
   * 實作說明：在 API 帶入 market 參數請求後端，更新 6 大 KPI 卡片與流水帳表格
   * [2026-10-13] 異動說明：
   * 目的：支援搜尋過濾字串 extraQueryString (如 &trade_type=BUY&stock_id=NVDA)
   * @param {string} targetMarket - 目標市場代碼
   * @param {string} [extraQueryString=''] - 附加的搜尋過濾字串
   */
  async function loadDashboardData(targetMarket, extraQueryString = '') {
    // 變數用途說明：serverStatus 頂部導覽列連線狀態顯示元素
    const serverStatus = document.getElementById('server-status');

    try {
      if (serverStatus) serverStatus.textContent = '載入中...';

      // 變數用途說明：res 發送至後端 summary API 之 fetch 回應物件
      // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
      // [2026-10-13] feat: URL 串接 extraQueryString 搜尋參數
      const res = await window.ClientAuth.authFetch(`/api/dashboard/summary?market=${encodeURIComponent(targetMarket)}${extraQueryString}`);

      if (res.status === 401) {
        if (window.ClientAuth) window.ClientAuth.logout();
        return;
      }

      // 變數用途說明：result 後端回傳之 JSON 解析物件
      const result = await res.json();
      if (!result.success) throw new Error(result.message || '取得數據失敗');

      if (serverStatus) serverStatus.textContent = '連線正常';

      // 變數用途說明：summary 財務彙總數據；recentLogs 最近流水明細；availableMarkets 資料庫市場清單
      const { summary = {}, recentLogs = [], availableMarkets = [] } = result.data || {};
      globalRecentLogs = recentLogs;
      currentPage = 1; // [2026-10-09] feat: 切換市場或搜尋重新拉取數據時，重設頁碼為第 1 頁

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
      updateFilterSummary(); // [2026-10-14] 同步更新搜尋區塊的不分頁合計

    } catch (err) {
      console.error('[Dashboard Error]:', err);
      if (serverStatus) serverStatus.textContent = '連線異常';
    }
  }

  /**
   * [2026-10-09] 渲染收支流水明細清單，並依當前分頁設定進行陣列切片及自動累加序號
   * [2026-10-21] 
   * 1. 標的呈現格式改為 STOCK_ID-STOCK_NAME；若無名稱則直接呈現 STOCK_ID (不出現 -)；出入金顯示交割帳戶
   * 2. 增加最右側操作欄位 (編輯備註與刪除按鈕)
   * 
   * [2026-10-22] 
   * 0. 呼叫 ClientAuth.formatDateTime 將 mtdt 轉為使用者本地時區 yyyy/mm/dd 24hh:mm
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
      ledgerBody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">尚無任何交易流水記錄</td></tr>';
      updatePaginationControls(0, 1, 1);
      return;
    }

    const isAll = pageSizeSetting === 'ALL';
    const pageSizeNum = isAll ? totalCount : parseInt(pageSizeSetting, 10);
    const totalPages = isAll ? 1 : Math.ceil(totalCount / pageSizeNum);

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
      
      /**
       * [2026-10-21] 異動說明
       * 目的：標的呈現格式嚴格要求為 STOCK_ID-STOCK_NAME；沒有 NAME 則直接呈現 ID (不需出現 -)
       * 變數用途說明：
       * 1. rawStockId: 原始股票代碼字串
       * 2. rawStockName: 原始股票名稱字串
       * 3. displayStock: 組裝標的代碼與標的名稱之最終顯示文字
       */
      let displayStock = '-';
      if (['INPUT', 'OUTPUT'].includes(item.trade_type)) {
        displayStock = '交割帳戶';
      } else {
        const rawStockId = String(item.stock_id || '').trim();
        const rawStockName = String(item.stock_name || '').trim();

        if (rawStockId && rawStockName) {
          displayStock = `${rawStockId}-${rawStockName}`;
        } else if (rawStockId) {
          displayStock = rawStockId;
        }
      }

      // [2026-10-22] 異動說明：使用共用函式依使用者在地時區動態轉換最後異動時間
      const displayMtdt = window.ClientAuth && typeof window.ClientAuth.formatDateTime === 'function'
        ? window.ClientAuth.formatDateTime(item.mtdt)
        : (item.mtdt || '-');

      return `
        <tr class="hover:bg-gray-800/30 transition-colors">
          <td class="px-4 py-4 text-center text-gray-400 font-mono text-xs">${serialNumber}</td>
          <td class="px-6 py-4">${displayDate}</td>
          <td class="px-6 py-4 font-mono font-medium text-white">${displayStock}</td>
          <td class="px-6 py-4"><span class="badge ${typeConf.badgeClass}">${typeConf.label}</span></td>
          <td class="px-6 py-4 text-right">${isIncome ? formatAmount(netAmount) : '-'}</td>
          <td class="px-6 py-4 text-right">${!isIncome ? formatAmount(netAmount) : '-'}</td>
          <td class="px-6 py-4 text-gray-400">${item.note || ''}</td>
          <td class="px-4 py-4 text-center">
            <button type="button" class="btn-edit text-blue-400 hover:text-blue-300 mr-2.5 text-xs font-medium" data-id="${item.trade_id}">編輯</button>
            <button type="button" class="btn-delete text-gray-500 hover:text-red-400 text-xs font-medium" data-id="${item.trade_id}">刪除</button>
          </td>
          <!-- [2026-10-22] 異動欄位：操作之後新增最後異動時間 (動態轉換本地時區) -->
          <td class="px-6 py-4 text-gray-400 font-mono text-xs whitespace-nowrap">${displayMtdt}</td>
        </tr>
      `;
    }).join('');

    // [2026-10-21] feat: 綁定明細操作按鈕 (編輯/刪除) 事件
    bindTableRowEvents();

    updatePaginationControls(totalCount, currentPage, totalPages);
  }

  /**
   * [2026-10-21] 異動說明
   * 目的：為表格內的「編輯」與「刪除」按鈕綁定操作事件
   * 規則：Dashboard 僅允許編輯備註說明，其他欄位全數設為唯讀帶入
   * 變數用途說明：
   * 1. targetLog: 比對出之目標交易紀錄物件
   * 2. isIncome: 判斷是否為純金流或被動收益
   */
  function bindTableRowEvents() {
    const ledgerBody = document.getElementById('ledger-body');
    if (!ledgerBody) return;

    // 1. 綁定編輯按鈕
    ledgerBody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.onclick = () => {
        const targetLog = globalRecentLogs.find((item) => String(item.trade_id) === String(btn.dataset.id));
        if (!targetLog) return;

        if (inputTradeId) inputTradeId.value = targetLog.trade_id;
        if (modalTradeTitle) modalTradeTitle.textContent = '編輯交易備註';
        if (tradeToast) tradeToast.classList.add('hidden');

        // 標的呈現帶入
        if (inputStockId) {
          inputStockId.value = targetLog.stock_id || '';
        }

        if (inputTradeDate) {
          inputTradeDate.value = targetLog.trade_date ? targetLog.trade_date.slice(0, 10) : '';
        }

        if (inputTradeType) {
          inputTradeType.value = targetLog.trade_type || 'BUY';
        }

        // 判斷交易類型切換實收區塊
        const isIncome = ['REVENUE', 'INTEREST', 'INPUT', 'OUTPUT'].includes(targetLog.trade_type);
        if (isIncome) {
          if (wrapNetTotal) wrapNetTotal.classList.remove('hidden');
          if (inputRound) inputRound.value = '0';
          if (inputPrice) inputPrice.value = '0';
          if (inputShares) inputShares.value = '0';
          if (inputFee) inputFee.value = '0';
          if (inputTax) inputTax.value = '0';
          if (inputNetTotal) inputNetTotal.value = Math.abs(Number(targetLog.net_total || 0));
        } else {
          if (wrapNetTotal) wrapNetTotal.classList.add('hidden');
          if (inputRound) inputRound.value = targetLog.round !== undefined ? targetLog.round : '0';
          if (inputPrice) inputPrice.value = targetLog.price || '';
          if (inputShares) inputShares.value = targetLog.shares || '';
          if (inputFee) inputFee.value = targetLog.fee || '';
          if (inputTax) inputTax.value = targetLog.tax || '';
          if (inputNetTotal) inputNetTotal.value = '';
        }

        // 備註欄位賦值並自動聚焦
        if (inputNote) {
          inputNote.value = targetLog.note || '';
          setTimeout(() => {
            inputNote.focus();
            inputNote.select();
          }, 50);
        }

        toggleModal(modalTrade, true);
      };
    });

    // 2. 綁定刪除按鈕
    ledgerBody.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('確定要刪除這筆交易記錄嗎？此操作將無法復原。')) return;
        try {
          // 變數用途說明：res 呼叫現有 detail 刪除 API 之回應物件
          const res = await window.ClientAuth.authFetch(`/api/trading/detail?trade_id=${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          // 變數用途說明：result 刪除請求回傳之 JSON 物件
          const result = await res.json();
          if (!result.success) throw new Error(result.message);

          // 重新整理儀表板數據
          await loadDashboardData(currentActiveMarket);
        } catch (err) {
          alert(`刪除失敗: ${err.message}`);
        }
      };
    });
  }

  /**
   * [2026-10-21] 異動說明
   * 目的：送出交易明細備註修改至後端，其他欄位完全保持資料庫原始數值不變
   * 變數用途說明：
   * 1. trade_id: 欲修改之交易識別碼
   * 2. targetLog: 比對原始快取所得之完整交易記錄物件
   * 3. updatedNote: 使用者輸入之最新備註字串
   * 4. payload: 送交後端 PUT 請求之資料本體物件
   */
  async function submitTradeForm() {
    const trade_id = inputTradeId?.value?.trim();
    if (!trade_id) {
      alert('缺少交易記錄 ID，無法進行編輯！');
      return;
    }

    // 找出原始資料紀錄，維持原欄位數值送出
    const targetLog = globalRecentLogs.find((item) => String(item.trade_id) === String(trade_id));
    if (!targetLog) {
      alert('找不到該筆交易原始紀錄！');
      return;
    }

    const updatedNote = inputNote?.value?.trim() || '';

    // 組裝 Payload，除 note 外其餘一律忠實使用原始紀錄數值
    const payload = {
      trade_id: targetLog.trade_id,
      stock_id: targetLog.stock_id,
      round: targetLog.round !== undefined ? targetLog.round : 0,
      trade_date: targetLog.trade_date ? targetLog.trade_date.slice(0, 10) : '',
      trade_type: targetLog.trade_type,
      price: targetLog.price || 0,
      shares: targetLog.shares || 0,
      fee: targetLog.fee || 0,
      tax: targetLog.tax || 0,
      net_total: targetLog.net_total !== undefined ? targetLog.net_total : undefined,
      note: updatedNote
    };

    try {
      // 變數用途說明：res 發送至 detail API 更新交易記錄之 fetch 回應物件
      const res = await window.ClientAuth.authFetch('/api/trading/detail', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      // 變數用途說明：result 更新請求回傳結果
      const result = await res.json();
      if (!result.success) throw new Error(result.message);

      // 重新載入儀表板最新數據
      await loadDashboardData(currentActiveMarket);

      // 顯示編輯成功提示並於 0.9 秒後關閉彈窗
      showSuccessToast(tradeToast, 900, () => {
        toggleModal(modalTrade, false);
      }, '✓ 編輯成功');
    } catch (err) {
      showModalToast(tradeToast, `✕ 更新失敗: ${err.message}`, false, 2000);
    }
  }

  // 綁定編輯彈窗關閉按鈕
  if (btnCloseTradeModal) {
    btnCloseTradeModal.onclick = () => toggleModal(modalTrade, false);
  }

  // 綁定編輯彈窗儲存修改按鈕
  if (btnSubmitTrade) {
    btnSubmitTrade.onclick = () => submitTradeForm();
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
  // [2026-10-09] feat: 分頁事件監聽處理函式（頂部與底部共用）
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

      // [2026-10-14] 同步更新搜尋區塊的不分頁合計遮罩狀態
      const elNoInt = document.getElementById('filter-summary-no-int');
      const elWithInt = document.getElementById('filter-summary-with-int');
      if (elNoInt) elNoInt.textContent = formatAmount(Number(elNoInt.dataset.raw || 0), true);
      if (elWithInt) elWithInt.textContent = formatAmount(Number(elWithInt.dataset.raw || 0), true);

      renderLedgerTable();
    };
  }

  // =========================================================================
  // [2026-10-13] 異動說明：搜尋與重置按鈕事件綁定
  // =========================================================================
  // 變數用途說明：快取 6 個篩選表單輸入元件 DOM
  const inputFilterTradeType = document.getElementById('filter-trade-type');
  const inputFilterStockId = document.getElementById('filter-stock-id');
  const inputFilterStockName = document.getElementById('filter-stock-name');
  const inputFilterStartDate = document.getElementById('filter-start-date');
  const inputFilterEndDate = document.getElementById('filter-end-date');
  const inputFilterNote = document.getElementById('filter-note');

  // 變數用途說明：btnFilterSearch 執行查詢按鈕
  const btnFilterSearch = document.getElementById('btn-filter-search');
  if (btnFilterSearch) {
    btnFilterSearch.onclick = async () => {
      // 變數用途說明：params 用於組裝各篩選輸入欄位的 Query String 物件
      const params = new URLSearchParams();

      if (inputFilterTradeType && inputFilterTradeType.value) {
        params.append('trade_type', inputFilterTradeType.value.trim());
      }
      if (inputFilterStockId && inputFilterStockId.value) {
        params.append('stock_id', inputFilterStockId.value.trim());
      }
      if (inputFilterStockName && inputFilterStockName.value) {
        params.append('stock_name', inputFilterStockName.value.trim());
      }
      if (inputFilterStartDate && inputFilterStartDate.value) {
        params.append('start_date', inputFilterStartDate.value.trim());
      }
      if (inputFilterEndDate && inputFilterEndDate.value) {
        params.append('end_date', inputFilterEndDate.value.trim());
      }
      if (inputFilterNote && inputFilterNote.value) {
        params.append('note', inputFilterNote.value.trim());
      }

      // 變數用途說明：queryString 附加於 API 網址後方的搜尋參數字串
      const queryString = params.toString() ? `&${params.toString()}` : '';

      // 重新以篩選參數載入數據
      await loadDashboardData(currentActiveMarket, queryString);
    };
  }

  // 變數用途說明：btnFilterReset 重置條件按鈕
  const btnFilterReset = document.getElementById('btn-filter-reset');
  if (btnFilterReset) {
    btnFilterReset.onclick = async () => {
      // 清空 6 個搜尋欄位數值
      if (inputFilterTradeType) inputFilterTradeType.value = '';
      if (inputFilterStockId) inputFilterStockId.value = '';
      if (inputFilterStockName) inputFilterStockName.value = '';
      if (inputFilterStartDate) inputFilterStartDate.value = '';
      if (inputFilterEndDate) inputFilterEndDate.value = '';
      if (inputFilterNote) inputFilterNote.value = '';

      // 重新載入無篩選條件之當前市場資料
      await loadDashboardData(currentActiveMarket, '');
    };
  }

  /**
    * [2026-10-14] 異動說明
    * 目的：依據條件篩選結果 (globalRecentLogs 全集，不限分頁) 計算不含息與含息之已實現投資損益
    * 業務公式：
    * 1. 不含息公式：SELL - BUY
    * 2. 含息公式：(SELL + REVENUE + INTEREST) - BUY
    * (說明：排除本金轉移的 INPUT 與 OUTPUT，避免重複扣除或雙重灌水)
    * 變數用途說明：
    * 1. elNoInt: 呈現不含息損益數值的 DOM 元素
    * 2. elWithInt: 呈現含息損益數值的 DOM 元素
    * 3. sumNoInterest: 累計不含息損益金額
    * 4. sumWithInterest: 累計含息損益金額
    */
  function updateFilterSummary() {
    // 變數用途說明：elNoInt 存放不含息損益 DOM 元素
    const elNoInt = document.getElementById('filter-summary-no-int');
    // 變數用途說明：elWithInt 存放含息損益 DOM 元素
    const elWithInt = document.getElementById('filter-summary-with-int');

    if (!elNoInt || !elWithInt) return;

    // 變數用途說明：sumNoInterest 累積計算不含息之已實現損益 (SELL - BUY)
    let sumNoInterest = 0;
    // 變數用途說明：sumWithInterest 累積計算含息之已實現損益 (SELL + REVENUE + INTEREST - BUY)
    let sumWithInterest = 0;

    globalRecentLogs.forEach((item) => {
      // 變數用途說明：net 該筆紀錄之收付淨額數值
      const net = Number(item.net_total || 0);
      // 變數用途說明：type 交易型態字串
      const type = item.trade_type;

      // 依交易型態計算實際投資損益
      if (type === 'SELL') {
        sumNoInterest += net;
        sumWithInterest += net;
      } else if (type === 'BUY') {
        sumNoInterest -= net;
        sumWithInterest -= net;
      } else if (type === 'REVENUE' || type === 'INTEREST') {
        // 股利與利息屬於被動收益，僅計入「含息損益」
        sumWithInterest += net;
      }
      // 注意：INPUT (入金) 與 OUTPUT (出金) 屬本金資金流，不參與投資損益計算
    });

    // 暫存原始未遮罩數值，供切換遮罩時使用
    elNoInt.dataset.raw = sumNoInterest;
    elWithInt.dataset.raw = sumWithInterest;

    // 渲染數值並套用盈虧樣式 (正數為 text-profit 柔和青綠，負數為 text-loss 冷調石板灰)
    elNoInt.textContent = formatAmount(sumNoInterest, true);
    elNoInt.className = `font-bold ${sumNoInterest >= 0 ? 'text-profit' : 'text-loss'}`;

    elWithInt.textContent = formatAmount(sumWithInterest, true);
    elWithInt.className = `font-bold ${sumWithInterest >= 0 ? 'text-profit' : 'text-loss'}`;
  }

  // =========================================================================
  // [2026-10-20] 異動說明：新增市場別維護開窗與互動邏輯 (比照 tradinglog.js 規格)
  // =========================================================================
  // 變數用途說明：快取市場開窗與內部元件 DOM
  const modalMarket = document.getElementById('modal-market');
  const marketToast = document.getElementById('market-toast');
  const inputNewMarketType = document.getElementById('input-new-market-type');
  const btnOpenMarketModal = document.getElementById('btn-open-market-modal');
  const btnCloseMarketModal = document.getElementById('btn-close-market-modal');
  const btnSubmitMarket = document.getElementById('btn-submit-market');
  const btnSubmitMarketContinue = document.getElementById('btn-submit-market-continue');

  // 開啟市場彈窗
  if (btnOpenMarketModal) {
    btnOpenMarketModal.onclick = () => {
      if (inputNewMarketType) inputNewMarketType.value = '';
      if (marketToast) marketToast.classList.add('hidden');
      toggleModal(modalMarket, true);
      if (inputNewMarketType) inputNewMarketType.focus();
    };
  }

  // 關閉市場彈窗
  if (btnCloseMarketModal) {
    btnCloseMarketModal.onclick = () => toggleModal(modalMarket, false);
  }

  /**
   * [2026-10-20] 異動說明
   * 目的：送出市場維護表單資料，支援「儲存並關閉」或「儲存並繼續新增」
   * [2026-10-22] 異動說明：改為呼叫獨立端點 /api/dashboard/addmarket
   * 1. keepOpen: 布林值，true 儲存後保持彈窗繼續新增，false 儲存後關閉
   * 2. newMarket: 格式化後之市場代碼大寫字串
   */
  async function submitMarketForm(keepOpen = false) {
    const newMarket = inputNewMarketType?.value?.trim().toUpperCase();

    if (!newMarket) {
      showModalToast(marketToast, '✕ 請填寫市場代碼！', false, 2000);
      if (inputNewMarketType) inputNewMarketType.focus();
      return;
    }

    try {
      // 變數用途說明：res 呼叫後端建立/維護市場 API 之回應物件
      // (作廢) [2026-10-20] 原呼叫端點：/api/dashboard/summary (POST)
      // [2026-10-22] refactor: 依規範呼叫獨立端點 /api/dashboard/addmarket
      const res = await window.ClientAuth.authFetch('/api/dashboard/addmarket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market_id: newMarket,
          market_name: newMarket
        })
      });

      const result = await res.json();
      if (!result.success) {
        showModalToast(marketToast, `✕ ${result.message || '新增失敗'}`, false, 2000);
        return;
      }

      // 成功後處理：依 keepOpen 決定提示與開窗收合
      if (keepOpen) {
        if (inputNewMarketType) {
          inputNewMarketType.value = '';
          inputNewMarketType.focus();
        }
        showSuccessToast(marketToast, 1500);
      } else {
        showSuccessToast(marketToast, 800, () => {
          toggleModal(modalMarket, false);
          if (inputNewMarketType) inputNewMarketType.value = '';
        });
      }

      // 同步更新當前市場，並動態將新市場加入頂部下拉選單
      currentActiveMarket = newMarket;
      if (window.ClientAuth && typeof window.ClientAuth.setMarket === 'function') {
        window.ClientAuth.setMarket(currentActiveMarket);
      } else {
        sessionStorage.setItem('stockweb_session_market', currentActiveMarket);
      }

      const selectMarket = document.getElementById('select-market');
      if (selectMarket) {
        let exists = false;
        for (let i = 0; i < selectMarket.options.length; i++) {
          if (selectMarket.options[i].value === newMarket) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = newMarket;
          opt.textContent = newMarket;
          opt.className = 'bg-gray-800 text-white';
          selectMarket.appendChild(opt);
        }
        selectMarket.value = newMarket;
      }

      // 重新載入最新市場資料
      await loadDashboardData(currentActiveMarket);

    } catch (err) {
      showModalToast(marketToast, `✕ 新增失敗: ${err.message}`, false, 2000);
    }
  }

  // 綁定市場開窗「儲存並關閉」按鈕事件
  if (btnSubmitMarket) {
    btnSubmitMarket.onclick = () => submitMarketForm(false);
  }

  // 綁定市場開窗「儲存並繼續新增」按鈕事件
  if (btnSubmitMarketContinue) {
    btnSubmitMarketContinue.onclick = () => submitMarketForm(true);
  }

  // 初始載入：抓取當前市場數據
  await loadDashboardData(currentActiveMarket);
});