// api/dashboard/summary.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');
const { DASHBOARD_QUERIES } = require('../lib/queries');

module.exports = async function handler(req, res) {
  // 1. 身分鑑權：驗證 Clerk Bearer Token 取得已認證的使用者 ID
  // 變數用途說明：sessionUser 儲存由伺服端驗證出的當前使用者認證資訊物件
  const sessionUser = await getAuthenticatedUser(req);
  if (!sessionUser || !sessionUser.userId) {
    return res.status(401).json({
      success: false,
      message: '未授權存取或登入逾時，請重新登入！'
    });
  }

  // 變數用途說明：userId 儲存當前使用者的唯一識別碼，供資料庫隔離查詢使用
  const userId = sessionUser.userId;

  // =========================================================================
  // 1. GET：取得儀表板 KPI 指標、近期流水帳與可用市場清單
  // =========================================================================
  if (req.method === 'GET') {
    try {
      // 變數用途說明：marketType 儲存前端傳入之市場代碼 (例如 'TW', 'US')，缺少時中斷執行
      const marketType = String(req.query.market || '').trim().toUpperCase();
      if (!marketType) {
        return res.status(400).json({ success: false, message: '缺少市場別 (market)！' });
      }

      /**
       * [2026-10-13] 異動說明
       * 目的：提取前端搜尋工具列傳入的 6 個篩選條件
       * 實作說明：若前端未傳入該參數或為空字串，一律轉為 null，觸發 SQL 內的 ($X IS NULL) 略過條件邏輯
       */
      const filterTradeType = req.query.trade_type ? String(req.query.trade_type).trim() : null;
      const filterStockId = req.query.stock_id ? String(req.query.stock_id).trim().toUpperCase() : null;
      const filterStockName = req.query.stock_name ? String(req.query.stock_name).trim() : null;
      const filterStartDate = req.query.start_date ? String(req.query.start_date).trim() : null;
      const filterEndDate = req.query.end_date ? String(req.query.end_date).trim() : null;
      const filterNote = req.query.note ? String(req.query.note).trim() : null;

      /**
       * 變數用途說明：logsQueryParams 傳遞給 GET_RECENT_LOGS 的參數陣列
       */
      const logsQueryParams = [
        userId,
        marketType,
        filterTradeType,
        filterStockId,
        filterStockName,
        filterStartDate,
        filterEndDate,
        filterNote
      ];

      /**
       * 平行發起 3 個安全參數化查詢：
       * 1. 財務指標彙總 (GET_SUMMARY_METRICS)
       * 2. 依條件篩選的交易流水明細 (GET_RECENT_LOGS)
       * 3. 該使用者所有市場清單 (GET_DISTINCT_MARKETS_BY_STOCK)
       */
      const [summaryResult, logsResult, marketsResult] = await Promise.all([
        query(DASHBOARD_QUERIES.GET_SUMMARY_METRICS, [userId, marketType]),
        query(DASHBOARD_QUERIES.GET_RECENT_LOGS, logsQueryParams),
        query(DASHBOARD_QUERIES.GET_DISTINCT_MARKETS_BY_STOCK, [userId])
      ]);

      const stats = summaryResult.rows[0] || {};
      const totalDeposit = Number(stats.total_deposit || 0);
      const totalInterest = Number(stats.total_interest || 0);
      const currentCash = Number(stats.current_cash || 0);
      const tradeNetPnl = Number(stats.trade_net_pnl || 0);
      const expectedReturnWithInterest = totalDeposit + totalInterest;

      const pnlIncludingInterest = tradeNetPnl + totalInterest;
      const pnlExcludingInterest = tradeNetPnl;

      // [2026-10-20] 異動說明：配合 stock_market 主檔改動，改取 market_id 作為可用市場陣列
      // (作廢) [2026-10-06] 原註解：availableMarkets 轉換後的市場代碼純字串陣列 (例如 ['TW', 'US'])
      const availableMarkets = marketsResult.rows.map(item => item.market_id);

      return res.status(200).json({
        success: true,
        data: {
          summary: {
            totalDeposit,
            totalInterest,
            expectedReturnWithInterest,
            currentCash,
            pnlExcludingInterest,
            pnlIncludingInterest
          },
          recentLogs: logsResult.rows,
          availableMarkets
        }
      });

    } catch (error) {
      console.error('[Dashboard Summary GET Error]:', error);
      return res.status(500).json({
        success: false,
        message: '伺服器內部錯誤，無法取得儀表板數據'
      });
    }
  }

  // =========================================================================
  // 2. POST：新增自訂市場別 (stock_market 主檔維護，比照 trading/detail.js 多動詞架構)
  // =========================================================================
  if (req.method === 'POST') {
    try {
      // 變數用途說明：marketId 取得市場代碼 (相容 market_id 或 market_type，強制大寫)
      const marketId = String((req.body || {}).market_id || (req.body || {}).market_type || '').trim().toUpperCase();
      // 變數用途說明：marketName 取得市場顯示名稱 (未填則預設為代碼)
      const marketName = String((req.body || {}).market_name || marketId).trim();

      // 欄位格式檢查
      if (!marketId) {
        return res.status(400).json({ success: false, message: '市場代碼 (market_id) 為必填欄位！' });
      }

      // 檢查市場別是否已存在 (以 user_id 與 market_id 為判斷基準)
      const checkSql = `
        SELECT market_id 
        FROM public.stock_market 
        WHERE user_id = $1 AND market_id = $2
        LIMIT 1;
      `;
      // 變數用途說明：checkResult 市場存在性檢查查詢結果
      const checkResult = await query(checkSql, [userId, marketId]);

      if (checkResult.rows.length > 0) {
        return res.status(409).json({ 
          success: false, 
          message: `市場代碼 [${marketId}] 已存在於清單中，未執行任何變更！` 
        });
      }

      // 寫入 stock_market 主檔
      // 變數用途說明：insertResult 新增市場資料庫執行結果
      const insertResult = await query(DASHBOARD_QUERIES.INSERT_STOCK_MARKET, [userId, marketId, marketName]);

      return res.status(201).json({
        success: true,
        message: `市場 [${marketId}] 新增成功`,
        data: insertResult.rows[0]
      });

    } catch (err) {
      console.error('[Dashboard Summary POST Error]:', err);
      return res.status(500).json({ 
        success: false, 
        message: '伺服器新增市場別失敗', 
        error: err.message 
      });
    }
  }

  // 若非 GET 或 POST 則拒絕
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};