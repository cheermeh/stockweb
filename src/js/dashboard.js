// src/js/dashboard.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 前端路由守衛：透過 client-auth.js 驗證基礎登入狀態
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) {
    return;
  }

  // 取得真實使用者帳號與市場設定 (由 ClientAuth 解析 Token 或 Session)
  const sessionInfo = window.ClientAuth 
    ? window.ClientAuth.getSessionInfo() 
    : { username: '', market: 'TW' };

  const { username = '', market = 'TW' } = sessionInfo;

  // 2. 市場顯示與樣式配置 (台股紅漲綠跌 / 美股綠漲紅跌)
  const marketConfig = {
    TW: {
      titleSuffix: '台股帳戶',
      currency: 'NT$ ',
      profitClass: 'text-profit', // 紅漲
      lossClass: 'text-loss'      // 綠跌
    },
    US: {
      titleSuffix: '美股帳戶',
      currency: '$ ',
      profitClass: 'text-loss',   // 美股綠漲
      lossClass: 'text-profit'    // 美股紅跌
    }
  };

  const currentConfig = marketConfig[market] || marketConfig.TW;

  // 3. 渲染 Header 使用者資訊與市場別 (真實使用者名稱遮罩)
  const userBadge = document.getElementById('current-user-badge');
  if (userBadge && username) {
    const maskedName = username.length > 3 ? `${username.slice(0, 3)}***` : username;
    userBadge.textContent = `${maskedName} (${currentConfig.titleSuffix})`;
  }

  // 4. 登出按鈕事件綁定
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (window.ClientAuth) {
        window.ClientAuth.logout();
      } else {
        sessionStorage.clear();
        localStorage.clear();
        window.location.replace('index.html');
      }
    });
  }

  // 5. 導航至個股明細頁面 (已移除寫死的 2330 / NVDA，直接導航至空白標的頁)
  const btnGotoTradinglog = document.getElementById('btn-goto-tradinglog');
  if (btnGotoTradinglog) {
    btnGotoTradinglog.addEventListener('click', (e) => {
      e.preventDefault();
      // 跳轉至純淨的 tradinglog.html，由使用者於下拉選單選擇標的
      window.location.href = 'tradinglog.html';
    });
  }

  // 資料庫 ENUM 代碼對應中文標籤與 Badge 樣式
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

  // 6. 從後端 API 取得真實儀表板數據
  try {
    const res = await fetch('/api/dashboard/summary');

    // 鑑權失敗或登入逾時防呆
    if (res.status === 401) {
      alert('未授權存取或登入已過期，請重新登入！');
      if (window.ClientAuth) {
        window.ClientAuth.logout();
      } else {
        sessionStorage.clear();
        localStorage.clear();
        window.location.replace('index.html');
      }
      return;
    }

    const result = await res.json();
    if (!result.success) {
      throw new Error(result.message || '取得數據失敗');
    }

    const { summary = {}, recentLogs = [] } = result.data || {};
    globalRecentLogs = recentLogs;

    // 7. 渲染 6 大 KPI 卡片 (依序對應卡片 DOM 順序)
    // [入金合計, 利息合計, 期望回收(本金+利息), 當前現金, 波段損益(不含息), 當前損益(含息)]
    const kpiValues = [
      Number(summary.totalDeposit || 0),
      Number(summary.totalInterest || 0),
      Number(summary.expectedReturnWithInterest || 0), // 本金 + 利息
      Number(summary.currentCash || 0),
      Number(summary.pnlExcludingInterest || 0),
      Number(summary.pnlIncludingInterest || 0)
    ];

    const kpiElements = document.querySelectorAll('.kpi-value');
    kpiElements.forEach((el, idx) => {
      const val = kpiValues[idx];
      el.dataset.raw = val;

      const isPnL = idx >= 4; // 第 5、6 張卡片為損益類
      const sign = isPnL && val > 0 ? '+' : '';
      el.textContent = `${sign}${currentConfig.currency}${val.toLocaleString()}`;

      if (isPnL) {
        el.classList.remove('text-profit', 'text-loss');
        el.classList.add(val >= 0 ? currentConfig.profitClass : currentConfig.lossClass);
      }
    });

    // 計算並渲染報酬率百分比 (以淨入金 totalDeposit 作為基準)
    const subPnlNoInt = document.getElementById('sub-pnl-noint');
    const subPnlInt = document.getElementById('sub-pnl-int');
    const totalDep = Number(summary.totalDeposit || 0);

    // (1) 波段損益率 (不含息)
    if (subPnlNoInt) {
      const pnlNoInt = Number(summary.pnlExcludingInterest || 0);
      const rateNoInt = totalDep > 0 ? ((pnlNoInt / totalDep) * 100).toFixed(2) : '0.00';
      const sign = Number(rateNoInt) > 0 ? '+' : '';
      subPnlNoInt.dataset.rawRate = `${sign}${rateNoInt}%`;
      subPnlNoInt.textContent = `${sign}${rateNoInt}%`;
      subPnlNoInt.classList.remove('text-profit', 'text-loss');
      subPnlNoInt.classList.add(Number(rateNoInt) >= 0 ? currentConfig.profitClass : currentConfig.lossClass);
    }

    // (2) 當前損益率 (含利息)
    if (subPnlInt) {
      const pnlInt = Number(summary.pnlIncludingInterest || 0);
      const rateInt = totalDep > 0 ? ((pnlInt / totalDep) * 100).toFixed(2) : '0.00';
      const sign = Number(rateInt) > 0 ? '+' : '';
      subPnlInt.dataset.rawRate = `${sign}${rateInt}%`;
      subPnlInt.textContent = `${sign}${rateInt}%`;
      subPnlInt.classList.remove('text-profit', 'text-loss');
      subPnlInt.classList.add(Number(rateInt) >= 0 ? currentConfig.profitClass : currentConfig.lossClass);
    }

    // 8. 狀態更新：移除連線中提示
    const statusIndicators = document.querySelectorAll('header span, header div');
    statusIndicators.forEach(node => {
      if (node.textContent.includes('連線中...')) {
        node.textContent = '正常連線';
      }
    });

    // 9. 渲染近期進出流水帳真實表格
    renderLedgerTable(globalRecentLogs);

  } catch (err) {
    console.error('[Dashboard Error]:', err);
  }

  // 流水帳表格渲染函式
  function renderLedgerTable(logs) {
    const ledgerBody = document.getElementById('ledger-body');
    if (!ledgerBody) return;
    ledgerBody.innerHTML = '';

    if (!logs || logs.length === 0) {
      ledgerBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 24px; color: #888;">
            尚無任何交易流水記錄
          </td>
        </tr>
      `;
      return;
    }

    logs.forEach(item => {
      const tr = document.createElement('tr');
      const typeConf = TYPE_CONFIG[item.trade_type] || { 
        label: item.trade_type || '其他', 
        badgeClass: 'badge-deposit' 
      };

      // 判斷金流方向：入金、賣出、股利、利息為收入 (+)；出金、買進為支出 (-)
      const isIncome = ['INPUT', 'SELL', 'REVENUE', 'INTEREST'].includes(item.trade_type);
      const netAmount = Number(item.net_total || 0);

      const incomeText = isIncome ? `${currentConfig.currency}${netAmount.toLocaleString()}` : '-';
      const expenseText = !isIncome ? `${currentConfig.currency}${netAmount.toLocaleString()}` : '-';

      const displayDate = item.trade_date ? item.trade_date.slice(0, 10) : '-';
      const displayStock = item.stock_id || (['INPUT', 'OUTPUT'].includes(item.trade_type) ? '交割帳戶' : '-');

      tr.innerHTML = `
        <td>${displayDate}</td>
        <td>${displayStock}</td>
        <td><span class="badge ${typeConf.badgeClass}">${typeConf.label}</span></td>
        <td class="text-right ${isIncome ? currentConfig.profitClass : ''}" data-type="amount">${incomeText}</td>
        <td class="text-right ${!isIncome ? currentConfig.lossClass : ''}" data-type="amount">${expenseText}</td>
        <td>${item.note || ''}</td>
      `;
      ledgerBody.appendChild(tr);
    });
  }

  // 10. 一鍵金額遮罩切換功能 (資安隱私保護)
  const btnMaskToggle = document.getElementById('btn-mask-toggle');
  if (btnMaskToggle) {
    btnMaskToggle.addEventListener('click', () => {
      isMasked = !isMasked;

      // 遮罩 / 還原 KPI 卡片金額
      const kpiElements = document.querySelectorAll('.kpi-value');
      kpiElements.forEach((el, idx) => {
        const raw = Number(el.dataset.raw || 0);
        const isPnL = idx >= 4;
        const sign = isPnL && raw > 0 ? '+' : '';
        el.textContent = isMasked ? '******' : `${sign}${currentConfig.currency}${raw.toLocaleString()}`;
      });

      // 遮罩 / 還原 報酬率百分比
      const subPnlNoInt = document.getElementById('sub-pnl-noint');
      const subPnlInt = document.getElementById('sub-pnl-int');
      if (subPnlNoInt) {
        subPnlNoInt.textContent = isMasked ? '***%' : (subPnlNoInt.dataset.rawRate || '--%');
      }
      if (subPnlInt) {
        subPnlInt.textContent = isMasked ? '***%' : (subPnlInt.dataset.rawRate || '--%');
      }

      // 遮罩 / 還原 流水帳金額欄位
      document.querySelectorAll('[data-type="amount"]').forEach(el => {
        if (el.textContent.trim() !== '-') {
          el.textContent = isMasked ? '******' : el.textContent;
        }
      });

      // 若取消遮罩，重新渲染表格恢復原始金額格式
      if (!isMasked) {
        renderLedgerTable(globalRecentLogs);
      }
    });
  }
});