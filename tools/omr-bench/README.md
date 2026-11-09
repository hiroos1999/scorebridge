# OMR(Audiveris)精度ベンチ

同名の `.mscz`(MuseScore)と `.pdf` が並んでいる楽譜を、正解付きテストとして使います。
正解はMuseScoreで書き出したMusicXML、入力はPDF（任意でDPI違いの画像）。

## 準備（Mac）
- Audiveris（インストール済み）
- MuseScore（`/Applications/MuseScore 4.app` など）
- 画像化して試すなら: `brew install poppler`

## 実行例
```
python3 tools/omr-bench/bench.py --scores "$HOME/Library/Mobile Documents/com~apple~CloudDocs/01_Music/Scores/Jazz" --limit 3
python3 tools/omr-bench/bench.py --scores "..." --dpi 150,300
```
結果は `tools/omr-bench/results/<日時>/` の `results.csv` と `summary.txt`（gitには入りません）。

## 点数の意味
- pitch_sim: 音の高さの並びの一致度（0〜1）
- pitchclass_sim: オクターブを無視した一致度
- note_sim: 高さ＋長さの一致度
- measure_len_ok: 小節の長さが正解と合う小節の割合
- chord_root_sim: コード（ルート音）の一致度
