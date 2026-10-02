// src/js/tradinglog.js

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 權限檢查：未登入則阻斷跳轉
  if (window.ClientAuth && !window.ClientAuth.requireAuth()) return;

  // 取得登入使用者市場別設定 (預設為 TW)
  const sessionInfo = window.ClientAuth ? window.ClientAuth.getSessionInfo() : { market: 'TW' };
  // 幣別符號前綴：美股市場為 $，台股市場為 NT$ 
  const currencySymbol = sessionInfo.market === 'US' ? '$' : 'NT$ ';

  // 取得網址列參數
  const urlParams = new URLSearchParams(window.location.search);
  // 當前選取的標的代碼 (強制轉大寫)
  let currentStock = (urlParams.get('symbol') || urlParams.get('stock_id') || '').toUpperCase();
  // 當前選取的回合數 (字串)
  let currentRound = (urlParams.get('round') || '').toUpperCase();
  // 系統建議的下一回合數
  let currentSuggestedRound = '0';

  // =========================================================================
  // DOM 元素快取宣告與說明
  // =========================================================================
  // 下拉選單：標的代碼
  const selectStock = document.getElementById('select-stock');
  // 下拉選單：回合數
  const selectRound = document.getElementById('select-round');

  // 交易明細彈窗元素
  const modalTrade = document.getElementById('modal-add-trade');
  const modalTitle = document.getElementById('modal-title');
  const btnSubmitTradeText = document.getElementById('btn-submit-trade-text');

  // 交易明細表單輸入欄位
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

  // 股利 / 利息專屬 net_total 欄位
  const wrapNetTotal = document.getElementById('wrap-net-total');
  const inputNetTotal = document.getElementById('input-net-total');

  // 標的維護彈窗元素
  const modalStock = document.getElementById('modal-stock-comp');
  const inputNewStockId = document.getElementById('input-new-stock-id');
  const inputNewStockName = document.getElementById('input-new-stock-name');

  // =========================================================================
  // 通用輔助與輸入限制函式
  // =========================================================================

  // 工具函式：切換 Modal 顯示與隱藏
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

  /**
   * 數值欄位嚴格過濾器：防止 DB 溢位 (Overflow)
   * 1. 阻擋 e, E, +, - 科學記號與負號
   * 2. 限制原生最大長度 (maxLength)
   * 3. 即時替換非法字元，保證只有純數字
   * 
   * @param {HTMLInputElement} inputElement - 欲套用的輸入框
   * @param {boolean} allowDecimal - 是否允許小數點 (true: 單價/金額; false: 整數)
   * @param {number} maxLen - 最大允許輸入長度
   */
  const bindStrictNumericFilter = (inputElement, allowDecimal = false, maxLen = 10) => {
    if (!inputElement) return;

    // 設定 HTML 原生 maxLength 屬性
    inputElement.maxLength = maxLen;

    // 鍵盤輸入事件：直接阻擋非法按鍵
    inputElement.addEventListener('keydown', (e) => {
      // 嚴格阻斷科學記號、負號與正號
      if (['e', 'E', '+', '-'].includes(e.key)) {
        e.preventDefault();
      }
      // 不允許小數點的整數欄位，阻擋小數點
      if (!allowDecimal && e.key === '.') {
        e.preventDefault();
      }
    });

    // 內容變更事件：處理貼上或拖曳等輸入
    inputElement.addEventListener('input', (e) => {
      let val = e.target.value;
      if (allowDecimal) {
        // 移除非數字與非小數點
        val = val.replace(/[^0-9.]/g, '');
        // 僅保留第一個小數點，防止輸入多個小數點
        const parts = val.split('.');
        if (parts.length > 2) {
          val = parts[0] + '.' + parts.slice(1).join('');
        }
      } else {
        // 純整數過濾
        val = val.replace(/\D/g, '');
      }

      // 超過長度即時截斷
      if (val.length > maxLen) {
        val = val.slice(0, maxLen);
      }
      e.target.value = val;
    });
  };

  // 套用數值長度與型態限制 (防範資料庫數值溢位)
  bindStrictNumericFilter(inputRound, false, 4);       // 回合數：最多 4 位數 (0-9999)
  bindStrictNumericFilter(inputShares, false, 8);      // 股數：最多 8 位數 (0-99,999,999 股)
  bindStrictNumericFilter(inputFee, false, 7);         // 手續費：最多 7 位數
  bindStrictNumericFilter(inputTax, false, 7);         // 交易稅：最多 7 位數
  bindStrictNumericFilter(inputPrice, true, 11);       // 單價：最多 11 字元 (例：999999.9999)
  bindStrictNumericFilter(inputNetTotal, true, 12);    // 實收入帳金額：最多 12 字元 (例：999999999.99)

  // =========================================================================
  // 核心邏輯：依交易型態切換唯讀狀態與欄位顯隱
  // =========================================================================

  /**
   * 依據選取的交易型態切換表單欄位
   * 規則：
   * 1. REVENUE (配息) / INTEREST (利息)：
   *    - 顯示實收入帳金額 (net_total)。
   *    - 回合強制設為 0，且鎖定為唯讀。
   *    - 單價、股數、手續費、證券交易稅強制歸 0 並鎖定為唯讀。
   * 2. BUY (買進) / SELL (賣出)：
   *    - 隱藏實收入帳金額 (net_total) 容器。
   *    - 回合、單價、股數、手續費、證券交易稅全部解除唯讀。
   */
  const updateFormFieldsByTradeType = () => {
    if (!inputTradeType) return;

    const currentType = inputTradeType.value;
    const isIncomeType = (currentType === 'REVENUE' || currentType === 'INTEREST');

    if (isIncomeType) {
      // 1. 顯示收付淨額容器
      if (wrapNetTotal) wrapNetTotal.classList.remove('hidden');

      // 2. 回合強制為 0 並唯讀
      if (inputRound) {
        inputRound.value = '0';
        inputRound.readOnly = true;
        inputRound.classList.add('cursor-not-allowed', 'opacity-60');
      }

      // 3. 單價、股數、手續費、交易稅強制為 0 並唯讀
      const nonIncomeFields = [inputPrice, inputShares, inputFee, inputTax];
      nonIncomeFields.forEach((field) => {
        if (field) {
          field.value = '0';
          field.readOnly = true;
          field.classList.add('cursor-not-allowed', 'opacity-60');
        }
      });

      // 4. 聚焦至實收入帳金額輸入框
      if (inputNetTotal) {
        inputNetTotal.focus();
        inputNetTotal.select();
      }
    } else {
      // 1. 隱藏收付淨額容器並清空
      if (wrapNetTotal) wrapNetTotal.classList.add('hidden');
      if (inputNetTotal) inputNetTotal.value = '';

      // 2. 解除回合鎖定
      if (inputRound) {
        inputRound.readOnly = false;
        inputRound.classList.remove('cursor-not-allowed', 'opacity-60');
        if (inputRound.value === '0') {
          inputRound.value = currentSuggestedRound !== '0' ? currentSuggestedRound : '1';
        }
      }

      // 3. 單價、股數、手續費、交易稅解除唯讀
      const nonIncomeFields = [inputPrice, inputShares, inputFee, inputTax];
      nonIncomeFields.forEach((field) => {
        if (field) {
          field.readOnly = false;
          field.classList.remove('cursor-not-allowed', 'opacity-60');
          // 若原本數值為 0 則還原為空，正常顯示 placeholder
          if (field.value === '0') field.value = '';
        }
      });
    }
  };

  // 監聽交易型態下拉選單變更事件
  if (inputTradeType) {
    inputTradeType.addEventListener('change', updateFormFieldsByTradeType);
  }

  // 初始化預設值
  if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
  if (inputStockId) {
    inputStockId.value = currentStock;
    inputStockId.readOnly = true;
  }
  if (inputRound) {
    inputRound.value = currentRound || '0';
  }

  // 登出按鈕事件綁定
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

  // =========================================================================
  // 2. 核心資料載入函式
  // =========================================================================
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

  // =========================================================================
  // 3. 表格渲染與操作行為
  // =========================================================================
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

    // 綁定編輯按鈕
    tbody.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.onclick = () => {
        const targetLog = logs.find((item) => String(item.trade_id) === String(btn.dataset.id));
        if (!targetLog) return;

        if (inputTradeId) inputTradeId.value = targetLog.trade_id;
        if (modalTitle) modalTitle.textContent = '編輯交易明細';
        if (btnSubmitTradeText) btnSubmitTradeText.textContent = '儲存修改';

        // 標的代碼一律從既有資料代入並維持唯讀
        if (inputStockId) {
          inputStockId.value = targetLog.stock_id || currentStock;
          inputStockId.readOnly = true;
        }

        if (inputTradeDate) inputTradeDate.value = targetLog.trade_date ? targetLog.trade_date.slice(0, 10) : '';
        if (inputTradeType) inputTradeType.value = targetLog.trade_type || 'BUY';

        // 依交易型態校正欄位與唯讀屬性
        updateFormFieldsByTradeType();

        const isIncome = ['REVENUE', 'INTEREST'].includes(targetLog.trade_type);
        if (isIncome) {
          if (inputRound) inputRound.value = '0';
          if (inputNetTotal) inputNetTotal.value = Math.abs(Number(targetLog.net_total || 0));
        } else {
          if (inputRound) inputRound.value = targetLog.round !== undefined ? targetLog.round : '0';
          if (inputPrice) inputPrice.value = targetLog.price || '';
          if (inputShares) inputShares.value = targetLog.shares || '';
          if (inputFee) inputFee.value = targetLog.fee || '';
          if (inputTax) inputTax.value = targetLog.tax || '';
        }

        if (inputNote) inputNote.value = targetLog.note || '';

        toggleModal(modalTrade, true);
      };
    });

    // 綁定刪除按鈕
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

  // =========================================================================
  // 4. 標的與回合下拉選單變更
  // =========================================================================
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

  // =========================================================================
  // 5. 交易明細 Modal 開啟與關閉
  // =========================================================================
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

      // 標的代碼從外部代入
      if (inputStockId) {
        inputStockId.value = currentStock;
        inputStockId.readOnly = true;
      }

      if (inputTradeDate) inputTradeDate.value = new Date().toISOString().slice(0, 10);
      if (inputTradeType) inputTradeType.value = 'BUY';
      if (inputRound) inputRound.value = currentSuggestedRound !== '0' ? currentSuggestedRound : '1';
      if (inputPrice) inputPrice.value = '';
      if (inputShares) inputShares.value = '';
      if (inputFee) inputFee.value = '';
      if (inputTax) inputTax.value = '';
      if (inputNetTotal) inputNetTotal.value = '';
      if (inputNote) inputNote.value = '';

      // 開窗時重新檢查型態對應的唯讀與顯隱
      updateFormFieldsByTradeType();

      toggleModal(modalTrade, true);
    };
  }

  if (btnCloseModal) {
    btnCloseModal.onclick = () => toggleModal(modalTrade, false);
  }

  // =========================================================================
  // 6. 交易明細表單送出 (新增 / 修改) - 含第一道數值防呆與溢位檢查
  // =========================================================================
  const btnSubmitTrade = document.getElementById('btn-submit-trade');
  if (btnSubmitTrade) {
    btnSubmitTrade.onclick = async () => {
      const trade_id = inputTradeId?.value?.trim();
      const stock_id = inputStockId?.value?.trim();
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

      // 判斷是否為收益型態 (配息 / 利息)
      const isIncomeType = (trade_type === 'REVENUE' || trade_type === 'INTEREST');
      let round = 0;

      // =========================================================================
      // 數值邊界與溢位檢查常數 (第一道防線)
      // =========================================================================
      const MAX_ROUND_LIMIT = 9999;           // 回合上限
      const MAX_PRICE_LIMIT = 999999.9999;    // 單價上限
      const MAX_SHARES_LIMIT = 99999999;      // 股數上限 (99,999,999 股)
      const MAX_FEE_LIMIT = 9999999;          // 費用與稅金上限
      const MAX_NET_TOTAL_LIMIT = 999999999;  // 實收淨額上限 (9.9 億)

      if (isIncomeType) {
        // 股息與利息一律強制歸為第 0 回合
        round = 0;

        // 檢查實收入帳金額 (net_total)
        const netTotalNum = Number(inputNetTotal?.value || 0);
        if (netTotalNum <= 0) {
          alert('請填寫大於 0 的實收入帳金額！');
          if (inputNetTotal) inputNetTotal.focus();
          return;
        }
        if (netTotalNum > MAX_NET_TOTAL_LIMIT) {
          alert(`實收入帳金額過大，不可超過 ${MAX_NET_TOTAL_LIMIT.toLocaleString()}！`);
          if (inputNetTotal) inputNetTotal.focus();
          return;
        }
      } else {
        // 一般買賣：驗證回合、單價、股數、費用
        const roundRaw = inputRound?.value?.trim();
        round = parseInt(roundRaw, 10);
        if (isNaN(round) || round < 0) {
          alert('回合 (Round) 只能填寫大於或等於 0 的整數！');
          if (inputRound) inputRound.focus();
          return;
        }
        if (round > MAX_ROUND_LIMIT) {
          alert(`回合數不可超過 ${MAX_ROUND_LIMIT}！`);
          if (inputRound) inputRound.focus();
          return;
        }

        const priceNum = Number(inputPrice?.value || 0);
        const sharesNum = Number(inputShares?.value || 0);
        const feeNum = Number(inputFee?.value || 0);
        const taxNum = Number(inputTax?.value || 0);

        if (priceNum <= 0 || priceNum > MAX_PRICE_LIMIT) {
          alert(`單價必須大於 0 且不可超過 ${MAX_PRICE_LIMIT}！`);
          if (inputPrice) inputPrice.focus();
          return;
        }
        if (sharesNum <= 0 || sharesNum > MAX_SHARES_LIMIT) {
          alert(`股數必須大於 0 且不可超過 ${MAX_SHARES_LIMIT.toLocaleString()} 股！`);
          if (inputShares) inputShares.focus();
          return;
        }
        if (feeNum > MAX_FEE_LIMIT || taxNum > MAX_FEE_LIMIT) {
          alert(`手續費或交易稅金額過大，請確認是否輸入正確！`);
          return;
        }
      }

      const isEdit = Boolean(trade_id);
      // 組裝送出內容：收益型態送出 net_total，其餘單價/股數/費稅強制為 0
      const payload = {
        ...(isEdit && { trade_id }),
        stock_id,
        round,
        trade_date,
        trade_type,
        price: isIncomeType ? 0 : (inputPrice?.value || 0),
        shares: isIncomeType ? 0 : (inputShares?.value || 0),
        fee: isIncomeType ? 0 : (inputFee?.value || 0),
        tax: isIncomeType ? 0 : (inputTax?.value || 0),
        net_total: isIncomeType ? (inputNetTotal?.value || 0) : undefined,
        note: inputNote?.value?.trim() || ''
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

  // =========================================================================
  // 7. 標的維護 (新增標的)
  // =========================================================================
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