// src/js/client-auth.js

// ==========================================
// 全域認證與安全設定 (日後修改時間或路徑只改這裡)
// ==========================================
const AUTH_CONFIG = {
  // 閒置自動登出時間 (單位：分鐘)
  IDLE_TIMEOUT_MINUTES: 15,
  
  // 滑鼠/鍵盤活動節流時間 (毫秒)，避免高頻率觸發重設計時器
  ACTIVITY_THROTTLE_MS: 1000,
  
  // Session 儲存 Key 名稱
  STORAGE_KEYS: {
    USER: 'stockweb_session_user',
    MARKET: 'stockweb_session_market'
  },
  
  // 導向目標頁面
  PAGES: {
    HOME: 'index.html'
  }
};

function getSessionInfo() {
  return {
    username: sessionStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER) || '',
    // 2026.10.08 feat: 不再預設 TW，沒有市場別即視為未登入
    market: sessionStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.MARKET) || ''
  };
}

function setSessionInfo(username, market) {
  sessionStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.USER, username || '');
  sessionStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.MARKET, market || ''); // 2026.10.08 feat: 移除預設 TW
}

/**
 * [2026-10-06] 異動說明
 * 目的：提供單獨更新市場別的標準函式，供導覽列市場快速切換使用
 * 實作說明：將目標市場別寫入 sessionStorage 的 stockweb_session_market，確保 tradinglog 頁面讀取一致
 * @param {string} newMarket - 目標市場代碼 (例如 'TW', 'US')
 */
function setMarket(newMarket) {
  sessionStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.MARKET, newMarket || ''); // 2026.10.08 feat: 移除預設 TW
}

// 路由守衛：未登入踢回首頁
function requireAuth() {
  // 2026.10.08 feat: 帳號或市場別任一缺少都視為未登入
  if (!sessionStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER) || !sessionStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.MARKET)) {
    window.location.replace(AUTH_CONFIG.PAGES.HOME);
    return false;
  }
  return true;
}

// 登出核心：只做最純粹的清理與跳轉，絕不卡住畫面
async function logout() {
  // 1. 立即清空前端記憶
  sessionStorage.clear();
  localStorage.clear();
  
  // 2. 2026.10.08 feat: 已改用 Clerk Token，不再有後端 Cookie 需清除

  // 3. 安全呼叫 Clerk 登出，並確保 100% 跳轉
  if (window.Clerk && window.Clerk.loaded) {
    try {
      await window.Clerk.signOut();
    } catch (e) {
      console.warn('[Clerk Logout]:', e);
    }
  }
  window.location.replace(AUTH_CONFIG.PAGES.HOME);
}

/**
 * 2026.10.08 feat: 帶 Clerk Token 呼叫後端 API
 * 取不到 Token (未登入或 Session 已失效) 時回傳 401 Response，由呼叫端既有的 401 流程登出
 * @param {string} url - API 路徑
 * @param {RequestInit} [options] - fetch 選項
 * @returns {Promise<Response>}
 */
async function authFetch(url, options = {}) {
  // 變數用途說明：token 當前 Clerk Session 的 JWT (Clerk 會在快過期時自動換發)
  let token = null;
  try {
    if (window.Clerk && !window.Clerk.loaded) {
      await window.Clerk.load();
    }
    token = window.Clerk?.session ? await window.Clerk.session.getToken() : null;
  } catch (e) {
    console.warn('[Clerk Token]:', e);
  }

  if (!token) {
    return new Response(null, { status: 401 });
  }

  // 變數用途說明：headers 合併呼叫端自訂標頭與 Authorization
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

// ==========================================
// 長時間無操作自動登出功能 (Idle Timer)
// ==========================================

/**
 * 閒置計時器 ID (儲存 setTimeout 指標，用於清除舊計時與排程新計時)
 */
let idleTimerId = null;

/**
 * 上次重設計時器的時間戳記 (毫秒，用於節流閥判斷，避免頻繁呼叫浪費效能)
 */
let lastActivityTimestamp = 0;

/**
 * 旗標：標記監聽器是否已完成初始化，防止重複綁定全域事件
 */
let isAutoLogoutInitialized = false;

/**
 * 處理使用者活動：執行節流並重置倒數計時
 * @param {number} timeoutMs - 閒置逾時長度 (毫秒)
 * @param {number} throttleMs - 節流區間 (毫秒)
 */
function handleUserActivity(timeoutMs, throttleMs) {
  const currentTimestamp = Date.now();

  // 節流檢查：若在節流間隔內有連續動作，直接忽略重置請求
  if (currentTimestamp - lastActivityTimestamp < throttleMs) {
    return;
  }

  lastActivityTimestamp = currentTimestamp;

  // 清除先前的計時器
  if (idleTimerId !== null) {
    clearTimeout(idleTimerId);
  }

  // 重新啟動倒數計時，時間到直接呼叫既有的 logout 函式
  idleTimerId = setTimeout(() => {
    logout();
  }, timeoutMs);
}

/**
 * 初始化閒置自動登出監聽器
 * @param {number} [idleMinutes=AUTH_CONFIG.IDLE_TIMEOUT_MINUTES] - 允許閒置的分鐘數 (未傳入則預設讀取 AUTH_CONFIG)
 */
function initAutoLogout(idleMinutes = AUTH_CONFIG.IDLE_TIMEOUT_MINUTES) {
  // 防止重複初始化掛載
  if (isAutoLogoutInitialized) {
    return;
  }

  // 未登入時不啟用計時
  const currentUser = sessionStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER);
  if (!currentUser) {
    return;
  }

  isAutoLogoutInitialized = true;

  // 變數宣告與說明：
  // 1. timeoutMilliseconds: 將分鐘數轉為毫秒數
  const timeoutMilliseconds = idleMinutes * 60 * 1000;

  // 2. monitoredEvents: 需監聽之使用者有效操作清單
  const monitoredEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

  const onActivity = () => {
    handleUserActivity(timeoutMilliseconds, AUTH_CONFIG.ACTIVITY_THROTTLE_MS);
  };

  // 註冊全域事件監聽 (使用 passive: true 維持頁面原生捲動效能)
  monitoredEvents.forEach((eventName) => {
    window.addEventListener(eventName, onActivity, { passive: true });
  });

  // 啟動第一次計時
  onActivity();
}

// 頁面載入安全掛載 (不傳參，自動使用 AUTH_CONFIG.IDLE_TIMEOUT_MINUTES)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initAutoLogout());
} else {
  initAutoLogout();
}

window.ClientAuth = {
  config: AUTH_CONFIG,
  getSessionInfo,
  setSessionInfo,
  setMarket, // [2026-10-06] 匯出市場更新函式
  requireAuth,
  authFetch, // 2026.10.08 feat: 匯出帶 Clerk Token 的 fetch
  logout,
  initAutoLogout
};