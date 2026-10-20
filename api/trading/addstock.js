// api/trading/addstock.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');

/**
 * 標的註冊 API (單純新增模式)
 * [2026-10-08] feat: market_type 改由前端 body 傳入 (不限定市場清單，缺少則回 400)
 * [2026-10-20] refactor: 因應 stock_comp 欄位重構，將 market_type 改為 market_id
 */
module.exports = async function handler(req, res) {
  // 1. 驗證身分授權並取得市場別
  // [2026-10-08] feat: getAuthenticatedUser 改為非同步 (驗證 Clerk Token)，需 await
  // 變數用途說明：sessionUser 儲存由伺服端驗證出的當前使用者認證資訊物件
  const sessionUser = await getAuthenticatedUser(req);
  if (!sessionUser) {
    return res.status(401).json({ success: false, message: '未登入或登入已過期' });
  }

  // 僅接受 POST 請求新增
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 變數用途說明：userId 儲存當前使用者唯一識別代碼
  const userId = sessionUser.userId;

  // [2026-10-20] 異動說明：優先讀取 market_id，向下相容前端傳入之 market_type(作廢)
  // (作廢) [2026-10-08] feat: Token 不含市場別，改讀前端傳入的 market_type，缺少時一律視為錯誤
  // 變數用途說明：marketId 儲存前端傳入之市場代碼 (例如 'TW', 'US')
  const marketId = String((req.body || {}).market_id || '').trim().toUpperCase();
  if (!marketId) {
    return res.status(400).json({ success: false, message: '缺少市場別 (market_id)！' });
  }

  try {
    // 變數用途說明：解構前端傳入之標的代碼與標的名稱
    const { stock_id, stock_name } = req.body || {};

    // 2. 欄位格式檢查
    // [2026-10-12] feat: 標的名稱改為選填
    if (!stock_id) {
      return res.status(400).json({ 
        success: false, 
        message: '標的代碼 (stock_id)為必填欄位！' 
      });
    }

    // 變數用途說明：cleanStockId 清理後之大寫標的代碼
    const cleanStockId = String(stock_id).trim().toUpperCase();
    // 變數用途說明：cleanStockName 清理後之標的顯示名稱
    const cleanStockName = String(stock_name || '').trim();

    // 3. 檢查標的是否已存在 (依複合主鍵 user_id, market_id, stock_id 為判斷基準)
    // [2026-10-20] 異動說明：加入 market_id 條件，精確判斷同一市場內是否重複
    // (作廢) 舊 SQL：WHERE user_id = $1 AND stock_id = $2
    const checkSql = `
      SELECT stock_id 
      FROM public.stock_comp 
      WHERE user_id = $1 AND market_id = $2 AND stock_id = $3
      LIMIT 1;
    `;
    // 變數用途說明：checkResult 重複性檢查查詢結果
    const checkResult = await query(checkSql, [userId, marketId, cleanStockId]);

    // 若已存在，立即阻擋並警告，不做任何事
    if (checkResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: `標的代碼 [${cleanStockId}] 已存在於 [${marketId}] 清單中，未執行任何變更！` 
      });
    }

    // 4. 執行新增寫入 (欄位順序對齊實體結構：user_id, market_id, stock_id, stock_name)
    // [2026-10-20] 異動說明：欄位由 market_type 改為 market_id
    // (作廢) 舊 SQL：INSERT INTO public.stock_comp (user_id, stock_id, stock_name, market_type)
    const insertSql = `
      INSERT INTO public.stock_comp (user_id, market_id, stock_id, stock_name)
      VALUES ($1, $2, $3, $4)
      RETURNING stock_id, stock_name, market_id;
    `;
    // 變數用途說明：insertResult 新增資料庫執行結果
    const insertResult = await query(insertSql, [userId, marketId, cleanStockId, cleanStockName]);

    return res.status(201).json({
      success: true,
      message: `標的 [${cleanStockId} - ${cleanStockName}] 新增成功 (${marketId})`,
      data: insertResult.rows[0]
    });

  } catch (err) {
    console.error('[AddStock POST Error]:', err);
    return res.status(500).json({ 
      success: false, 
      message: '伺服器新增標的失敗', 
      error: err.message 
    });
  }
};