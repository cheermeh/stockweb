// src/js/tradinglog.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 權限檢查
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) return;

  const sessionInfo = window.ClientAuth ? window.ClientAuth.getSessionInfo() : { market: 'TW' };
  const currencySymbol = sessionInfo.market === 'US' ? '$' : 'NT$ ';

  // 取得網址列參數
  const urlParams = new URLSearchParams(window.location.search);
  let currentStock = (urlParams.get('symbol') || urlParams.get('stock_id') || '').toUpperCase();
  let currentRound = (urlParams.get('round') || '').toUpperCase();

  // 暫存系統自動推算的建議回合
  let currentSuggestedRound = '1';

  // DOM 元素快取
  const selectStock = document.getElementById('select-stock');
  const selectRound = document.getElementById('select-round');
  const inputStockId = document.getElementById('input-stock-id');
  const inputRound = document.getElementById('input-round');
  const inputTradeDate = document.getElementById('input-trade-date');

  // 初始化預設值防呆
  if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
  if (inputStockId) inputStockId.value = currentStock;
  if (inputRound) inputRound.value = currentRound || '1';

  // 2. 登出按鈕
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (window.ClientAuth) window.ClientAuth.logout();
    });
  }

  // 3. 核心載入資料
  async function loadTradingData(stockId, round) {
    try {
      const url = stockId
        ? `/api/trading/detail?stock_id=${encodeURIComponent(stockId)}&round=${encodeURIComponent(round || '')}`
        : `/api/trading/detail`;

      const res = await fetch(url);
      if (res.status === 401) {
        alert('登入已過期，請重新登入！');
        if (window.ClientAuth) window.ClientAuth.logout();
        return;
      }

      const result = await res.json();
      if (!result.success) throw new Error(result.message || '查詢失敗');

      const { availableStocks = [], availableRounds = [], summary = {}, logs = [], suggestedRound } = result.data || {};

      // 更新推算回合
      currentSuggestedRound = suggestedRound || '1';

      // (1) 渲染標的下拉選單 (已修復：純粹放入股票代號)
      if (selectStock) {
        selectStock.innerHTML = '<option value="">-- 請選擇標的 --</option>';
        availableStocks.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          if (s === stockId) opt.selected = true;
          selectStock.appendChild(opt);
        });
      }

      // (2) 渲染回合選單 (已修復：支援字串或帶狀態的物件結構)
      if (selectRound) {
        if (!stockId) {
          selectRound.innerHTML = '<option value="">-- 前10回合 --</option>';
          selectRound.disabled = true;
        } else {
          selectRound.disabled = false;
          selectRound.innerHTML = '<option value="">前 10 回合 (預設)</option>';
          if (availableRounds && availableRounds.length > 0) {
            availableRounds.forEach(r => {
              const opt = document.createElement('option');
              const roundVal = (typeof r === 'object' && r !== null) ? r.round : r;
              opt.value = roundVal;

              // 若後端有帶回 remaining_shares 則附上狀態，否則顯示純文字
              if (typeof r === 'object' && r.remaining_shares !== undefined) {
                const statusText = Number(r.remaining_shares) === 0 ? '已結束' : '進行中';
                opt.textContent = `第 ${roundVal} 回合 (${statusText})`;
              } else {
                opt.textContent = `第 ${roundVal} 回合`;
              }

              if (String(roundVal) === String(round)) opt.selected = true;
              selectRound.appendChild(opt);
            });
          }
        }
      }

      // (3) 渲染 KPI 數值
      const elShares = document.getElementById('stat-shares');
      const elAvgCost = document.getElementById('stat-avg-cost');
      const elBuyCost = document.getElementById('stat-buy-cost');
      const elRevenue = document.getElementById('stat-revenue');

      if (!stockId) {
        if (elShares) elShares.textContent = '-- 股';
        if (elAvgCost) elAvgCost.textContent = '--';
        if (elBuyCost) elBuyCost.textContent = '--';
        if (elRevenue) elRevenue.textContent = '--';
      } else {
        if (elShares) elShares.textContent = `${Number(summary.remainingShares || 0).toLocaleString()} 股`;
        if (elAvgCost) elAvgCost.textContent = `${currencySymbol}${Number(summary.avgCost || 0).toLocaleString()}`;
        if (elBuyCost) elBuyCost.textContent = `${currencySymbol}${Number(summary.totalBuyCost || 0).toLocaleString()}`;
        if (elRevenue) elRevenue.textContent = `${currencySymbol}${(Number(summary.totalSellRevenue || 0) + Number(summary.totalDividends || 0)).toLocaleString()}`;
      }

      // (4) 渲染明細清單
      renderTable(logs, stockId);

    } catch (err) {
      console.error('[TradingLog Load Error]:', err);
      const tbody = document.getElementById('trade-log-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-red-400">載入失敗: ${err.message}</td></tr>`;
      }
    }
  }

  // 4. 表格渲染
  function renderTable(logs, stockId) {
    const tbody = document.getElementById('trade-log-body');
    const countBadge = document.getElementById('log-count');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!stockId) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">請由上方選單選擇標的代碼以檢視紀錄</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">所選條件下尚無交易明細</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    if (countBadge) countBadge.textContent = `共 ${logs.length} 筆`;

    const TYPE_MAP = {
      BUY: { label: '買進', class: 'badge-buy' },
      SELL: { label: '賣出', class: 'badge-sell' },
      REVENUE: { label: '配息', class: 'badge-dividend' },
      INTEREST: { label: '利息', class: 'badge-dividend' }
    };

    logs.forEach(log => {
      const tr = document.createElement('tr');
      const typeConf = TYPE_MAP[log.trade_type] || { label: log.trade_type, class: 'badge-buy' };
      const date = log.trade_date ? log.trade_date.slice(0, 10) : '-';
      const isIncome = ['SELL', 'REVENUE', 'INTEREST'].includes(log.trade_type);

      tr.innerHTML = `
        <td class="px-4 py-3">${date}</td>
        <td class="px-4 py-3"><span class="badge ${typeConf.class}">${typeConf.label} (R${log.round})</span></td>
        <td class="px-4 py-3 text-right">${Number(log.price || 0).toLocaleString()}</td>
        <td class="px-4 py-3 text-right">${Number(log.shares || 0).toLocaleString()}</td>
        <td class="px-4 py-3 text-right text-gray-400">${Number(log.fee || 0).toLocaleString()}</td>
        <td class="px-4 py-3 text-right text-gray-400">${Number(log.tax || 0).toLocaleString()}</td>
        <td class="px-4 py-3 text-right font-medium ${isIncome ? 'text-profit' : 'text-loss'}">
            ${isIncome ? '+' : '-'}${currencySymbol}${Math.abs(Number(log.net_total || 0)).toLocaleString()}
        </td>
        <td class="px-4 py-3 text-gray-400">${log.note || ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 5. 標的切換監聽
  if (selectStock) {
    selectStock.addEventListener('change', (e) => {
      currentStock = e.target.value;
      currentRound = '';
      const newUrl = currentStock ? `${window.location.pathname}?symbol=${currentStock}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
      loadTradingData(currentStock, currentRound);
    });
  }

  // 6. 回合切換監聽
  if (selectRound) {
    selectRound.addEventListener('change', (e) => {
      currentRound = e.target.value;
      const roundParam = currentRound ? `&round=${currentRound}` : '';
      const newUrl = `${window.location.pathname}?symbol=${currentStock}${roundParam}`;
      window.history.replaceState(null, '', newUrl);
      loadTradingData(currentStock, currentRound);
    });
  }

  // 7. 彈窗控制與自動帶入建議回合數
  const modal = document.getElementById('modal-add-trade');
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  if (btnOpenModal && modal) {
    btnOpenModal.addEventListener('click', () => {
      if (inputStockId) inputStockId.value = currentStock || '';
      if (inputRound) inputRound.value = currentSuggestedRound || '1';

      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  // 8. 新增交易表單送出
  const btnSubmitTrade = document.getElementById('btn-submit-trade');
  if (btnSubmitTrade) {
    btnSubmitTrade.addEventListener('click', async () => {
      const stock_id = document.getElementById('input-stock-id')?.value?.trim();
      const round = document.getElementById('input-round')?.value?.trim();
      const trade_date = document.getElementById('input-trade-date')?.value;
      const trade_type = document.getElementById('input-trade-type')?.value;
      const price = document.getElementById('input-price')?.value;
      const shares = document.getElementById('input-shares')?.value;
      const fee = document.getElementById('input-fee')?.value;
      const tax = document.getElementById('input-tax')?.value;
      const note = document.getElementById('input-note')?.value?.trim();

      if (!stock_id || !trade_date || !trade_type) {
        alert('請完整填寫標的代碼、交易日期與交易型態！');
        return;
      }

      try {
        const res = await fetch('/api/trading/detail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id, round, trade_date, trade_type, price, shares, fee, tax, note })
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.message);

        alert('交易明細記錄成功！');
        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }

        currentStock = stock_id.toUpperCase();
        currentRound = ''; // 重新載入近 10 回合
        loadTradingData(currentStock, currentRound);
      } catch (err) {
        alert(`新增失敗: ${err.message}`);
      }
    });
  }

  // 初始載入
  loadTradingData(currentStock, currentRound);
});