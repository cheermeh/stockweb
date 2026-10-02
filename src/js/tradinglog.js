// src/js/tradinglog.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 權限檢查：未登入則阻斷
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) return;

  const sessionInfo = window.ClientAuth ? window.ClientAuth.getSessionInfo() : { market: 'TW' };
  const currencySymbol = sessionInfo.market === 'US' ? '$' : 'NT$ ';

  // 取得網址列參數
  const urlParams = new URLSearchParams(window.location.search);
  let currentStock = (urlParams.get('symbol') || urlParams.get('stock_id') || '').toUpperCase();
  let currentRound = (urlParams.get('round') || '').toUpperCase();
  let currentSuggestedRound = '0';

  // DOM 元素快取
  const selectStock = document.getElementById('select-stock');
  const selectRound = document.getElementById('select-round');
  const modalTrade = document.getElementById('modal-add-trade');
  const modalTitle = document.getElementById('modal-title');
  const btnSubmitTradeText = document.getElementById('btn-submit-trade-text');
  const inputTradeId = document.getElementById('input-trade-id');
  const inputStockId = document.getElementById('input-stock-id');
  const inputRound = document.getElementById('input-round');
  const inputTradeDate = document.getElementById('input-trade-date');
  const inputTradeType = document.getElementById('input-trade-type');
  const inputPrice = document.getElementById('input-price');
  const inputShares = document.getElementById('input-shares');
  const inputFee = document.getElementById('input-fee');
  const inputTax = document.getElementById('input-tax');
  const inputNote = document.getElementById('input-note');

  const modalStock = document.getElementById('modal-stock-comp');
  const inputNewStockId = document.getElementById('input-new-stock-id');
  const inputNewStockName = document.getElementById('input-new-stock-name');

  // 工具函式：切換 Modal 顯示狀態
  const toggleModal = (modalEl, show) => {
    if (!modalEl) return;
    modalEl.classList.toggle('hidden', !show);
    modalEl.classList.toggle('flex', show);
  };

  // 工具函式：同步網址列狀態
  const syncUrl = () => {
    const roundParam = currentRound ? `&round=${encodeURIComponent(currentRound)}` : '';
    const newUrl = currentStock ? `${window.location.pathname}?symbol=${currentStock}${roundParam}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  };

  // 初始化預設值與輸入過濾防呆
  if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
  if (inputStockId) {
    inputStockId.value = currentStock;
    inputStockId.readOnly = true;
  }
  if (inputRound) {
    inputRound.value = currentRound || '0';
    inputRound.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  }

  // 登出按鈕：直接清空並跳轉，具備降級防呆
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

  // 2. 核心資料載入函式
  async function loadTradingData(stockId, round) {
    try {
      const roundParam = round !== '' && round !== null && round !== undefined ? encodeURIComponent(round) : '';
      const url = stockId ? `/api/trading/detail?stock_id=${encodeURIComponent(stockId)}&round=${roundParam}` : '/api/trading/detail';

      const res = await fetch(url);
      if (res.status === 401) {
        if (window.ClientAuth) await window.ClientAuth.logout();
        return;
      }

      const result = await res.json();
      if (!result.success) throw new Error(result.message || '查詢失敗');

      const { availableStocks = [], availableRounds = [], summary = {}, logs = [], suggestedRound } = result.data || {};
      currentSuggestedRound = suggestedRound !== undefined && suggestedRound !== null ? String(suggestedRound) : '0';

      // (1) 渲染標的下拉選單
      if (selectStock) {
        selectStock.innerHTML = '<option value="">-- 請選擇標的 --</option>';
        availableStocks.forEach((s) => {
          const opt = document.createElement('option');
          const sId = typeof s === 'object' ? s.stock_id : s;
          const sName = typeof s === 'object' ? s.stock_name : '';
          opt.value = sId;
          opt.textContent = sName ? `${sId}-${sName}` : sId;
          if (sId === stockId) opt.selected = true;
          selectStock.appendChild(opt);
        });
      }

      // (2) 渲染回合下拉選單
      if (selectRound) {
        if (!stockId) {
          selectRound.innerHTML = '<option value="">-- 請先選擇標的 --</option>';
          selectRound.disabled = true;
        } else {
          selectRound.disabled = false;
          selectRound.innerHTML = '<option value="">-- 全部歷史 (未選回合) --</option>';
          availableRounds.forEach((r) => {
            const opt = document.createElement('option');
            const roundVal = typeof r === 'object' && r !== null ? r.round : r;
            opt.value = roundVal;
            const statusText = typeof r === 'object' && r.remaining_shares !== undefined ? (Number(r.remaining_shares) === 0 ? '已結束' : '進行中') : '';
            opt.textContent = `第 ${roundVal} 回合${statusText ? ` (${statusText})` : ''}`;
            if (String(roundVal) === String(round)) opt.selected = true;
            selectRound.appendChild(opt);
          });
        }
      }

      // (3) 渲染 5 大 KPI 指標卡片
      const elShares = document.getElementById('stat-shares');
      const elAvgCost = document.getElementById('stat-avg-cost');
      const elBuyCost = document.getElementById('stat-buy-cost');
      const elRevenue = document.getElementById('stat-revenue');
      const elPnl = document.getElementById('stat-pnl');

      if (!stockId) {
        if (elShares) elShares.textContent = '-- 股';
        if (elAvgCost) elAvgCost.textContent = '--';
        if (elBuyCost) elBuyCost.textContent = '--';
        if (elRevenue) elRevenue.textContent = '--';
        if (elPnl) {
          elPnl.textContent = '--';
          elPnl.className = 'text-xl font-bold mt-1 text-gray-400';
        }
      } else {
        if (elShares) elShares.textContent = `${Number(summary.remainingShares || 0).toLocaleString()} 股`;
        if (elAvgCost) elAvgCost.textContent = `${currencySymbol}${Number(summary.avgCost || 0).toLocaleString()}`;
        if (elBuyCost) elBuyCost.textContent = `${currencySymbol}${Number(summary.totalBuyCost || 0).toLocaleString()}`;
        if (elRevenue) {
          const totalRev = Number(summary.totalSellRevenue || 0) + Number(summary.totalDividends || 0);
          elRevenue.textContent = `${currencySymbol}${totalRev.toLocaleString()}`;
        }
        if (elPnl) {
          const totalPnl = Number(summary.totalPnl ?? 0);
          const isProfit = totalPnl >= 0;
          elPnl.textContent = `${isProfit ? '+' : '-'}${currencySymbol}${Math.abs(totalPnl).toLocaleString()}`;
          elPnl.className = `text-xl font-bold mt-1 ${isProfit ? 'text-profit' : 'text-loss'}`;
        }
      }

      // (4) 渲染流水帳表格
      renderTable(logs, stockId, round);
    } catch (err) {
      console.error('[TradingLog Load Error]:', err);
      const tbody = document.getElementById('trade-log-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-red-400">載入失敗: ${err.message}</td></tr>`;
    }
  }

  // 3. 表格渲染與操作行為
  function renderTable(logs, stockId, round) {
    const tbody = document.getElementById('trade-log-body');
    const countBadge = document.getElementById('log-count');
    if (!tbody) return;

    if (!stockId) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">請先由上方選單選擇標的代碼</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    if (round === '' || round === null || round === undefined) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">請選擇特定回合以檢視該回合交易流水帳明細</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">該回合尚無任何交易流水記錄</td></tr>';
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

    tbody.innerHTML = logs.map((log) => {
      const typeConf = TYPE_MAP[log.trade_type] || { label: log.trade_type, class: 'badge-buy' };
      const isIncome = ['SELL', 'REVENUE', 'INTEREST'].includes(log.trade_type);
      return `
        <tr>
          <td class="px-4 py-3">${log.trade_date ? log.trade_date.slice(0, 10) : '-'}</td>
          <td class="px-4 py-3"><span class="badge ${typeConf.class}">${typeConf.label} (R${log.round})</span></td>
          <td class="px-4 py-3 text-right">${Number(log.price || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right">${Number(log.shares || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right text-gray-400">${Number(log.fee || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right text-gray-400">${Number(log.tax || 0).toLocaleString()}</td>
          <td class="px-4 py-3 text-right font-medium ${isIncome ? 'text-profit' : 'text-loss'}">
            ${isIncome ? '+' : '-'}${currencySymbol}${Math.abs(Number(log.net_total || 0)).toLocaleString()}
          </td>
          <td class="px-4 py-3 text-gray-400">${log.note || ''}</td>
          <td class="px-4 py-3 text-center">
            <button type="button" class="btn-edit text-blue-400 hover:text-blue-300 mr-2.5 text-xs font-medium" data-id="${log.trade_id}">編輯</button>
            <button type="button" class="btn-delete text-gray-500 hover:text-red-400 text-xs font-medium" data-id="${log.trade_id}">刪除</button>
          </td>
        </tr>
      `;
    }).join('');

    // 綁定編輯
    tbody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.onclick = () => {
        const targetLog = logs.find((item) => String(item.trade_id) === String(btn.dataset.id));
        if (!targetLog) return;

        if (inputTradeId) inputTradeId.value = targetLog.trade_id;
        if (modalTitle) modalTitle.textContent = '編輯交易明細';
        if (btnSubmitTradeText) btnSubmitTradeText.textContent = '儲存修改';

        if (inputStockId) {
          inputStockId.value = targetLog.stock_id || currentStock;
          inputStockId.readOnly = true;
        }
        if (inputRound) inputRound.value = targetLog.round !== undefined ? targetLog.round : '0';
        if (inputTradeDate) inputTradeDate.value = targetLog.trade_date ? targetLog.trade_date.slice(0, 10) : '';
        if (inputTradeType) inputTradeType.value = targetLog.trade_type || 'BUY';
        if (inputPrice) inputPrice.value = targetLog.price || 0;
        if (inputShares) inputShares.value = targetLog.shares || 0;
        if (inputFee) inputFee.value = targetLog.fee || 0;
        if (inputTax) inputTax.value = targetLog.tax || 0;
        if (inputNote) inputNote.value = targetLog.note || '';

        toggleModal(modalTrade, true);
      };
    });

    // 綁定刪除
    tbody.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('確定要刪除這筆交易記錄嗎？此操作將無法復原。')) return;
        try {
          const res = await fetch(`/api/trading/detail?trade_id=${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          const result = await res.json();
          if (!result.success) throw new Error(result.message);
          loadTradingData(currentStock, currentRound);
        } catch (err) {
          alert(`刪除失敗: ${err.message}`);
        }
      };
    });
  }

  // 4. 標的與回合下拉選單變更
  if (selectStock) {
    selectStock.onchange = (e) => {
      currentStock = e.target.value;
      currentRound = '';
      syncUrl();
      loadTradingData(currentStock, currentRound);
    };
  }

  if (selectRound) {
    selectRound.onchange = (e) => {
      currentRound = e.target.value;
      syncUrl();
      loadTradingData(currentStock, currentRound);
    };
  }

  // 5. 交易明細 Modal 開啟與關閉
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  if (btnOpenModal) {
    btnOpenModal.onclick = () => {
      if (!currentStock) {
        alert('請先在上方選單選擇「標的」，再新增交易明細！');
        if (selectStock) selectStock.focus();
        return;
      }
      if (inputTradeId) inputTradeId.value = '';
      if (modalTitle) modalTitle.textContent = '新增交易明細';
      if (btnSubmitTradeText) btnSubmitTradeText.textContent = '確認送出儲存';

      if (inputStockId) {
        inputStockId.value = currentStock;
        inputStockId.readOnly = true;
      }
      if (inputRound) inputRound.value = currentSuggestedRound;
      if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
      if (inputTradeType) inputTradeType.value = 'BUY';
      if (inputPrice) inputPrice.value = '';
      if (inputShares) inputShares.value = '';
      if (inputFee) inputFee.value = '0';
      if (inputTax) inputTax.value = '0';
      if (inputNote) inputNote.value = '';

      toggleModal(modalTrade, true);
    };
  }

  if (btnCloseModal) {
    btnCloseModal.onclick = () => toggleModal(modalTrade, false);
  }

  // 6. 交易明細表單送出 (新增 / 修改)
  const btnSubmitTrade = document.getElementById('btn-submit-trade');
  if (btnSubmitTrade) {
    btnSubmitTrade.onclick = async () => {
      const trade_id = inputTradeId?.value?.trim();
      const stock_id = inputStockId?.value?.trim();
      const roundRaw = inputRound?.value?.trim();
      const trade_date = inputTradeDate?.value?.trim();
      const trade_type = inputTradeType?.value;

      if (!stock_id || !trade_date || !trade_type) {
        alert('請完整填寫標的代碼、交易日期與交易型態！');
        return;
      }

      if (isNaN(new Date(trade_date).getTime())) {
        alert('請填寫正確有效的交易日期！');
        if (inputTradeDate) inputTradeDate.focus();
        return;
      }

      const round = parseInt(roundRaw, 10);
      if (isNaN(round) || round < 0) {
        alert('回合 (Round) 只能填寫大於或等於 0 的整數！');
        if (inputRound) inputRound.focus();
        return;
      }

      const isEdit = Boolean(trade_id);
      const payload = {
        ...(isEdit && { trade_id }),
        stock_id,
        round,
        trade_date,
        trade_type,
        price: inputPrice?.value,
        shares: inputShares?.value,
        fee: inputFee?.value,
        tax: inputTax?.value,
        note: inputNote?.value?.trim()
      };

      try {
        const res = await fetch('/api/trading/detail', {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.message);

        alert(isEdit ? '交易明細更新成功！' : '交易明細記錄成功！');
        toggleModal(modalTrade, false);
        currentStock = stock_id.toUpperCase();
        loadTradingData(currentStock, currentRound);
      } catch (err) {
        alert(`${isEdit ? '更新' : '新增'}失敗: ${err.message}`);
      }
    };
  }

  // 7. 標的維護 (新增標的)
  const btnOpenStockModal = document.getElementById('btn-open-stock-modal');
  const btnCloseStockModal = document.getElementById('btn-close-stock-modal');
  const btnSubmitStockComp = document.getElementById('btn-submit-stock-comp');

  if (btnOpenStockModal) {
    btnOpenStockModal.onclick = () => {
      if (inputNewStockId) inputNewStockId.value = '';
      if (inputNewStockName) inputNewStockName.value = '';
      toggleModal(modalStock, true);
    };
  }

  if (btnCloseStockModal) {
    btnCloseStockModal.onclick = () => toggleModal(modalStock, false);
  }

  if (btnSubmitStockComp) {
    btnSubmitStockComp.onclick = async () => {
      const stock_id = inputNewStockId?.value?.trim();
      const stock_name = inputNewStockName?.value?.trim();

      if (!stock_id || !stock_name) {
        alert('請完整填寫標的代碼與標的名稱！');
        return;
      }

      try {
        const res = await fetch('/api/trading/addstock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id, stock_name })
        });
        const result = await res.json();
        if (!result.success) {
          alert(`提示：${result.message}`);
          return;
        }

        alert(result.message);
        toggleModal(modalStock, false);

        currentStock = stock_id.toUpperCase();
        currentRound = '';
        syncUrl();
        loadTradingData(currentStock, currentRound);
      } catch (err) {
        alert(`連線或新增失敗: ${err.message}`);
      }
    };
  }

  // 初始載入
  loadTradingData(currentStock, currentRound);
});