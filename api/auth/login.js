// api/auth/login.js
const bcrypt = require('bcryptjs'); // 若安裝的是 bcrypt 則改為 require('bcrypt')
const { query } = require('../lib/db');
const { USER_QUERIES } = require('../lib/queries');
const { generateSessionCookie } = require('../lib/server-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { username, password, market = 'TW' } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '請輸入使用者名稱與密碼' });
    }

    // 1. 查詢使用者
    const result = await query(USER_QUERIES.FIND_USER_BY_USERNAME, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }

    const user = result.rows[0];

    // 2. 驗證雜湊密碼
    // bcrypt.compare 會自動比對明文密碼與資料庫中的 password_hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }

    // 3. 驗證成功，簽發 Session Cookie
    const cookieHeader = generateSessionCookie({
      userId: user.user_id,
      username: user.username,
      market: market
    });

    res.setHeader('Set-Cookie', cookieHeader);

    return res.status(200).json({
      success: true,
      message: '登入成功',
      data: {
        userId: user.user_id,
        username: user.username,
        market: market
      }
    });

  } catch (error) {
    console.error('[Login API Error]:', error);
    return res.status(500).json({ success: false, message: '伺服器內部錯誤，無法完成登入' });
  }
};