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
      // 1. 取得使用者關注標的清單 (下拉選單來源)
      const stockListRes = await query(TRADING_QUERIES.GET_STOCKS_FROM_COMP, [userId]);
      const availableStocks = stockListRes.rows.map(r => r.stock_id);

      const rawStockId = req.query.stock_id || req.query.symbol;

      // 若未選擇標的，回傳標的清單與預設空值
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
            summary: { remainingShares: 0, totalBuyCost: 0, totalSellRevenue: 0, totalDividends: 0, avgCost: 0 },
            logs: []
          }
        });
      }

      const stockId = String(rawStockId).toUpperCase();
      const rawRound = req.query.round;

      // 2. 取得該標的所有 round 及持股剩餘量 (物件陣列：{ round, remaining_shares })
      const allRoundsRes = await query(TRADING_QUERIES.GET_AVAILABLE_ROUNDS, [userId, stockId]);
      const availableRounds = allRoundsRes.rows.map(r => ({
        round: Number(r.round),
        remaining_shares: Number(r.remaining_shares || 0)
      }));

      // 3. 自動判斷最新回合狀態與建議的下一回合 (round 現為 integer)
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

      // 4. 回合條件篩選
      let targetRoundsInt = [];
      let isSingleRound = false;

      if (rawRound && String(rawRound).trim() !== '') {
        const parsedRound = parseInt(rawRound, 10);
        if (!isNaN(parsedRound)) {
          targetRoundsInt = [parsedRound];
          isSingleRound = true;
        }
      } else {
        const top10Res = await query(TRADING_QUERIES.GET_LATEST_10_ROUNDS, [userId, stockId]);
        targetRoundsInt = top10Res.rows.map(r => Number(r.round)).filter(n => !isNaN(n));
      }

      // 若該標的無任何歷史明細
      if (targetRoundsInt.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            stockId,
            round: '',
            availableStocks,
            availableRounds: [],
            suggestedRound: 1,
            isRoundFinished: true,
            summary: { remainingShares: 0, totalBuyCost: 0, totalSellRevenue: 0, totalDividends: 0, avgCost: 0 },
            logs: []
          }
        });
      }

      // 5. 查詢部位數據與交易明細 (傳入 int[] 參數)
      const [positionRes, logsRes] = await Promise.all([
        query(TRADING_QUERIES.GET_POSITION_BY_ROUNDS, [userId, stockId, targetRoundsInt]),
        query(TRADING_QUERIES.GET_TRADE_LOGS_BY_ROUNDS, [userId, stockId, targetRoundsInt])
      ]);

      const position = positionRes.rows[0] || {};
      const remainingShares = Number(position.remaining_shares || 0);
      const totalBuyCost = Number(position.total_buy_cost || 0);
      const totalBoughtShares = Number(position.total_bought_shares || 0);
      const avgCost = totalBoughtShares > 0 ? (totalBuyCost / totalBoughtShares).toFixed(2) : 0;

      return res.status(200).json({
        success: true,
        data: {
          stockId,
          round: isSingleRound ? targetRoundsInt[0] : '',
          suggestedRound,
          isRoundFinished,
          availableStocks,
          availableRounds,
          summary: {
            remainingShares,
            totalBuyCost,
            totalSellRevenue: Number(position.total_sell_revenue || 0),
            totalDividends: Number(position.total_dividends || 0),
            avgCost: Number(avgCost)
          },
          logs: logsRes.rows
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