// api/lib/server-auth.js
// 2026.10.08 feat: 改為驗證 Clerk JWT (Authorization: Bearer)，不再讀取自製 Session Cookie
const { verifyToken } = require('@clerk/backend');

/**
 * 從 Authorization 標頭取出 Clerk JWT 並驗證簽章與效期
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ userId: string } | null>}
 */
async function getAuthenticatedUser(req) {
  try {
    // 變數用途說明：authHeader 前端送出的 Authorization 標頭字串
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }

    // 變數用途說明：token 去除 "Bearer " 前綴後的 Clerk JWT
    const token = authHeader.slice(7).trim();
    if (!token) {
      return null;
    }

    // 變數用途說明：payload 驗證通過後的 JWT 內容，sub 即 Clerk 使用者 ID
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    if (!payload || !payload.sub) {
      return null;
    }

    return { userId: payload.sub };
  } catch (error) {
    console.error('[Server Auth Error]:', error.message || error);
    return null;
  }
}

module.exports = {
  getAuthenticatedUser
};