// api/lib/server-auth.js

// 1. 解析 Cookie
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

// 2. 從 Request 取得已驗證的使用者
function getAuthenticatedUser(req) {
  try {
    const cookieHeader = req.headers?.cookie;
    const cookies = parseCookies(cookieHeader);
    const sessionToken = cookies['stockweb_session'];
    if (!sessionToken) return null;

    const payloadJson = Buffer.from(sessionToken, 'base64').toString('utf8');
    const userPayload = JSON.parse(payloadJson);
    if (!userPayload || !userPayload.userId) return null;
      return userPayload;
  } catch (err) {
    return null;
  }
}

// 3. 登入成功時產生 HttpOnly Cookie 字串
function generateSessionCookie(userPayload) {
  const sessionToken = Buffer.from(JSON.stringify(userPayload)).toString('base64');
  // 設定 7 天有效期的 HttpOnly 安全 Cookie
  return `stockweb_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
}

module.exports = {
  getAuthenticatedUser,
  generateSessionCookie
};