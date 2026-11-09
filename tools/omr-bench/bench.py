#!/usr/bin/env python3
"""Audiveris 精度ベンチ（Mac上で実行）。標準ライブラリのみ。

「同名の .mscz と .pdf が並んでいる楽譜」を正解付きテストとして使う。
  正解   : MuseScoreのCLIで .mscz -> MusicXML に書き出したもの
  入力   : .pdf（そのまま） と、任意で .pdf を各DPIの画像にしたもの
  出力   : results/<日時>/results.csv と summary.txt

使い方:
  python3 tools/omr-bench/bench.py --scores "/Users/.../01_Music/Scores/Jazz" --limit 3
  オプション: --dpi 150,300 （画像化して試す。poppler の pdftoppm が必要: brew install poppler）
              --first-page-only （各PDFの1ページ目だけ使う。pdftoppm が必要）
環境変数: AUDIVERIS_CMD, MUSESCORE_CMD
"""
import argparse
import csv
import datetime
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import musicxml_compare as mc  # noqa: E402

AUDIVERIS = os.environ.get("AUDIVERIS_CMD", "/Applications/Audiveris.app/Contents/MacOS/Audiveris")
MUSESCORE_CANDIDATES = [
    os.environ.get("MUSESCORE_CMD", ""),
    "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
    "/Applications/MuseScore 3.app/Contents/MacOS/mscore",
    "/Applications/MuseScore Studio.app/Contents/MacOS/mscore",
]


def find_musescore():
    for p in MUSESCORE_CANDIDATES:
        if p and os.path.exists(p):
            return p
    sys.exit("MuseScore の実行ファイルが見つかりません。MUSESCORE_CMD=/Applications/MuseScore\\ 4.app/Contents/MacOS/mscore のように指定してください。")


def find_pairs(folder):
    files = {}
    for name in os.listdir(folder):
        stem, ext = os.path.splitext(name)
        files.setdefault(stem, {})[ext.lower()] = os.path.join(folder, name)
    return sorted((s, f[".mscz"], f[".pdf"]) for s, f in files.items() if ".mscz" in f and ".pdf" in f)


def run(cmd, timeout):
    t = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, time.time() - t, (r.stdout + r.stderr)[-3000:]
    except subprocess.TimeoutExpired:
        return -9, time.time() - t, "timeout"


def export_truth(mscore, mscz, out_xml):
    code, _, log = run([mscore, "-o", out_xml, mscz], 180)
    if code != 0 or not os.path.exists(out_xml):
        return None, log
    return out_xml, ""


def make_variants(pdf, workdir, dpis, first_page_only):
    """(ラベル, 入力ファイルパス) のリスト"""
    variants = []
    if not first_page_only:
        variants.append(("pdf", pdf))
    if dpis or first_page_only:
        if not shutil.which("pdftoppm"):
            print("  ! pdftoppm が無いので画像化はスキップ（brew install poppler）")
        else:
            for dpi in (dpis or [300]):
                prefix = os.path.join(workdir, f"img{dpi}")
                args = ["pdftoppm", "-png", "-r", str(dpi)]
                if first_page_only:
                    args += ["-f", "1", "-l", "1"]
                run(args + [pdf, prefix], 300)
                pngs = sorted(p for p in os.listdir(workdir) if p.startswith(f"img{dpi}") and p.endswith(".png"))
                if pngs:
                    variants.append((f"png{dpi}" + ("_p1" if first_page_only else ""), os.path.join(workdir, pngs[0])))
    return variants


def audiveris(inp, outdir, timeout):
    os.makedirs(outdir, exist_ok=True)
    args = [AUDIVERIS, "-batch", "-export", "-output", outdir, "--", inp]
    if not inp.lower().endswith(".pdf"):
        args[3:3] = ["-sheets", "1"]
    code, secs, log = run(args, timeout)
    outs = []
    for r, _, fs in os.walk(outdir):
        outs += [os.path.join(r, f) for f in fs if f.lower().endswith((".mxl", ".musicxml", ".xml"))]
    return sorted(outs), secs, code, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True, help="mscz と pdf が並んでいるフォルダ")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dpi", default="")
    ap.add_argument("--first-page-only", action="store_true")
    ap.add_argument("--timeout", type=int, default=600)
    a = ap.parse_args()

    if not os.path.exists(AUDIVERIS):
        sys.exit(f"Audiveris が見つかりません: {AUDIVERIS}")
    mscore = find_musescore()
    dpis = [int(x) for x in a.dpi.split(",") if x]

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", stamp)
    os.makedirs(root, exist_ok=True)

    pairs = find_pairs(a.scores)
    if a.limit:
        pairs = pairs[: a.limit]
    print(f"{len(pairs)} 組を実行します。結果: {root}")

    rows = []
    for stem, mscz, pdf in pairs:
        safe = "".join(ch if ch.isalnum() else "_" for ch in stem)[:60]
        work = os.path.join(root, safe)
        os.makedirs(work, exist_ok=True)
        print(f"\n== {stem}")
        truth, log = export_truth(mscore, mscz, os.path.join(work, "truth.musicxml"))
        if not truth:
            print("  正解の書き出しに失敗:", log[-200:])
            continue
        for label, inp in make_variants(pdf, work, dpis, a.first_page_only):
            outs, secs, code, log = audiveris(inp, os.path.join(work, f"out_{label}"), a.timeout)
            row = {"song": stem, "variant": label, "seconds": round(secs, 1), "exit_code": code, "outputs": len(outs)}
            if outs:
                try:
                    # 複数出力は先頭を使う（ページ分割時は参考値）
                    row.update(mc.compare(truth, outs[0]))
                except Exception as e:  # noqa: BLE001
                    row["error"] = f"compare: {e}"
            else:
                row["error"] = log[-200:].replace("\n", " ")
            rows.append(row)
            print(f"  {label:12s} {row['seconds']:6.1f}s  note_sim={row.get('note_sim','-')} chord={row.get('chord_root_sim','-')}")

    keys = ["song", "variant", "seconds", "exit_code", "outputs", "truth_measures", "test_measures", "truth_notes", "test_notes",
            "pitch_sim", "pitchclass_sim", "note_sim", "measure_len_ok", "truth_chords", "test_chords", "chord_root_sim", "error"]
    with open(os.path.join(root, "results.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    # 条件ごとの平均
    lines = ["条件ごとの平均（成功したもののみ）", ""]
    for label in sorted({r["variant"] for r in rows}):
        ok = [r for r in rows if r["variant"] == label and "note_sim" in r]
        fail = [r for r in rows if r["variant"] == label and "note_sim" not in r]
        if ok:
            avg = lambda k: sum(r[k] for r in ok) / len(ok)
            lines.append(f"{label}: 成功{len(ok)} 失敗{len(fail)} | 音高 {avg('pitch_sim'):.2f} 音高+長さ {avg('note_sim'):.2f} "
                         f"小節長OK {avg('measure_len_ok'):.2f} コード {avg('chord_root_sim'):.2f} | 平均 {avg('seconds'):.0f}秒")
        else:
            lines.append(f"{label}: 成功0 失敗{len(fail)}")
    with open(os.path.join(root, "summary.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n" + "\n".join(lines))
    print(f"\n詳細: {os.path.join(root, 'results.csv')}")


if __name__ == "__main__":
    main()
