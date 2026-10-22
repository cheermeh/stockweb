// api/lib/queries.js

/**
 * =========================================================================
 * 2. 主儀表板相關查詢 (DASHBOARD_QUERIES)
 *    重點：市場別主檔為 stock_market，標的物 market_id 存在於 stock_comp。
 *    所有出入金與股票交易一律透過 INNER JOIN stock_comp 嚴格限定 c.market_id = $2，
 *    徹底杜絕台美股幣別混算。
 * =========================================================================
 */
const DASHBOARD_QUERIES = {
  /**
   * [2026-10-20] 重構說明
   * 目的：改由市場別維度主檔 (stock_market) 取得完整的市場清單，避免依賴 stock_comp 進行掃描
   * 參數：
   *   $1: userId (使用者識別碼)
   */
  GET_DISTINCT_MARKETS_BY_STOCK: `
    SELECT 
      market_id,
      market_name
    FROM public.stock_market
    WHERE user_id = $1
    ORDER BY market_id ASC;
  `,

  /**
   * 儀表板 KPI 指標彙總 (入金合計、利息合計、現金餘額、交易淨損益)
   * 參數：
   *   $1: userId (使用者識別碼)
   *   $2: market_id ('TW' 或 'US')
   * 
   * 業務說明：
   * 1. 透過 INNER JOIN stock_comp，只挑選屬於當前市場 (TW/US) 的所有交易與出入金紀錄。
   * 2. 避免台幣與美金在帳面金額上被混在一起加總。
   */
  GET_SUMMARY_METRICS: `
    SELECT 
      -- 1. 當前市場資金淨入金：SUM(INPUT) - SUM(OUTPUT)
      COALESCE(SUM(
        CASE 
          WHEN t.trade_type = 'INPUT' THEN t.net_total 
          WHEN t.trade_type = 'OUTPUT' THEN -t.net_total 
          ELSE 0 
        END
      ), 0) AS total_deposit,

      -- 2. 當前市場收益利息合計 (配息與利息收入)
      COALESCE(SUM(
        CASE 
          WHEN t.trade_type IN ('REVENUE', 'INTEREST') THEN t.net_total 
          ELSE 0 
        END
      ), 0) AS total_interest,
      
      -- 3. 當前市場可用現金餘額：(入金 + 賣出 + 利息) - (出金 + 買進)
      COALESCE(SUM(
        CASE 
          WHEN t.trade_type IN ('INPUT', 'SELL', 'REVENUE', 'INTEREST') THEN t.net_total
          WHEN t.trade_type IN ('OUTPUT', 'BUY') THEN -t.net_total
          ELSE 0 
        END
      ), 0) AS current_cash,
      
      -- 4. 當前市場交易淨損益：賣出收付淨額 - 買進收付淨額
      COALESCE(SUM(
        CASE 
          WHEN t.trade_type = 'SELL' THEN t.net_total 
          WHEN t.trade_type = 'BUY' THEN -t.net_total 
          ELSE 0 
        END
      ), 0) AS trade_net_pnl
    FROM public.trade_store t
    INNER JOIN public.stock_comp c 
      ON t.stock_id = c.stock_id AND t.user_id = c.user_id
    WHERE t.user_id = $1 AND c.market_id = $2;
  `,

  /**
   * 儀表板近期交易流水帳
   * 參數：
   *   $1: userId (使用者識別碼)
   *   $2: market_id ('TW' 或 'US')
   * 
   * [2026-10-09] 異動說明：
   * 目的：配合前端新增分頁功能 (全部/10/20/50/100)，移除 LIMIT 10 限制
   * 
   * [2026-10-13] 異動說明：
   * 目的：增加搜尋功能，允許前端依據交易類別、標的代碼、標的名稱、起訖日期及備註進行篩選(改WHERE子句)
   * 
   * [2026-10-22] 異動說明：
   * 目的：移除所有 TO_CHAR，一律直接讀取原始欄位名稱 trade_date 與 mtdt，由前端依使用者所在地時區動態轉換
   */
  GET_RECENT_LOGS: `
    SELECT 
      t.trade_id,
      t.trade_date,
      t.stock_id,
      c.stock_name,
      t.round,
      t.trade_type,
      t.price,
      t.shares,
      t.fee,
      t.tax,
      t.net_total,
      t.note,
      t.crtdt,
      t.mtdt
    FROM public.trade_store t
    INNER JOIN public.stock_comp c 
    ON t.stock_id = c.stock_id AND t.user_id = c.user_id
    WHERE   t.user_id = $1 
        AND c.market_id = $2
        AND ($3::text IS NULL OR t.trade_type::text = $3) --列舉轉TXT否則不能用
        AND ($4::text IS NULL OR t.stock_id = $4)
        AND ($5::text IS NULL OR c.stock_name ILIKE '%' || $5 || '%')
        AND ($6::date IS NULL OR t.trade_date >= $6)
        AND ($7::date IS NULL OR t.trade_date <= $7)
        AND ($8::text IS NULL OR t.note ILIKE '%' || $8 || '%')
    ORDER BY t.trade_date DESC, t.crtdt DESC
    /* LIMIT 10 */; --限制最多查詢筆數(暫時不用)
  `
};

/**
 * =========================================================================
 * 3. 個股交易明細與波段查詢 (TRADING_QUERIES)
 * =========================================================================
 */
const TRADING_QUERIES = {
  /**
   * 1. 取得使用者在當前市場的標的清單 (下拉選單來源)
   * 參數：
   *   $1: userId
   *   $2: market_id ('TW' 或 'US')
   */
  GET_STOCKS_FROM_COMP: `
    SELECT 
      stock_id, 
      stock_name
    FROM public.stock_comp
    WHERE user_id = $1 AND market_id = $2
    GROUP BY stock_id, stock_name
    ORDER BY stock_id ASC;
  `,

  /**
   * 2. 取得該標的所有回合清單與各回合持股剩餘量 (供回合下拉選單呈現進行狀態)
   * 參數：
   *   $1: userId
   *   $2: stockId (標的代碼)
   */
  GET_AVAILABLE_ROUNDS: `
    SELECT 
      round,
      COALESCE(SUM(
        CASE 
          WHEN trade_type = 'BUY' THEN shares 
          WHEN trade_type = 'SELL' THEN -shares 
          ELSE 0 
        END
      ), 0) AS remaining_shares
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2
    GROUP BY round
    ORDER BY round DESC;
  `,

  /**
   * 3. 查詢標的「最新回合」持股餘額 (用於判斷是否需要自動建議開立下一回合)
   * 參數：
   *   $1: userId
   *   $2: stockId (標的代碼)
   */
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
      COALESCE(SUM(
        CASE 
          WHEN t.trade_type = 'BUY' THEN t.shares 
          WHEN t.trade_type = 'SELL' THEN -t.shares 
          ELSE 0 
        END
      ), 0) AS remaining_shares
    FROM latest_r l
    JOIN public.trade_store t 
      ON t.user_id = $1 AND t.stock_id = $2 AND t.round = l.round
    GROUP BY l.round;
  `,

  /**
   * 4. 查詢該標的「全歷史」累計部位與 5 大指標 (未選擇特定回合時使用)
   * 參數：
   *   $1: userId
   *   $2: stockId (標的代碼)
   */
  GET_STOCK_ALL_SUMMARY: `
    SELECT 
      -- 1. 目前總持股餘額 (股數)
      COALESCE(SUM(
        CASE 
          WHEN trade_type = 'BUY' THEN shares 
          WHEN trade_type = 'SELL' THEN -shares 
          ELSE 0 
        END
      ), 0) AS remaining_shares,

      -- 累計買進總股數 (計算平均持有成本的分母)
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN shares ELSE 0 END), 0) AS total_bought_shares,

      -- 2. 累計投入本金 (買進 net_total 總額)
      COALESCE(SUM(CASE WHEN trade_type = 'BUY' THEN net_total ELSE 0 END), 0) AS total_buy_cost,

      -- 3. 已實現收入 (賣出 net_total 總額)
      COALESCE(SUM(CASE WHEN trade_type = 'SELL' THEN net_total ELSE 0 END), 0) AS total_sell_revenue,

      -- 4. 累計配息與利息收入
      COALESCE(SUM(CASE WHEN trade_type IN ('REVENUE', 'INTEREST') THEN net_total ELSE 0 END), 0) AS total_dividends,

      -- 5. 全歷史總損益：(賣出收入 + 配息利息) - 買進總成本
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

  /**
   * 5. 彙總「指定回合」波段部位與指標 (下拉選單選定特定 round 時使用)
   * 參數：
   *   $1: userId
   *   $2: stockId (標的代碼)
   *   $3: rounds 陣列 ($3::int[])，支援整數 0, 1, 2...
   */
  GET_POSITION_BY_ROUNDS: `
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN trade_type = 'BUY' THEN shares 
          WHEN trade_type = 'SELL' THEN -shares 
          ELSE 0 
        END
      ), 0) AS remaining_shares,
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

  /**
   * 6. 依回合集合查詢交易流水帳明細 (選取特定回合時載入表格清單)
   * 參數：
   *   $1: userId
   *   $2: stockId (標的代碼)
   *   $3: rounds 陣列 ($3::int[])
   * 
   * [2026-10-22] 移除所有 TO_CHAR，一律直接讀取原始欄位名稱 trade_date 與 mtdt
   */
  GET_TRADE_LOGS_BY_ROUNDS: `
    SELECT 
      trade_id,
      user_id,
      stock_id,
      round,
      trade_date,
      trade_type, 
      price,
      shares,
      fee,
      tax,
      net_total,
      note,
      crtdt,
      mtdt
    FROM public.trade_store
    WHERE user_id = $1 AND stock_id = $2 AND round = ANY($3::int[])
    ORDER BY trade_date DESC, crtdt DESC;
  `,

  /**
   * 7. 新增單筆交易流水明細 (維持原生 trade_store 11 欄結構，無 market_type 欄位)
   * 參數：
   *   $1: user_id, $2: stock_id, $3: round, $4: trade_date, $5: trade_type,
   *   $6: price, $7: shares, $8: fee, $9: tax, $10: net_total, $11: note
   * [2026-10-22] 異動說明：新增時 crtdt 與 mtdt 一併設定為 NOW()
   */
  INSERT_TRADE_LOG: `
    INSERT INTO public.trade_store (
      user_id, stock_id, round, trade_date, trade_type, 
      price, shares, fee, tax, net_total, note, crtdt, mtdt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING *;
  `,

  /**
   * 8. 更新單筆交易流水明細 (依據 trade_id 與 user_id 雙重條件驗證保護)
   * 參數：
   *   $1: stock_id, $2: round, $3: trade_date, $4: trade_type,
   *   $5: price, $6: shares, $7: fee, $8: tax, $9: net_total, $10: note,
   *   $11: trade_id, $12: user_id
   * [2026-10-22] 異動說明：更新時設定 mtdt 為 NOW()
   */
  UPDATE_TRADE_LOG: `
    UPDATE public.trade_store
    SET 
      stock_id = $1,
      round = $2,
      trade_date = $3,
      trade_type = $4,
      price = $5,
      shares = $6,
      fee = $7,
      tax = $8,
      net_total = $9,
      note = $10,
      mtdt = NOW()
    WHERE trade_id = $11 AND user_id = $12
    RETURNING *;
  `,

  /**
   * 9. 刪除單筆交易流水明細 (限制只能刪除所屬使用者的紀錄)
   * 參數：
   *   $1: trade_id, $2: user_id
   */
  DELETE_TRADE_LOG: `
    DELETE FROM public.trade_store
    WHERE trade_id = $1 AND user_id = $2
    RETURNING trade_id;
  `
};

module.exports = {
  DASHBOARD_QUERIES,
  TRADING_QUERIES
};