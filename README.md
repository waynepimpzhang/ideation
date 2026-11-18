# 點子牆：廣告案例參考庫

給創意團隊在發想前翻閱的外部廣告案例卡。每張卡拆成必講訊息、Insight、一句話、腳本結構、為什麼有效與可套用的方向，並標上手法、形式、規格、調性與 AI 可行性。網站可依這些欄位篩選，也可以搜尋標題與內文。

- 案例卡放在 `refs/*.md`，每週會自動新增。
- 網站放在 `docs/`，由 GitHub Pages 提供，是純靜態頁面。
- 篩選條件會寫進網址 `#` 後面，可以直接分享篩選後的畫面。

## 重新產生資料

新增或修改 `refs/*.md` 之後，執行：

```
python scripts/build.py
```

只用 Python 3 標準函式庫，會產生：

- `docs/cards.json`：網站讀取的資料（案例、手法庫、更新時間）
- `refs/INDEX.md`：案例索引表，由程式自動產生，請勿手動編輯

篩選選項從資料自動長出來，新增的產業、形式、手法不需要改網頁。

## 本機預覽

```
cd docs
python -m http.server
```

再開啟 http://localhost:8000。

## 手法庫來源

手法庫讀自 `scripts/patterns.md`（若存在），否則讀 `~/.claude/skills/aic-ideation/library/patterns.md`。程式只輸出手法名稱、結構、調性與可套用範圍，不會輸出出處欄。
