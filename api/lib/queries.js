// api/lib/queries.js

/**
 * 使用者與登入驗證相關查詢
 */
const USER_QUERIES = {
  // 依帳號查詢使用者 (登入驗證)
  FIND_USER_BY_USERNAME: `
    SELECT user_id, username, password_hash 
    FROM public.users 
    WHERE username = $1 
    LIMIT 1;
  `
};

/**
 * 儀表板相關查詢
 */
const DASHBOARD_QUERIES = {
  // 儀表板 KPI 指標彙總
  GET_SUMMARY_METRICS: `
    SELECT 
      -- 入金合計：SUM(INPUT) - SUM(OUTPUT)
      COALESCE(SUM(
        CASE 
          WHEN trade_type = 'INPUT' THEN net_total 
          WHEN trade_type = 'OUTPUT' THEN -net_total 
          ELSE 0 
        END
      ), 0) AS total_deposit,

      -- 利息合計
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_interest,
      
      -- 目前現金餘額
      COALESCE(SUM(
        CASE 
          WHEN trade_type IN ('INPUT', 'SELL', 'REVENUE', 'INTEREST') THEN net_total
          WHEN trade_type IN ('OUTPUT', 'BUY') THEN -net_total
          ELSE 0 
        END
      ), 0) AS current_cash,
      
      -- 交易淨損益
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

/**
 * 個股交易明細與波段查詢
 */
const TRADING_QUERIES = {
  // 1. 取得使用者標的清單 (下拉選單來源：整合關注清單與既有交易紀錄)
  GET_STOCKS_FROM_COMP: `
    SELECT stock_id, stock_name
      FROM public.stock_comp
      WHERE user_id = $1
      GROUP BY stock_id, stock_name
    ORDER BY stock_id ASC;
  `,

  // 2. 取得該標的所有回合與各回合剩餘股數 (供下拉選單顯示回合進行狀態)
  GET_AVAILABLE_ROUNDS: `
    SELECT 
      round,
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares WHEN trade_type = 'SELL' THEN -shares ELSE 0 END), 0) AS remaining_shares
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2
    GROUP BY round
    ORDER BY round DESC;
  `,

  // 3. 查詢標的「最新回合」持股餘額 (用於新增紀錄時，判斷是否需自動開立下一回合)
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

  // 4. 當未選擇特定回合 (回合為空) 時：查詢該標的「全歷史」5 大卡片指標
  GET_STOCK_ALL_SUMMARY: `
    SELECT 
      -- 1. 目前總持股餘額
      COALESCE(SUM(
        CASE 
          WHEN trade_type = 'BUY' THEN shares 
          WHEN trade_type = 'SELL' THEN -shares 
          ELSE 0 
        END
      ), 0) AS remaining_shares,

      -- 買入總股數 (計算總平均持有成本的分母)
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares ELSE 0 END), 0) AS total_bought_shares,

      -- 2. 累計投入本金 (買進 net_total 總額)
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN net_total ELSE 0 END), 0) AS total_buy_cost,

      -- 3. 已實現收入 (賣出 net_total 總額)
      COALESCE(SUM(CASE WHEN trade_type = 'SELL' THEN net_total ELSE 0 END), 0) AS total_sell_revenue,

      -- 4. 累計配息/利息
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_dividends,

      -- 5. 全歷史總損益：(賣出收入 + 利息收入) - 買進總成本
      COALESCE(SUM(
        CASE 
          WHEN trade_type IN ('SELL', 'REVENUE', 'INTEREST') THEN net_total
          WHEN trade_type = 'BUY' THEN -net_total
          ELSE 0 
        END
      ), 0) AS total_pnl
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2;
  `,

  // 5. 彙總「指定回合」部位 (當下拉選單選取了特定回合時使用)
  GET_POSITION_BY_ROUNDS: `
    SELECT 
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares WHEN trade_type = 'SELL' THEN -shares ELSE 0 END), 0) AS remaining_shares,
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares ELSE 0 END), 0) AS total_bought_shares,
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN net_total ELSE 0 END), 0) AS total_buy_cost,
      COALESCE(SUM(CASE WHEN trade_type = 'SELL' THEN net_total ELSE 0 END), 0) AS total_sell_revenue,
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_dividends,
      COALESCE(SUM(
        CASE 
          WHEN trade_type IN ('SELL', 'REVENUE', 'INTEREST') THEN net_total
          WHEN trade_type = 'BUY' THEN -net_total
          ELSE 0 
        END
      ), 0) AS total_pnl
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2 AND round = ANY($3::int[]);
  `,

  // 6. 依回合集合查詢交易流水帳明細 (選取特定回合時載入)
  GET_TRADE_LOGS_BY_ROUNDS: `
    SELECT 
      trade_id, user_id, stock_id, round, trade_date, trade_type, 
      price, shares, fee, tax, net_total, note, created_at
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2 AND round = ANY($3::int[])
    ORDER BY trade_date DESC;
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