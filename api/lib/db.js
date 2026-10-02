// api/lib/db.js

// 1. 本機開發容錯：若環境中尚未注入 DATABASE_URL，從專案根目錄載入
if (!process.env.DATABASE_URL) {
  require('dotenv').config();
}

// 2. 引入 pg 模組 (Pool 與 types)
const { Pool, types } = require('pg');

// 3. PostgreSQL 類型解析器覆寫 (Type Parser)
// 1082 為 DATE 類型的 OID，回傳 YYYY-MM-DD 純字串避免時差問題
types.setTypeParser(1082, (val) => val);

// 連線池快取 (Singleton 模式)
let pool = null;

/**
 * 取得或初始化 PostgreSQL 連線池 (Singleton 模式)
 * @returns {Pool} PostgreSQL 連線池實例
 */
function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL 環境變數未配置！');
  }

  if (!pool) {
    // 移除連線字串中可能存在的衝突參數
    const cleanConnectionString = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]+/g, '');
    const caCert = process.env.DATABASE_CA_CERT;

    pool = new Pool({
      connectionString: cleanConnectionString,
      ssl: caCert
        ? {
            rejectUnauthorized: true,
            ca: caCert
          }
        : {
            rejectUnauthorized: false
          },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
      console.error('[DB Pool Unexpected Error]:', err);
    });
  }

  return pool;
}

/**
 * 封裝參數化查詢函式，防止 SQL Injection
 * @param {string} text - SQL 語句
 * @param {Array} params - 查詢參數
 * @returns {Promise<object>} pg 查詢結果
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