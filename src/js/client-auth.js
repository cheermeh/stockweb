// src/js/client-auth.js

// 在 client-auth.js 最上方加入
(function injectFavicon() {
  if (document.querySelector('link[rel="icon"]')) return;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%232563eb' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='22 7 13.5 15.5 8.5 10.5 2 17'%3E%3C/polyline%3E%3Cpolyline points='16 7 22 7 22 13'%3E%3C/polyline%3E%3C/svg%3E";
  document.head.appendChild(link);
})();

const CLIENT_AUTH_KEYS = {
  USER: 'stockweb_session_user',
  MARKET: 'stockweb_session_market'
};

const ClientAuth = {
  // 檢查是否登入，未登入則導回登入頁 (用於 dashboard / tradinglog)
  requireAuth() {
    const user = sessionStorage.getItem(CLIENT_AUTH_KEYS.USER);
    if (!user) {
      alert('未授權存取或登入已過期，請重新登入！');
      window.location.replace('index.html');
      return false;
    }
    return true;
  },

  // 取得使用者資訊
  getSessionInfo() {
    return {
      username: sessionStorage.getItem(CLIENT_AUTH_KEYS.USER),
      market: sessionStorage.getItem(CLIENT_AUTH_KEYS.MARKET)
    };
  },

  // 登入成功時寫入 SessionStorage
  setSessionInfo(username, market = 'TW') {
    sessionStorage.setItem(CLIENT_AUTH_KEYS.USER, username);
    sessionStorage.setItem(CLIENT_AUTH_KEYS.MARKET, market);
  },

  // 登出流程
  logout() {
    sessionStorage.removeItem(CLIENT_AUTH_KEYS.USER);
    sessionStorage.removeItem(CLIENT_AUTH_KEYS.MARKET);
    sessionStorage.clear();
    // 清除前端 Cookie 覆蓋
    document.cookie = 'stockweb_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.replace('index.html');
  }
};

window.ClientAuth = ClientAuth;