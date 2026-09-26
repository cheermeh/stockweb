// api/auth/login.js
const bcrypt = require('bcryptjs'); // 若專案安裝的是 bcrypt 則改為 require('bcrypt')
const { query } = require('../lib/db');
const { USER_QUERIES } = require('../lib/queries');
const { generateSessionCookie } = require('../lib/server-auth');

module.exports = async function handler(req, res) {
  // 1. 限制僅允許 POST 請求
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ 
      success: false, 
      message: 'Method Not Allowed' 
    });
  }

  try {
    // 2. 解構取得前端傳入的帳號、密碼與市場別 (market)
    const { username, password, market } = req.body || {};

    // 3. 基本必填防呆：帳號與密碼不得為空
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: '請輸入使用者名稱與密碼' 
      });
    }

    // 4. 【市場防呆】：只要 market 為空 (包含 null、undefined 或空字串) 即禁止登入
    if (!market || String(market).trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '登入失敗：未選擇市場別 (market 不得為空)' 
      });
    }

    // 將市場別去除首尾空白並轉為大寫，確保後續比對一致
    const cleanMarket = String(market).trim().toUpperCase();

    // 5. 依據帳號查詢資料庫中的使用者紀錄
    const result = await query(USER_QUERIES.FIND_USER_BY_USERNAME, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: '帳號或密碼錯誤' 
      });
    }

    const user = result.rows[0];

    // 6. 比對使用者輸入的明文密碼與資料庫中的雜湊密碼 (password_hash)
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: '帳號或密碼錯誤' 
      });
    }

    // 7. 驗證通過，將使用者 ID、帳號與選定的 market 打包簽發 Session Cookie
    const cookieHeader = generateSessionCookie({
      userId: user.user_id,
      username: user.username,
      market: cleanMarket // 確保選取的市場被正確寫入 Cookie
    });

    // 透過 HTTP Header 設定 Cookie 至客戶端
    res.setHeader('Set-Cookie', cookieHeader);

    // 8. 回傳登入成功回應與基本使用者資訊
    return res.status(200).json({
      success: true,
      message: '登入成功',
      data: {
        userId: user.user_id,
        username: user.username,
        market: cleanMarket
      }
    });

  } catch (error) {
    // 例外錯誤攔截與日誌記錄
    console.error('[Login API Error]:', error);
    return res.status(500).json({ 
      success: false, 
      message: '伺服器內部錯誤，無法完成登入' 
    });
  }
};