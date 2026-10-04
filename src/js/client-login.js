// src/js/client-login.js

let isAuthenticating = false;

// 超時中斷器：若 Clerk 伺服器卡死無回應，時間到自動強制拋出錯誤
function withTimeout(promise, ms, errorMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
}

// 換發後端 Cookie 並導向
async function exchangeAndRedirect(selectedMarket) {
  try {
    const clerkToken = await withTimeout(window.Clerk.session.getToken(), 5000, '取得安全憑證超時，請重試');
    
    const userId = window.Clerk.user?.id || '';
    const username = window.Clerk.user?.username || 
                     window.Clerk.user?.primaryEmailAddress?.emailAddress || 
                     'Admin';

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkToken, userId, username, market: selectedMarket })
    });

    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.message || '伺服器身分驗證失敗！');
    }

    const finalMarket = result.data?.market || selectedMarket;
    const finalUsername = result.data?.username || username;

    if (window.ClientAuth) {
      window.ClientAuth.setSessionInfo(finalUsername, finalMarket);
    } else {
      sessionStorage.setItem('stockweb_session_user', finalUsername);
      sessionStorage.setItem('stockweb_session_market', finalMarket);
    }

    window.location.replace('dashboard.html');
  } catch (err) {
    throw err; 
  }
}

// 核心登入處理邏輯
async function handleLoginSubmit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // 阻擋狂點按鈕
  if (isAuthenticating) return;

  // 若 Clerk JS 完全沒下載成功 (網路問題或擋廣告外掛)
  if (!window.Clerk) {
    alert('安全模組尚未載入，請確認網路連線或關閉擋廣告外掛後重整網頁！');
    return;
  }

  const identifier = document.getElementById('input-username')?.value.trim();
  const password = document.getElementById('input-password')?.value.trim();

  if (!identifier || !password) {
    alert('請輸入帳號與密碼！');
    return;
  }

  const checkedRadio = document.querySelector('input[name="market"]:checked');
  const selectedMarket = checkedRadio ? checkedRadio.value.trim().toUpperCase() : 'TW';

  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = '元件載入與驗證中...';
  }

  isAuthenticating = true;

  try {
    // 【關鍵修復】如果元件還沒載入完，自動幫它 await 載入，而不是直接彈錯誤把你擋掉
    if (!window.Clerk.loaded) {
      await window.Clerk.load();
    }

    // 防呆清理：如果瀏覽器殘存著上一筆未清乾淨的會話，先強制登出 (最高等待 3 秒)
    if (window.Clerk.session) {
      await withTimeout(window.Clerk.signOut(), 3000, '清理前次登入狀態超時');
    }

    // 發起帳密驗證 (最高等待 8 秒)
    const signInAttempt = await withTimeout(
      window.Clerk.client.signIn.create({ identifier, password }),
      8000,
      '驗證伺服器無回應，請檢查網路連線'
    );

    if (signInAttempt.status !== 'complete') {
      throw new Error(`登入未完成，狀態: ${signInAttempt.status}`);
    }

    // 啟用 Session (最高等待 5 秒)
    await withTimeout(
      window.Clerk.setActive({ session: signInAttempt.createdSessionId }),
      5000,
      '啟用會話超時'
    );

    // 進行後端驗證與跳轉
    await exchangeAndRedirect(selectedMarket);

  } catch (err) {
    // 嚴格資安防護：帳密錯誤或網路斷線，必定跳進這裡阻斷
    const errorMsg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || '帳號或密碼錯誤！';
    alert(errorMsg);
  } finally {
    // 恢復按鈕狀態
    isAuthenticating = false;
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = '進入管理系統';
    }
  }
}

// 頁面載入完成綁定事件與背景預熱
document.addEventListener('DOMContentLoaded', () => {
  const btnLogin = document.getElementById('btn-login');
  const loginForm = document.getElementById('login-form');

  if (btnLogin) btnLogin.addEventListener('click', handleLoginSubmit);
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  // 網頁開啟時，背景靜默載入 Clerk，加速後續登入速度
  setTimeout(async () => {
    if (window.Clerk && !window.Clerk.loaded) {
      try {
        await window.Clerk.load();
        if (window.Clerk.session) {
          await window.Clerk.signOut();
        }
      } catch (e) {
        console.warn('背景預熱載入異常', e);
      }
    }
  }, 100);
});

/**
 * 切換密碼欄位顯示/隱藏
 */
function togglePasswordVisibility() {
  // passwordField: 密碼輸入框元素
  const passwordField = document.getElementById('input-password');
  // 切換 type 屬性
  passwordField.type = (passwordField.type === 'password') ? 'text' : 'password';
}