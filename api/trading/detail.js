// api/trading/detail.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');
const { TRADING_QUERIES } = require('../lib/queries');

module.exports = async function handler(req, res) {
  const sessionUser = getAuthenticatedUser(req);
  if (!sessionUser) {
    return res.status(401).json({ success: false, message: '未登入或登入已過期' });
  }

  const userId = sessionUser.userId || sessionUser.id;

  if (req.method === 'GET') {
    try {
      // 1. 取得使用者標的清單 (下拉選單來源)
      const stockListRes = await query(TRADING_QUERIES.GET_STOCKS_FROM_COMP, [userId]);
      const availableStocks = stockListRes.rows.map(r => ({
        stock_id: r.stock_id,
        stock_name: r.stock_name || ''
      }));

      const rawStockId = req.query.stock_id || req.query.symbol;

      // 若未選擇任何標的，回傳標的清單與初始空值
      if (!rawStockId) {
        return res.status(200).json({
          success: true,
          data: {
            stockId: '',
            round: '',
            availableStocks,
            availableRounds: [],
            suggestedRound: 1,
            isRoundFinished: true,
            summary: {
              remainingShares: 0,
              totalBuyCost: 0,
              totalSellRevenue: 0,
              totalDividends: 0,
              avgCost: 0,
              totalPnl: 0
            },
            logs: []
          }
        });
      }

      const stockId = String(rawStockId).toUpperCase();
      const rawRound = req.query.round;

      // 2. 取得該標的所有回合清單及持股剩餘量 (供下拉選單顯示)
      const allRoundsRes = await query(TRADING_QUERIES.GET_AVAILABLE_ROUNDS, [userId, stockId]);
      const availableRounds = allRoundsRes.rows.map(r => ({
        round: Number(r.round),
        remaining_shares: Number(r.remaining_shares || 0)
      }));

      // 3. 自動判斷最新回合狀態與建議的下一回合 (供彈窗新增交易預設使用)
      let suggestedRound = 1;
      let isRoundFinished = false;

      const latestStatusRes = await query(TRADING_QUERIES.GET_LATEST_ROUND_STATUS, [userId, stockId]);
      if (latestStatusRes.rows.length > 0) {
        const latestInfo = latestStatusRes.rows[0];
        const latestRoundNum = Number(latestInfo.round) || 1;
        const latestRemaining = Number(latestInfo.remaining_shares || 0);

        if (latestRemaining === 0) {
          // 持股餘額為 0 -> 最新回合已結清，自動開下一回合 (+1)
          suggestedRound = latestRoundNum + 1;
          isRoundFinished = true;
        } else {
          // 持股尚未出清 -> 仍在目前回合波段中
          suggestedRound = latestRoundNum;
          isRoundFinished = false;
        }
      }

      // 4. 判斷是否指定回合：
      // 若 rawRound 為 undefined、null 或空字串，代表「未選擇回合 (全歷史模式)」
      const hasRound = rawRound !== undefined && rawRound !== null && String(rawRound).trim() !== '';

      if (!hasRound) {
        // ==========================================
        // 【模式 A：回合為空】
        // 1. 查詢全標的歷史累計（不分回合）
        // 2. logs 回傳空陣列（不呈現明細）
        // ==========================================
        const allSummaryRes = await query(TRADING_QUERIES.GET_STOCK_ALL_SUMMARY, [userId, stockId]);
        const position = allSummaryRes.rows[0] || {};

        const remainingShares = Number(position.remaining_shares || 0);
        const totalBuyCost = Number(position.total_buy_cost || 0);
        const totalBoughtShares = Number(position.total_bought_shares || 0);
        const totalSellRevenue = Number(position.total_sell_revenue || 0);
        const totalDividends = Number(position.total_dividends || 0);
        const avgCost = totalBoughtShares > 0 ? (totalBuyCost / totalBoughtShares).toFixed(2) : 0;
        const totalPnl = Number(position.total_pnl || 0);

        return res.status(200).json({
          success: true,
          data: {
            stockId,
            round: '', // 回合保持空值
            suggestedRound,
            isRoundFinished,
            availableStocks,
            availableRounds,
            summary: {
              remainingShares,
              totalBuyCost,
              totalSellRevenue,
              totalDividends,
              avgCost: Number(avgCost),
              totalPnl
            },
            logs: [] // 依需求：未選回合時不呈現任何明細流水帳
          }
        });
      }

      // ==========================================
      // 【模式 B：有選擇特定回合】
      // 依指定 round 查詢該回合部位與交易流水帳
      // ==========================================
      const parsedRound = parseInt(rawRound, 10);
      const targetRoundsInt = !isNaN(parsedRound) ? [parsedRound] : [];

      if (targetRoundsInt.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            stockId,
            round: '',
            suggestedRound,
            isRoundFinished,
            availableStocks,
            availableRounds,
            summary: {
              remainingShares: 0,
              totalBuyCost: 0,
              totalSellRevenue: 0,
              totalDividends: 0,
              avgCost: 0,
              totalPnl: 0
            },
            logs: []
          }
        });
      }

      // 查詢該特定回合的部位統計與交易明細清單
      const [positionRes, logsRes] = await Promise.all([
        query(TRADING_QUERIES.GET_POSITION_BY_ROUNDS, [userId, stockId, targetRoundsInt]),
        query(TRADING_QUERIES.GET_TRADE_LOGS_BY_ROUNDS, [userId, stockId, targetRoundsInt])
      ]);

      const position = positionRes.rows[0] || {};
      const remainingShares = Number(position.remaining_shares || 0);
      const totalBuyCost = Number(position.total_buy_cost || 0);
      const totalBoughtShares = Number(position.total_bought_shares || 0);
      const totalSellRevenue = Number(position.total_sell_revenue || 0);
      const totalDividends = Number(position.total_dividends || 0);
      const avgCost = totalBoughtShares > 0 ? (totalBuyCost / totalBoughtShares).toFixed(2) : 0;
      const totalPnl = position.total_pnl !== undefined
        ? Number(position.total_pnl || 0)
        : (totalSellRevenue + totalDividends) - totalBuyCost;

      return res.status(200).json({
        success: true,
        data: {
          stockId,
          round: targetRoundsInt[0],
          suggestedRound,
          isRoundFinished,
          availableStocks,
          availableRounds,
          summary: {
            remainingShares,
            totalBuyCost,
            totalSellRevenue,
            totalDividends,
            avgCost: Number(avgCost),
            totalPnl
          },
          logs: logsRes.rows // 回傳該回合明細紀錄
        }
      });

    } catch (err) {
      console.error('[Trading Detail GET Error]:', err);
      return res.status(500).json({ success: false, message: '無法取得交易紀錄', error: err.message });
    }
  }

  // POST 新增單筆交易明細
  if (req.method === 'POST') {
    try {
      const {
        stock_id,
        round = 1,
        trade_date,
        trade_type,
        price = 0,
        shares = 0,
        fee = 0,
        tax = 0,
        net_total,
        note = ''
      } = req.body || {};

      if (!stock_id || !trade_date || !trade_type) {
        return res.status(400).json({ success: false, message: '標的代碼、交易日期與交易類別為必填項！' });
      }

      const numPrice = Number(price);
      const numShares = Number(shares);
      const numFee = Math.round(Number(fee));
      const numTax = Math.round(Number(tax));
      // 確保 round 轉成乾淨的整數
      const numRound = parseInt(String(round).replace(/\D/g, ''), 10) || 1;

      let computedNetTotal = Number(net_total);
      if (isNaN(computedNetTotal) || computedNetTotal === 0) {
        const subtotal = numPrice * numShares;
        if (trade_type === 'BUY') {
          computedNetTotal = subtotal + numFee;
        } else if (trade_type === 'SELL') {
          computedNetTotal = subtotal - numFee - numTax;
        } else {
          computedNetTotal = subtotal || 0;
        }
      }

      const insertValues = [
        userId,
        stock_id.toUpperCase(),
        numRound,
        trade_date,
        trade_type,
        numPrice,
        numShares,
        numFee,
        numTax,
        computedNetTotal,
        note
      ];

      const insertResult = await query(TRADING_QUERIES.INSERT_TRADE_LOG, insertValues);

      return res.status(201).json({
        success: true,
        message: '交易記錄新增成功',
        data: insertResult.rows[0]
      });
    } catch (err) {
      console.error('[Trading Detail POST Error]:', err);
      return res.status(500).json({ success: false, message: '新增交易紀錄失敗', error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};