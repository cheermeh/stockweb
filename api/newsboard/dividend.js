// api/newsboard/dividend.js

// 引用既有資料庫查詢模組
const { query } = require('../lib/db');
// 引用既有 SQL 集中定義模組
const { NEWSBOARD_QUERIES } = require('../lib/queries');
// 引用既有 Clerk 身分鑑權伺服端模組
const { getAuthenticatedUser } = require('../lib/server-auth');

/**
 * 取得除權息最新消息 API
 * 請求路徑: GET /api/newsboard/dividend?market=TW 或 GET /api/newsboard/dividend?market=US
 */
module.exports = async function handler(req, res) {
  // 僅允許 GET 請求，其餘 HTTP 方法回傳 405
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 1. 身分鑑權：透過 Clerk Bearer Token 驗證當前登入者
  // 變數用途說明：sessionUser 儲存由伺服端驗證通過之使用者身分資訊物件
  const sessionUser = await getAuthenticatedUser(req);
  if (!sessionUser || !sessionUser.userId) {
    return res.status(401).json({
      success: false,
      message: '未授權存取或登入逾時，請重新登入！'
    });
  }

  // 變數用途說明：userId 儲存當前使用者的唯一識別碼，供資料庫隔離查詢
  const userId = sessionUser.userId;

  // 2. 取得並驗證市場別參數
  // 變數用途說明：targetMarket 儲存前端傳入之市場代碼 (例如 'TW', 'US')
  const targetMarket = String(req.query.market || '').trim().toUpperCase();
  if (!targetMarket) {
    return res.status(400).json({ success: false, message: '缺少市場別 (market)！' });
  }
  if (targetMarket !== 'TW' && targetMarket !== 'US') {
    return res.status(400).json({ success: false, message: '不支援的市場別，僅允許 TW 或 US' });
  }

  try {
    // 變數用途說明：todayDateStr 儲存今日之西元標準日期字串 (YYYY-MM-DD)，供比對除權息日期
    const todayDateStr = getTaipeiDateString();

    // 3. 查詢 STOCK_COMP 資料表：撈取該使用者在該市場開啟追蹤 (news_flag = 'Y') 的標的
    // 變數用途說明：selectParams 參數化查詢陣列，防止 SQL Injection
    const selectParams = [userId, targetMarket];
    // 變數用途說明：dbResult 資料庫查詢回傳之結果物件
    const dbResult = await query(NEWSBOARD_QUERIES.GET_TRACKED_STOCKS, selectParams);

    // 若使用者在此市場無設定任何開啟追蹤的標的，直接回傳空陣列，不發送外部網路請求
    if (dbResult.rows.length === 0) {
      return res.status(200).json({ success: true, latestCrtdt: null, data: [] });
    }

    // [2026-11-05] feat: market+date 命中快取時直接讀取 stock_news，避免重複呼叫外部 API
    // 變數用途說明：cacheProbeResult 快取命中探測查詢結果
    const cacheProbeResult = await query(NEWSBOARD_QUERIES.CHECK_CACHE_EXISTS, [targetMarket, todayDateStr]);

    // [2026-11-05] feat: 快取未命中時才呼叫外部 API，並寫入 stock_news 供後續請求重用
    if (cacheProbeResult.rows.length === 0) {
      // 變數用途說明：marketNewsRows 儲存單一市場全量資料 (非使用者隔離)，供快取寫入
      const marketNewsRows = [];

      // =========================================================================
      // 分支 A: 台股市場 (TW) - 由MoneyDJ 除權除息表端點
      // =========================================================================
      if (targetMarket === 'TW') {
        // 變數用途說明：moneydjApiUrl 儲存 MoneyDJ 除權除息表資料來源網址
        const moneydjApiUrl = 'https://kgiweb.moneydj.com/b2brwdCommon/jsondata/63/56/6c/twstockdata.xdjjson?x=afterhours-bulletin0001';

        // 變數用途說明：moneydjResponse 對 MoneyDJ 發送 HTTP GET 請求之回應物件
        const moneydjResponse = await fetch(moneydjApiUrl, {
          method: 'GET',
          headers: {
            'Referer': 'https://kgiweb.moneydj.com/b2brwd/page/afterhours/bulletin/0001',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!moneydjResponse.ok) {
          return res.status(502).json({ success: false, message: '除權息資料來源讀取異常' });
        }

        // 變數用途說明：rawResult 接收 MoneyDJ 回傳之完整 JSON 資料物件
        const rawResult = await moneydjResponse.json();
        // 變數用途說明：dividendList 取得回傳物件內除權除息明細清單陣列
        const dividendList = (rawResult && rawResult.ResultSet && rawResult.ResultSet.Result) || [];

        for (const item of dividendList) {
          // 變數用途說明：stockCode 標的股票代碼 (對應 V2 欄位，例如 "00400A")
          const stockCode = (item.V2 || '').trim();
          // 變數用途說明：rawDateStr 除權息基準日原始字串 (對應 V9 欄位，格式為 "YYYY/MM/DD")
          const rawDateStr = (item.V9 || '').trim();
          // 變數用途說明：exDate 將斜線轉換為標準西元 YYYY-MM-DD 字串
          const exDate = rawDateStr ? rawDateStr.replace(/\//g, '-') : null;

          // 嚴格比對：除權息日期必須存在且大於或等於今日
          if (!stockCode || !exDate || exDate < todayDateStr) {
            continue;
          }

          // 變數用途說明：cashVal 現金股利小計金額字串 (對應 V12 欄位)，若無數值則顯示 '待公告'
          const cashVal = item.V12 && String(item.V12).trim() !== ''
            ? String(item.V12).trim()
            : '待公告';
          // 變數用途說明：stockVal 股票股利小計字串 (對應 V13 欄位)，若無配股則顯示 '-'
          const stockVal = item.V13 && String(item.V13).trim() !== '' && String(item.V13).trim() !== '0'
            ? String(item.V13).trim()
            : '-';
          // 變數用途說明：payDateStr 現金股利發放日 (對應 V10 欄位，格式為 "YYYY/MM/DD")，無日期則為 null
          const payDateStr = item.V10 && String(item.V10).trim() !== ''
            ? String(item.V10).trim().replace(/\//g, '-')
            : null;
          // 變數用途說明：officialName 標的名稱 (對應 V3 欄位，例如 "主動國泰動能高息")
          const officialName = (item.V3 || '').trim();

          marketNewsRows.push({
            stock_id: stockCode,
            stock_name: officialName || null,
            ex_date: exDate,
            pay_date: payDateStr,
            cash_dividend: cashVal,
            stock_dividend: stockVal
          });
        }
      }

      // =========================================================================
      // [2026-11-08] feat: 分支 B: 美股市場 (US) - 改由 Alpha Vantage 取得美股除息資料
      // =========================================================================
      else if (targetMarket === 'US') {
        // 變數用途說明：alphaApiKey 從環境變數取得 Alpha Vantage 金鑰
        const alphaApiKey = process.env.ALPHA_VANTAGE_API_KEY;
        if (!alphaApiKey) {
          return res.status(500).json({ success: false, message: '伺服器未設定 ALPHA_VANTAGE_API_KEY' });
        }

        // 依據使用者追蹤的標的，逐一呼叫 Alpha Vantage API
        for (const row of dbResult.rows) {
          // 變數用途說明：symbol 美股標的代號
          const symbol = String(row.stock_id || '').trim();
          if (!symbol) continue;

          // 變數用途說明：alphaUrl Alpha Vantage 取得歷史配息資料端點
          const alphaUrl = `https://www.alphavantage.co/query?function=DIVIDENDS&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alphaApiKey)}`;
          const alphaResponse = await fetch(alphaUrl);

          if (!alphaResponse.ok) {
            console.error(`[Alpha Vantage Error]: 請求失敗，狀態碼: ${alphaResponse.status}, 標的: ${symbol}`);
            continue;
          }

          const alphaResult = await alphaResponse.json();

          // [2026-11-08] feat: 攔截 Alpha Vantage 回傳 200 但實為次數超限或金鑰異常的狀況(待刪)
          if (alphaResult['Information'] || alphaResult['Error Message']) {
            console.error(`[Alpha Vantage 異常]: 標的 ${symbol} 取值失敗，API 回傳:`, alphaResult);
            continue;
          }
          
          // 變數用途說明：dividendList 儲存該標的從以前到現在的配息陣列 (欄位名為 data)
          const dividendList = Array.isArray(alphaResult.data) ? alphaResult.data : [];

          for (const event of dividendList) {
            // 變數用途說明：exDateStr 取得除息日 (欄位名為 ex_dividend_date)
            const exDateStr = event.ex_dividend_date ? String(event.ex_dividend_date).trim() : '';

            // 嚴格比對：除權息日期必須存在且大於或等於今日
            if (!exDateStr || exDateStr < todayDateStr) {
              continue;
            }

            // 變數用途說明：cashAmount 現金股利金額
            const cashAmount = event.amount !== undefined && event.amount !== null
              ? String(event.amount)
              : '待公告';

            // 變數用途說明：payDateStr 股利發放日 (欄位名為 payment_date)
            const payDateStr = event.payment_date ? String(event.payment_date).trim() : '';

            marketNewsRows.push({
              stock_id: symbol,
              stock_name: null,
              ex_date: exDateStr,
              pay_date: payDateStr || null,
              cash_dividend: cashAmount,
              stock_dividend: '-'
            });
          }

          // 延遲 1 秒，避免觸發 Alpha Vantage 免費版 API 速率限制
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // [2026-11-05] feat: 將當日市場全量資料批次寫入 stock_news，供後續請求直接讀取
      if (marketNewsRows.length > 0) {
        await query(NEWSBOARD_QUERIES.INSERT_CACHE_ROWS, [targetMarket, todayDateStr, JSON.stringify(marketNewsRows)]);
      }

      // [2026-11-05] feat: 寫入當日快取標記列 (ex_date = NULL)，避免同市場同日重複呼叫外部 API
      await query(NEWSBOARD_QUERIES.INSERT_CACHE_MARKER, [targetMarket, todayDateStr]);
    }

// 變數用途說明：cachedNewsResult 取回 stock_news 當日快取清單的查詢結果
    const cachedNewsResult = await query(NEWSBOARD_QUERIES.GET_CACHED_NEWS_ROWS, [targetMarket, todayDateStr, userId]);

    // [2026-11-08] feat: 獨立查詢當日快取標記列，以取得最準確的資料庫更新時間
    // 變數用途說明：markerResult 儲存標記列的查詢結果
    const markerResult = await query(NEWSBOARD_QUERIES.GET_CACHE_MARKER_TIME, [targetMarket, todayDateStr]);

    // [2026-11-08] feat: latestCrtdt 改由獨立查詢 markerResult 取得
    const latestCrtdt = markerResult.rows[0]?.crtdt || null;

    // 變數用途說明：filteredList 儲存 SQL 已過濾完成之最終陣列，直接轉為前端回傳格式
    const filteredList = cachedNewsResult.rows.map((row) => ({
      stockId: row.stock_id,
      stockName: row.stock_name,
      exDate: row.ex_date,
      payDate: row.pay_date,
      cashDividend: row.cash_dividend,
      stockDividend: row.stock_dividend
    }));

    return res.status(200).json({
      success: true,
      latestCrtdt: latestCrtdt,
      data: filteredList
    });

  } catch (error) {
    console.error('[Newsboard Dividend API Error]:', error);
    return res.status(500).json({ success: false, message: '伺服器內部錯誤' });
  }
};

/**
 * [2026-11-05] feat: 取得台北時區今日日期字串 (YYYY-MM-DD)
 * @returns {string} - 台北時區今日日期字串
 */
function getTaipeiDateString() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}
