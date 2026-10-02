// src/js/dashboard.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 登入狀態檢查：未通過驗證則中斷
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) {
    return;
  }

  // 取得使用者資訊與市場環境
  const { username = '', market = 'TW' } = window.ClientAuth ? window.ClientAuth.getSessionInfo() : {};
  const isUS = market.toUpperCase() === 'US';
  const currencySymbol = isUS ? '$' : 'NT$ ';

  // 2. 渲染市場徽章
  const badgeMarket = document.getElementById('badge-market');
  if (badgeMarket) {
    const maskedUser = username ? ` (${username.length > 3 ? username.slice(0, 3) + '***' : username})` : '';
    badgeMarket.textContent = `${isUS ? 'US' : 'TW'}${maskedUser}`;
  }

  // 3. 頁面導航至個股明細
  const btnGotoTradinglog = document.getElementById('btn-goto-tradinglog');
  if (btnGotoTradinglog) {
    btnGotoTradinglog.onclick = () => {
      window.location.href = 'tradinglog.html';
    };
  }

  // 4. 登出按鈕：直接清空並跳轉，具備降級防呆
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.onclick = () => {
      if (window.ClientAuth && typeof window.ClientAuth.logout === 'function') {
        window.ClientAuth.logout();
      } else {
        sessionStorage.clear();
        localStorage.clear();
        window.location.replace('index.html');
      }
    };
  }

  // 交易類別標籤與樣式映射
  const TYPE_CONFIG = {
    INPUT:    { label: '入金', badgeClass: 'badge-deposit' },
    OUTPUT:   { label: '出金', badgeClass: 'badge-deposit' },
    BUY:      { label: '買進', badgeClass: 'badge-buy' },
    SELL:     { label: '賣出', badgeClass: 'badge-sell' },
    REVENUE:  { label: '股利', badgeClass: 'badge-dividend' },
    INTEREST: { label: '利息', badgeClass: 'badge-dividend' }
  };

  let isMasked = false;
  let globalRecentLogs = [];

  // 金額字串格式化工具
  const formatAmount = (val, isPnL = false) => {
    if (isMasked) return '******';
    const sign = isPnL && val > 0 ? '+' : '';
    return `${sign}${currencySymbol}${val.toLocaleString()}`;
  };

  // 5. 請求後端儀表板數據
  try {
    const res = await fetch('/api/dashboard/summary');

    // 401 鑑權過期處理
    if (res.status === 401) {
      if (window.ClientAuth) window.ClientAuth.logout();
      return;
    }

    const result = await res.json();
    if (!result.success) throw new Error(result.message || '取得數據失敗');

    // 更新連線狀態文字
    const serverStatus = document.getElementById('server-status');
    if (serverStatus) serverStatus.textContent = '連線正常';

    const { summary = {}, recentLogs = [] } = result.data || {};
    globalRecentLogs = recentLogs;

    // 6. 渲染 KPI 卡片
    const kpiValues = [
      Number(summary.totalDeposit || 0),
      Number(summary.totalInterest || 0),
      Number(summary.expectedReturnWithInterest || 0),
      Number(summary.currentCash || 0),
      Number(summary.pnlExcludingInterest || 0),
      Number(summary.pnlIncludingInterest || 0)
    ];

    document.querySelectorAll('.kpi-value').forEach((el, idx) => {
      const val = kpiValues[idx];
      el.dataset.raw = val;
      const isPnL = idx >= 4;
      el.textContent = formatAmount(val, isPnL);
      if (isPnL) {
        el.className = `kpi-value text-xl font-bold mt-1 ${val >= 0 ? 'text-profit' : 'text-loss'}`;
      }
    });

    // 渲染報酬率百分比
    const totalDep = Number(summary.totalDeposit || 0);
    const renderRate = (elemId, pnlValue) => {
      const el = document.getElementById(elemId);
      if (!el) return;
      const rate = totalDep > 0 ? ((pnlValue / totalDep) * 100).toFixed(2) : '0.00';
      const sign = Number(rate) > 0 ? '+' : '';
      el.dataset.rawRate = `${sign}${rate}%`;
      el.textContent = `${sign}${rate}%`;
      el.className = `text-xs mt-1 ${Number(rate) >= 0 ? 'text-profit' : 'text-loss'}`;
    };

    renderRate('sub-pnl-noint', Number(summary.pnlExcludingInterest || 0));
    renderRate('sub-pnl-int', Number(summary.pnlIncludingInterest || 0));

    // 7. 渲染交易流水明細表
    renderLedgerTable(globalRecentLogs);

  } catch (err) {
    console.error('[Dashboard Error]:', err);
    const serverStatus = document.getElementById('server-status');
    if (serverStatus) serverStatus.textContent = '連線異常';
  }

  // 表格渲染函式
  function renderLedgerTable(logs) {
    const ledgerBody = document.getElementById('ledger-body');
    if (!ledgerBody) return;

    if (!logs || logs.length === 0) {
      ledgerBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">尚無任何交易流水記錄</td></tr>';
      return;
    }

    ledgerBody.innerHTML = logs.map(item => {
      const typeConf = TYPE_CONFIG[item.trade_type] || { label: item.trade_type || '其他', badgeClass: 'badge-deposit' };
      const isIncome = ['INPUT', 'SELL', 'REVENUE', 'INTEREST'].includes(item.trade_type);
      const netAmount = Number(item.net_total || 0);
      const displayDate = item.trade_date ? item.trade_date.slice(0, 10) : '-';
      const displayStock = item.stock_id || (['INPUT', 'OUTPUT'].includes(item.trade_type) ? '交割帳戶' : '-');

      return `
        <tr class="hover:bg-gray-800/30 transition-colors">
          <td class="px-6 py-4">${displayDate}</td>
          <td class="px-6 py-4 font-mono font-medium text-white">${displayStock}</td>
          <td class="px-6 py-4"><span class="badge ${typeConf.badgeClass}">${typeConf.label}</span></td>
          <td class="px-6 py-4 text-right">${isIncome ? formatAmount(netAmount) : '-'}</td>
          <td class="px-6 py-4 text-right">${!isIncome ? formatAmount(netAmount) : '-'}</td>
          <td class="px-6 py-4 text-gray-400">${item.note || ''}</td>
        </tr>
      `;
    }).join('');
  }

  // 8. 遮罩切換事件
  const btnMaskToggle = document.getElementById('btn-mask-toggle');
  if (btnMaskToggle) {
    btnMaskToggle.onclick = () => {
      isMasked = !isMasked;
      btnMaskToggle.textContent = isMasked ? '顯示金額' : '隱藏金額';

      // 遮罩卡片
      document.querySelectorAll('.kpi-value').forEach((el, idx) => {
        el.textContent = formatAmount(Number(el.dataset.raw || 0), idx >= 4);
      });

      // 遮罩百分比
      ['sub-pnl-noint', 'sub-pnl-int'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = isMasked ? '***%' : (el.dataset.rawRate || '--%');
      });

      // 重繪表格
      renderLedgerTable(globalRecentLogs);
    };
  }
});