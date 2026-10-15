// src/js/tradinglog.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 權限檢查：未登入則阻斷跳轉
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) return;

  /**
   * [2026-10-06] 異動說明
   * 目的：直接取得 Session 中的市場別 (例如 'TW', 'US')
   * 變數說明：
   * 1. sessionInfo: 從 ClientAuth 獲取當前使用者資訊
   * 2. currentMarket: 當前市場代碼
   * 3. currencySymbol: 幣別符號
   */
  const sessionInfo = window.ClientAuth ? window.ClientAuth.getSessionInfo() : {};
  // [2026-10-08] feat: 移除市場別預設 TW (requireAuth 已確保有市場別)
  const currentMarket = String(sessionInfo.market || '').toUpperCase();
  // [2026-10-08] feat: 幣別符號一律使用 $，不再依市場區分
  const currencySymbol = '$';

  // 取得網址列參數
  const urlParams = new URLSearchParams(window.location.search);
  let currentStock = (urlParams.get('symbol') || urlParams.get('stock_id') || '').toUpperCase();
  let currentRound = (urlParams.get('round') || '').toUpperCase();
  let currentSuggestedRound = '0';

  // =========================================================================
  // DOM 元素快取宣告
  // =========================================================================
  const selectStock = document.getElementById('select-stock');
  const selectRound = document.getElementById('select-round');

  const modalTrade = document.getElementById('modal-add-trade');
  const modalTitle = document.getElementById('modal-title');
  const btnSubmitTradeText = document.getElementById('btn-submit-trade-text');

  const inputTradeId = document.getElementById('input-trade-id');
  const inputStockId = document.getElementById('input-stock-id');
  const inputRound = document.getElementById('input-round');
  const inputTradeDate = document.getElementById('input-trade-date');
  const inputTradeType = document.getElementById('input-trade-type');
  const inputPrice = document.getElementById('input-price');
  const inputShares = document.getElementById('input-shares');
  const inputFee = document.getElementById('input-fee');
  const inputTax = document.getElementById('input-tax');
  const inputNote = document.getElementById('input-note');

  const wrapNetTotal = document.getElementById('wrap-net-total');
  const inputNetTotal = document.getElementById('input-net-total');

  const modalStock = document.getElementById('modal-stock-comp');
  const inputNewStockId = document.getElementById('input-new-stock-id');
  const inputNewStockName = document.getElementById('input-new-stock-name');

  /**
   * [2026-10-12] 異動說明
   * 目的：快取「儲存並繼續新增」按鈕元素
   * 變數說明：
   * 1. btnSubmitTradeContinue: 交易記錄開窗之「儲存並繼續新增」按鈕
   * 2. btnSubmitStockCompContinue: 標的開窗之「儲存並繼續新增」按鈕
   */
  const btnSubmitTradeContinue = document.getElementById('btn-submit-trade-continue');
  const btnSubmitStockCompContinue = document.getElementById('btn-submit-stock-comp-continue');

  /**
   * [2026-10-13] 異動說明
   * 目的：快取彈窗內的成功浮動提示列 (Toast) 元素
   * 變數說明：
   * 1. tradeToast: 交易記錄新增成功之浮動提示元素
   * 2. stockToast: 標的代碼新增成功之浮動提示元素
   */
  const tradeToast = document.getElementById('trade-toast');
  const stockToast = document.getElementById('stock-toast');

  /**
   * [2026-10-15] 異動說明
   * 目的：抽成彈窗共用 Toast 提示處理函式 (支援成功/失敗樣式與可選的倒數完成回呼)
   * 變數說明：
   * 1. toastEl: 目標 Toast DOM 元素 (如 tradeToast 或 stockToast)
   * 2. message: 顯示的訊息字串
   * 3. isSuccess: 是否為成功樣式 (true: 綠色, false: 紅色)
   * 4. duration: 停留時間 (毫秒)
   * 5. onComplete: 提示倒數結束後的 callback (例如執行 toggleModal 關閉彈窗)
   */
  const showModalToast = (toastEl, message, isSuccess = true, duration = 1500, onComplete = null) => {
    if (!toastEl) return;

    // 設定提示文字
    toastEl.textContent = message;

    // 清除既有色彩與隱藏狀態
    toastEl.classList.remove(
      'bg-emerald-950/95', 'border-emerald-500/70', 'text-emerald-300',
      'bg-red-950/95', 'border-red-500/70', 'text-red-300',
      'hidden'
    );

    // 依狀態套用綠色或紅色
    if (isSuccess) {
      toastEl.classList.add('bg-emerald-950/95', 'border-emerald-500/70', 'text-emerald-300');
    } else {
      toastEl.classList.add('bg-red-950/95', 'border-red-500/70', 'text-red-300');
    }

    // 倒數結束後隱藏，若有回呼函式則一併觸發
    setTimeout(() => {
      toastEl.classList.add('hidden');
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }, duration);
  };

  /**
   * [2026-10-15] 異動說明
   * 目的：共用統一成功提示字詞處理函式，一律顯示「✓ 編輯成功」或「✓ 新增成功」
   * 變數說明：
   * 1. toastEl: 目標 Toast DOM 元素
   * 2. isEdit: 是否為編輯模式 (true: 顯示編輯成功, false: 顯示新增成功)
   * 3. duration: 停留時間 (毫秒)
   * 4. onComplete: 倒數完的回呼函式 (關閉開窗用)
   */
  const showSuccessToast = (toastEl, isEdit = false, duration = 1500, onComplete = null) => {
    // 依據編輯狀態決定統一提示文字
    const message = isEdit ? '✓ 編輯成功' : '✓ 新增成功';
    showModalToast(toastEl, message, true, duration, onComplete);
  };

  // [2026-10-09] [作廢] feat: 分頁控制介面 DOM 元素快取宣告 (已改為下方 [2026-10-10] 的 class 選取陣列)
  // const selectPageSize = document.getElementById('select-page-size');
  // const btnPrevPage = document.getElementById('btn-prev-page');
  // const btnNextPage = document.getElementById('btn-next-page');
  // const pageIndicator = document.getElementById('page-indicator');

  // [2026-10-10] feat: 分頁控制介面 DOM 元素快取宣告 (改用 class，支援多組分頁)
  // 變數說明：
  // 1. logCounts: NodeList，儲存所有顯示總筆數的文字標籤
  // 2. selectPageSizes: NodeList，儲存所有每頁筆數下拉選單
  // 3. btnPrevPages: NodeList，儲存所有「上一頁」按鈕
  // 4. btnNextPages: NodeList，儲存所有「下一頁」按鈕
  // 5. pageIndicators: NodeList，儲存所有頁碼指示器
  const logCounts = document.querySelectorAll('.log-count');
  const selectPageSizes = document.querySelectorAll('.select-page-size');
  const btnPrevPages = document.querySelectorAll('.btn-prev-page');
  const btnNextPages = document.querySelectorAll('.btn-next-page');
  const pageIndicators = document.querySelectorAll('.page-indicator');

  /**
   * [2026-10-09] 異動說明
   * 目的：支援前端交易流水帳分頁與序號累計計算
   * 變數說明：
   * 1. currentPage: 當前頁碼（由 1 開始整數）
   * 2. pageSizeSetting: 每頁筆數設定字串（如 '10', '20', '50', '100', 'ALL'，預設 '10'）
   * 3. currentLogsCache: 儲存當前回合載入的完整交易明細陣列，供分頁切換時直接取用
   */
  let currentPage = 1;
  let pageSizeSetting = '10';
  let currentLogsCache = [];

  const toggleModal = (modalEl, show) => {
    if (!modalEl) return;
    modalEl.classList.toggle('hidden', !show);
    modalEl.classList.toggle('flex', show);
  };

  const syncUrl = () => {
    const roundParam = currentRound ? `&round=${encodeURIComponent(currentRound)}` : '';
    const newUrl = currentStock ? `${window.location.pathname}?symbol=${currentStock}${roundParam}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  };

  // [2026-10-07] 修正：防止 type="number" 輸入小數點時被清空的問題
  const bindStrictNumericFilter = (inputElement, allowDecimal = false, maxLen = 10) => {
    if (!inputElement) return;

    inputElement.addEventListener('keydown', (e) => {
      // 允許 Backspace, Delete, Tab, 方向鍵
      if (['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

      // 阻擋科學記號與正負號
      if (['e', 'E', '+', '-'].includes(e.key)) {
        e.preventDefault();
        return;
      }

      // 如果不允許小數點，或是已經有小數點了，阻擋再按小數點
      if (e.key === '.') {
        if (!allowDecimal || inputElement.value.includes('.')) {
          e.preventDefault();
        }
      }
    });
  };

  bindStrictNumericFilter(inputRound, false, 4);
  bindStrictNumericFilter(inputShares, false, 8);
  bindStrictNumericFilter(inputFee, false, 7);
  bindStrictNumericFilter(inputTax, false, 7);
  bindStrictNumericFilter(inputPrice, true, 11);
  bindStrictNumericFilter(inputNetTotal, true, 12);

  /**
   * [2026-10-07] 異動說明
   * 目的：切換交易型態時，更新開窗輸入欄位的啟用/停用與顯示狀態
   * 規則：交易型態為 INPUT (入金) 或 OUTPUT (出金) 時，規則比照 REVENUE / INTEREST 辦理
   * 變數說明：
   * 1. currentType: 當前選取的交易型態字串 (如 'BUY', 'SELL', 'REVENUE', 'INTEREST', 'INPUT', 'OUTPUT')
   * 2. isIncomeType: 布林值，判斷是否屬於純金流/收益類型 (REVENUE, INTEREST, INPUT, OUTPUT)
   * 3. nonIncomeFields: 陣列，存放一般股票買賣才需填寫的欄位 DOM 元素 (單價、股數、手續費、交易稅)
   */
  const updateFormFieldsByTradeType = () => {
    if (!inputTradeType) return;

    // 取得當前選取的交易型態
    const currentType = inputTradeType.value;

    // [2026-10-07] 修正：將 INPUT 與 OUTPUT 納入比照 INTEREST 規則辦理
    const isIncomeType = (
      currentType === 'REVENUE' ||
      currentType === 'INTEREST' ||
      currentType === 'INPUT' ||
      currentType === 'OUTPUT'
    );

    if (isIncomeType) {
      // 顯示實收/收付淨額輸入區塊
      if (wrapNetTotal) wrapNetTotal.classList.remove('hidden');

      // 回合欄位強制為 0 並鎖定唯讀
      if (inputRound) {
        inputRound.value = '0';
        inputRound.readOnly = true;
        inputRound.classList.add('cursor-not-allowed', 'opacity-60');
      }

      // 單價、股數、手續費、交易稅清空歸零並鎖定唯讀
      const nonIncomeFields = [inputPrice, inputShares, inputFee, inputTax];
      nonIncomeFields.forEach((field) => {
        if (field) {
          field.value = '0';
          field.readOnly = true;
          field.classList.add('cursor-not-allowed', 'opacity-60');
        }
      });

      // 自動聚焦至收付淨額欄位便於使用者輸入
      if (inputNetTotal) {
        inputNetTotal.focus();
        inputNetTotal.select();
      }
    } else {
      // 隱藏收付淨額輸入區塊並清空數值
      if (wrapNetTotal) wrapNetTotal.classList.add('hidden');
      if (inputNetTotal) inputNetTotal.value = '';

      // 解除回合欄位鎖定
      if (inputRound) {
        inputRound.readOnly = false;
        inputRound.classList.remove('cursor-not-allowed', 'opacity-60');
        if (inputRound.value === '0') {
          inputRound.value = currentSuggestedRound !== '0' ? currentSuggestedRound : '1';
        }
      }

      // 解除單價、股數、手續費、交易稅欄位鎖定
      const nonIncomeFields = [inputPrice, inputShares, inputFee, inputTax];
      nonIncomeFields.forEach((field) => {
        if (field) {
          field.readOnly = false;
          field.classList.remove('cursor-not-allowed', 'opacity-60');
          if (field.value === '0') field.value = '';
        }
      });
    }
  };

  if (inputTradeType) {
    inputTradeType.addEventListener('change', updateFormFieldsByTradeType);
  }

  if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
  if (inputStockId) {
    inputStockId.value = currentStock;
    inputStockId.readOnly = true;
  }
  if (inputRound) {
    inputRound.value = currentRound || '0';
  }

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

  /**
   * [2026-10-06] 異動說明
   * 目的：載入指定市場與標的交易資訊
   * 實作說明：在 URL 帶上 market 參數，讓後端正確過濾當前市場的標的
   */
  async function loadTradingData(stockId, round) {
    try {
      const roundParam = round !== '' && round !== null && round !== undefined ? encodeURIComponent(round) : '';

      const params = new URLSearchParams();
      params.set('market', currentMarket);
      if (stockId) params.set('stock_id', stockId);
      if (roundParam) params.set('round', roundParam);

      // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
      const res = await window.ClientAuth.authFetch(`/api/trading/detail?${params.toString()}`);
      if (res.status === 401) {
        if (window.ClientAuth) await window.ClientAuth.logout();
        return;
      }

      const result = await res.json();
      if (!result.success) throw new Error(result.message || '查詢失敗');

      const { availableStocks = [], availableRounds = [], summary = {}, logs = [], suggestedRound } = result.data || {};
      currentSuggestedRound = suggestedRound !== undefined && suggestedRound !== null ? String(suggestedRound) : '0';

      // (1) 渲染標的下拉選單
      if (selectStock) {
        selectStock.innerHTML = '<option value="">-- 請選擇標的 --</option>';
        availableStocks.forEach((s) => {
          const opt = document.createElement('option');
          const sId = typeof s === 'object' ? s.stock_id : s;
          const sName = typeof s === 'object' ? s.stock_name : '';
          opt.value = sId;
          opt.textContent = sName ? `${sId}-${sName}` : sId;
          if (sId === stockId) opt.selected = true;
          selectStock.appendChild(opt);
        });

        // [2026-10-09]：標的資料全部塞入完畢後，解除禁用，避免破圖
        selectStock.disabled = false;
      }

      // (2) 渲染回合下拉選單
      if (selectRound) {
        if (!stockId) {
          selectRound.innerHTML = '<option value="">-- 請先選擇標的 --</option>';
          selectRound.disabled = true;
        } else {
          selectRound.disabled = false;
          selectRound.innerHTML = '<option value="">-- 全部歷史 (未選回合) --</option>';
          availableRounds.forEach((r) => {
            const opt = document.createElement('option');
            const roundVal = typeof r === 'object' && r !== null ? r.round : r;
            opt.value = roundVal;
            const statusText = typeof r === 'object' && r.remaining_shares !== undefined ? (Number(r.remaining_shares) === 0 ? '已結束' : '進行中') : '';
            opt.textContent = `第 ${roundVal} 回合${statusText ? ` (${statusText})` : ''}`;
            if (String(roundVal) === String(round)) opt.selected = true;
            selectRound.appendChild(opt);
          });
        }
      }

      // (3) 渲染 5 大 KPI 指標卡片
      const elShares = document.getElementById('stat-shares');
      const elAvgCost = document.getElementById('stat-avg-cost');
      const elBuyCost = document.getElementById('stat-buy-cost');
      const elRevenue = document.getElementById('stat-revenue');
      const elPnl = document.getElementById('stat-pnl');

      if (!stockId) {
        if (elShares) elShares.textContent = '-- 股';
        if (elAvgCost) elAvgCost.textContent = '--';
        if (elBuyCost) elBuyCost.textContent = '--';
        if (elRevenue) elRevenue.textContent = '--';
        if (elPnl) {
          elPnl.textContent = '--';
          elPnl.className = 'text-xl font-bold mt-1 text-gray-400';
        }
      } else {
        if (elShares) elShares.textContent = `${Number(summary.remainingShares || 0).toLocaleString()} 股`;
        if (elAvgCost) elAvgCost.textContent = `${currencySymbol}${Number(summary.avgCost || 0).toLocaleString()}`;
        if (elBuyCost) elBuyCost.textContent = `${currencySymbol}${Number(summary.totalBuyCost || 0).toLocaleString()}`;
        if (elRevenue) {
          const totalRev = Number(summary.totalSellRevenue || 0) + Number(summary.totalDividends || 0);
          elRevenue.textContent = `${currencySymbol}${totalRev.toLocaleString()}`;
        }
        if (elPnl) {
          const totalPnl = Number(summary.totalPnl ?? 0);
          const isProfit = totalPnl >= 0;
          elPnl.textContent = `${isProfit ? '+' : '-'}${currencySymbol}${Math.abs(totalPnl).toLocaleString()}`;
          elPnl.className = `text-xl font-bold mt-1 ${isProfit ? 'text-profit' : 'text-loss'}`;
        }
      }

      // (4) [2026-10-09] feat: 暫存當前查詢的全部流水帳，重設當前頁碼為第 1 頁並執行分頁渲染
      currentLogsCache = Array.isArray(logs) ? logs : [];
      currentPage = 1;
      renderTable(stockId, round);
    } catch (err) {
      console.error('[TradingLog Load Error]:', err);
      const tbody = document.getElementById('trade-log-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-red-400">載入失敗: ${err.message}</td></tr>`;
      updatePaginationControls(0, 1, 1);
    }
  }

  /**
   * [2026-10-09] 異動說明
   * 目的：依據當前分頁與每頁筆數，渲染歷史交易明細流水帳表格（含最左側自動計算之序號欄位）
   * 變數說明：
   * 1. stockId: 當前選取的標的代碼
   * 2. round: 當前選取的回合
   * 3. totalCount: 當前回合總紀錄筆數
   * 4. isAll: 是否選擇顯示全部
   * 5. pageSizeNum: 數字型態的每頁顯示筆數
   * 6. totalPages: 總頁數
   * 7. startIndex: 當前頁面第一筆資料在整個陣列中的起始索引 (用於計算序號與 slice)
   * 8. currentRows: 當前頁面要切片顯示的交易明細清單
   */
  function renderTable(stockId, round) {
    const tbody = document.getElementById('trade-log-body');
    if (!tbody) return;

    // 檢查條件：未選擇標的
    if (!stockId) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">請先由上方選單選擇標的代碼</td></tr>';
      updatePaginationControls(0, 1, 1);
      return;
    }

    // 檢查條件：未選擇回合
    if (round === '' || round === null || round === undefined) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">請選擇特定回合以檢視該回合交易流水帳明細</td></tr>';
      updatePaginationControls(0, 1, 1);
      return;
    }

    // 檢查條件：該回合無任何明細紀錄
    const totalCount = currentLogsCache.length;
    if (totalCount === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">該回合尚無任何交易流水記錄</td></tr>';
      updatePaginationControls(0, 1, 1);
      return;
    }

    // 依據每頁筆數計算總頁數與資料切片
    const isAll = pageSizeSetting === 'ALL';
    const pageSizeNum = isAll ? totalCount : parseInt(pageSizeSetting, 10);
    const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalCount / pageSizeNum));

    // 當前頁碼防呆邊界檢查
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * pageSizeNum;
    const currentRows = isAll ? currentLogsCache : currentLogsCache.slice(startIndex, startIndex + pageSizeNum);

    // [2026-10-07] 異動說明：將 INTEREST 類別的中文顯示文字由「利息」改為「銀行利息」
    const TYPE_MAP = {
      BUY: { label: '買進', class: 'badge-buy' },
      SELL: { label: '賣出', class: 'badge-sell' },
      REVENUE: { label: '股息', class: 'badge-dividend' },
      INTEREST: { label: '銀行利息', class: 'badge-dividend' },
      INPUT: { label: '入金', class: 'badge-input' },
      OUTPUT: { label: '出金', class: 'badge-output' }
    };

    // 渲染資料列：第一欄為自動累加序號 (由 1 開始累算)
    tbody.innerHTML = currentRows.map((log, index) => {
      const serialNumber = startIndex + index + 1; // 序號計算：(當前頁碼 - 1) * 每頁筆數 + 當頁索引 + 1
      const typeConf = TYPE_MAP[log.trade_type] || { label: log.trade_type, class: 'badge-buy' };
      const isIncome = ['SELL', 'REVENUE', 'INTEREST'].includes(log.trade_type);

      return `
        <tr>
          <td class="px-3 py-3 text-center text-gray-400 font-mono text-xs">${serialNumber}</td>
          <td class="px-4 py-3">${log.trade_date ? log.trade_date.slice(0, 10) : '-'}</td>
          <td class="px-4 py-3"><span class="badge ${typeConf.class}">${typeConf.label} (R${log.round})</span></td>
          <td class="px-4 py-3 text-right">${Number(log.price || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right">${Number(log.shares || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right text-gray-400">${Number(log.fee || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right text-gray-400">${Number(log.tax || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right font-medium ${isIncome ? 'text-profit' : 'text-loss'}">
            ${isIncome ? '+' : '-'}${currencySymbol}${Math.abs(Number(log.net_total || 0)).toLocaleString()}
          </td>
          <td class="px-4 py-3 text-gray-400">${log.note || ''}</td>
          <td class="px-4 py-3 text-center">
            <button type="button" class="btn-edit text-blue-400 hover:text-blue-300 mr-2.5 text-xs font-medium" data-id="${log.trade_id}">編輯</button>
            <button type="button" class="btn-delete text-gray-500 hover:text-red-400 text-xs font-medium" data-id="${log.trade_id}">刪除</button>
          </td>
        </tr>
      `;
    }).join('');

    // 重新綁定當頁按鈕的編輯與刪除事件
    bindTableRowEvents();

    // 更新分頁按鈕狀態與頁碼顯示
    updatePaginationControls(totalCount, currentPage, totalPages);
  }

  // [2026-10-09] [作廢] 異動說明 (已改為 [2026-10-10] 支援 class 多組同步邏輯)
  // 目的：更新分頁指示器文字與切換按鈕的啟用/停用樣式
  // 變數說明：
  // 1. totalCount: 總筆數
  // 2. current: 當前頁碼
  // 3. totalPages: 總頁數
  // function updatePaginationControls(totalCount, current, totalPages) { ... }

  /**
   * [2026-10-10] 異動說明
   * 目的：更新分頁指示器文字與切換按鈕的啟用/停用樣式 (支援 class 多組同步)
   * 變數說明：
   * 1. totalCount: 總筆數 (若為 0 則鎖定按鈕)
   * 2. current: 當前頁碼 
   * 3. totalPages: 總頁數
   */
  function updatePaginationControls(totalCount, current, totalPages) {
    // 1. 同步更新所有總筆數標籤
    logCounts.forEach(el => {
      el.textContent = `共 ${totalCount} 筆`;
    });

    // 2. 同步更新所有頁碼文字
    pageIndicators.forEach(el => {
      el.textContent = `第 ${current} / ${totalPages} 頁`;
    });
    
    // 3. 同步更新所有「上一頁」按鈕狀態
    const disablePrev = (current <= 1 || totalCount === 0);
    btnPrevPages.forEach(el => {
      el.disabled = disablePrev;
    });
    
    // 4. 同步更新所有「下一頁」按鈕狀態
    const disableNext = (current >= totalPages || totalCount === 0);
    btnNextPages.forEach(el => {
      el.disabled = disableNext;
    });
  }

  /**
   * [2026-10-09] 異動說明
   * 目的：為表格內的「編輯」與「刪除」按鈕綁定操作事件
   */
  function bindTableRowEvents() {
    const tbody = document.getElementById('trade-log-body');
    if (!tbody) return;

    tbody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.onclick = () => {
        const targetLog = currentLogsCache.find((item) => String(item.trade_id) === String(btn.dataset.id));
        if (!targetLog) return;

        if (inputTradeId) inputTradeId.value = targetLog.trade_id;
        if (modalTitle) modalTitle.textContent = '編輯交易明細';
        if (btnSubmitTradeText) btnSubmitTradeText.textContent = '儲存修改';

        /**
         * [2026-10-12] 異動說明
         * 目的：編輯模式下，隱藏「儲存並繼續新增」按鈕
         */
        if (btnSubmitTradeContinue) btnSubmitTradeContinue.classList.add('hidden');

        // [2026-10-13] 編輯模式時確保提示條處於隱藏狀態
        if (tradeToast) tradeToast.classList.add('hidden');

        if (inputStockId) {
          inputStockId.value = targetLog.stock_id || currentStock;
          inputStockId.readOnly = true;
        }

        if (inputTradeDate) inputTradeDate.value = targetLog.trade_date ? targetLog.trade_date.slice(0, 10) : '';
        if (inputTradeType) inputTradeType.value = targetLog.trade_type || 'BUY';

        updateFormFieldsByTradeType();

        // [2026-10-07] 異動說明：編輯帶入資料時，INPUT 與 OUTPUT 比照 REVENUE / INTEREST 設定數值
        const isIncome = ['REVENUE', 'INTEREST', 'INPUT', 'OUTPUT'].includes(targetLog.trade_type);
        if (isIncome) {
          if (inputRound) inputRound.value = '0';
          if (inputNetTotal) inputNetTotal.value = Math.abs(Number(targetLog.net_total || 0));
        } else {
          if (inputRound) inputRound.value = targetLog.round !== undefined ? targetLog.round : '0';
          if (inputPrice) inputPrice.value = targetLog.price || '';
          if (inputShares) inputShares.value = targetLog.shares || '';
          if (inputFee) inputFee.value = targetLog.fee || '';
          if (inputTax) inputTax.value = targetLog.tax || '';
        }

        if (inputNote) inputNote.value = targetLog.note || '';

        toggleModal(modalTrade, true);
      };
    });

    tbody.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('確定要刪除這筆交易記錄嗎？此操作將無法復原。')) return;
        try {
          // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
          const res = await window.ClientAuth.authFetch(`/api/trading/detail?trade_id=${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          const result = await res.json();
          if (!result.success) throw new Error(result.message);
          loadTradingData(currentStock, currentRound);
        } catch (err) {
          alert(`刪除失敗: ${err.message}`);
        }
      };
    });
  }

  // =========================================================================
  // [2026-10-09] [作廢] feat: 監聽分頁操作控制元件事件 (已改為 [2026-10-10] class 陣列綁定)
  // =========================================================================
  // if (selectPageSize) { ... }
  // if (btnPrevPage) { ... }
  // if (btnNextPage) { ... }

  // =========================================================================
  // [2026-10-10] feat: 監聽分頁操作控制元件事件 (針對 class 多組元件綁定)
  // =========================================================================
  
  // 綁定所有每頁筆數下拉選單
  selectPageSizes.forEach(selectEl => {
    selectEl.addEventListener('change', (e) => {
      pageSizeSetting = e.target.value;
      
      // 連動更新畫面上其他所有的下拉選單的值，保持狀態一致
      selectPageSizes.forEach(el => {
        if (el !== e.target) el.value = pageSizeSetting;
      });
      
      currentPage = 1; // 切換每頁筆數時重回第 1 頁
      renderTable(currentStock, currentRound);
    });
  });

  // 綁定所有上一頁按鈕
  btnPrevPages.forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderTable(currentStock, currentRound);
      }
    });
  });

  // 綁定所有下一頁按鈕
  btnNextPages.forEach(btn => {
    btn.addEventListener('click', () => {
      const isAll = pageSizeSetting === 'ALL';
      const pageSizeNum = isAll ? currentLogsCache.length : parseInt(pageSizeSetting, 10);
      const totalPages = isAll ? 1 : Math.ceil(currentLogsCache.length / pageSizeNum);

      if (currentPage < totalPages) {
        currentPage++;
        renderTable(currentStock, currentRound);
      }
    });
  });

  if (selectStock) {
    selectStock.onchange = (e) => {
      currentStock = e.target.value;
      currentRound = '';
      syncUrl();
      loadTradingData(currentStock, currentRound);
    };
  }

  if (selectRound) {
    selectRound.onchange = (e) => {
      currentRound = e.target.value;
      syncUrl();
      loadTradingData(currentStock, currentRound);
    };
  }

  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  if (btnOpenModal) {
    btnOpenModal.onclick = () => {
      if (!currentStock) {
        alert('請先在上方選單選擇「標的」，再新增交易明細！');
        if (selectStock) selectStock.focus();
        return;
      }
      if (inputTradeId) inputTradeId.value = '';
      if (modalTitle) modalTitle.textContent = '新增交易明細';
      if (btnSubmitTradeText) btnSubmitTradeText.textContent = '儲存並關閉';

      /**
       * [2026-10-12] 異動說明
       * 目的：在新增模式下，確保「儲存並繼續新增」按鈕正常顯示
       */
      if (btnSubmitTradeContinue) btnSubmitTradeContinue.classList.remove('hidden');

      // [2026-10-13] 開啟時重設隱藏浮動提示條
      if (tradeToast) tradeToast.classList.add('hidden');

      if (inputStockId) {
        inputStockId.value = currentStock;
        inputStockId.readOnly = true;
      }

      if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
      if (inputTradeType) inputTradeType.value = 'BUY';
      if (inputRound) inputRound.value = currentSuggestedRound !== '0' ? currentSuggestedRound : '1';
      if (inputPrice) inputPrice.value = '';
      if (inputShares) inputShares.value = '';
      if (inputFee) inputFee.value = '';
      if (inputTax) inputTax.value = '';
      if (inputNetTotal) inputNetTotal.value = '';
      if (inputNote) inputNote.value = '';

      updateFormFieldsByTradeType();
      toggleModal(modalTrade, true);
    };
  }

  if (btnCloseModal) {
    btnCloseModal.onclick = () => toggleModal(modalTrade, false);
  }

  const btnSubmitTrade = document.getElementById('btn-submit-trade');

  /**
   * [2026-10-12] 異動說明
   * 目的：送出交易明細表單資料，支援「儲存並關閉」或「儲存並繼續新增」
   * 變數說明：
   * 1. keepOpen: 布林值，true 代表儲存後不關閉彈窗，繼續登打下一筆明細
   * 2. trade_id: 交易流水識別碼 (若有值表示為編輯模式)
   * 3. stock_id: 股票標的代碼
   * 4. trade_date: 交易發生日期
   * 5. trade_type: 交易型態字串
   * 6. isIncomeType: 是否為收益金流型態
   * 7. round: 交易回合數
   * 8. isEdit: 是否為編輯模式
   * 9. payload: 送往 API 的交易資料物件
   */
  async function submitTradeForm(keepOpen = false) {
    const trade_id = inputTradeId?.value?.trim();
    const stock_id = inputStockId?.value?.trim();
    const trade_date = inputTradeDate?.value?.trim();
    const trade_type = inputTradeType?.value;

    if (!stock_id || !trade_date || !trade_type) {
      alert('請完整填寫標的代碼、交易日期與交易型態！');
      return;
    }

    if (isNaN(new Date(trade_date).getTime())) {
      alert('請填寫正確有效的交易日期！');
      if (inputTradeDate) inputTradeDate.focus();
      return;
    }

    /**
     * [2026-10-07] 異動說明
     * 目的：驗證送出資料時，INPUT 與 OUTPUT 比照 REVENUE / INTEREST 邏輯
     * 變數說明：
     * 1. isIncomeType: 判斷是否為收益/金流型態 (REVENUE, INTEREST, INPUT, OUTPUT)
     * 2. round: 回合數 (金流型態強制為 0，買賣交易則檢核整數值)
     * 3. netTotalNum: 收付淨額數值
     */
    const isIncomeType = (
      trade_type === 'REVENUE' ||
      trade_type === 'INTEREST' ||
      trade_type === 'INPUT' ||
      trade_type === 'OUTPUT'
    );
    let round = 0;

    const MAX_ROUND_LIMIT = 9999;
    const MAX_PRICE_LIMIT = 999999.9999;
    const MAX_SHARES_LIMIT = 99999999;
    const MAX_FEE_LIMIT = 9999999;
    const MAX_NET_TOTAL_LIMIT = 999999999;

    if (isIncomeType) {
      round = 0;
      const netTotalNum = Number(inputNetTotal?.value || 0);
      if (netTotalNum <= 0) {
        alert('請填寫大於 0 的實收入帳金額！');
        if (inputNetTotal) inputNetTotal.focus();
        return;
      }
      if (netTotalNum > MAX_NET_TOTAL_LIMIT) {
        alert(`實收入帳金額過大，不可超過 ${MAX_NET_TOTAL_LIMIT.toLocaleString()}！`);
        if (inputNetTotal) inputNetTotal.focus();
        return;
      }
    } else {
      const roundRaw = inputRound?.value?.trim();
      round = parseInt(roundRaw, 10);
      if (isNaN(round) || round < 0) {
        alert('回合 (Round) 只能填寫大於或等於 0 的整數！');
        if (inputRound) inputRound.focus();
        return;
      }
      if (round > MAX_ROUND_LIMIT) {
        alert(`回合數不可超過 ${MAX_ROUND_LIMIT}！`);
        if (inputRound) inputRound.focus();
        return;
      }

      const priceNum = Number(inputPrice?.value || 0);
      const sharesNum = Number(inputShares?.value || 0);
      const feeNum = Number(inputFee?.value || 0);
      const taxNum = Number(inputTax?.value || 0);

      if (priceNum <= 0 || priceNum > MAX_PRICE_LIMIT) {
        alert(`單價必須大於 0 且不可超過 ${MAX_PRICE_LIMIT}！`);
        if (inputPrice) inputPrice.focus();
        return;
      }
      if (sharesNum <= 0 || sharesNum > MAX_SHARES_LIMIT) {
        alert(`股數必須大於 0 且不可超過 ${MAX_SHARES_LIMIT.toLocaleString()} 股！`);
        if (inputShares) inputShares.focus();
        return;
      }
      if (feeNum > MAX_FEE_LIMIT || taxNum > MAX_FEE_LIMIT) {
        alert(`手續費或交易稅金額過大，請確認是否輸入正確！`);
        return;
      }
    }

    const isEdit = Boolean(trade_id);
    const payload = {
      ...(isEdit && { trade_id }),
      stock_id,
      round,
      trade_date,
      trade_type,
      price: isIncomeType ? 0 : (inputPrice?.value || 0),
      shares: isIncomeType ? 0 : (inputShares?.value || 0),
      fee: isIncomeType ? 0 : (inputFee?.value || 0),
      tax: isIncomeType ? 0 : (inputTax?.value || 0),
      net_total: isIncomeType ? (inputNetTotal?.value || 0) : undefined,
      note: inputNote?.value?.trim() || ''
    };

    try {
      // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
      const res = await window.ClientAuth.authFetch('/api/trading/detail', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message);

      // 重新整理資料庫與流水帳數據
      currentStock = stock_id.toUpperCase();
      loadTradingData(currentStock, currentRound);

      /**
       * [2026-10-15] 異動說明
       * 目的：儲存成功改用共用 showSuccessToast 提示，依 isEdit 統一顯示「✓ 編輯成功」或「✓ 新增成功」
       */
      if (keepOpen && !isEdit) {
        if (inputPrice) inputPrice.value = '';
        if (inputShares) inputShares.value = '';
        if (inputFee) inputFee.value = '';
        if (inputTax) inputTax.value = '';
        if (inputNetTotal) inputNetTotal.value = '';
        if (inputNote) inputNote.value = '';

        // 浮現成功提示條並於 1.5 秒後自動隱藏 (保持開窗)
        showSuccessToast(tradeToast, isEdit, 1500);

        // 依交易型態自動重新聚焦
        if (isIncomeType) {
          if (inputNetTotal) inputNetTotal.focus();
        } else {
          if (inputPrice) inputPrice.focus();
        }
      } else {
        // 浮現成功提示條，停留 0.9 秒後自動關閉開窗
        showSuccessToast(tradeToast, isEdit, 900, () => {
          toggleModal(modalTrade, false);
        });
      }
    } catch (err) {
      /**
       * [2026-10-15] 異動說明
       * 目的：新增或更新交易明細失敗時，改以紅色 Toast 警示，不阻斷且不關閉開窗
       * 變數說明：
       * 1. errorMessage: 失敗錯誤提示文字
       */
      const errorMessage = `✕ ${isEdit ? '更新' : '新增'}失敗: ${err.message}`;
      showModalToast(tradeToast, errorMessage, false, 2000);
    }
  }

  // 綁定交易開窗「儲存並關閉」事件
  if (btnSubmitTrade) {
    btnSubmitTrade.onclick = () => submitTradeForm(false);
  }

  /**
   * [2026-10-12] 異動說明
   * 目的：綁定交易開窗「儲存並繼續新增」點擊事件
   */
  if (btnSubmitTradeContinue) {
    btnSubmitTradeContinue.onclick = () => submitTradeForm(true);
  }

  const btnOpenStockModal = document.getElementById('btn-open-stock-modal');
  const btnCloseStockModal = document.getElementById('btn-close-stock-modal');
  const btnSubmitStockComp = document.getElementById('btn-submit-stock-comp');

  if (btnOpenStockModal) {
    btnOpenStockModal.onclick = () => {
      if (inputNewStockId) inputNewStockId.value = '';
      if (inputNewStockName) inputNewStockName.value = '';
      // [2026-10-13] 開啟時重設隱藏標的提示條
      if (stockToast) stockToast.classList.add('hidden');
      toggleModal(modalStock, true);
    };
  }

  if (btnCloseStockModal) {
    btnCloseStockModal.onclick = () => toggleModal(modalStock, false);
  }

  /**
   * [2026-10-12] 異動說明
   * 目的：送出標的維護表單資料，支援「儲存並關閉」或「儲存並繼續新增」
   * 變數說明：
   * 1. keepOpen: 布林值，true 代表儲存後不關閉彈窗，繼續新增下一個標的
   * 2. stock_id: 新增之標的代碼
   * 3. stock_name: 新增之標的名稱
   */
  async function submitStockCompForm(keepOpen = false) {
    const stock_id = inputNewStockId?.value?.trim();
    const stock_name = inputNewStockName?.value?.trim();

    // [2026-10-12] feat: 標的名稱改為選填
    if (!stock_id) {
      alert('請完整填寫標的代碼！');
      return;
    }

    try {
      // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
      const res = await window.ClientAuth.authFetch('/api/trading/addstock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id,
          stock_name,
          market_type: currentMarket
        })
      });
      const result = await res.json();
      if (!result.success) {
        /**
         * [2026-10-15] 異動說明
         * 目的：標的新增業務檢核失敗時，改以紅色 Toast 警示，不跳原生 alert 且不關閉開窗
         * 變數說明：
         * 1. failMessage