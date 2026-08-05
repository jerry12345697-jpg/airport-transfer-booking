# 全台機場接送預約與報價系統

完整功能：
- 📱 美觀的預約網站（手機友善）
- 💰 即時自動報價（依地區、車型、夜間、行李）
- 📊 自動整理到 Excel（bookings.xlsx）
- 📲 即時推播通知到你的 LINE 官方帳號

---

## 快速開始

### 1. 安裝套件
```bash
cd airport-transfer-booking
npm install express cors body-parser exceljs @line/bot-sdk dotenv
```

### 2. 設定 LINE
1. 到 [LINE Developers](https://developers.line.biz/) 建立一個 Messaging API Channel
2. 取得 **Channel Access Token** 與 **Channel Secret**
3. 複製 `.env.example` 成 `.env`，填入資料：
```bash
cp .env.example .env
```
4. 取得你自己的 **LINE User ID**（管理員 ID）：
   - 最簡單方式：用 LINE 官方「LINE Bot Designer」或暫時寫一個 webhook 印出 event.source.userId
   - 或使用現成工具搜尋「取得 LINE User ID」

### 3. 啟動
```bash
node server.js
```
開啟瀏覽器：http://localhost:3000

### 4. 部署上線（推薦）
- **Railway.app** 或 **Render.com**（免費額度夠用）
- **Vercel**（前端）+ Railway（後端）
- 或用你自己的主機 / NAS

部署後把網址給客人即可預約。

---

## 報價規則（可自行修改）

目前設定（server.js 與 index.html 都有）：

| 地區       | 5人座日間 | 7-9人座日間 |
|------------|-----------|-------------|
| 竹東鎮     | 1350      | 1750        |
| 湖口鄉     | 1250      | 1650        |
| 芎林鄉     | 1300      | 1700        |
| 橫山鄉     | 1450      | 1850        |
| 北埔鄉     | 1500      | 1900        |
| 峨眉鄉     | 1550      | 1950        |
| 新埔鎮     | 1300      | 1700        |
| 關西鎮     | 1450      | 1850        |
| 新竹市     | 1400      | 1800        |

- 夜間（22:00～05:59）+200
- 行李 5 件以上 +100

你可依實際營運調整數字。

---

## 檔案說明
- `index.html` ：預約網站前端
- `server.js` ：後端 API + Excel + LINE 推播
- `bookings.xlsx` ：所有預約紀錄（自動產生）
- `.env` ：LINE 金鑰（不要上傳到 Git）

---

## 進階功能建議
1. 加入「訂單管理後台」頁面（可改狀態：已確認 / 已完成 / 取消）
2. 用 Google Sheet 取代 Excel（方便手機查看）
3. 串接付款（綠界、藍新）
4. 自動產生接送確認 Flex Message 給客人

需要我再幫你加這些功能，直接告訴我！
