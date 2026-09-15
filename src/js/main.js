document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            // 基礎前端防禦驗證
            if (!username || !password) {
                alert('請完整填寫帳號與密碼');
                return;
            }

            if (password.length < 6) {
                alert('密碼長度不得低於 6 碼 (遵循安全策略)');
                return;
            }

            // 模擬登入成功
            console.log(`[AUTH] 登入驗證通過：${username}`);
            alert(`登入成功！歡迎 ${username}。\n(即將進入 Dashboard 畫面)`);
        });
    }
});