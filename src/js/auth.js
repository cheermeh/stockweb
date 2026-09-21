document.addEventListener('DOMContentLoaded', () => {
    // 1. 正式宣告變數並抓取 HTML 表單元件
    const authForm = document.getElementById('login-form') || document.querySelector('form');
    const usernameInput = document.getElementById('username') || document.querySelector('input[type="text"]');
    const passwordInput = document.getElementById('password') || document.querySelector('input[type="password"]');
    const marketSelect = document.getElementById('market') || document.querySelector('select');

    if (!authForm) {
        console.error('[Auth Error] 找不到表單元素，請檢查 HTML 是否有 <form> 標籤！');
        return;
    }

    // 2. 綁定提交事件
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // 防止表單直接送出刷新

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        const market = marketSelect ? marketSelect.value : 'TW';

        if (!username || !password) {
            alert('請輸入帳號與密碼');
            return;
        }

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password, market })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // 儲存登入憑證至 Session
                sessionStorage.setItem('stockweb_session_user', result.data.username);
                sessionStorage.setItem('stockweb_session_user_id', result.data.userId);
                sessionStorage.setItem('stockweb_session_market', result.data.market);

                alert('登入成功！');
                window.location.replace('dashboard.html');
            } else {
                alert(result.message || '帳號或密碼錯誤');
            }
        } catch (err) {
            console.error('[API Error]:', err);
            alert('無法連線至伺服器，請確認 Vercel 開發環境是否正常運行');
        }
    });
});