document.addEventListener('DOMContentLoaded', () => {
    // 獲取登入表單元件
    const loginForm = document.getElementById('login-form');

    if (loginForm) {
        // 監聽表單送出事件
        loginForm.addEventListener('submit', (e) => {
            // 阻止表單預設的重整行為
            e.preventDefault();

            // 獲取輸入的帳密 (用於驗證，這裡僅模擬)
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            // --- 模擬登入驗證 (資安注意: 這裡純展示用，正式版禁止) ---
            console.log(`嘗試登入: ${username}`);
            
            // 如果輸入了帳密，就假設登入成功並跳轉
            if (username && password) {
                // 這裡我們暫定 Dashboard 的檔案名稱為 dashboard.html
                // (你可以選擇未來用哪個方式跳轉，目前先用 window.location)
                console.log('登入成功，正在跳轉...');
                
                // 跳轉到 Dashboard 頁面 (假設我們未來會建立此檔案)
                // window.location.href = 'dashboard.html';
                
                // 如果要保留在 index.html 進行動態載入，則不能使用 href 跳轉
                // 這部分邏輯未來可以請 Copilot 協助
                alert('登入成功！(待實作: 跳轉到管理頁)');
            }
        });
    }
});