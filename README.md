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
- Ctrl+E 切換 Markdown 預覽
