// api/lib/queries.js

const USER_QUERIES = {
  // 依帳號查詢使用者 (登入驗證)
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
    --入金合計
    SELECT 
      COALESCE(SUM(
      CASE 
        WHEN trade_type = 'INPUT' THEN net_total 
        WHEN trade_type = 'OUTPUT' THEN -net_total 
        ELSE 0 
      END
      ), 0) AS total_deposit,

      --利息合計
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_interest,
      
      --目前現金餘額
      COALESCE(SUM(
        CASE 
          WHEN trade_type IN ('INPUT', 'SELL', 'REVENUE', 'INTEREST') THEN net_total
          WHEN trade_type IN ('OUTPUT', 'BUY') THEN -net_total
          ELSE 0 
        END
      ), 0) AS current_cash,
      
      --交易損益
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

  // 儀表板近期交易流水帳 10 筆
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

const TRADING_QUERIES = {
  // 1. 取得使用者關注標的清單 (下拉選單來源)
  GET_STOCKS_FROM_COMP: `
    SELECT DISTINCT stock_id
    FROM public.stock_comp
    WHERE user_id = $1
    ORDER BY stock_id ASC;
  `,

  // 2. 取得該標的所有 ROUND (並在下拉選單呈現回合是否已結束)
  GET_AVAILABLE_ROUNDS: `
  SELECT 
  round,
  COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares WHEN trade_type = 'SELL' THEN -shares ELSE 0 END), 0) AS remaining_shares
  FROM public.trade_store
  WHERE user_id = $1 AND stock_id = $2
  GROUP BY round
ORDER BY round DESC;
  `,

  // 3. 取得該標的「近 10 回合」
  GET_LATEST_10_ROUNDS: `
    SELECT round
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2
    GROUP BY round
    ORDER BY round DESC
    LIMIT 10;
  `,

  // 4. 查詢標的「最新回合」以及該回合持股餘額 (判斷該回合是否結清)
  GET_LATEST_ROUND_STATUS: `
    WITH latest_r AS (
      SELECT round
      FROM public.trade_store
      WHERE user_id = $1 AND stock_id = $2
      GROUP BY round
      ORDER BY round DESC
      LIMIT 1
    )
    SELECT 
      l.round,
      COALESCE(SUM(CASE WHEN t.trade_type = 'BUY' THEN t.shares WHEN t.trade_type = 'SELL' THEN -t.shares ELSE 0 END), 0) AS remaining_shares
    FROM latest_r l
    JOIN public.trade_store t ON t.user_id = $1 AND t.stock_id = $2 AND t.round = l.round
    GROUP BY l.round;
  `,

  // 5. 依回合集合查詢交易明細
  GET_TRADE_LOGS_BY_ROUNDS: `
    SELECT 
      trade_id, user_id, stock_id, round, trade_date, trade_type, 
      price, shares, fee, tax, net_total, note, created_at
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2 AND round = ANY($3::int[])
    ORDER BY trade_date DESC, created_at DESC;
  `,

  // 6. 彙總指定回合集合部位
  GET_POSITION_BY_ROUNDS: `
    SELECT 
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares WHEN trade_type = 'SELL' THEN -shares ELSE 0 END), 0) AS remaining_shares,
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares ELSE 0 END), 0) AS total_bought_shares,
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN net_total ELSE 0 END), 0) AS total_buy_cost,
      COALESCE(SUM(CASE WHEN trade_type = 'SELL' THEN net_total ELSE 0 END), 0) AS total_sell_revenue,
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_dividends
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2 AND round = ANY($3::int[]);
  `,

  // 7. 新增單筆交易明細
  INSERT_TRADE_LOG: `
    INSERT INTO public.trade_store (
      user_id, stock_id, round, trade_date, trade_type, price, shares, fee, tax, net_total, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *;
  `
};

module.exports = {
  USER_QUERIES,
  DASHBOARD_QUERIES,
  TRADING_QUERIES
};