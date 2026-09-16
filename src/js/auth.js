document.addEventListener('DOMContentLoaded', () => {
    // 若已登入直接進 Dashboard
    if (sessionStorage.getItem('stockweb_session_user')) {
        window.location.replace('dashboard.html');
        return;
    }

    const loginForm = document.getElementById('login-form');
    if (!loginForm) return;

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const selectedMarket = document.querySelector('input[name="market"]:checked').value;

        if (!username || !password) {
            alert('請完整填寫帳號與密碼');
            return;
        }

        if (password.length < 6) {
            alert('密碼長度不得低於 6 碼 (符合資安原則)');
            return;
        }

        // Session 儲存使用者與當前工作市場 (TW 或 US)
        sessionStorage.setItem('stockweb_session_user', username);
        sessionStorage.setItem('stockweb_session_market', selectedMarket);

        // 跳轉到總管理頁
        window.location.href = 'dashboard.html';
    });
});