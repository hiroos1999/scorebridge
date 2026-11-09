"""MusicXML(.xml/.musicxml/.mxl)を簡易パースして比較する。標準ライブラリのみ。"""
import difflib
import re
import xml.etree.ElementTree as ET
import zipfile

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _read(path):
    if path.lower().endswith(".mxl"):
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            inner = None
            if "META-INF/container.xml" in names:
                m = re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode("utf-8", "ignore"))
                if m:
                    inner = m.group(1)
            if not inner:
                inner = next(n for n in names if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF"))
            data = z.read(inner)
    else:
        with open(path, "rb") as f:
            data = f.read()
    # DOCTYPE があるとETが嫌がる場合があるので除去
    data = re.sub(rb"<!DOCTYPE[^>]*>", b"", data)
    return ET.fromstring(data)


def _local(tag):
    return tag.split("}")[-1]


def _child(el, name):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _text(el, name):
    c = _child(el, name) if el is not None else None
    return c.text.strip() if c is not None and c.text else None


def parse(path):
    """先頭パートを (measures, chords) に変換。
    measures: 小節ごとの [(midi or -1(休符), 長さ(四分音符=1.0)), ...]
    chords: 小節ごとの [(root_pc, kind), ...]
    """
    root = _read(path)
    part = next(c for c in root if _local(c.tag) == "part")
    divisions = 1
    measures, chords = [], []
    for m in (c for c in part if _local(c.tag) == "measure"):
        notes, hs = [], []
        for el in m:
            t = _local(el.tag)
            if t == "attributes":
                d = _text(el, "divisions")
                if d:
                    divisions = max(1, int(float(d)))
            elif t == "note":
                if _child(el, "chord") is not None:
                    continue  # 和音の2音目以降は無視（旋律のみ比較）
                if _child(el, "grace") is not None:
                    continue
                dur = _text(el, "duration")
                dur = float(dur) / divisions if dur else 0.0
                p = _child(el, "pitch")
                if p is None:
                    notes.append((-1, round(dur, 3)))
                else:
                    step, octv = _text(p, "step"), _text(p, "octave")
                    alter = _text(p, "alter") or "0"
                    midi = 12 * (int(octv) + 1) + STEP[step] + int(float(alter))
                    notes.append((midi, round(dur, 3)))
            elif t == "harmony":
                r = _child(el, "root")
                if r is not None:
                    step = _text(r, "root-step")
                    alter = int(float(_text(r, "root-alter") or 0))
                    k = _child(el, "kind")
                    kind = (k.get("text") or k.text or "") if k is not None else ""
                    hs.append(((STEP[step] + alter) % 12, kind.strip()))
        measures.append(notes)
        chords.append(hs)
    return measures, chords


def _ratio(a, b):
    if not a and not b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def compare(truth_path, test_path):
    tm, tc = parse(truth_path)
    om, oc = parse(test_path)
    flat = lambda ms: [n for m in ms for n in m if n[0] >= 0]
    tn, on = flat(tm), flat(om)
    res = {
        "truth_measures": len(tm),
        "test_measures": len(om),
        "truth_notes": len(tn),
        "test_notes": len(on),
        # 音の高さの並びの一致度（リズム無視）
        "pitch_sim": round(_ratio([p for p, _ in tn], [p for p, _ in on]), 4),
        # 音名のみ（オクターブ無視）
        "pitchclass_sim": round(_ratio([p % 12 for p, _ in tn], [p % 12 for p, _ in on]), 4),
        # 高さ＋長さ
        "note_sim": round(_ratio(tn, on), 4),
        # 小節の長さの合計が一致する小節の割合（先頭から小節番号で対応づけ）
        "measure_len_ok": round(
            sum(1 for a, b in zip(tm, om) if abs(sum(d for _, d in a) - sum(d for _, d in b)) < 0.01) / max(1, len(tm)),
            4,
        ),
        # コード（ルート）の並びの一致度
        "chord_root_sim": round(
            _ratio([r for h in tc for r, _ in h], [r for h in oc for r, _ in h]), 4
        ),
        "truth_chords": sum(len(h) for h in tc),
        "test_chords": sum(len(h) for h in oc),
    }
    return res
