# release note: v 2.2.2 
1. 交易記錄及標的提供連續新增功能
2. DB時間欄位改為CRTDT
3. US的STOCK沒有NAME所以改為選填

# release note: V 2.3.0
1. Dashboard增加搜尋功能

# release note: V 2.3.1
1. TradingLog連續新增成功時出現提示

# release note: V 2.3.2
1. 增加區間損益合計功能(含息/不含息)
2. 收入: SELL+REVERNUE+INTEREST
3. 支出: BUY
4. 不計INPUT跟OUPUT避免重覆計算

# release note: V 2.3.3
1. TradingLog警示訊息由msgbox改為toast
2. 修改Tradinglog標的下拉選單無法載入問題
3. 登入的帳號欄位顏色修正
4. 修正連續新增時, 已進下一回合, 回合數不正確

# release note: V 3.0.0
1. 架設CLI開發環境
2. 建立市場別新增功能
3. 重構DB(拆三個TABLE)

# release note: V 3.1.0
1. 移除GEMINI CLI設定
2. Dashboard增加編輯備註功能
3. Dashboard標的顯示中文名稱

# release note: V 3.1.1
1. 加強新增及編輯時的XSS安全性
