// 引入 Node.js 檔案系統模組，負責讀取與寫入檔案
const fs = require('fs');
// 引入路徑處理模組，負責組合跨平台相容的路徑字串
const path = require('path');

// 變數用途：取得當前專案 package.json 的絕對路徑
const packageJsonPath = path.join(__dirname, 'package.json');
// 變數用途：讀取並解析 package.json，取得內建定義的版本號
const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// 變數用途：取得當前伺服器時間物件
const currentDate = new Date();

// 輔助函式：將單一位數的數字補零至兩位數
const padZero = (num) => String(num).padStart(2, '0');

// 變數用途：分別提取年月日與時分字串
const year = currentDate.getFullYear();
const month = padZero(currentDate.getMonth() + 1);
const day = padZero(currentDate.getDate());
const hours = padZero(currentDate.getHours());
const minutes = padZero(currentDate.getMinutes());

// 變數用途：組合成格式化的版號物件
const versionPayload = {
  version: `Ver ${packageData.version} (build_${year}/${month}/${day}_${hours}:${minutes})`
};

// 變數用途：指定欲輸出的 version.json 絕對路徑
const targetOutputPath = path.join(__dirname, 'version.json');

// 將版號物件寫入專案目錄下的 version.json
fs.writeFileSync(targetOutputPath, JSON.stringify(versionPayload, null, 2), 'utf8');

console.log(`版本檔案建立完成: ${versionPayload.version}`);