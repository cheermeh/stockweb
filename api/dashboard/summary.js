// api/dashboard/summary.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');
const { DASHBOARD_QUERIES } = require('../lib/queries');

module.exports = async function handler(req, res) {
  // 只允許 GET 方法請求
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
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
    // 變數用途說明：filterTradeType 交易類別條件 (例如 'BUY', 'SELL'；未選為 null)
    const filterTradeType = req.query.trade_type ? String(req.query.trade_type).trim() : null;

    // 變數用途說明：filterStockId 標的代碼條件 (強制轉大寫；未填為 null)
    const filterStockId = req.query.stock_id ? String(req.query.stock_id).trim().toUpperCase() : null;

    // 變數用途說明：filterStockName 標的名稱模糊搜尋條件 (未填為 null)
    const filterStockName = req.query.stock_name ? String(req.query.stock_name).trim() : null;

    // 變數用途說明：filterStartDate 起始交易日期條件 (格式 YYYY-MM-DD；未填為 null)
    const filterStartDate = req.query.start_date ? String(req.query.start_date).trim() : null;

    // 變數用途說明：filterEndDate 結束交易日期條件 (格式 YYYY-MM-DD；未填為 null)
    const filterEndDate = req.query.end_date ? String(req.query.end_date).trim() : null;

    // 變數用途說明：filterNote 備註說明模糊搜尋條件 (未填為 null)
    const filterNote = req.query.note ? String(req.query.note).trim() : null;

    /**
     * 變數用途說明：logsQueryParams 傳遞給 GET_RECENT_LOGS 的參數陣列
     * 依序對應 SQL 預編譯參數：
     *   $1: userId (使用者ID)
     *   $2: marketType (市場代碼)
     *   $3: filterTradeType (交易類別)
     *   $4: filterStockId (標的代碼)
     *   $5: filterStockName (標的名稱)
     *   $6: filterStartDate (起始日期)
     *   $7: filterEndDate (結束日期)
     *   $8: filterNote (備註關鍵字)
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

    // 變數用途說明：stats 資料庫回傳之 KPI 彙總第一列數據物件
    const stats = summaryResult.rows[0] || {};
    // 變數用途說明：totalDeposit 當前市場累計淨入金
    const totalDeposit = Number(stats.total_deposit || 0);
    // 變數用途說明：totalInterest 當前市場累計收益利息
    const totalInterest = Number(stats.total_interest || 0);
    // 變數用途說明：currentCash 當前市場帳戶可用現金餘額
    const currentCash = Number(stats.current_cash || 0);
    // 變數用途說明：tradeNetPnl 當前市場買賣交易淨損益
    const tradeNetPnl = Number(stats.trade_net_pnl || 0);
    // 變數用途說明：expectedReturnWithInterest 期望回收總額 (入金 + 利息)
    const expectedReturnWithInterest = totalDeposit + totalInterest;

    // 變數用途說明：pnlIncludingInterest 總體損益含息 (交易淨損益 + 利息)
    const pnlIncludingInterest = tradeNetPnl + totalInterest;
    // 變數用途說明：pnlExcludingInterest 波段損益不含息 (純交易淨損益)
    const pnlExcludingInterest = tradeNetPnl;

    // 變數用途說明：availableMarkets 轉換後的市場代碼純字串陣列 (例如 ['TW', 'US'])
    const availableMarkets = marketsResult.rows.map(item => item.market_type);

    // 回傳成功結果給前端
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
    console.error('[Dashboard Summary API Error]:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器內部錯誤，無法取得儀表板數據'
    });
  }
};