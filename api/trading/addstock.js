// api/trading/addstock.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');

/**
 * 標的註冊 API (單純新增模式)
 * 2026.10.08 feat: market_type 改由前端 body 傳入 (不限定市場清單，缺少則回 400)
 */
module.exports = async function handler(req, res) {
  // 1. 驗證身分授權並取得市場別
  // 2026.10.08 feat: getAuthenticatedUser 改為非同步 (驗證 Clerk Token)，需 await
  const sessionUser = await getAuthenticatedUser(req);
  if (!sessionUser) {
    return res.status(401).json({ success: false, message: '未登入或登入已過期' });
  }

  // 僅接受 POST 請求新增
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const userId = sessionUser.userId || sessionUser.id;
  // 2026.10.08 feat: Token 不含市場別，改讀前端傳入的 market_type，缺少時一律視為錯誤
  const marketType = String((req.body || {}).market_type || '').trim().toUpperCase();
  if (!marketType) {
    return res.status(400).json({ success: false, message: '缺少市場別 (market_type)！' });
  }

  try {
    const { stock_id, stock_name } = req.body || {};

    // 2. 欄位格式檢查
    if (!stock_id || !stock_name) {
      return res.status(400).json({ 
        success: false, 
        message: '標的代碼 (stock_id) 與標的名稱 (stock_name) 為必填欄位！' 
      });
    }

    const cleanStockId = String(stock_id).trim().toUpperCase();
    const cleanStockName = String(stock_name).trim();

    // 3. 檢查標的是否已存在 (以 user_id 與 stock_id 為判斷基準)
    const checkSql = `
      SELECT stock_id 
      FROM public.stock_comp 
      WHERE user_id = $1 AND stock_id = $2
      LIMIT 1;
    `;
    const checkResult = await query(checkSql, [userId, cleanStockId]);

    // 若已存在，立即阻擋並警告，不做任何事
    if (checkResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: `標的代碼 [${cleanStockId}] 已存在於清單中，未執行任何變更！` 
      });
    }

    // 4. 執行新增寫入 (自動帶入抓到的 marketType)
    const insertSql = `
      INSERT INTO public.stock_comp (user_id, stock_id, stock_name, market_type)
      VALUES ($1, $2, $3, $4)
      RETURNING stock_id, stock_name, market_type;
    `;
    const insertResult = await query(insertSql, [userId, cleanStockId, cleanStockName, marketType]);

    return res.status(201).json({
      success: true,
      message: `標的 [${cleanStockId} - ${cleanStockName}] 新增成功 (${marketType})`,
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