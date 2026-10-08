# 資產河流｜每日收盤價版（GitHub Pages）

**這一版修正了：瀏覽器直接呼叫 Yahoo Finance 因 CORS 而更新 0 檔的問題。**

## 必須先部署 GitHub Pages（直接開本機 index.html 不會自動更新行情）

1. 在 GitHub 的公開 `asset-river-web` 儲存庫上傳這份 ZIP **解壓縮後的檔案和資料夾**，包括 `.github/workflows/quotes.yml`、`scripts/fetch_quotes.py`、`watchlist.csv`、`data/quotes.json`、`index.html`、`app.js`。務必保持資料夾結構且 index.html 在根目錄。
2. GitHub → Settings → Pages → Source: Deploy from a branch → main / (root) → Save。
3. GitHub → Actions → 每日收盤價與匯率 → Run workflow，等待綠色勾勾（若出現 workflow 權限提示，依畫面啟用）。
4. 在 GitHub 公開儲存庫打開 `data/quotes.json`，應出現實際日期、股票價格與匯率，而非空陣列。網站部署完成後在 `https://ruo30643.github.io/asset-river-web/` 的「行情與匯率」點「讀取最新每日收盤價」。
5. 你的 Firstrade 持股在舊版 Windows 本機瀏覽器 localStorage 裡。**注意：改成 GitHub Pages 的網址後，因網域不同，既有持股不會自動帶過去！先在舊版下載加密備份，再於 GitHub Pages 網址載入備份。**

## 行情來源及限制

- GitHub Actions 每個台灣時間週二至週六早上嘗試執行一次，**不保證精準時間、永不中斷或每檔都有報價**。交易所休市時使用最近有效交易日價格。
- 使用非官方 Yahoo Chart 接口。若接口遭限制會保留上次有效報價，但新股可能拿不到價格；可在網頁手動輸入。
- 價格是每日未調整收盤價，不是即時價格。
- 自動更新僅針對 `watchlist.csv` 裡的代號。新增其他美股，請於 `watchlist.csv` 加入一行 `US,代號`。台股上市加 `TW,代號`，上櫃因市場代號不同目前需要額外處理。
- `watchlist.csv` 會**公開**：別人可看到這份報價清單（但不包含你的股數、成本、帳戶名稱）。如不希望別人知道你關注哪些股票，請不要以公開儲存庫維護個人專屬清單。
- 報價資料、程式碼是公開的；**真實持股數量、個人財務備份或密碼絕對不要上傳**。App 仍在瀏覽器 localStorage 保存未加密的資料；請使用可信任裝置。
- GitHub Actions 與 GitHub Pages 目前在標準個人免費額度內可使用，但 GitHub 政策與免費額度可能改變。

## 本機測試

本機打開 index.html 能新增資料、手動輸入報價，但自動行情功能只支援 HTTP(S) 網站讀取 `data/quotes.json`；空白的初始 JSON 不會填入假股價。
