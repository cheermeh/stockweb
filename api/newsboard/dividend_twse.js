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
      // 分支 A: 台股市場 (TW) - 串接證交所 OpenAPI
      // =========================================================================
      if (targetMarket === 'TW') {
        // 4. 呼叫證交所 OpenAPI：上市股票除權除息預告表全集 (涵蓋個股與上市 ETF)
        // 變數用途說明：twseApiUrl 證交所公開 OpenAPI 端點網址
        const twseApiUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
        // 變數用途說明：twseResponse 對證交所發送 fetch 請求之回應物件
        const twseResponse = await fetch(twseApiUrl);

        if (!twseResponse.ok) {
          return res.status(502).json({ success: false, message: '證交所 API 讀取異常' });
        }

        // 變數用途說明：rawTwseList 接收證交所端點回傳之全部原始除權息資料陣列
        const rawTwseList = await twseResponse.json();

        for (const item of rawTwseList) {
          // 變數用途說明：stockCode 證交所回傳之標的代碼 (欄位名稱為 Code)
          const stockCode = (item.Code || '').trim();
          // 變數用途說明：exDate 將證交所日期轉換為標準西元 YYYY-MM-DD 的字串
          const exDate = parseTwseDateToIso(item.Date || '');

          // 嚴格比對：除權息日期必須存在且大於或等於今日
          if (!stockCode || !exDate || exDate < todayDateStr) {
            continue;
          }

          // 變數用途說明：cashVal 現金股利字串，若尚未公告則顯示 '待公告'
          const cashVal = item.CashDividend && String(item.CashDividend).trim() !== ''
            ? String(item.CashDividend).trim()
            : '待公告';
          // 變數用途說明：stockVal 股票股利字串，若無數值則顯示 '-'
          const stockVal = item.StockDividendRatio && String(item.StockDividendRatio).trim() !== ''
            ? String(item.StockDividendRatio).trim()
            : '-';
          // 變數用途說明：officialName 證交所官方標的名稱 (若無資料則寫入 null)
          const officialName = item.Name ? String(item.Name).trim() : '';

          marketNewsRows.push({
            stock_id: stockCode,
            stock_name: officialName || null,
            ex_date: exDate,
            pay_date: null,
            cash_dividend: cashVal,
            stock_dividend: stockVal
          });
        }
      }

      // =========================================================================
      // [2026-11-03] feat: 分支 B: 美股市場 (US) - 改用免費版 Dividend Calendar 端點避免 403
      // =========================================================================
      else if (targetMarket === 'US') {
        // 變數用途說明：finnhubApiKey 從環境變數取得 Finnhub 金鑰
        const finnhubApiKey = process.env.FINNHUB_API_KEY;
        if (!finnhubApiKey) {
          return res.status(500).json({ success: false, message: '伺服器未設定 FINNHUB_API_KEY' });
        }

        // 變數用途說明：
        // futureDate: 以今日為基準往後推算 60 天之 Date 物件，覆蓋未來除息日程
        const futureDate = new Date(`${todayDateStr}T00:00:00Z`);
        futureDate.setUTCDate(futureDate.getUTCDate() + 60);
        // 變數用途說明：futureDateStr 60 天後之西元日期字串 (YYYY-MM-DD)
        const futureDateStr = futureDate.toISOString().split('T')[0];

        // 變數用途說明：calendarUrl Finnhub 免費版除息行事曆端點 (支援 from 與 to 區間)
        const calendarUrl = `https://finnhub.io/api/v1/calendar/dividend?from=${encodeURIComponent(todayDateStr)}&to=${encodeURIComponent(futureDateStr)}&token=${encodeURIComponent(finnhubApiKey)}`;
        // 變數用途說明：finnhubResponse 發送至 Finnhub 之 fetch 回應物件
        const finnhubResponse = await fetch(calendarUrl);

        if (!finnhubResponse.ok) {
          console.error(`[Finnhub Error]: 行事曆請求失敗，狀態碼: ${finnhubResponse.status}`);
          return res.status(502).json({ success: false, message: `Finnhub API 回傳錯誤碼: ${finnhubResponse.status}` });
        }

        // 變數用途說明：calendarResult Finnhub 回傳之 JSON 物件 (結構包含 dividendCalendar 陣列)
        const calendarResult = await finnhubResponse.json();
        // 變數用途說明：calendarEvents 除息事件清單陣列
        const calendarEvents = Array.isArray(calendarResult.dividendCalendar) ? calendarResult.dividendCalendar : [];

        for (const event of calendarEvents) {
          // 變數用途說明：symbol 美股標的代號 (例如 'QQQI', 'T')
          const symbol = String(event.symbol || '').trim();
          // 變數用途說明：exDateStr Finnhub 日曆回傳之除息日 (YYYY-MM-DD，欄位名為 date)
          const exDateStr = event.date ? String(event.date).trim() : '';
          if (!symbol || !exDateStr || exDateStr < todayDateStr) {
            continue;
          }

          // 變數用途說明：cashAmount 現金股利金額字串
          const cashAmount = event.amount !== undefined && event.amount !== null
            ? String(event.amount)
            : '待公告';
          // [2026-11-03] feat: 取得 Finnhub 日曆中自帶之股利發放日 (payDate)
          // 變數用途說明：payDateStr 股利發放日字串，若無則回傳空值 (寫入資料庫可為 null)
          const payDateStr = event.payDate ? String(event.payDate).trim() : '';

          marketNewsRows.push({
            stock_id: symbol,
            stock_name: null,
            ex_date: exDateStr,
            pay_date: payDateStr || null,
            cash_dividend: cashAmount,
            stock_dividend: '-'
          });
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

    // [2026-11-06] feat: latestCrtdt 取得當日快取資料庫寫入之建立時間 (ISO 格式，由前端轉換為使用者本地時區)
    const latestCrtdt = cachedNewsResult.rows[0]?.crtdt || null;

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
 * 輔助函式：將證交所民國年日期格式轉換為西元 YYYY-MM-DD
 * 支援證交所標準 7 碼純數字格式 (如 "1151117") 或含分隔符字串 (如 "115/11/17")
 * @param {string} rawDate - 證交所原始日期字串
 * @returns {string|null} - 回傳格式化後的西元日期字串或 null
 */
function parseTwseDateToIso(rawDate) {
  if (!rawDate) return null;

  // 變數用途說明：cleanStr 移除年月日與所有常見分隔符號後的純數字字串
  const cleanStr = String(rawDate).trim().replace(/[年月日\/\-\.]/g, '');

  // 1. 處理 7 碼純數字 (例如: "1151117" 代表民國 115 年 11 月 17 日)
  if (cleanStr.length === 7) {
    // 變數用途說明：twYear 民國年前 3 碼整數數值
    const twYear = parseInt(cleanStr.substring(0, 3), 10);
    // 變數用途說明：month 月份 2 碼字串
    const month = cleanStr.substring(3, 5);
    // 變數用途說明：day 日期 2 碼字串
    const day = cleanStr.substring(5, 7);

    if (isNaN(twYear)) return null;

    // 變數用途說明：adYear 民國年轉西元年 (+1911) 的 4 碼字串
    const adYear = String(twYear + 1911);
    return `${adYear}-${month}-${day}`;
  }

  // 2. 備用容錯：若字串原先含有斜線等分隔符號且分割為 3 段的情況
  // 變數用途說明：dateParts 依照斜線切分後的陣列
  const dateParts = String(rawDate).replace(/[年月日]/g, '/').split('/').filter(Boolean);
  if (dateParts.length === 3) {
    // 變數用途說明：twYear 民國年整數數值
    const twYear = parseInt(dateParts[0], 10);
    if (isNaN(twYear)) return null;

    // 變數用途說明：adYear 民國年轉西元年之 4 碼字串
    const adYear = String(twYear + 1911);
    // 變數用途說明：month 補零後的月份字串
    const month = dateParts[1].padStart(2, '0');
    // 變數用途說明：day 補零後的日期字串
    const day = dateParts[2].padStart(2, '0');
    return `${adYear}-${month}-${day}`;
  }

  return null;
}

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