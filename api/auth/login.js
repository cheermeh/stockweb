// api/auth/login.js
const bcrypt = require('bcryptjs');
const { query } = require('../lib/db');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const { username, password, market } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: '請輸入帳號與密碼' 
            });
        }

        // 參數化查詢防止 SQL Injection
        const userResult = await query(
            'SELECT user_id, username, password_hash, default_market FROM users WHERE username = $1 LIMIT 1',
            [username.trim()]
        );

        // 避免帳號探測，統一回傳泛化錯誤訊息
        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: '帳號或密碼錯誤' 
            });
        }

        const user = userResult.rows[0];


        // 比對 bcrypt 密碼雜湊
        const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: '帳號或密碼錯誤' 
            });
        }

        const selectedMarket = (market === 'TW' || market === 'US') ? market : user.default_market;

        return res.status(200).json({
            success: true,
            message: '登入成功',
            data: {
                userId: user.user_id,
                username: user.username,
                market: selectedMarket
            }
        });

    } catch (error) {
        console.error('[Auth Error]:', error);
        return res.status(500).json({ 
            success: false, 
            message: '系統服務異常，請稍後再試' 
        });
    }
};