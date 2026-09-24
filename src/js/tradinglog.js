// src/js/tradinglog.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 權限檢查：透過 client-auth.js 驗證登入狀態
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) return;

  const sessionInfo = window.ClientAuth ? window.ClientAuth.getSessionInfo() : { market: 'TW' };
  const currencySymbol = sessionInfo.market === 'US' ? '$' : 'NT$ ';

  // 取得網址列參數 (不預設任何標的代碼)
  const urlParams = new URLSearchParams(window.location.search);
  let currentStock = (urlParams.get('symbol') || urlParams.get('stock_id') || '').toUpperCase();
  let currentRound = (urlParams.get('round') || '').toUpperCase();

  // 暫存系統自動推算的建議回合 (供新增交易時預設使用)
  let currentSuggestedRound = '0';

  // DOM 元素快取：明細與交易相關
  const selectStock = document.getElementById('select-stock');
  const selectRound = document.getElementById('select-round');
  const modal = document.getElementById('modal-add-trade');
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

  // DOM 元素快取：標的維護 (關注名單管理) 相關
  const modalStock = document.getElementById('modal-stock-comp');
  const btnOpenStockModal = document.getElementById('btn-open-stock-modal');
  const btnCloseStockModal = document.getElementById('btn-close-stock-modal');
  const btnSubmitStockComp = document.getElementById('btn-submit-stock-comp');
  const inputNewStockId = document.getElementById('input-new-stock-id');
  const inputNewStockName = document.getElementById('input-new-stock-name');

  // 初始化新增彈窗預設值防呆
  if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
  if (inputStockId) {
    inputStockId.value = currentStock;
    // 預先鎖定標的欄位為唯讀
    inputStockId.readOnly = true;
  }
  if (inputRound) inputRound.value = currentRound || '0';

  // 【防呆】：回合輸入框即時過濾非數字字元 (禁止輸入小數點、負號或英文字母)
  if (inputRound) {
    inputRound.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  }

  // 2. 登出按鈕事件綁定
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

  // 3. 核心資料載入函式
  async function loadTradingData(stockId, round) {
    try {
      // 依據是否有 stockId 組裝 API 請求路徑
      const roundParam = (round !== undefined && round !== null && String(round).trim() !== '') ? encodeURIComponent(round) : '';
      const url = stockId
        ? `/api/trading/detail?stock_id=${encodeURIComponent(stockId)}&round=${roundParam}`
        : `/api/trading/detail`;

      const res = await fetch(url);
      if (res.status === 401) {
        alert('登入已過期，請重新登入！');
        if (window.ClientAuth) window.ClientAuth.logout();
        return;
      }

      const result = await res.json();
      if (!result.success) throw new Error(result.message || '查詢失敗');

      const {
        availableStocks = [],
        availableRounds = [],
        summary = {},
        logs = [],
        suggestedRound
      } = result.data || {};

      // 儲存後端推算的建議回合 (若無建議則預設為 0)
      currentSuggestedRound = suggestedRound !== undefined && suggestedRound !== null ? String(suggestedRound) : '0';

      // (1) 渲染標的下拉選單 (呈現格式：STOCK_ID-STOCK_NAME)
      if (selectStock) {
        selectStock.innerHTML = '<option value="">-- 請選擇標的 --</option>';
        availableStocks.forEach(s => {
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
          // 預設第一項為空值（代表全部歷史模式）
          selectRound.innerHTML = '<option value="">-- 全部歷史 (未選回合) --</option>';
          if (availableRounds && availableRounds.length > 0) {
            availableRounds.forEach(r => {
              const opt = document.createElement('option');
              const roundVal = (typeof r === 'object' && r !== null) ? r.round : r;
              opt.value = roundVal;

              if (typeof r === 'object' && r.remaining_shares !== undefined) {
                const statusText = Number(r.remaining_shares) === 0 ? '已結束' : '進行中';
                opt.textContent = `第 ${roundVal} 回合 (${statusText})`;
              } else {
                opt.textContent = `第 ${roundVal} 回合`;
              }

              // 準確比對字串，避免 roundVal 為 0 時因型別判斷失準
              if (String(roundVal) === String(round)) opt.selected = true;
              selectRound.appendChild(opt);
            });
          }
        }
      }

      // (3) 渲染 5 大 KPI 指標卡片
      const elShares = document.getElementById('stat-shares');
      const elAvgCost = document.getElementById('stat-avg-cost');
      const elBuyCost = document.getElementById('stat-buy-cost');
      const elRevenue = document.getElementById('stat-revenue');
      const elPnl = document.getElementById('stat-pnl');

      if (!stockId) {
        // 未選擇標的：全數重設為佔位符
        if (elShares) elShares.textContent = '-- 股';
        if (elAvgCost) elAvgCost.textContent = '--';
        if (elBuyCost) elBuyCost.textContent = '--';
        if (elRevenue) elRevenue.textContent = '--';
        if (elPnl) {
          elPnl.textContent = '--';
          elPnl.className = 'text-xl font-bold mt-1 text-gray-400';
        }
      } else {
        // 1. 目前持股餘額
        if (elShares) {
          elShares.textContent = `${Number(summary.remainingShares || 0).toLocaleString()} 股`;
        }

        // 2. 平均持有成本
        if (elAvgCost) {
          elAvgCost.textContent = `${currencySymbol}${Number(summary.avgCost || 0).toLocaleString()}`;
        }

        // 3. 累計投入本金 (買進)
        if (elBuyCost) {
          elBuyCost.textContent = `${currencySymbol}${Number(summary.totalBuyCost || 0).toLocaleString()}`;
        }

        // 4. 已實現收入 (賣出 + 配息/利息)
        if (elRevenue) {
          const totalRev = Number(summary.totalSellRevenue || 0) + Number(summary.totalDividends || 0);
          elRevenue.textContent = `${currencySymbol}${totalRev.toLocaleString()}`;
        }

        // 5. 損益合計：未選回合為全部歷史累計，選定回合為該單一回合波段損益
        if (elPnl) {
          const totalPnl = Number(summary.totalPnl ?? 0);
          const isProfit = totalPnl >= 0;
          const sign = isProfit ? '+' : '-';

          elPnl.textContent = `${sign}${currencySymbol}${Math.abs(totalPnl).toLocaleString()}`;
          elPnl.className = `text-xl font-bold mt-1 ${isProfit ? 'text-profit' : 'text-loss'}`;
        }
      }

      // (4) 渲染歷史交易流水帳明細
      renderTable(logs, stockId, round);

    } catch (err) {
      console.error('[TradingLog Load Error]:', err);
      const tbody = document.getElementById('trade-log-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-red-400">載入失敗: ${err.message}</td></tr>`;
      }
    }
  }

  // 4. 表格渲染函式 (擴充操作按鈕與事件綁定)
  function renderTable(logs, stockId, round) {
    const tbody = document.getElementById('trade-log-body');
    const countBadge = document.getElementById('log-count');
    if (!tbody) return;
    tbody.innerHTML = '';

    // 狀態 A：尚未選擇標的
    if (!stockId) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">請先由上方選單選擇標的代碼</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    // 狀態 B：已選標的但未選特定回合 (明確檢查空值與 undefined，允許回合為 0)
    const hasSelectedRound = round !== undefined && round !== null && String(round).trim() !== '';
    if (!hasSelectedRound) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">請選擇特定回合以檢視該回合交易流水帳明細</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    // 狀態 C：已選回合但該回合無明細資料
    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">該回合尚無任何交易流水記錄</td></tr>';
      if (countBadge) countBadge.textContent = '共 0 筆';
      return;
    }

    // 狀態 D：正常渲染該回合流水帳列表
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
        <td class="px-4 py-3 text-center">
          <button type="button" class="btn-edit text-blue-400 hover:text-blue-300 mr-2.5 text-xs font-medium" data-id="${log.trade_id}">編輯</button>
          <button type="button" class="btn-delete text-gray-500 hover:text-red-400 text-xs font-medium" data-id="${log.trade_id}">刪除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // 綁定編輯與刪除行為
    bindTableActions(logs);
  }

  // 5. 綁定表格內各列的編輯與刪除按鈕事件
  function bindTableActions(logs) {
    // 編輯明細：讀取當前資料並填入 Modal
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tradeId = e.currentTarget.dataset.id;
        const targetLog = logs.find(item => String(item.trade_id) === String(tradeId));
        if (!targetLog) return;

        // 切換 Modal 為編輯狀態
        if (inputTradeId) inputTradeId.value = targetLog.trade_id;
        if (modalTitle) modalTitle.textContent = '編輯交易明細';
        if (btnSubmitTradeText) btnSubmitTradeText.textContent = '儲存修改';

        // 資料回填並鎖定標的欄位
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

        // 開啟彈窗
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      });
    });

    // 刪除明細：呼叫 DELETE API
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tradeId = e.currentTarget.dataset.id;
        if (!confirm('確定要刪除這筆交易記錄嗎？此操作將無法復原。')) return;

        try {
          const res = await fetch(`/api/trading/detail?trade_id=${encodeURIComponent(tradeId)}`, {
            method: 'DELETE'
          });
          const result = await res.json();
          if (!result.success) throw new Error(result.message);

          // 刪除完成後重新載入目前畫面
          loadTradingData(currentStock, currentRound);
        } catch (err) {
          alert(`刪除失敗: ${err.message}`);
        }
      });
    });
  }

  // 6. 標的下拉選單變更事件
  if (selectStock) {
    selectStock.addEventListener('change', (e) => {
      currentStock = e.target.value;
      currentRound = ''; // 切換標的時，回合自動重設為空
      const newUrl = currentStock ? `${window.location.pathname}?symbol=${currentStock}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
      loadTradingData(currentStock, currentRound);
    });
  }

  // 7. 回合下拉選單變更事件
  if (selectRound) {
    selectRound.addEventListener('change', (e) => {
      currentRound = e.target.value;
      const roundParam = currentRound !== '' ? `&round=${encodeURIComponent(currentRound)}` : '';
      const newUrl = currentStock ? `${window.location.pathname}?symbol=${currentStock}${roundParam}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
      loadTradingData(currentStock, currentRound);
    });
  }

  // =========================================================================
  // 8. 打開新增明細彈窗 (加入防呆：未選標的禁止開窗、開窗鎖定標的)
  // =========================================================================
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  if (btnOpenModal && modal) {
    btnOpenModal.addEventListener('click', () => {
      // 【防呆 1】：必須先在主畫面選擇標的，否則禁止開啟新增交易彈窗
      if (!currentStock || currentStock.trim() === '') {
        alert('請先在上方選單選擇「標的」，再新增交易明細！');
        if (selectStock) selectStock.focus();
        return;
      }

      // 清空 trade_id 代表此為新增模式
      if (inputTradeId) inputTradeId.value = '';
      if (modalTitle) modalTitle.textContent = '新增交易明細';
      if (btnSubmitTradeText) btnSubmitTradeText.textContent = '確認送出儲存';

      // 【防呆 2】：鎖定標的代碼為當前選定的標的，不可編輯更動
      if (inputStockId) {
        inputStockId.value = currentStock;
        inputStockId.readOnly = true;
      }

      // 初始化表單欄位 (回合預設自動帶入建議回合，若無則為 0)
      if (inputRound) inputRound.value = currentSuggestedRound !== undefined ? currentSuggestedRound : '0';
      if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
      if (inputTradeType) inputTradeType.value = 'BUY';
      if (inputPrice) inputPrice.value = '';
      if (inputShares) inputShares.value = '';
      if (inputFee) inputFee.value = '0';
      if (inputTax) inputTax.value = '0';
      if (inputNote) inputNote.value = '';

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

  // =========================================================================
  // 9. 交易表單送出 (加入防呆：日期驗證、回合驗證、自動區分 POST 與 PUT)
  // =========================================================================
  const btnSubmitTrade = document.getElementById('btn-submit-trade');
  if (btnSubmitTrade) {
    btnSubmitTrade.addEventListener('click', async () => {
      const trade_id = inputTradeId?.value?.trim();
      const stock_id = inputStockId?.value?.trim();
      const roundRaw = inputRound?.value?.trim();
      const trade_date = inputTradeDate?.value?.trim();
      const trade_type = inputTradeType?.value;
      const price = inputPrice?.value;
      const shares = inputShares?.value;
      const fee = inputFee?.value;
      const tax = inputTax?.value;
      const note = inputNote?.value?.trim();

      // 基本必填防呆
      if (!stock_id || !trade_date || !trade_type) {
        alert('請完整填寫標的代碼、交易日期與交易型態！');
        return;
      }

      // 【防呆 3】：交易日期有效性檢查（轉成 Date 物件，轉不過去或 NaN 就直接擋掉）
      const dateObj = new Date(trade_date);
      if (isNaN(dateObj.getTime())) {
        alert('請填寫正確有效的交易日期！');
        if (inputTradeDate) inputTradeDate.focus();
        return;
      }

      // 【防呆 4】：回合 (Round) 必須為整數且允許大於或等於 0 (如 0, 1, 2...)
      if (roundRaw === '' || isNaN(roundRaw)) {
        alert('回合 (Round) 只能填寫數字！');
        if (inputRound) inputRound.focus();
        return;
      }

      const round = parseInt(roundRaw, 10);
      if (isNaN(round) || round < 0) {
        alert('回合 (Round) 只能填寫大於或等於 0 的整數！');
        if (inputRound) inputRound.focus();
        return;
      }

      const isEdit = Boolean(trade_id);
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        ...(isEdit && { trade_id }),
        stock_id,
        round,
        trade_date,
        trade_type,
        price,
        shares,
        fee,
        tax,
        note
      };

      try {
        const res = await fetch('/api/trading/detail', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.message);

        alert(isEdit ? '交易明細更新成功！' : '交易明細記錄成功！');

        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }

        // 維持當前選取的標的並重新整理明細
        currentStock = stock_id.toUpperCase();
        loadTradingData(currentStock, currentRound);
      } catch (err) {
        alert(`${isEdit ? '更新' : '新增'}失敗: ${err.message}`);
      }
    });
  }

  // =========================================================================
  // 10. 標的代碼維護 (新增標的) 彈窗控制與送出
  // =========================================================================

  // (1) 開啟「標的維護」彈窗
  if (btnOpenStockModal && modalStock) {
    btnOpenStockModal.addEventListener('click', () => {
      if (inputNewStockId) inputNewStockId.value = '';
      if (inputNewStockName) inputNewStockName.value = '';

      modalStock.classList.remove('hidden');
      modalStock.classList.add('flex');
    });
  }

  // (2) 關閉「標的維護」彈窗
  if (btnCloseStockModal && modalStock) {
    btnCloseStockModal.addEventListener('click', () => {
      modalStock.classList.add('hidden');
      modalStock.classList.remove('flex');
    });
  }

  // (3) 送出新增標的：呼叫 /api/trading/addstock (單純新增，已存在則警告)
  if (btnSubmitStockComp) {
    btnSubmitStockComp.addEventListener('click', async () => {
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

        // 伺服器回傳已存在警告 (HTTP 409) 或其他檢核錯誤：彈出警示並中斷，不做任何異動
        if (!result.success) {
          alert(`提示：${result.message}`);
          return;
        }

        // 成功建立提示
        alert(result.message);

        // 關閉標的維護彈窗
        if (modalStock) {
          modalStock.classList.add('hidden');
          modalStock.classList.remove('flex');
        }

        // 自動將選取狀態切換為剛新增的標的，更新網址並載入最新下拉選單
        currentStock = stock_id.toUpperCase();
        currentRound = '';
        const newUrl = `${window.location.pathname}?symbol=${currentStock}`;
        window.history.replaceState(null, '', newUrl);

        loadTradingData(currentStock, currentRound);
      } catch (err) {
        alert(`連線或新增失敗: ${err.message}`);
      }
    });
  }

  // 初始載入
  loadTradingData(currentStock, currentRound);
});