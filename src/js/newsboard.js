// src/js/newsboard.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 登入狀態檢查：未通過 Clerk 身分驗證則中斷執行 (ClientAuth 內部會自動處理未登入跳轉)
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) {
    return;
  }

  // 2. 取得目前登入使用者帳號與市場別
  // 變數用途說明：username 使用者登入帳號名稱；market 當前選定的市場代碼 (例如 'TW', 'US')
  const { username = '', market = '' } = window.ClientAuth ? window.ClientAuth.getSessionInfo() : {};
  // 變數用途說明：currentActiveMarket 正規化轉為大寫之當前市場代碼
  const currentActiveMarket = String(market).toUpperCase();

  // 變數用途說明：userDisplay 頂部導航列顯示使用者帳號名稱的 DOM 元素
  const userDisplay = document.getElementById('user-display');
  // 變數用途說明：marketDisplay 頂部導航列顯示當前市場代碼的 DOM 元素
  const marketDisplay = document.getElementById('market-display');
  // 變數用途說明：serverStatus 頂部導航列顯示連線狀態的 DOM 元素
  const serverStatus = document.getElementById('server-status');
  // 變數用途說明：btnGotoDashboard 點擊進入主儀表板的按鈕 DOM 元素
  const btnGotoDashboard = document.getElementById('btn-goto-dashboard');
  // 變數用途說明：btnLogout 點擊登出的按鈕 DOM 元素
  const btnLogout = document.getElementById('btn-logout');

  // 變數用途說明：latestCrtdtDisplay 標題列顯示最新取得時間的 DOM 元素
  const latestCrtdtDisplay = document.getElementById('latest-crtdt-display');
  // 變數用途說明：loadingMsg 顯示「載入中」提示的 DOM 元素
  const loadingMsg = document.getElementById('loading-msg');
  // 變數用途說明：emptyMsg 顯示「無最新消息」提示的 DOM 元素
  const emptyMsg = document.getElementById('empty-msg');
  // 變數用途說明：newsTable 資料表格本體的 DOM 元素
  const newsTable = document.getElementById('news-table');
  // 變數用途說明：newsBody 表格資料行容器 (tbody) 的 DOM 元素
  const newsBody = document.getElementById('news-body');

  // 渲染使用者帳號明碼
  if (userDisplay && username) {
    userDisplay.textContent = username;
  }
  // 渲染當前市場別
  if (marketDisplay && currentActiveMarket) {
    marketDisplay.textContent = currentActiveMarket;
  }

  // 綁定前往 Dashboard 點擊事件 (保持相同市場別)
  if (btnGotoDashboard) {
    btnGotoDashboard.onclick = () => {
      window.location.href = 'dashboard.html';
    };
  }

  // 綁定登出按鈕事件 (比照 dashboard.js 規格)
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

  // 3. 呼叫後端 API 載入除權息資料
  try {
    if (serverStatus) serverStatus.textContent = '載入中...';

    // 變數用途說明：apiEndpoint 後端除權息端點網址 (附帶動態 market 參數)
    const apiEndpoint = `/api/newsboard/dividend?market=${encodeURIComponent(currentActiveMarket)}`;
    // 變數用途說明：res 發送至後端 dividend API 之 fetch 回應物件 (由 authFetch 帶入 Clerk Token)
    const res = await window.ClientAuth.authFetch(apiEndpoint);

    // 若 Token 失效回傳 401，觸發登出
    if (res.status === 401) {
      if (window.ClientAuth) window.ClientAuth.logout();
      return;
    }

    // 變數用途說明：result 後端回傳之 JSON 解析物件
    const result = await res.json();
    if (!result.success) {
      throw new Error(result.message || '取得除權息資料失敗');
    }

    if (serverStatus) serverStatus.textContent = '連線正常';

    // [2026-11-06] feat: 渲染資料庫最新取得時間，由前端轉為使用者本地時區 (比照 dashboard.js mtdt 作法)
    if (latestCrtdtDisplay) {
      const displayCrtdt = window.ClientAuth && typeof window.ClientAuth.formatDateTime === 'function'
        ? window.ClientAuth.formatDateTime(result.latestCrtdt)
        : (result.latestCrtdt || '--');
      latestCrtdtDisplay.textContent = displayCrtdt;
    }

    // 變數用途說明：dividendList 符合追蹤條件之除權息資料陣列
    const dividendList = result.data || [];

    // 關閉載入中文案
    if (loadingMsg) loadingMsg.style.display = 'none';

    // 若無任何符合資料，顯示空狀態提示
    if (dividendList.length === 0) {
      if (emptyMsg) emptyMsg.style.display = 'block';
      return;
    }

    // 4. 渲染除權息清單表格
    if (newsBody) {
      newsBody.innerHTML = dividendList.map((item) => {
        // 變數用途說明：safeStockId 經過防 XSS 跳脫後的股票代碼
        const safeStockId = escapeHtml(item.stockId);
        // 變數用途說明：safeStockName 經過防 XSS 跳脫後的標的名稱
        const safeStockName = escapeHtml(item.stockName);
        // 變數用途說明：safeExDate 經過防 XSS 跳脫後的除權息日期 (YYYY-MM-DD)
        const safeExDate = escapeHtml(item.exDate);
        // [2026-11-03] feat: 計算最後買進日 (除息日 - 1 天)
        // 變數用途說明：safeLastBuyDate 經過防 XSS 跳脫後的最後買進日期字串 (YYYY-MM-DD)
        const safeLastBuyDate = escapeHtml(calculateLastBuyDate(item.exDate));
        // 變數用途說明：safeCashDiv 經過防 XSS 跳脫後的現金股利
        const safeCashDiv = escapeHtml(item.cashDividend);
        // 變數用途說明：safeStockDiv 經過防 XSS 跳脫後的股票股利
        const safeStockDiv = escapeHtml(item.stockDividend);
        // [2026-11-03] feat: 經過防 XSS 跳脫後的股利發放日 (若為台股預設為 -，美股帶出 Finnhub 日曆資料)
        // 變數用途說明：safePayDate 經過防 XSS 跳脫後的股利發放日期字串
        const safePayDate = escapeHtml(item.payDate || '-');

        // [2026-11-03] fix: 統一除權息日期的樣式為正常灰字 (不加粗、不使用 font-mono)，發放日置於最後一欄且無值 '-' 時置中
        return `  
          <tr class="hover:bg-gray-800/30 transition-colors">
            <td class="px-6 py-4 font-mono font-medium text-white">${safeStockId}</td>
            <td class="px-6 py-4 text-gray-300">${safeStockName}</td>
            <td class="px-6 py-4 font-mono text-gray-300">${safeLastBuyDate}</td>
            <td class="px-6 py-4 text-gray-300">${safeExDate}</td>
            <td class="px-6 py-4 text-right text-gray-300">${safeCashDiv}</td>
            <td class="px-6 py-4 text-gray-300 ${safeStockDiv === '-' ? 'text-center' : 'text-right'}">${safeStockDiv}</td>
            <td class="px-6 py-4 text-gray-300 font-mono ${safePayDate === '-' ? 'text-center' : ''}">${safePayDate}</td>
          </tr>
        `;
      }).join('');
    }

    // 顯示表格本體
    if (newsTable) newsTable.style.display = 'table';

  } catch (err) {
    console.error('[Newsboard Error]:', err);
    if (serverStatus) serverStatus.textContent = '連線異常';
    if (loadingMsg) {
      loadingMsg.textContent = '載入除權息資料失敗，請重新整理重試。';
    }
  }
});

/**
 * [2026-11-03] feat: 計算最後買進日 (除權息日 - 1 天)
 * 實作說明：以本地時區解析 YYYY-MM-DD 字串並遞減 1 天，防止跨時區偏移
 * @param {string} exDateStr - 除權息日期字串 (格式: YYYY-MM-DD)
 * @returns {string} - 回傳計算後的日期字串 (格式: YYYY-MM-DD)，若無效則回傳 '-'
 */
function calculateLastBuyDate(exDateStr) {
  if (!exDateStr || typeof exDateStr !== 'string') {
    return '-';
  }

  // 變數用途說明：dateParts 依照橫線分割所得之年月日陣列 [YYYY, MM, DD]
  const dateParts = exDateStr.split('-');
  if (dateParts.length !== 3) {
    return '-';
  }

  // 變數用途說明：year 西元年整數
  const year = parseInt(dateParts[0], 10);
  // 變數用途說明：month 月份整數 (0-indexed，故減 1)
  const month = parseInt(dateParts[1], 10) - 1;
  // 變數用途說明：day 日期整數
  const day = parseInt(dateParts[2], 10);

  // 變數用途說明：targetDate 以傳入日期建構之本地 Date 物件
  const targetDate = new Date(year, month, day);
  if (isNaN(targetDate.getTime())) {
    return '-';
  }

  // 將日期往前遞減 1 天
  targetDate.setDate(targetDate.getDate() - 1);

  // 變數用途說明：resYear 遞減後之西元年 4 碼字串
  const resYear = targetDate.getFullYear();
  // 變數用途說明：resMonth 遞減後之月份 2 碼字串 (補零)
  const resMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
  // 變數用途說明：resDay 遞減後之日期 2 碼字串 (補零)
  const resDay = String(targetDate.getDate()).padStart(2, '0');

  return `${resYear}-${resMonth}-${resDay}`;
}

/**
 * 簡易 XSS 防禦跳脫字元函式
 * @param {string} inputStr - 待過濾字串
 * @returns {string} - 安全字串
 */
function escapeHtml(inputStr) {
  if (!inputStr) return '';
  return String(inputStr)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}