// api/lib/server-auth.js

/**
 * 從請求中解析並驗證使用者身分 Cookie
 * @param {import('http').IncomingMessage} req 
 * @returns {{ userId: string, username: string, market: string } | null}
 */
function getAuthenticatedUser(req) {
  try {
    // 1. 取得 Header 中的 Cookie 字串
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      return null;
    }

    // 2. 尋找 stockweb_session
    const cookies = cookieHeader.split(';').reduce((acc, item) => {
      const [key, val] = item.trim().split('=');
      if (key && val) {
        acc[key] = decodeURIComponent(val);
      }
      return acc;
    }, {});

    const sessionCookie = cookies['stockweb_session'];
    if (!sessionCookie) {
      return null;
    }

    // 3. 解碼 Base64 (格式: userId:username:market:timestamp)
    const decoded = Buffer.from(sessionCookie, 'base64').toString('utf-8');
    const parts = decoded.split(':');

    // 檢查欄位完整性
    if (parts.length < 4) {
      return null;
    }

    const [userId, username, market, timestamp] = parts;

    // 基本防呆：確認 userId 存在
    if (!userId) {
      return null;
    }

    return {
      userId,
      username,
      market: market,
      timestamp: Number(timestamp)
    };

  } catch (error) {
    console.error('[Server Auth Error]:', error);
    return null;
  }
}

module.exports = {
  getAuthenticatedUser
};