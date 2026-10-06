// api/dashboard/summary.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');
const { DASHBOARD_QUERIES } = require('../lib/queries');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    // 1. 身分鑑權：從 HttpOnly Session Cookie 提取已認證的使用者 ID
    const sessionUser = getAuthenticatedUser(req);
    if (!sessionUser || !sessionUser.userId) {
      return res.status(401).json({
        success: false,
        message: '未授權存取或登入逾時，請重新登入！'
      });
    }

    const userId = sessionUser.userId;

    /**
     * [2026-10-06] 異動說明
     * 目的：支援前端即時傳入目標市場代碼 (例如 ?market=US) 取得對應市場的財務數據
     * 實作說明：優先讀取 req.query.market，若未帶入則以 sessionUser 中的 market 或預設 TW 為主
     */
    const marketType = (req.query.market || sessionUser.market || sessionUser.market_type || 'TW').toUpperCase();

    /**
     * [2026-10-06] 異動說明
     * 目的：取得當前市場財務數據的同時，一併取得該使用者在 stock_comp 具備的所有市場別
     * 實作說明：平行發起 3 個安全參數化查詢 (指標彙總、流水明細、不重複市場別)，避免額外的 API 請求負擔
     */
    const [summaryResult, logsResult, marketsResult] = await Promise.all([
      query(DASHBOARD_QUERIES.GET_SUMMARY_METRICS, [userId, marketType]),
      query(DASHBOARD_QUERIES.GET_RECENT_LOGS, [userId, marketType]),
      query(DASHBOARD_QUERIES.GET_DISTINCT_MARKETS_BY_STOCK, [userId])
    ]);

    const stats = summaryResult.rows[0] || {};
    const totalDeposit = Number(stats.total_deposit || 0);
    const totalInterest = Number(stats.total_interest || 0);
    const currentCash = Number(stats.current_cash || 0);
    const tradeNetPnl = Number(stats.trade_net_pnl || 0);
    const expectedReturnWithInterest = totalDeposit + totalInterest; // 本金 + 利息

    // 3. 業務指標推導
    const pnlIncludingInterest = tradeNetPnl + totalInterest;
    const pnlExcludingInterest = tradeNetPnl;

    /**
     * [2026-10-06] 異動說明
     * 目的：轉換市場別資料格式
     * 實作說明：將資料庫回傳的物件陣列提取為乾淨字串陣列 (如 ['TW', 'US'])
     */
    const availableMarkets = marketsResult.rows.map(item => item.market_type);

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
        // [2026-10-06] 回傳資料庫所擁有的市場別清單
        availableMarkets
      }
    });

  } catch (error) {
    console.error('[Dashboard Summary API Error]:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器內部錯誤，無法取得儀表板數據'
    });
  }
};