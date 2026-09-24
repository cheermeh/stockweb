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

    // 2. 平行發起安全參數化查詢
    const [summaryResult, logsResult] = await Promise.all([
      query(DASHBOARD_QUERIES.GET_SUMMARY_METRICS, [userId]),
      query(DASHBOARD_QUERIES.GET_RECENT_LOGS, [userId])
    ]);

    const stats = summaryResult.rows[0] || {};
    const totalDeposit = Number(stats.total_deposit || 0);
    const totalInterest = Number(stats.total_interest || 0);
    const currentCash = Number(stats.current_cash || 0);
    const tradeNetPnl = Number(stats.trade_net_pnl || 0);
    const expectedReturnWithInterest = totalDeposit + totalInterest; // 本金 + 利息
    
    // 3. 業務指標推導
    const pnlIncludingInterest = tradeNetPnl + totalInterest;
    const pnlExcludingInterest = tradeNetPnl ;
    // 期望回收指標


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
        recentLogs: logsResult.rows
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