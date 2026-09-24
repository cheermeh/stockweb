// api/lib/db.js

// 1. 本機開發容錯：若系統環境中尚未注入 DATABASE_URL，則嘗試從根目錄 .env 載入
if (!process.env.DATABASE_URL) {
  const path = require('path');
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
}

// 2. 引入 pg 模組 (Pool 與 types)
const { Pool, types } = require('pg');

// 3. PostgreSQL 類型解析器覆寫 (Type Parser)
// 1082 是 PostgreSQL 內部 DATE 類型的 OID
// 強制告訴 pg 驅動程式：讀取 DATE 欄位時，直接回傳原始純字串 (YYYY-MM-DD)，不要轉成 JS Date 物件，杜絕時差 8 小時造成的少一天問題
types.setTypeParser(1082, (val) => val);

// 連線池實例快取 (Singleton 模式)
let pool = null;

/**
 * 取得或初始化 PostgreSQL 連線池 (Singleton 模式)
 * 具備連線字串清洗、CA 憑證安全性檢驗及連線異常事件監控
 * @returns {Pool} PostgreSQL 連線池實例
 */
function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL 環境變數未配置！');
  }

  if (!pool) {
    // 移除連線字串中可能存在的衝突參數 (如 sslmode)
    const cleanConnectionString = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]+/g, '');

    // 取得由環境變數注入的 CA 憑證內容
    const caCert = process.env.DATABASE_CA_CERT;

    pool = new Pool({
      connectionString: cleanConnectionString,
      ssl: caCert
        ? {
            // 具備官方 CA 憑證時啟用嚴格鏈驗證，杜絕中間人攻擊 (MITM)
            rejectUnauthorized: true,
            ca: caCert
          }
        : {
            // 容錯降級（若未配置 CA 變數，依然維持傳輸加密）
            rejectUnauthorized: false
          },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    // 監聽連線池內部的非預期連線錯誤
    pool.on('error', (err) => {
      console.error('[DB Pool Unexpected Error]:', err);
    });
  }

  return pool;
}

/**
 * 封裝參數化查詢函式，預設阻絕 SQL Injection 風險
 * @param {string} text - SQL 語句 ($1, $2 佔位符)
 * @param {Array} params - 查詢參數陣列
 * @returns {Promise<object>} pg 查詢結果物件 (包含 rows, rowCount 等)
 */
async function query(text, params) {
  const currentPool = getPool();
  const start = Date.now();
  try {
    const res = await currentPool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DB Query OK] 花費: ${duration}ms | 影響行數: ${res.rowCount}`);
    }
    return res;
  } catch (error) {
    console.error('[DB Query Error]:', error.message);
    throw error;
  }
}

module.exports = {
  getPool,
  query
};