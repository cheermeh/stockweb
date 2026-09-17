document.addEventListener('DOMContentLoaded', () => {
    // 1. 資安防衛：Session 驗證
    const sessionUser = sessionStorage.getItem('stockweb_session_user');
    const sessionMarket = sessionStorage.getItem('stockweb_session_market') || 'TW';

    if (!sessionUser) {
        alert('未授權存取或登入逾時，請重新登入！');
        window.location.replace('index.html');
        return;
    }

    // 2. 市場環境配置 (紅漲綠跌 / 綠漲紅跌)
    const isTW = sessionMarket === 'TW';
    const currency = isTW ? 'NT$ ' : '$ ';
    const profitColorClass = isTW ? 'text-profit' : 'text-loss';
    const lossColorClass = isTW ? 'text-loss' : 'text-profit';

    const marketBadge = document.getElementById('market-badge');
    if (marketBadge) {
        marketBadge.textContent = isTW ? '台股 TWD' : '美股 USD';
    }

    // 3. 資料持久化層：對齊 StockComp(Type, Id, Name) 與 TradeStore
    const defaultStockComps = [
        { Type: 'TW', Id: '2330', Name: '台積電' },
        { Type: 'TW', Id: '2454', Name: '聯發科' },
        { Type: 'US', Id: 'NVDA', Name: '輝達' },
        { Type: 'US', Id: 'AAPL', Name: '蘋果' }
    ];

    let stockComps = JSON.parse(localStorage.getItem('StockComp_table')) || defaultStockComps;
    let tradeStore = JSON.parse(localStorage.getItem('TradeStore_table')) || {};

    const saveStockComps = () => localStorage.setItem('StockComp_table', JSON.stringify(stockComps));
    const saveTradeStore = () => localStorage.setItem('TradeStore_table', JSON.stringify(tradeStore));

    // 4. DOM 元件綁定
    const stockSelect = document.getElementById('stock-select');
    const roundSelect = document.getElementById('round-select');
    const tradeForm = document.getElementById('trade-form');
    const tradeDate = document.getElementById('trade-date');
    const tradeType = document.getElementById('trade-type');
    const inputPrice = document.getElementById('trade-price');
    const inputShares = document.getElementById('trade-shares');
    const inputFee = document.getElementById('trade-fee');
    const inputTax = document.getElementById('trade-tax');
    const inputNote = document.getElementById('trade-note');
    const groupPrice = document.getElementById('group-price');
    const labelShares = document.getElementById('label-shares');
    const tradeLedgerBody = document.getElementById('trade-ledger-body');
    const roundSummaryBody = document.getElementById('round-summary-body');

    tradeDate.value = new Date().toISOString().split('T')[0];

    // 5. 標的切換與渲染
    function renderStockOptions(targetId = null) {
        stockSelect.innerHTML = '';
        const marketStocks = stockComps.filter(s => s.Type === sessionMarket);

        if (marketStocks.length === 0) {
            stockSelect.innerHTML = '<option value="">無追蹤標的，請點擊新增</option>';
            return;
        }

        marketStocks.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.Id;
            opt.textContent = `${s.Id} ${s.Name}`;
            if (targetId && s.Id === targetId) opt.selected = true;
            stockSelect.appendChild(opt);
        });

        refreshPage();
    }

    // 6. 回合計算輔助函式
    function getRoundHolding(logs, roundName) {
        let shares = 0;
        logs.filter(l => l.round === roundName).forEach(l => {
            if (l.type === '買進') shares += l.shares;
            else if (l.type === '賣出') shares -= l.shares;
        });
        return shares;
    }

    function getLatestRoundMeta(logs) {
        if (!logs || logs.length === 0) {
            return { currentRound: 'R1', holding: 0, isClosed: true, nextRound: 'R1' };
        }

        const nums = logs.map(l => parseInt(l.round.replace('R', ''), 10) || 1);
        const maxNum = Math.max(...nums);
        const currentRound = `R${maxNum}`;
        const holding = getRoundHolding(logs, currentRound);
        const isClosed = (holding === 0);
        const nextRound = isClosed ? `R${maxNum + 1}` : currentRound;

        return { currentRound, holding, isClosed, nextRound };
    }

    function updateRoundOptions(logs) {
        roundSelect.innerHTML = '';
        const { currentRound, holding, isClosed, nextRound } = getLatestRoundMeta(logs);
        const kpiRoundEl = document.getElementById('kpi-current-round');

        if (isClosed) {
            const opt = document.createElement('option');
            opt.value = nextRound;
            opt.textContent = `${nextRound} (全新波段)`;
            opt.selected = true;
            roundSelect.appendChild(opt);
            kpiRoundEl.textContent = `待開啟 (${nextRound})`;
        } else {
            kpiRoundEl.textContent = `${currentRound} (進行中)`;
        }

        const distinctRounds = Array.from(new Set(logs.map(l => l.round))).sort().reverse();
        distinctRounds.forEach(r => {
            if (isClosed && r === nextRound) return;
            const opt = document.createElement('option');
            opt.value = r;
            const h = getRoundHolding(logs, r);
            opt.textContent = `${r} (${h > 0 ? '持股中' : '已結清'})`;
            if (!isClosed && r === currentRound) opt.selected = true;
            roundSelect.appendChild(opt);
        });
    }

    // 7. KPI 卡片計算
    function updateKPI(logs) {
        let shares = 0;
        let cost = 0;
        let realized = 0;

        logs.forEach(l => {
            if (l.type === '買進') {
                shares += l.shares;
                cost += Math.abs(l.netTotal);
            } else if (l.type === '賣出' || l.type === '股利') {
                if (l.type === '賣出') shares -= l.shares;
                realized += l.netTotal;
            }
        });

        const displayShares = Math.max(0, shares);
        document.getElementById('kpi-shares').textContent = `${displayShares.toLocaleString()} 股`;

        const avg = displayShares > 0 ? (cost / displayShares).toFixed(1) : '0.0';
        document.getElementById('kpi-avg-price').textContent = `均價 ${currency}${avg}`;

        const kpiCost = document.getElementById('kpi-cost');
        kpiCost.dataset.raw = cost;
        kpiCost.textContent = `${currency}${cost.toLocaleString()}`;

        const kpiReal = document.getElementById('kpi-realized');
        kpiReal.dataset.raw = realized;
        kpiReal.className = `kpi-value ${realized >= 0 ? profitColorClass : lossColorClass}`;
        kpiReal.textContent = `${realized >= 0 ? '+' : ''}${currency}${realized.toLocaleString()}`;
    }

    // 8. 渲染交易明細帳
    function renderLogs(logs) {
        tradeLedgerBody.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            let badgeClass = 'badge-buy';
            if (log.type === '賣出') badgeClass = 'badge-sell';
            else if (log.type === '股利') badgeClass = 'badge-dividend';
            else if (log.type === '出金') badgeClass = 'badge-withdraw';

            const sign = log.netTotal > 0 ? '+' : '';
            const totalColor = log.netTotal > 0 ? profitColorClass : (log.netTotal < 0 ? lossColorClass : '');

            tr.innerHTML = `
                <td>${log.date}</td>
                <td><strong>${log.round}</strong></td>
                <td><span class="${badgeClass}">${log.type}</span></td>
                <td class="text-right">${log.price > 0 ? currency + log.price.toLocaleString() : '-'}</td>
                <td class="text-right">${log.shares > 0 ? log.shares.toLocaleString() : '-'}</td>
                <td class="text-right" data-raw="${log.fee}">${currency}${log.fee.toLocaleString()}</td>
                <td class="text-right" data-raw="${log.tax}">${currency}${log.tax.toLocaleString()}</td>
                <td class="text-right ${totalColor}" data-raw="${log.netTotal}">${sign}${currency}${Math.abs(log.netTotal).toLocaleString()}</td>
                <td>${escapeHtml(log.note || '-')}</td>
            `;
            tradeLedgerBody.appendChild(tr);
        });
    }

    // 9. 渲染回合總覽表 (聚合計算)
    function renderRoundSummary(logs) {
        roundSummaryBody.innerHTML = '';
        const roundMap = {};

        logs.forEach(log => {
            const r = log.round;
            if (!roundMap[r]) {
                roundMap[r] = { round: r, dates: [], buyCost: 0, sellIncome: 0, dividendIncome: 0, sharesHolding: 0 };
            }
            roundMap[r].dates.push(log.date);
            const feeTax = (log.fee || 0) + (log.tax || 0);

            if (log.type === '買進') {
                roundMap[r].buyCost += (log.price * log.shares + feeTax);
                roundMap[r].sharesHolding += log.shares;
            } else if (log.type === '賣出') {
                roundMap[r].sellIncome += (log.price * log.shares - feeTax);
                roundMap[r].sharesHolding -= log.shares;
            } else if (log.type === '股利') {
                roundMap[r].dividendIncome += (log.price * log.shares - feeTax);
            }
        });

        const summaryData = Object.values(roundMap).map(item => {
            item.dates.sort();
            const minDate = item.dates[0] || '-';
            const maxDate = item.dates[item.dates.length - 1] || '-';
            const isHolding = item.sharesHolding > 0;
            const dateRange = isHolding ? `${minDate} ~ 進行中` : (minDate === maxDate ? minDate : `${minDate} ~ ${maxDate}`);

            const totalReturn = item.sellIncome + item.dividendIncome;
            const netRealized = isHolding ? totalReturn : (totalReturn - item.buyCost);
            const roi = item.buyCost > 0 ? ((netRealized / item.buyCost) * 100).toFixed(2) : '0.00';

            return { round: item.round, dateRange, buyCost: item.buyCost, totalReturn, netRealized, roi, isHolding };
        }).sort((a, b) => b.round.localeCompare(a.round));

        summaryData.forEach(row => {
            const tr = document.createElement('tr');
            const sign = row.netRealized > 0 ? '+' : '';
            const colorClass = row.netRealized > 0 ? profitColorClass : (row.netRealized < 0 ? lossColorClass : '');
            const statusBadge = row.isHolding 
                ? '<span class="badge-status-active">進行中</span>' 
                : '<span class="badge-status-closed">已結清</span>';

            tr.innerHTML = `
                <td><strong>${row.round}</strong></td>
                <td>${row.dateRange}</td>
                <td class="text-right" data-raw="${row.buyCost}">${currency}${row.buyCost.toLocaleString()}</td>
                <td class="text-right" data-raw="${row.totalReturn}">${currency}${row.totalReturn.toLocaleString()}</td>
                <td class="text-right ${colorClass}" data-raw="${row.netRealized}">
                    ${row.isHolding ? '持股中 (未結)' : `${sign}${currency}${Math.abs(row.netRealized).toLocaleString()}`}
                </td>
                <td class="text-right ${colorClass}">${row.isHolding ? '-' : `${sign}${row.roi}%`}</td>
                <td>${statusBadge}</td>
                <td><button type="button" class="btn-text-action" onclick="window.filterByRound('${row.round}')">查看明細</button></td>
            `;
            roundSummaryBody.appendChild(tr);
        });
    }

    // 10. 頁面資料統一重繪
    function refreshPage() {
        const symbol = stockSelect.value;
        if (!symbol) return;

        const logs = tradeStore[symbol] || [];
        updateRoundOptions(logs);
        syncFilterRounds(logs);

        const currentFilter = document.getElementById('detail-round-filter').value;
        const displayLogs = currentFilter === 'ALL' ? logs : logs.filter(l => l.round === currentFilter);

        renderLogs(displayLogs);
        renderRoundSummary(logs);
        updateKPI(logs);
    }

    function syncFilterRounds(logs) {
        const filterSelect = document.getElementById('detail-round-filter');
        const prev = filterSelect.value;
        filterSelect.innerHTML = '<option value="ALL">全部回合</option>';
        const distinct = Array.from(new Set(logs.map(l => l.round))).sort().reverse();
        distinct.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = `回合 ${r}`;
            filterSelect.appendChild(opt);
        });
        if (distinct.includes(prev)) filterSelect.value = prev;
    }

    // 11. 動作類型切換 (出金處理)
    tradeType.addEventListener('change', () => {
        if (tradeType.value === '出金') {
            groupPrice.style.display = 'none';
            inputPrice.removeAttribute('required');
            labelShares.textContent = '提領金額';
            inputShares.placeholder = '請輸入出金總額';
        } else {
            groupPrice.style.display = 'flex';
            inputPrice.setAttribute('required', 'true');
            labelShares.textContent = '股數 / 單位';
            inputShares.placeholder = '0';
        }
    });

    // 12. 交易表單提交 (自動生命週期判定)
    tradeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const symbol = stockSelect.value;
        if (!symbol) return;

        if (!tradeStore[symbol]) tradeStore[symbol] = [];
        const logs = tradeStore[symbol];

        const date = tradeDate.value;
        const type = tradeType.value;
        const price = parseFloat(inputPrice.value) || 0;
        const shares = parseInt(inputShares.value, 10) || 0;
        const fee = parseInt(inputFee.value, 10) || 0;
        const tax = parseInt(inputTax.value, 10) || 0;
        const note = inputNote.value.trim();

        const { currentRound, holding, isClosed, nextRound } = getLatestRoundMeta(logs);
        let targetRound = roundSelect.value;

        // 防呆：禁止超賣
        if (type === '賣出') {
            const currentHolding = getRoundHolding(logs, targetRound);
            if (currentHolding <= 0) {
                alert(`操作無效：${targetRound} 目前無剩餘持股可供賣出！`);
                return;
            }
            if (shares > currentHolding) {
                alert(`操作無效：${targetRound} 目前持股僅剩 ${currentHolding.toLocaleString()} 股，不可超賣！`);
                return;
            }
        }

        // 自動開新回合
        let isAutoNew = false;
        if (type === '買進' && isClosed) {
            targetRound = nextRound;
            isAutoNew = true;
        }

        let netTotal = 0;
        if (type === '買進') netTotal = -(price * shares + fee + tax);
        else if (type === '賣出' || type === '股利') netTotal = (price * shares - fee - tax);
        else if (type === '出金') netTotal = -shares;

        logs.unshift({
            date,
            round: targetRound,
            type,
            price: type === '出金' ? 0 : price,
            shares: type === '出金' ? 0 : shares,
            fee,
            tax,
            netTotal,
            note: note || (type === '出金' ? '純提領' : '')
        });

        saveTradeStore();

        // 觸發生命週期通知
        if (isAutoNew) {
            alert(`【波段開立通知】\n前波段已結清！系統已自動為您開立新回合：${targetRound}。`);
        } else if (type === '賣出' && (holding - shares === 0)) {
            alert(`【波段結算通知】\n本次賣出後，${targetRound} 持股數已全數歸零，該回合正式結算結束！`);
        }

        // 重設表單狀態
        tradeForm.reset();
        tradeDate.value = new Date().toISOString().split('T')[0];
        inputFee.value = '0';
        inputTax.value = '0';
        tradeType.dispatchEvent(new Event('change'));

        refreshPage();
    });

    // 13. Tab 分頁切換與篩選機制
    const tabBtnDetail = document.getElementById('tab-btn-detail');
    const tabBtnSummary = document.getElementById('tab-btn-summary');
    const panelDetail = document.getElementById('tab-panel-detail');
    const panelSummary = document.getElementById('tab-panel-summary');
    const filterWrap = document.getElementById('filter-wrap');
    const roundFilter = document.getElementById('detail-round-filter');
    const ledgerTip = document.getElementById('ledger-tip');

    tabBtnDetail.addEventListener('click', () => {
        tabBtnDetail.classList.add('active');
        tabBtnSummary.classList.remove('active');
        panelDetail.classList.remove('hidden');
        panelSummary.classList.add('hidden');
        filterWrap.style.display = 'flex';
        ledgerTip.textContent = '依時序紀錄之交易流水';
    });

    tabBtnSummary.addEventListener('click', () => {
        tabBtnSummary.classList.add('active');
        tabBtnDetail.classList.remove('active');
        panelSummary.classList.remove('hidden');
        panelDetail.classList.add('hidden');
        filterWrap.style.display = 'none';
        ledgerTip.textContent = '各波段週期損益彙總';

        const symbol = stockSelect.value;
        renderRoundSummary(tradeStore[symbol] || []);
    });

    roundFilter.addEventListener('change', () => {
        const symbol = stockSelect.value;
        const logs = tradeStore[symbol] || [];
        const sel = roundFilter.value;
        if (sel === 'ALL') {
            ledgerTip.textContent = '依時序紀錄之交易流水';
            renderLogs(logs);
        } else {
            ledgerTip.textContent = `篩選檢視：${sel} 回合明細`;
            renderLogs(logs.filter(l => l.round === sel));
        }
    });

    window.filterByRound = function(roundName) {
        tabBtnDetail.click();
        roundFilter.value = roundName;
        roundFilter.dispatchEvent(new Event('change'));
    };

    // 14. 新增標的彈窗控制 (StockComp)
    const modalAddStock = document.getElementById('modal-add-stock');
    const formAddStock = document.getElementById('form-add-stock');
    const newStockType = document.getElementById('new-stock-type');

    document.getElementById('btn-open-add-stock').addEventListener('click', () => {
        newStockType.value = sessionMarket;
        document.getElementById('new-stock-id').value = '';
        document.getElementById('new-stock-name').value = '';
        modalAddStock.classList.remove('hidden');
    });

    const closeModal = () => modalAddStock.classList.add('hidden');
    document.getElementById('btn-close-stock-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-stock').addEventListener('click', closeModal);

    formAddStock.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('new-stock-id').value.trim().toUpperCase();
        const name = document.getElementById('new-stock-name').value.trim();

        if (stockComps.some(s => s.Type === sessionMarket && s.Id === id)) {
            alert(`標的代號 ${id} 已存在！`);
            return;
        }

        stockComps.push({ Type: sessionMarket, Id: id, Name: name });
        saveStockComps();
        closeModal();
        renderStockOptions(id);
    });

    // 15. 金額防窺遮罩 (ISO 27000)
    let isMasked = false;
    document.getElementById('btn-mask-toggle').addEventListener('click', () => {
        isMasked = !isMasked;
        document.querySelectorAll('.kpi-value[data-raw], td[data-raw]').forEach(el => {
            const raw = Number(el.dataset.raw);
            const isProfit = el.classList.contains(profitColorClass) || el.textContent.includes('+');
            const sign = isProfit ? '+' : '';
            el.textContent = isMasked ? '******' : `${sign}${currency}${Math.abs(raw).toLocaleString()}`;
        });
    });

    // 16. 登出
    document.getElementById('btn-logout').addEventListener('click', () => {
        sessionStorage.clear();
        window.location.replace('index.html');
    });

    // XSS 防護輔助
    function escapeHtml(str) {
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
    }

    // 啟動入口
    stockSelect.addEventListener('change', refreshPage);
    const urlParams = new URLSearchParams(window.location.search);
    renderStockOptions(urlParams.get('symbol'));
});