document.addEventListener('DOMContentLoaded', () => {
    const sessionUser = sessionStorage.getItem('stockweb_session_user');
    const sessionMarket = sessionStorage.getItem('stockweb_session_market') || 'TW';

    // 1. Session 權限守衛
    if (!sessionUser) {
        alert('未授權存取或登入已過期，請重新登入！');
        window.location.replace('index.html');
        return;
    }

    // 2. 市場設定與獨立 Mock 數據
    const marketConfig = {
        TW: {
            titleSuffix: '台股帳戶',
            currency: 'NT$ ',
            profitClass: 'text-profit', // 紅漲
            lossClass: 'text-loss',     // 綠跌
            kpi: [1200000, 384500, 16500000, 3220300, 1862700, 2247200],
            rates: ['+15.52%', '+18.72%'],
            ledger: [
                { date: '2026-03-12', stock: '2330 台積電', type: '買進', income: 0, expense: 98000, note: '第10次分批買進' },
                { date: '2026-03-10', stock: '2330 台積電', type: '股利', income: 4500, expense: 0, note: 'Q4 現金股利' },
                { date: '2026-03-05', stock: '2454 聯發科', type: '賣出', income: 142000, expense: 0, note: '波段回合#1結算' },
                { date: '2026-02-28', stock: '交割帳戶', type: '入金', income: 200000, expense: 0, note: '定期存入' }
            ]
        },
        US: {
            titleSuffix: '美股帳戶',
            currency: '$ ',
            profitClass: 'text-loss',   // 美股綠漲 (採用 loss 綠色變數)
            lossClass: 'text-profit',   // 美股紅跌 (採用 profit 紅色變數)
            kpi: [40000, 1200, 500000, 12400, 8200, 9400],
            rates: ['+20.50%', '+23.50%'],
            ledger: [
                { date: '2026-03-11', stock: 'NVDA 輝達', type: '買進', income: 0, expense: 3200, note: '分批加碼 25 股' },
                { date: '2026-03-01', stock: 'AAPL 蘋果', type: '股利', income: 120, expense: 0, note: '已扣 30% 預扣稅' },
                { date: '2026-02-20', stock: 'TSLA 特斯拉', type: '賣出', income: 5400, expense: 0, note: '波段回合#1結算' }
            ]
        }
    };

    const currentConfig = marketConfig[sessionMarket];

    // 3. 渲染 Header 使用者資訊
    const userBadge = document.getElementById('current-user-badge');
    if (userBadge) {
        userBadge.textContent = `${sessionUser.slice(0, 3)}*** (${currentConfig.titleSuffix})`;
    }

    // 4. 登出
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            sessionStorage.clear();
            window.location.replace('index.html');
        });
    }

    // 5. 渲染 KPI 卡片
    const kpiElements = document.querySelectorAll('.kpi-value');
    kpiElements.forEach((el, i) => {
        const val = currentConfig.kpi[i];
        el.dataset.raw = val;

        const isPnL = i >= 4;
        const sign = isPnL && val > 0 ? '+' : '';
        el.textContent = `${sign}${currentConfig.currency}${val.toLocaleString()}`;

        if (isPnL) {
            el.classList.add(val >= 0 ? currentConfig.profitClass : currentConfig.lossClass);
        }
    });

    document.getElementById('sub-pnl-noint').textContent = currentConfig.rates[0];
    document.getElementById('sub-pnl-noint').classList.add(currentConfig.profitClass);
    document.getElementById('sub-pnl-int').textContent = currentConfig.rates[1];
    document.getElementById('sub-pnl-int').classList.add(currentConfig.profitClass);

    // 6. 渲染流水帳表格
    const ledgerBody = document.getElementById('ledger-body');
    function renderTable() {
        if (!ledgerBody) return;
        ledgerBody.innerHTML = '';
        currentConfig.ledger.forEach(item => {
            const tr = document.createElement('tr');
            let badgeClass = 'badge-deposit';
            if (item.type === '買進') badgeClass = 'badge-buy';
            if (item.type === '賣出') badgeClass = 'badge-sell';
            if (item.type === '股利') badgeClass = 'badge-dividend';

            const incomeText = item.income > 0 ? `${currentConfig.currency}${item.income.toLocaleString()}` : '-';
            const expenseText = item.expense > 0 ? `${currentConfig.currency}${item.expense.toLocaleString()}` : '-';

            tr.innerHTML = `
                <td>${item.date}</td>
                <td>${item.stock}</td>
                <td><span class="badge ${badgeClass}">${item.type}</span></td>
                <td class="text-right ${item.income > 0 ? currentConfig.profitClass : ''}" data-type="amount">${incomeText}</td>
                <td class="text-right ${item.expense > 0 ? currentConfig.lossClass : ''}" data-type="amount">${expenseText}</td>
                <td>${item.note}</td>
            `;
            ledgerBody.appendChild(tr);
        });
    }
    renderTable();

    // 7. 一鍵金額遮罩 (ISO 27000)
    let isMasked = false;
    const btnMaskToggle = document.getElementById('btn-mask-toggle');
    if (btnMaskToggle) {
        btnMaskToggle.addEventListener('click', () => {
            isMasked = !isMasked;

            kpiElements.forEach((el, idx) => {
                const raw = Number(el.dataset.raw);
                const isPnL = idx >= 4;
                const sign = isPnL && raw > 0 ? '+' : '';
                el.textContent = isMasked ? '******' : `${sign}${currentConfig.currency}${raw.toLocaleString()}`;
            });

            document.querySelectorAll('[data-type="amount"]').forEach(el => {
                if (el.textContent !== '-') {
                    el.textContent = isMasked ? '******' : el.textContent;
                }
            });

            if (!isMasked) renderTable();
        });
    }
    
    // 在 src/js/dashboard.js 內加入
const btnGotoTradinglog = document.getElementById('btn-goto-tradinglog');
if (btnGotoTradinglog) {
    btnGotoTradinglog.addEventListener('click', () => {
        // 依照登入時選擇的市場別，自動決定預設載入的標的
        const defaultSymbol = sessionMarket === 'US' ? 'NVDA' : '2330';
        
        // 透過 JS 進行頁面導航，不使用 <a> 超連結
        window.location.href = `tradinglog.html?symbol=${defaultSymbol}`;
    });
}
});