// api/dashboard/addmarket.js
const { query } = require('../lib/db');
const { getAuthenticatedUser } = require('../lib/server-auth');

/**
 * [2026-10-22] 異動說明
 * 目的：將新增市場 (addmarket) 功能自 queries.js 與 summary.js 抽離獨立成一隻 API，保持職責分明
 * 規則：新增時 crtdt 與 mtdt 皆寫入 NOW()
 */
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

  // 僅接受 POST 請求新增
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 變數用途說明：userId 儲存當前使用者的唯一識別碼
  const userId = sessionUser.userId;

  try {
    // 變數用途說明：marketId 取得市場代碼 (相容 market_id，強制大寫)
    const marketId = String((req.body || {}).market_id || '').trim().toUpperCase();
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

    // 寫入 stock_market 主檔，[2026-10-22] crtdt、mtdt 皆寫入 NOW()
    const insertSql = `
      INSERT INTO public.stock_market (
        user_id, market_id, market_name, crtdt, mtdt
      ) VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *;
    `;
    // 變數用途說明：insertResult 新增市場資料庫執行結果
    const insertResult = await query(insertSql, [userId, marketId, marketName]);

    return res.status(201).json({
      success: true,
      message: `市場 [${marketId}] 新增成功`,
      data: insertResult.rows[0]
    });

  } catch (err) {
    console.error('[AddMarket POST Error]:', err);
    return res.status(500).json({ 
      success: false, 
      message: '伺服器新增市場別失敗', 
      error: err.message 
    });
  }
};