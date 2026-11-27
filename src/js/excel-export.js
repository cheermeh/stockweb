// [2026-11-27] feat: 提供兩個資料頁共用的 Excel 匯出功能
(function () {
  // 變數用途說明：[2026-11-27] sanitizeCell 防止文字欄位被 Excel 當作公式執行
  const sanitizeCell = (value) => {
    if (typeof value !== 'string') return value;
    // 單一 "-" 是畫面空值標記，不會形成公式，維持原始顯示
    if (value.trim() === '-') return value;
    return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  };

  // 變數用途說明：[2026-11-27] getColumnWidths 依表頭與內容決定合理欄寬
  const getColumnWidths = (headers, rows) => {
    return headers.map((header, index) => {
      // 變數用途說明：[2026-11-27] values 儲存單一欄位的文字內容供計算寬度
      const values = rows.map(row => String(row[index] ?? ''));
      values.unshift(String(header));
      // 變數用途說明：[2026-11-27] longestLength 儲存該欄位最長內容長度
      const longestLength = Math.max(...values.map(value => value.length));
      return { wch: Math.min(Math.max(longestLength + 2, 10), 40) };
    });
  };

  // 變數用途說明：[2026-11-27] exportWorkbook 將完整資料表產生為 Excel 並下載
  const exportWorkbook = ({ filename, dateRange, headers, rows }) => {
    if (!window.XLSX) {
      throw new Error('Excel 模組載入失敗，請重新整理頁面後再試');
    }

    // 變數用途說明：[2026-11-27] safeRows 將文字欄位套用公式注入防護
    const safeRows = rows.map(row => row.map(sanitizeCell));
    // 變數用途說明：[2026-11-27] sheetData 組合日期區間、表頭與明細資料
    const sheetData = [
      [`實際交易日期區間：${dateRange}`],
      headers,
      ...safeRows
    ];
    // 變數用途說明：[2026-11-27] worksheet 建立單一明細工作表
    const worksheet = window.XLSX.utils.aoa_to_sheet(sheetData);
    worksheet['!cols'] = getColumnWidths(headers, safeRows);
    worksheet['!merges'] = [
      {
        s: { r: 0, c: 0 },
        e: { r: 0, c: Math.max(headers.length - 1, 0) }
      }
    ];
    // 變數用途說明：[2026-11-27] workbook 建立 Excel 活頁簿物件
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, '交易明細');
    window.XLSX.writeFile(workbook, filename);
  };

  // 變數用途說明：[2026-11-27] ExcelExport 對外提供匯出功能
  window.ExcelExport = { exportWorkbook };
})();
