// api/auth/login.js
const { verifyToken } = require('@clerk/backend');

/**
 * 處理 Clerk 身分憑證交換並簽發系統 Session Cookie
 * @param {import('http').IncomingMessage} req 
 * @param {import('http').ServerResponse} res 
 */
module.exports = async function handler(req, res) {
  // 僅允許 POST 請求
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: '方法不被允許 (Method Not Allowed)' });
  }

  try {
    const { clerkToken, userId, username, market } = req.body;

    // 1. 欄位與環境變數防呆
    if (!clerkToken || !userId) {
      return res.status(400).json({ success: false, message: '缺少認證憑證 (Token 或 User ID)' });
    }
    if (!process.env.CLERK_SECRET_KEY) {
      throw new Error('伺服器未配置 CLERK_SECRET_KEY 環境變數');
    }

    // 2. 驗證 Clerk 簽章真偽與效期
    const verifiedToken = await verifyToken(clerkToken, {
      secretKey: process.env.CLERK_SECRET_KEY
    });

    // 確保 Token 屬於當前請求的 User，防範越權偽造
    if (!verifiedToken || verifiedToken.sub !== userId) {
      return res.status(401).json({ success: false, message: '身分憑證無效或已過期' });
    }

    // 3. 確定市場別與使用者名稱 (預設 TW 與 Admin)
    const targetMarket = (market === 'US') ? 'US' : 'TW';
    const finalUsername = username || 'Admin';

    // 4. 沿用系統既有的 Session 格式並進行 Base64 編碼
    const sessionPayload = `${userId}:${finalUsername}:${targetMarket}:${Date.now()}`;
    const sessionCookieValue = Buffer.from(sessionPayload).toString('base64');

    // 5. 【資安升級】加入 Secure 屬性 (確保 Vercel HTTPS 環境下不被竊聽)
    res.setHeader(
      'Set-Cookie',
      `stockweb_session=${sessionCookieValue}; Path=/; HttpOnly; SameSite=Lax; Secure`
    );

    // 6. 回傳成功狀態與資料供前端儲存
    return res.status(200).json({
      success: true,
      message: '登入成功',
      data: {
        userId,
        username: finalUsername,
        market: targetMarket
      }
    });

  } catch (error) {
    // 捕捉所有驗證異常 (包含 Token 過期或偽造)
    console.error('[Clerk Server Verify Error]:', error.message || error);
    return res.status(401).json({
      success: false,
      message: '認證驗證失敗，請重新登入！'
    });
  }
};