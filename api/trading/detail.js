// api/trading/detail.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');
const { TRADING_QUERIES } = require('../lib/queries');

module.exports = async function handler(req, res) {
  // 變數用途說明：sessionUser 儲存由伺服端憑證解析出的當前登入使用者資訊
  // 2026.10.08 feat: getAuthenticatedUser 改為非同步 (驗證 Clerk Token)，需 await
  const sessionUser = await getAuthenticatedUser(req);
  if (!sessionUser) {
    return res.status(401).json({ success: false, message: '未登入或登入已過期' });
  }

  // 變數用途說明：userId 儲存當前使用者的唯一識別代碼，供 SQL 隔離資料使用
  const userId = sessionUser.userId;

  /**
   * [2026-10-06] 異動說明
   * 目的：修復未讀取最新切換之市場別，導致標的清單與幣別維持在登入時預設市場的問題
   * 程式實作說明：
   * 1. 優先從前端呼叫 API 時傳入的 URL Query 參數 (req.query.market) 讀取最新市場別 (例如 'US' 或 'TW')
   * 2. 2026.10.08 feat: 不再降級為 sessionUser 或預設市場別，缺少時 GET 回 400
   * 3. 強制轉為大寫，確保與 stock_comp 資料表內的 market_type 完全一致
   */
  // 變數用途說明：marketType 儲存本次請求所指定的市場代碼 (例如 'TW' 或 'US')
  // 2026.10.08 feat: Token 不含市場別，僅讀取前端傳入的 market (POST/PUT/DELETE 不需要，GET 缺少時回 400)
  const marketType = String(req.query.market || '').trim().toUpperCase();

  // =========================================================================
  // 1. GET：查詢標的清單、回合狀態、部位統計與交易明細
  // =========================================================================
  if (req.method === 'GET') {
    if (!marketType) {
      return res.status(400).json({ success: false, message: '缺少市場別 (market)！' });
    }
    try {
      // 變數用途說明：stockListRes 儲存資料庫查詢回傳的標的清單原始結果
      const stockListRes = await query(TRADING_QUERIES.GET_STOCKS_FROM_COMP, [userId, marketType]);
      
      // 變數用途說明：availableStocks 格式化後的標的物件陣列，供前端下拉選單渲染
      const availableStocks = stockListRes.rows.map(r => ({
        stock_id: r.stock_id,
        stock_name: r.stock_name || ''
      }));

      // 變數用途說明：rawStockId 取得 URL 查詢參數中的標的代碼 (未經格式化)
      const rawStockId = req.query.stock_id || req.query.symbol;

      // 若未選擇標的，回傳空的統計與流水資料，但保留對應市場的 availableStocks
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

      // 變數用途說明：stockId 格式化為大寫之特定標的代碼
      const stockId = String(rawStockId).toUpperCase();
      // 變數用途說明：rawRound 前端傳入的回合數參數
      const rawRound = req.query.round;

      // 變數用途說明：allRoundsRes 該標的歷史所有回合資料庫查詢結果
      const allRoundsRes = await query(TRADING_QUERIES.GET_AVAILABLE_ROUNDS, [userId, stockId]);
      // 變數用途說明：availableRounds 格式化後的歷史回合清單與各回合剩餘股數
      const availableRounds = allRoundsRes.rows.map(r => ({
        round: Number(r.round),
        remaining_shares: Number(r.remaining_shares || 0)
      }));

      // 變數用途說明：suggestedRound 建議開立的下一個回合編號
      let suggestedRound = 1;
      // 變數用途說明：isRoundFinished 標記目前最新回合是否已平倉清空部位
      let isRoundFinished = false;

      // 變數用途說明：latestStatusRes 查詢該標的最新一回合之持股現況
      const latestStatusRes = await query(TRADING_QUERIES.GET_LATEST_ROUND_STATUS, [userId, stockId]);
      if (latestStatusRes.rows.length > 0) {
        // 變數用途說明：latestInfo 該標的最新回合之資料庫原始列
        const latestInfo = latestStatusRes.rows[0];
        // 變數用途說明：latestRoundNum 最新回合之編號整數
        // 2026.10.08 fix: 回合 0 (出入金/利息) 不可被 `|| 1` 轉成 1，否則建議回合會變成 2
        const latestRoundNum = Number(latestInfo.round) || 0;
        // 變數用途說明：latestRemaining 最新回合目前剩餘之股數
        const latestRemaining = Number(latestInfo.remaining_shares || 0);

        if (latestRemaining === 0) {
          suggestedRound = latestRoundNum + 1;
          isRoundFinished = true;
        } else {
          suggestedRound = latestRoundNum;
          isRoundFinished = false;
        }
      }

      // 變數用途說明：hasRound 旗標，判斷前端是否有明確指定特定回合
      const hasRound = rawRound !== undefined && rawRound !== null && String(rawRound).trim() !== '';

      // 若未指定回合，回傳該標的全歷史累計指標
      if (!hasRound) {
        // 變數用途說明：allSummaryRes 該標的全歷史累計總和查詢結果
        const allSummaryRes = await query(TRADING_QUERIES.GET_STOCK_ALL_SUMMARY, [userId, stockId]);
        // 變數用途說明：position 統計資料列物件
        const position = allSummaryRes.rows[0] || {};

        // 變數用途說明：remainingShares 目前持股總庫存餘額
        const remainingShares = Number(position.remaining_shares || 0);
        // 變數用途說明：totalBuyCost 累計投入買進本金總額
        const totalBuyCost = Number(position.total_buy_cost || 0);
        // 變數用途說明：totalBoughtShares 累計買進總股數 (計算平均成本之分母)
        const totalBoughtShares = Number(position.total_bought_shares || 0);
        // 變數用途說明：totalSellRevenue 累計賣出總收入
        const totalSellRevenue = Number(position.total_sell_revenue || 0);
        // 變數用途說明：totalDividends 累計股息與利息收入
        const totalDividends = Number(position.total_dividends || 0);
        // 變數用途說明：avgCost 計算後之平均持有成本 (本金 / 總買進股數)
        const avgCost = totalBoughtShares > 0 ? (totalBuyCost / totalBoughtShares).toFixed(2) : 0;
        // 變數用途說明：totalPnl 全歷史累計損益總額
        const totalPnl = Number(position.total_pnl || 0);

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
              remainingShares,
              totalBuyCost,
              totalSellRevenue,
              totalDividends,
              avgCost: Number(avgCost),
              totalPnl
            },
            logs: []
          }
        });
      }

      // 變數用途說明：parsedRound 解析後的指定回合數字
      const parsedRound = parseInt(rawRound, 10);
      // 變數用途說明：targetRoundsInt 傳遞給 SQL ANY($3::int[]) 的回合陣列參數
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

      // 變數用途說明：平行查詢該回合的統計指標 (positionRes) 與流水帳清單 (logsRes)
      const [positionRes, logsRes] = await Promise.all([
        query(TRADING_QUERIES.GET_POSITION_BY_ROUNDS, [userId, stockId, targetRoundsInt]),
        query(TRADING_QUERIES.GET_TRADE_LOGS_BY_ROUNDS, [userId, stockId, targetRoundsInt])
      ]);

      // 變數用途說明：position 該指定回合之統計指標列
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
          logs: logsRes.rows
        }
      });

    } catch (err) {
      console.error('[Trading Detail GET Error]:', err);
      return res.status(500).json({ success: false, message: '無法取得交易紀錄', error: err.message });
    }
  }

  // =========================================================================
  // 2. POST：新增單筆交易明細
  // =========================================================================
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

      // 變數用途說明：isIncomeType 判斷交易類別是否為收益/金流型
      // 2026.10.08 fix: 納入 INPUT 與 OUTPUT，否則回合 0 會被 `|| 1` 誤存為第 1 回合，導致下一回合建議變成 2
      const isIncomeType = ['REVENUE', 'INTEREST', 'INPUT', 'OUTPUT'].includes(trade_type);

      // 變數用途說明：數值轉換與防呆處理變數
      let numPrice = Number(price);
      let numShares = Number(shares);
      let numFee = Math.round(Number(fee));
      let numTax = Math.round(Number(tax));
      let numRound = parseInt(String(round).replace(/\D/g, ''), 10) || 1;
      let computedNetTotal = Number(net_total);

      if (isIncomeType) {
        // 股息與利息固定歸屬第 0 回合，單價與股數歸 0
        numRound = 0;
        numPrice = 0;
        numShares = 0;
        numFee = 0;
        numTax = 0;
        computedNetTotal = isNaN(computedNetTotal) ? 0 : computedNetTotal;
      } else {
        // 一般買賣：若前端未傳遞收付淨額，自動進行公式試算
        if (isNaN(computedNetTotal) || computedNetTotal === 0) {
          // 變數用途說明：subtotal 未扣除稅費之成交金額 (單價 * 股數)
          const subtotal = numPrice * numShares;
          if (trade_type === 'BUY') {
            computedNetTotal = subtotal + numFee;
          } else if (trade_type === 'SELL') {
            computedNetTotal = subtotal - numFee - numTax;
          } else {
            computedNetTotal = subtotal || 0;
          }
        }
      }

      // 變數用途說明：insertValues 傳送給 INSERT_TRADE_LOG 參數化查詢之參數陣列
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

      // 變數用途說明：insertResult 新增資料列結果物件
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

  // =========================================================================
  // 3. PUT：編輯/更新指定交易明細
  // =========================================================================
  if (req.method === 'PUT') {
    try {
      const {
        trade_id,
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

      if (!trade_id || !stock_id || !trade_date || !trade_type) {
        return res.status(400).json({ success: false, message: '缺少交易ID、標的代碼、日期或交易型態等必填欄位！' });
      }

      // 2026.10.08 fix: 納入 INPUT 與 OUTPUT，固定歸屬第 0 回合 (同 POST)
      const isIncomeType = ['REVENUE', 'INTEREST', 'INPUT', 'OUTPUT'].includes(trade_type);

      let numPrice = Number(price);
      let numShares = Number(shares);
      let numFee = Math.round(Number(fee));
      let numTax = Math.round(Number(tax));
      let numRound = parseInt(String(round).replace(/\D/g, ''), 10) || 1;
      let computedNetTotal = Number(net_total);

      if (isIncomeType) {
        numRound = 0;
        numPrice = 0;
        numShares = 0;
        numFee = 0;
        numTax = 0;
        computedNetTotal = isNaN(computedNetTotal) ? 0 : computedNetTotal;
      } else {
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
      }

      // 變數用途說明：updateResult 更新資料列結果物件
      const updateResult = await query(TRADING_QUERIES.UPDATE_TRADE_LOG, [
        stock_id.toUpperCase(),
        numRound,
        trade_date,
        trade_type,
        numPrice,
        numShares,
        numFee,
        numTax,
        computedNetTotal,
        note,
        trade_id,
        userId
      ]);

      if (updateResult.rowCount === 0) {
        return res.status(404).json({ success: false, message: '找不到欲修改的交易記錄或無權限編輯' });
      }

      return res.status(200).json({
        success: true,
        message: '交易明細更新成功',
        data: updateResult.rows[0]
      });
    } catch (err) {
      console.error('[Trading Detail PUT Error]:', err);
      return res.status(500).json({ success: false, message: '更新交易紀錄失敗', error: err.message });
    }
  }

  // =========================================================================
  // 4. DELETE：刪除指定交易明細
  // =========================================================================
  if (req.method === 'DELETE') {
    try {
      // 變數用途說明：tradeId 取得欲刪除之流水帳識別代碼
      const tradeId = req.query.trade_id;

      if (!tradeId) {
        return res.status(400).json({ success: false, message: '請提供欲刪除的交易記錄編號 (trade_id)！' });
      }

      // 變數用途說明：deleteResult 刪除操作結果物件
      const deleteResult = await query(TRADING_QUERIES.DELETE_TRADE_LOG, [tradeId, userId]);

      if (deleteResult.rowCount === 0) {
        return res.status(404).json({ success: false, message: '找不到欲刪除的交易記錄或無權限刪除' });
      }

      return res.status(200).json({
        success: true,
        message: '交易記錄刪除成功',
        deletedId: tradeId
      });
    } catch (err) {
      console.error('[Trading Detail DELETE Error]:', err);
      return res.status(500).json({ success: false, message: '刪除交易紀錄失敗', error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
  return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};