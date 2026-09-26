// src/js/client-login.js

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const btnLogin = document.getElementById('btn-login') || document.querySelector('button[type="button"]');
  
  // 取得所有市場相關元素 (相容 radio 單選框、帶有 data-market 的標籤或自訂按鈕)
  const marketRadios = document.querySelectorAll('input[name="market"]');
  const marketBtns = document.querySelectorAll('.market-btn, [data-market]');
  
  // 預設選取市場
  let selectedMarket = 'TW';

  // =========================================================================
  // 1. 市場切換監聽 (支援 Radio 單選框 與 自訂 Button 兩種 UI 模式)
  // =========================================================================

  // (1) 若畫面使用標準單選框 (<input type="radio" name="market">)
  if (marketRadios.length > 0) {
    marketRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedMarket = e.target.value.trim().toUpperCase();
          console.log('[Client Auth] Radio 切換市場為:', selectedMarket);
        }
      });
    });
  }

  // (2) 若畫面使用按鈕切換 UI (.market-btn 或 [data-market])
  if (marketBtns.length > 0) {
    marketBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        marketBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 優先從 data-market 取值，其次判斷文字是否包含 US
        selectedMarket = (btn.dataset.market || (btn.textContent.includes('US') ? 'US' : 'TW')).toUpperCase();
        console.log('[Client Auth] 按鈕切換市場為:', selectedMarket);
      });
    });
  }

  // =========================================================================
  // 2. 登入執行邏輯
  // =========================================================================
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

    // 【關鍵修復】：在點擊登入的當下，即時動態查詢目前被勾選的 Radio
    // 避免使用者直接點選單選框後，未觸發監聽或變數未同步的問題
    const checkedRadio = document.querySelector('input[name="market"]:checked');
    if (checkedRadio) {
      selectedMarket = checkedRadio.value.trim().toUpperCase();
    }

    // 防呆驗證
    if (!username || !password) {
      alert('請輸入使用者名稱與密碼！');
      return;
    }

    if (!selectedMarket) {
      alert('請選擇登入市場 (TW / US)！');
      return;
    }

    console.log('[Client Auth] 準備送出登入，目標市場:', selectedMarket);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          password,
          market: selectedMarket // 確保送出的是當前勾選的市場代碼 ('TW' 或 'US')
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        alert(result.message || '帳號或密碼錯誤！');
        return;
      }

      // 3. 登入成功：使用 ClientAuth 記錄會話狀態 (若後端有回傳以回傳值為主)
      const finalMarket = result.data?.market || selectedMarket;
      const finalUsername = result.data?.username || username;

      if (window.ClientAuth) {
        window.ClientAuth.setSessionInfo(finalUsername, finalMarket);
      } else {
        sessionStorage.setItem('stockweb_session_user', finalUsername);
        sessionStorage.setItem('stockweb_session_market', finalMarket);
      }

      // 4. 轉跳至儀表板主頁
      window.location.replace('dashboard.html');

    } catch (err) {
      console.error('[Login Client Error]:', err);
      alert('連線伺服器失敗，請確認開發環境已啟動！');
    }
  }

  // =========================================================================
  // 3. 事件綁定：支援按鈕點擊、表單 Submit 與 Enter 鍵送出
  // =========================================================================
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