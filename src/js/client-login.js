// src/js/client-login.js

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const btnLogin = document.getElementById('btn-login') || document.querySelector('button[type="button"]');
  const marketBtns = document.querySelectorAll('.market-btn, [data-market]');
  
  let selectedMarket = 'TW';

  // 1. 市場切換點選 (TW / US)
  marketBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      marketBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMarket = btn.dataset.market || (btn.textContent.includes('US') ? 'US' : 'TW');
    });
  });

  // 2. 登入執行邏輯
  async function performLogin(e) {
    // 嚴格阻斷 HTML 表單預設送出行為，避免帳密出現於網址列
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const usernameInput = document.getElementById('input-username');
    const passwordInput = document.getElementById('input-password');

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';

    if (!username || !password) {
      alert('請輸入使用者名稱與密碼！');
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          password,
          market: selectedMarket
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        alert(result.message || '帳號或密碼錯誤！');
        return;
      }

      // 3. 登入成功：使用 ClientAuth 記錄會話狀態
      if (window.ClientAuth) {
        window.ClientAuth.setSessionInfo(result.data.username || username, result.data.market || selectedMarket);
      } else {
        sessionStorage.setItem('stockweb_session_user', result.data.username || username);
        sessionStorage.setItem('stockweb_session_market', result.data.market || selectedMarket);
      }

      // 4. 轉跳至儀表板主頁
      window.location.replace('dashboard.html');

    } catch (err) {
      console.error('[Login Client Error]:', err);
      alert('連線伺服器失敗，請確認開發環境已啟動！');
    }
  }

  // 3. 事件綁定：支援按鈕點擊與 Enter 送出
  if (btnLogin) {
    btnLogin.addEventListener('click', performLogin);
  }

  if (loginForm) {
    loginForm.addEventListener('submit', performLogin);
  } else {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        performLogin(e);
      }
    });
  }
});