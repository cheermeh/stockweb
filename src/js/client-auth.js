// src/js/client-auth.js

function getSessionInfo() {
  return {
    username: sessionStorage.getItem('stockweb_session_user') || '',
    market: sessionStorage.getItem('stockweb_session_market') || 'TW'
  };
}

function setSessionInfo(username, market) {
  sessionStorage.setItem('stockweb_session_user', username || '');
  sessionStorage.setItem('stockweb_session_market', market || 'TW');
}

// 路由守衛：未登入踢回首頁
function requireAuth() {
  if (!sessionStorage.getItem('stockweb_session_user')) {
    window.location.replace('index.html');
    return false;
  }
  return true;
}

// 登出核心：只做最純粹的清理與跳轉，絕不卡住畫面
async function logout() {
  // 1. 立即清空前端記憶
  sessionStorage.clear();
  localStorage.clear();
  
  // 2. 背景通知後端清除 Cookie
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});

  // 3. 安全呼叫 Clerk 登出，並確保 100% 跳轉
  if (window.Clerk && window.Clerk.loaded) {
    try {
      await window.Clerk.signOut();
    } catch (e) {
      console.warn('[Clerk Logout]:', e);
    }
  }
  window.location.replace('index.html');
}

window.ClientAuth = {
  getSessionInfo,
  setSessionInfo,
  requireAuth,
  logout
};