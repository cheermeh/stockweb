// api/lib/queries.js

const USER_QUERIES = {
  // 依帳號查詢使用者 (用於登入)
  FIND_USER_BY_USERNAME: `
    SELECT user_id, username, password_hash 
    FROM public.users 
    WHERE username = $1 
    LIMIT 1;
  `
};

const DASHBOARD_QUERIES = {
  // 儀表板 KPI 指標彙總
  GET_SUMMARY_METRICS: `
    SELECT 
      COALESCE(SUM(CASE WHEN trade_type = 'INPUT' THEN net_total ELSE 0 END), 0) AS total_deposit,
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_interest,
      COALESCE(SUM(
        CASE 
          WHEN trade_type IN ('INPUT', 'SELL', 'REVENUE', 'INTEREST') THEN net_total
          WHEN trade_type IN ('OUTPUT', 'BUY') THEN -net_total
          ELSE 0 
        END
      ), 0) AS current_cash,
      COALESCE(SUM(
        CASE 
          WHEN trade_type = 'SELL' THEN net_total 
          WHEN trade_type = 'BUY' THEN -net_total 
          ELSE 0 
        END
      ), 0) AS trade_net_pnl
    FROM public.trade_store
    WHERE user_id = $1;
  `,

  // 近期進出流水帳最新 10 筆
  GET_RECENT_LOGS: `
    SELECT 
      trade_id,
      trade_date,
      stock_id,
      round,
      trade_type,
      price,
      shares,
      fee,
      tax,
      net_total,
      note,
      created_at
    FROM public.trade_store
    WHERE user_id = $1
    ORDER BY trade_date DESC, created_at DESC
    LIMIT 10;
  `
};

module.exports = {
  USER_QUERIES,
  DASHBOARD_QUERIES
};