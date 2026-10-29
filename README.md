# 記事本（網站程式）

個人記事本網站，部署在 GitHub Pages：https://mitsuiwei.github.io/notepad/

- 這個倉庫只有網頁程式（HTML / CSS / JS），**不含任何筆記內容或金鑰**。
- 筆記資料存在私人倉庫 `MitsuiWei/notepad-notes` 的 `notes/notes.json`，網頁透過 GitHub API 讀寫。
- 沒有 Token 時仍可使用，筆記只存於瀏覽器本機。

## 第一次使用

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
2. Repository access 選「Only select repositories」→ 勾選 `notepad-notes`
3. Repository permissions → **Contents** → **Read and write**
4. 打開網站，點左下角 ⚙️，貼上 Token，按「測試連線」再「儲存」

Token 只會存在瀏覽器的 localStorage。

## 快捷鍵

- Ctrl+S 立即同步到 GitHub
- Ctrl+B / Ctrl+I / Ctrl+U 粗體、斜體、底線
- 拖曳清單左側的 ⋮⋮ 把手可自訂筆記順序（搜尋中不可拖曳）
- 編輯區右上角 Aa 可設定整篇的字體（思源黑體、宋體、圓體、文楷、等寬）、字級與文字顏色，設定記在此瀏覽器
- 編輯區上方的格式列可對「選取的文字」套用粗體、斜體、底線、刪除線、文字顏色、螢光筆底色與字體；筆記以 HTML 格式存檔（`format: "html"`），舊的 Markdown 筆記第一次編輯時自動轉換
