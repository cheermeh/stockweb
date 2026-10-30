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
  // 變數用途說明：sessionInfo 儲存由前端 ClientAuth 取得之使用者登入工作階段物件
  const sessionInfo = window.ClientAuth ? window.ClientAuth.getSessionInfo() : {};
  // [2026-10-08] feat: 移除市場別預設 TW (requireAuth 已確保有市場別)
  // 變數用途說明：currentMarket 儲存當前選定的市場代碼 (例如 'TW', 'US', 'JP')
  const currentMarket = String(sessionInfo.market || '').toUpperCase();
  // [2026-10-08] feat: 幣別符號一律使用 $，不再依市場區分
  // 變數用途說明：currencySymbol 定義全站統一之貨幣符號
  const currencySymbol = '$';

  // 取得網址列參數
  // 變數用途說明：urlParams 解析當前瀏覽器網址列查詢參數
  const urlParams = new URLSearchParams(window.location.search);
  // 變數用途說明：currentStock 當前聚焦的股票標的代碼 (強制轉大寫)
  let currentStock = (urlParams.get('symbol') || urlParams.get('stock_id') || '').toUpperCase();
  // 變數用途說明：currentRound 當前聚焦的交易回合字串
  let currentRound = (urlParams.get('round') || '').toUpperCase();
  // 變數用途說明：currentSuggestedRound 後端計算建議開立的下一個回合編號
  let currentSuggestedRound = '0';

  /**
   * [2026-10-30] 異動說明
   * 目的：
   * 1. availableStocksCache 快取可用標的清單
   * 2. isDataLoading 防呆旗標：標記母頁面交易與回合資料是否正在非同步載入中
   * 3. pendingOpenModal 排隊旗標：若使用者在載入中點擊新增，等載入完畢自動開窗，不需點二次
   */
  // 變數用途說明：availableStocksCache 儲存目前市場所有可供選擇的標的快取清單
  let availableStocksCache = [];
  // 變數用途說明：isDataLoading 布林旗標，標記母頁面交易與回合資料是否正在非同步載入中
  let isDataLoading = false;
  // 變數用途說明：pendingOpenModal 布林旗標，標記是否有排隊等待載入完成後自動展開的新增開窗請求
  let pendingOpenModal = false;

  // =========================================================================
  // DOM 元素快取宣告
  // =========================================================================
  // 變數用途說明：selectStock 頂部導覽列標的下拉選單元素；selectRound 頂部導覽列回合下拉選單元素
  const selectStock = document.getElementById('select-stock');
  const selectRound = document.getElementById('select-round');

  // 變數用途說明：modalTrade 交易明細彈窗外層容器；modalTitle 交易彈窗標題文字；btnSubmitTradeText 交易送出按鈕主文字
  const modalTrade = document.getElementById('modal-add-trade');
  const modalTitle = document.getElementById('modal-title');
  const btnSubmitTradeText = document.getElementById('btn-submit-trade-text');

  // 變數用途說明：快取交易明細表單內各輸入元件 DOM
  const inputTradeId = document.getElementById('input-trade-id');
  // [2026-10-30] 說明：inputStockId 於 HTML 已由文字輸入框改為下拉選單元素 (<select>)
  const inputStockId = document.getElementById('input-stock-id');
  const inputRound = document.getElementById('input-round');
  const inputTradeDate = document.getElementById('input-trade-date');
  const inputTradeType = document.getElementById('input-trade-type');
  const inputPrice = document.getElementById('input-price');
  const inputShares = document.getElementById('input-shares');
  const inputFee = document.getElementById('input-fee');
  const inputTax = document.getElementById('input-tax');
  const inputNote = document.getElementById('input-note');

  // 變數用途說明：wrapNetTotal 收付淨額輸入外層區塊；inputNetTotal 收付淨額數字輸入框
  const wrapNetTotal = document.getElementById('wrap-net-total');
  const inputNetTotal = document.getElementById('input-net-total');

  // 變數用途說明：modalStock 標的維護彈窗外層容器；inputNewStockId 新標的代碼輸入框；inputNewStockName 新標的名稱輸入框
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

  /**
   * [2026-10-10] 異動說明
   * 目的：分頁控制介面 DOM 元素快取宣告 (改用 class，支援多組分頁)
   * 變數說明：
   * 1. logCounts: NodeList，儲存所有顯示總筆數的文字標籤
   * 2. selectPageSizes: NodeList，儲存所有每頁筆數下拉選單
   * 3. btnPrevPages: NodeList，儲存所有「上一頁」按鈕
   * 4. btnNextPages: NodeList，儲存所有「下一頁」按鈕
   * 5. pageIndicators: NodeList，儲存所有頁碼指示器
   */
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

  // 變數用途說明：toggleModal 切換彈窗顯示與隱藏狀態之輔助函式
  const toggleModal = (modalEl, show) => {
    if (!modalEl) return;
    modalEl.classList.toggle('hidden', !show);
    modalEl.classList.toggle('flex', show);
  };

  // 變數用途說明：syncUrl 將當前選取的標的與回合即時同步更新至瀏覽器網址列 (不重新整理)
  const syncUrl = () => {
    const roundParam = currentRound ? `&round=${encodeURIComponent(currentRound)}` : '';
    const newUrl = currentStock ? `${window.location.pathname}?symbol=${currentStock}${roundParam}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  };

  // [2026-10-07] 修正：防止 type="number" 輸入小數點時被清空的問題
  // 變數用途說明：bindStrictNumericFilter 數字欄位嚴格鍵盤輸入過濾監聽器
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
   * [2026-10-30] 異動說明
   * 目的：渲染彈窗中的標的下拉選單選項
   * 變數說明：
   * 1. targetStockId: 預設選中的標的代碼
   */
  const renderModalStockOptions = (targetStockId = '') => {
    if (!inputStockId) return;
    inputStockId.innerHTML = '<option value="">-- 請選擇標的 --</option>';
    availableStocksCache.forEach((s) => {
      // 變數用途說明：opt 下拉選單 option 元素
      const opt = document.createElement('option');
      // 變數用途說明：sId 股票代號
      const sId = typeof s === 'object' ? s.stock_id : s;
      // 變數用途說明：sName 股票名稱
      const sName = typeof s === 'object' ? s.stock_name : '';
      opt.value = sId;
      opt.textContent = sName ? `${sId}-${sName}` : sId;
      if (sId === targetStockId) opt.selected = true;
      inputStockId.appendChild(opt);
    });
  };

  /**
   * [2026-10-30] 異動說明 (方法一核心函式)
   * 目的：直接自外層已渲染完成之 selectRound 下拉選單讀取「(進行中)」的回合數 (0 延遲且完全吻合母頁)
   * 變數說明：
   * 1. options: 外層回合選單的所有 HTMLOptionElement 陣列
   * 2. activeOption: 找到包含 (進行中) 字樣的選項元素
   */
  const getActiveRoundFromSelectRoundDom = () => {
    if (!selectRound || !selectRound.options || selectRound.options.length <= 1) {
      return currentSuggestedRound !== '0' ? currentSuggestedRound : '1';
    }

    // 遍歷外層已渲染好的 option 尋找文字包含 "(進行中)" 的項目
    const options = Array.from(selectRound.options);
    const activeOption = options.find((opt) => opt.textContent && opt.textContent.includes('(進行中)'));

    if (activeOption && activeOption.value) {
      return String(activeOption.value);
    }

    // 若全部回合皆已結束，則優先回傳後端建議開立之新回合數
    if (currentSuggestedRound !== '0' && currentSuggestedRound !== '') {
      return currentSuggestedRound;
    }

    // 若無建議回合數，取最後一個回合值加 1
    const validNumericRounds = options
      .map((opt) => parseInt(opt.value, 10))
      .filter((val) => !isNaN(val) && val > 0);

    if (validNumericRounds.length > 0) {
      const maxRound = Math.max(...validNumericRounds);
      return String(maxRound + 1);
    }

    return '1';
  };

  // 變數用途說明：btnSubmitTrade 送出交易表單按鈕
  const btnSubmitTrade = document.getElementById('btn-submit-trade');

  /**
   * [2026-10-30] 異動說明
   * 目的：若使用者在開窗內切換標的，在尚未取得最新回合數前進入 LOADING 鎖定，載入完成後再解鎖
   * 變數說明：
   * 1. selectedStock: 開窗內新選取的標的代碼
   */
  if (inputStockId) {
    inputStockId.addEventListener('change', async (e) => {
      const selectedStock = e.target.value;
      if (!selectedStock) return;

      // 若選回母頁當前標的，直接吃母頁快取，0 秒即時帶出
      if (selectedStock === currentStock) {
        if (inputRound) inputRound.value = getActiveRoundFromSelectRoundDom();
        return;
      }

      // [2026-10-30] 切換新標的：進入 LOADING 狀態，暫時鎖定欄位與按鈕
      if (inputRound) {
        inputRound.type = 'text'; // 暫時轉為文字型態以顯示提示字
        inputRound.value = '載入中...';
        inputRound.disabled = true;
        inputRound.classList.add('cursor-wait', 'opacity-60');
      }
      if (btnSubmitTrade) btnSubmitTrade.disabled = true;
      if (btnSubmitTradeContinue) btnSubmitTradeContinue.disabled = true;

      try {
        // 同步通知母頁載入該新標的，並保持在全部歷史 (currentRound = '')
        currentStock = selectedStock;
        currentRound = '';
        syncUrl();
        await loadTradingData(currentStock, currentRound);
      } finally {
        // 載入完成，恢復數字型態並填入抓取到的最新回合數
        if (inputRound) {
          inputRound.type = 'number';
          inputRound.disabled = false;
          inputRound.classList.remove('cursor-wait', 'opacity-60');
          inputRound.value = getActiveRoundFromSelectRoundDom();
        }
        if (btnSubmitTrade) btnSubmitTrade.disabled = false;
        if (btnSubmitTradeContinue) btnSubmitTradeContinue.disabled = false;
      }
    });
  }

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
          // [2026-10-30] 解除唯讀時，即時帶回該標的進行中/建議回合數
          inputRound.value = getActiveRoundFromSelectRoundDom();
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
  
  if (inputRound) {
    inputRound.value = currentRound || '0';
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

  /**
   * [2026-10-30] 異動說明
   * 目的：執行新增明細開窗的核心表單初始化動作 (支援主動開啟與排隊自動開啟)
   */
  const executeOpenAddTradeModal = () => {
    if (inputTradeId) inputTradeId.value = '';
    if (modalTitle) modalTitle.textContent = '新增交易明細';
    if (btnSubmitTradeText) btnSubmitTradeText.textContent = '儲存並關閉';

    if (btnSubmitTradeContinue) btnSubmitTradeContinue.classList.remove('hidden');
    if (tradeToast) tradeToast.classList.add('hidden');

    // 渲染開窗標的選單並解鎖
    if (inputStockId) {
      inputStockId.disabled = false;
      renderModalStockOptions(currentStock);
    }

    if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
    if (inputTradeType) inputTradeType.value = 'BUY';

    // 0 秒無延遲同步帶入：直接自外層已載入之 selectRound 讀取「進行中」回合數
    if (inputRound) {
      inputRound.type = 'number';
      inputRound.disabled = false;
      inputRound.classList.remove('cursor-wait', 'opacity-60');
      inputRound.value = getActiveRoundFromSelectRoundDom();
    }

    if (inputPrice) inputPrice.value = '';
    if (inputShares) inputShares.value = '';
    if (inputFee) inputFee.value = '';
    if (inputTax) inputTax.value = '';
    if (inputNetTotal) inputNetTotal.value = '';
    if (inputNote) inputNote.value = '';

    updateFormFieldsByTradeType();
    toggleModal(modalTrade, true);
  };

  /**
   * [2026-10-06] 異動說明
   * 目的：載入指定市場與標的交易資訊
   * 實作說明：在 URL 帶上 market 參數，讓後端正確過濾當前市場的標的
   */
  async function loadTradingData(stockId, round) {
    // [2026-10-30] 防呆機制：標註資料載入中
    isDataLoading = true;
    try {
      // 變數用途說明：roundParam 經 URI 編碼後的指定回合查詢參數
      const roundParam = round !== '' && round !== null && round !== undefined ? encodeURIComponent(round) : '';

      // 變數用途說明：params 封裝向後端 detail API 請求之 Query String 物件
      const params = new URLSearchParams();
      params.set('market', currentMarket);
      if (stockId) params.set('stock_id', stockId);
      if (roundParam) params.set('round', roundParam);

      // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
      // 變數用途說明：res 發送至 trading/detail API 之 fetch 回應物件
      const res = await window.ClientAuth.authFetch(`/api/trading/detail?${params.toString()}`);
      if (res.status === 401) {
        if (window.ClientAuth) await window.ClientAuth.logout();
        return;
      }

      // 變數用途說明：result 後端回傳之 JSON 解析物件
      const result = await res.json();
      if (!result.success) throw new Error(result.message || '查詢失敗');

      // 變數用途說明：解構後端回傳之可用標的、回合清單、財務彙總與流水明細
      const { availableStocks = [], availableRounds = [], summary = {}, logs = [], suggestedRound } = result.data || {};
      currentSuggestedRound = suggestedRound !== undefined && suggestedRound !== null ? String(suggestedRound) : '0';

      // [2026-10-30] feat: 快取可用標的清單，提供開窗下拉選單使用
      availableStocksCache = Array.isArray(availableStocks) ? availableStocks : [];

      // (1) 渲染標的下拉選單
      if (selectStock) {
        selectStock.innerHTML = '<option value="">-- 請選擇標的 --</option>';
        availableStocks.forEach((s) => {
          // 變數用途說明：opt 標的下拉選單項目元素
          const opt = document.createElement('option');
          // 變數用途說明：sId 標的股票代碼字串
          const sId = typeof s === 'object' ? s.stock_id : s;
          // 變數用途說明：sName 標的股票顯示名稱
          const sName = typeof s === 'object' ? s.stock_name : '';
          opt.value = sId;
          opt.textContent = sName ? `${sId}-${sName}` : sId;
          if (sId === stockId) opt.selected = true;
          selectStock.appendChild(opt);
        });

        // [2026-10-09]：標的資料全部塞入完畢後，解除禁用，避免破圖
        selectStock.disabled = false;
      }

      // (2) 渲染回合下拉選單 (依舊保持在全部歷史，未強制跳動)
      if (selectRound) {
        if (!stockId) {
          selectRound.innerHTML = '<option value="">-- 請先選擇標的 --</option>';
          selectRound.disabled = true;
        } else {
          selectRound.disabled = false;
          selectRound.innerHTML = '<option value="">-- 全部歷史 (未選回合) --</option>';
          availableRounds.forEach((r) => {
            // 變數用途說明：opt 回合下拉選單項目元素
            const opt = document.createElement('option');
            // 變數用途說明：roundVal 回合整數值
            const roundVal = typeof r === 'object' && r !== null ? r.round : r;
            opt.value = roundVal;
            // 變數用途說明：statusText 回合進行狀態提示字詞 (進行中 / 已結束)
            const statusText = typeof r === 'object' && r.remaining_shares !== undefined ? (Number(r.remaining_shares) === 0 ? '已結束' : '進行中') : '';
            opt.textContent = `第 ${roundVal} 回合${statusText ? ` (${statusText})` : ''}`;
            if (String(roundVal) === String(round)) opt.selected = true;
            selectRound.appendChild(opt);
          });
        }
      }

      // (3) 渲染 5 大 KPI 指標卡片
      // 變數用途說明：快取 5 大部位與財務統計指標之 DOM 元素
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
          // 變數用途說明：totalRev 累計已實現收入 (賣出金額 + 股息利息合計)
          const totalRev = Number(summary.totalSellRevenue || 0) + Number(summary.totalDividends || 0);
          elRevenue.textContent = `${currencySymbol}${totalRev.toLocaleString()}`;
        }
        if (elPnl) {
          // 變數用途說明：totalPnl 總損益數值；isProfit 判斷是否為獲利 (正數)
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
      // 變數用途說明：tbody 表格主體 DOM 元素
      const tbody = document.getElementById('trade-log-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-red-400">載入失敗: ${err.message}</td></tr>`;
      updatePaginationControls(0, 1, 1);
    } finally {
      // [2026-10-30] 防呆機制解除：載入完成
      isDataLoading = false;

      // [2026-10-30] feat: 復原新增按鈕樣式與狀態
      const btnOpenModalEl = document.getElementById('btn-open-modal');
      if (btnOpenModalEl) {
        btnOpenModalEl.textContent = '+ 新增交易記錄';
        btnOpenModalEl.classList.remove('opacity-75', 'cursor-wait');
      }

      // [2026-10-30] feat: 若使用者剛才點擊了新增，等資料到位後「自動彈出開窗」，不需點擊第二次
      if (pendingOpenModal) {
        pendingOpenModal = false;
        executeOpenAddTradeModal();
      }
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
    // 變數用途說明：tbody 交易歷史流水帳表格 tbody DOM 元素
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
    const totalPages = isAll ? 1 : Math.ceil(totalCount / pageSizeNum);

    // 當前頁碼防呆邊界檢查
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * pageSizeNum;
    const currentRows = isAll ? currentLogsCache : currentLogsCache.slice(startIndex, startIndex + pageSizeNum);

    // [2026-10-07] 異動說明：將 INTEREST 類別的中文顯示文字由「利息」改為「銀行利息」
    // 變數用途說明：TYPE_MAP 對照各交易型態之中文標籤與 CSS Badge 樣式類別
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
      // 變數用途說明：serialNumber 自動累加計算所得之該筆紀錄絕對序號
      const serialNumber = startIndex + index + 1; // 序號計算：(當前頁碼 - 1) * 每頁筆數 + 當頁索引 + 1
      // 變數用途說明：typeConf 該筆紀錄對應之交易類別中文標籤與樣式物件
      const typeConf = TYPE_MAP[log.trade_type] || { label: log.trade_type, class: 'badge-buy' };
      // 變數用途說明：isIncome 判斷該交易類別是否屬於正向資金流入
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
    // 變數用途說明：disablePrev 布林值，判斷上一頁按鈕是否需要禁用
    const disablePrev = (current <= 1 || totalCount === 0);
    btnPrevPages.forEach(el => {
      el.disabled = disablePrev;
    });
    
    // 4. 同步更新所有「下一頁」按鈕狀態
    // 變數用途說明：disableNext 布林值，判斷下一頁按鈕是否需要禁用
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
    // 變數用途說明：tbody 交易表格內容 DOM 元素
    const tbody = document.getElementById('trade-log-body');
    if (!tbody) return;

    tbody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.onclick = () => {
        // 變數用途說明：targetLog 從快取清單中比對出的目標交易明細紀錄物件
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

        // [2026-10-30] 編輯模式下填入標的選單，並鎖定標的禁止變更以維護資料一致性
        if (inputStockId) {
          const editStockId = targetLog.stock_id || currentStock;
          renderModalStockOptions(editStockId);
          inputStockId.disabled = true;
        }

        if (inputTradeDate) inputTradeDate.value = targetLog.trade_date ? targetLog.trade_date.slice(0, 10) : '';
        if (inputTradeType) inputTradeType.value = targetLog.trade_type || 'BUY';

        updateFormFieldsByTradeType();

        // [2026-10-07] 異動說明：編輯帶入資料時，INPUT 與 OUTPUT 比照 REVENUE / INTEREST 設定數值
        // 變數用途說明：isIncome 判斷當前編輯項目是否為純資金/收益類別
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
          // 變數用途說明：res 呼叫刪除明細 API 之回應物件
          const res = await window.ClientAuth.authFetch(`/api/trading/detail?trade_id=${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          // 變數用途說明：result 刪除請求回傳之 JSON 結果
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
      // 變數用途說明：計算目前分頁總數以防超出上限
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
      currentRound = ''; // 保持停在全部歷史
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

  // 變數用途說明：btnOpenModal 開啟交易彈窗按鈕；btnCloseModal 關閉交易彈窗按鈕
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  if (btnOpenModal) {
    btnOpenModal.onclick = () => {
      // [2026-10-30] 若資料仍在載入，給予按鈕載入提示並啟動排隊，載入完成後會自動開窗
      if (isDataLoading) {
        pendingOpenModal = true;
        btnOpenModal.textContent = '載入中...';
        btnOpenModal.classList.add('opacity-75', 'cursor-wait');
        return;
      }

      // 若未在載入狀態，直接正常開窗
      executeOpenAddTradeModal();
    };
  }

  if (btnCloseModal) {
    btnCloseModal.onclick = () => toggleModal(modalTrade, false);
  }

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
    // 變數用途說明：取得使用者在交易表單填寫的各項原始數值
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

    // 變數用途說明：定義數值範圍邊界常數，落實安全性與防呆原則
    const MAX_ROUND_LIMIT = 9999;
    const MAX_PRICE_LIMIT = 999999.9999;
    const MAX_SHARES_LIMIT = 99999999;
    const MAX_FEE_LIMIT = 9999999;
    const MAX_NET_TOTAL_LIMIT = 999999999;

    if (isIncomeType) {
      round = 0;
      // 變數用途說明：netTotalNum 轉為數字型態之實收入帳金額
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
      // 變數用途說明：roundRaw 原始回合文字；round 轉為十進位之回合整數
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

      // 變數用途說明：數值轉換與上下限邊界檢核變數
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

    // 變數用途說明：isEdit 布林值，判斷當前為編輯模式或新增模式
    const isEdit = Boolean(trade_id);
    // 變數用途說明：payload 組裝送往後端 detail API 之純物件資料
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
      // 變數用途說明：res 發送至 detail API 之 fetch 請求物件
      const res = await window.ClientAuth.authFetch('/api/trading/detail', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      // 變數用途說明：result 後端交易儲存回傳結果
      const result = await res.json();
      if (!result.success) throw new Error(result.message);

      // [2026-10-30] 若開窗選定的標的與目前母頁不同，同步更新母頁狀態，並保持檢視當前回合
      currentStock = stock_id.toUpperCase();
      currentRound = String(round);
      syncUrl();
      await loadTradingData(currentStock, currentRound);

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

        // [2026-10-30] fix: 連續新增時，自外層刷新後之選單即時更新回合
        if (inputRound && !isIncomeType) {
          inputRound.value = getActiveRoundFromSelectRoundDom();
        }

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
      // 變數用途說明：errorMessage 失敗提示文字字串
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

  // 變數用途說明：快取標的代碼維護開窗相關按鈕 DOM
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
    // 變數用途說明：stock_id 使用者輸入之新標的代碼；stock_name 使用者輸入之新標的名稱
    const stock_id = inputNewStockId?.value?.trim();
    const stock_name = inputNewStockName?.value?.trim();

    // [2026-10-12] feat: 標的名稱改為選填
    if (!stock_id) {
      alert('請完整填寫標的代碼！');
      return;
    }

    try {
      // [2026-10-08] feat: 改用 authFetch 帶 Clerk Token
      // [2026-10-20] refactor: 因應 stock_comp 欄位重構，將傳遞欄位 market_type 改為 market_id
      // (作廢) [2026-10-08] 原傳遞 payload 包含：market_type: currentMarket
      // 變數用途說明：res 發送至 addstock API 之 fetch 回應物件
      const res = await window.ClientAuth.authFetch('/api/trading/addstock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id,
          stock_name,
          market_id: currentMarket
        })
      });
      // 變數用途說明：result 標的新增執行結果 JSON 物件
      const result = await res.json();
      if (!result.success) {
        /**
         * [2026-10-15] 異動說明
         * 目的：標的新增業務檢核失敗時，改以紅色 Toast 警示，不跳原生 alert 且不關閉開窗
         * 變數說明：
         * 1. failMessage: 業務失敗訊息字串
         */
        // 變數用途說明：failMessage 業務檢核失敗訊息字串
        const failMessage = `✕ ${result.message}`;
        showModalToast(stockToast, failMessage, false, 2000);
        return;
      }

      /**
       * [2026-10-15] 異動說明
       * 目的：標的維護改用共用 showSuccessToast 顯示「✓ 新增成功」；「儲存並關閉」時延遲 0.8 秒關閉開窗並清空欄位
       */
      if (keepOpen) {
        if (inputNewStockId) {
          inputNewStockId.value = '';
          inputNewStockId.focus();
        }
        if (inputNewStockName) {
          inputNewStockName.value = '';
        }

        // 浮現成功提示條並於 1.5 秒後自動隱藏 (保持開窗，標的為新增，傳入 false)
        showSuccessToast(stockToast, false, 1500);
      } else {
        // 浮現成功提示條，停留 0.8 秒後自動關閉開窗並重置輸入欄位
        showSuccessToast(stockToast, false, 800, () => {
          toggleModal(modalStock, false);
          if (inputNewStockId) inputNewStockId.value = '';
          if (inputNewStockName) inputNewStockName.value = '';
        });
      }

      // 同步刷新標的與交易明細清單
      currentStock = stock_id.toUpperCase();
      currentRound = '';
      syncUrl();
      // [2026-10-15] fix: 連續新增時，將開窗回合數同步更新為後端最新建議回合 (如平倉後自動 +1)
      await loadTradingData(currentStock, currentRound);
    } catch (err) {
      /**
       * [2026-10-15] 異動說明
       * 目的：連線或 API 請求發生未預期異常時，改以紅色 Toast 警示，不跳原生 alert
       * 變數說明：
       * 1. networkErrorMessage: 網路或伺服器異常提示字串
       */
      // 變數用途說明：networkErrorMessage 網路或伺服器未預期錯誤文字
      const networkErrorMessage = `✕ 新增失敗: ${err.message}`;
      showModalToast(stockToast, networkErrorMessage, false, 2000);
    }
  }

  // 綁定標的開窗「儲存並關閉」事件
  if (btnSubmitStockComp) {
    btnSubmitStockComp.onclick = () => submitStockCompForm(false);
  }

  /**
   * [2026-10-12] 異動說明
   * 目的：綁定標的開窗「儲存並繼續新增」點擊事件
   */
  if (btnSubmitStockCompContinue) {
    btnSubmitStockCompContinue.onclick = () => submitStockCompForm(true);
  }

  // 初始載入
  loadTradingData(currentStock, currentRound);
});