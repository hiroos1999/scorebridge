#!/usr/bin/env python3
"""
MusicXML（OMRツール homr 等の出力）を、components/StaffToFretboard.tsx の
Note型（rowIdx, duration, accidental）に変換するスクリプト。

Note型が前提とする座標系:
  - rows配列: rowIdx 0..19 = C6,B5,A5,G5,F5,E5,D5,C5,B4,A4,G4,F4,E4,D4,C4,B3,A3,G3,F3,E3
    （音名の「線・間」の位置。#/♭はrowIdxには含まれず、accidentalで別途表現する）
  - duration: 4分音符=4を基準としたグリッド単位（全音符=16, 2分=8, 4分=4, 8分=2, 16分=1）。
    MusicXMLの<duration>は<divisions>基準の値なので、divisions情報を使って
    「4分音符=4グリッド」の単位に変換する。
  - accidental: MusicXMLの<alter>の値をそのまま使う（自然音からの半音のずれ）。

タイ(<tie>)の扱い:
  同じ小節内で結ばれたタイは、1つの長い音符（duration合算）に統合する
  （アプリの再生・データ上は正しい長さの1音になる。符頭の見た目上の分割だけは
  再現されない）。
  小節をまたぐタイは、Note型のstartGridが小節内ローカルなグリッド番号であるため
  1つのNoteとして表現できない（データモデル上の制約）。この場合は2つの音符
  として出力し、再生時に本来ないはずの再アタックが入る旨を警告する。

  注意: OMRツール(homr)は、タイと（フレージングの）スラーを区別せず、
  どちらも<tie>ではなく<notations><slur type="start/stop"/></notations>として
  出力することを確認している。そのため本スクリプトは<tie>だけでなく<slur>も
  タイ候補として扱い、実際に同じ高さの音符同士を繋いでいる場合のみ結合する
  （高さが異なる場合は通常のフレージングスラーとみなし、結合しない＝2音の
  ままにする。これは正しい挙動で、警告の対象にもしない）。

使い方:
  python3 scripts/musicxml_to_notes.py input.musicxml
  python3 scripts/musicxml_to_notes.py input.musicxml --grids-per-quarter 4

標準ライブラリのみで動作する（追加インストール不要）。
"""

import argparse
import json
import sys
import xml.etree.ElementTree as ET

# rows配列（StaffToFretboard.tsx）と同じ並び。(音名, オクターブ) -> rowIdx
ROW_INDEX = {
    ("C", 6): 0, ("B", 5): 1, ("A", 5): 2, ("G", 5): 3, ("F", 5): 4,
    ("E", 5): 5, ("D", 5): 6, ("C", 5): 7, ("B", 4): 8, ("A", 4): 9,
    ("G", 4): 10, ("F", 4): 11, ("E", 4): 12, ("D", 4): 13, ("C", 4): 14,
    ("B", 3): 15, ("A", 3): 16, ("G", 3): 17, ("F", 3): 18, ("E", 3): 19,
}


def parse_measures(xml_path: str, grids_per_quarter: int = 4):
    tree = ET.parse(xml_path)
    root = tree.getroot()

    part = root.find("part")
    if part is None:
        raise ValueError("<part>要素が見つかりません（想定外のMusicXML構造）")

    divisions = 1
    warnings = []

    # ---- 1st pass: タイのマージはせず、1音ずつそのまま各小節のリストに積む。
    # 各要素は {startGrid, duration, isRest, rowIdx?, accidental?, tieStart, tieStop}。
    raw_measures: list[list[dict]] = []

    for m_idx, measure_el in enumerate(part.findall("measure")):
        for attrs in measure_el.findall("attributes"):
            div_el = attrs.find("divisions")
            if div_el is not None:
                divisions = int(div_el.text)

        raw_notes: list[dict] = []
        grid = 0

        def xml_dur_to_grids(xml_duration: int) -> int:
            return max(round(xml_duration / divisions * grids_per_quarter), 1)

        for child in measure_el:
            if child.tag == "backup":
                grid -= xml_dur_to_grids(int(child.find("duration").text))
            elif child.tag == "forward":
                grid += xml_dur_to_grids(int(child.find("duration").text))
            elif child.tag == "note":
                dur_el = child.find("duration")
                if dur_el is None:
                    warnings.append(f"小節{m_idx + 1}: duration無しのnote要素をスキップ（装飾音符の可能性）")
                    continue
                duration = xml_dur_to_grids(int(dur_el.text))

                if child.find("chord") is not None:
                    warnings.append(
                        f"小節{m_idx + 1}: <chord/>（和音）は単旋律採譜スクリプトでは未対応のため無視しました"
                    )
                    continue

                rest_el = child.find("rest")
                if rest_el is not None:
                    raw_notes.append({
                        "startGrid": grid, "duration": duration, "isRest": True,
                        "rowIdx": None, "accidental": None,
                        "tieStart": False, "tieStop": False,
                    })
                    grid += duration
                    continue

                pitch_el = child.find("pitch")
                if pitch_el is None:
                    warnings.append(f"小節{m_idx + 1}: pitchもrestも無いnote要素をスキップ")
                    continue
                step = pitch_el.find("step").text
                octave = int(pitch_el.find("octave").text)
                alter_el = pitch_el.find("alter")
                accidental = int(float(alter_el.text)) if alter_el is not None else 0

                key = (step, octave)
                if key not in ROW_INDEX:
                    warnings.append(
                        f"小節{m_idx + 1}: {step}{octave}はrows配列の範囲外(C6〜E3)のため変換できませんでした"
                        "（最も近い音に手動で置き換えてください）"
                    )
                    grid += duration
                    continue

                # <tie>だけでなく<notations><slur></notations>もタイ候補として拾う
                # （homrがタイをslurとして出力するため。マージ判定は実際の音高一致
                # 有無で行うので、異なる高さ同士の通常のフレージングスラーを
                # 誤ってタイ扱いすることはない）。
                notations_el = child.find("notations")
                slur_els = notations_el.findall("slur") if notations_el is not None else []
                tie_start = (
                    any(t.get("type") == "start" for t in child.findall("tie"))
                    or any(s.get("type") == "start" for s in slur_els)
                )
                tie_stop = (
                    any(t.get("type") == "stop" for t in child.findall("tie"))
                    or any(s.get("type") == "stop" for s in slur_els)
                )

                raw_notes.append({
                    "startGrid": grid, "duration": duration, "isRest": False,
                    "rowIdx": ROW_INDEX[key], "accidental": accidental,
                    "tieStart": tie_start, "tieStop": tie_stop,
                })
                grid += duration

        raw_measures.append(raw_notes)

    # ---- 2nd pass: 同じ小節内で閉じているタイ（tieStart直後にtieStopが来る、
    # 同じ高さの音符）だけをマージする。小節をまたぐタイはマージできないため、
    # 2つの別音符のまま残し、警告する。
    measures_out = []
    for m_idx, raw_notes in enumerate(raw_measures):
        merged: list[dict] = []
        i = 0
        while i < len(raw_notes):
            n = raw_notes[i]
            if (
                not n["isRest"] and n["tieStart"]
                and i + 1 < len(raw_notes)
                and not raw_notes[i + 1]["isRest"]
                and raw_notes[i + 1]["rowIdx"] == n["rowIdx"]
                and raw_notes[i + 1]["accidental"] == n["accidental"]
            ):
                nxt = raw_notes[i + 1]
                merged.append({
                    "startGrid": n["startGrid"],
                    "duration": n["duration"] + nxt["duration"],
                    "isRest": False,
                    "rowIdxList": [n["rowIdx"]],
                    "accidentals": {str(n["rowIdx"]): n["accidental"]},
                })
                i += 2
                continue
            if not n["isRest"] and n["tieStart"] and not (
                i + 1 < len(raw_notes) and raw_notes[i + 1]["tieStop"]
            ):
                warnings.append(
                    f"小節{m_idx + 1}: 小節をまたぐタイ（または対応するtie stopが同じ小節内に無い"
                    "タイ）を検出しました。Note型では1音に結合できないため2つの別音符のまま"
                    "出力します。再生時に本来無いはずの再アタックが入ります。"
                )
            if not n["isRest"] and n["tieStop"] and not n["tieStart"]:
                # 直前でマージ済み、またはマージできなかった残骸。単独のtie stopは
                # そのまま出力すればよい（上のマージ処理で拾えなかった＝小節をまたいだ側）。
                pass
            if n["isRest"]:
                merged.append({
                    "startGrid": n["startGrid"], "duration": n["duration"], "isRest": True,
                    "rowIdxList": [], "accidentals": {},
                })
            else:
                merged.append({
                    "startGrid": n["startGrid"], "duration": n["duration"], "isRest": False,
                    "rowIdxList": [n["rowIdx"]], "accidentals": {str(n["rowIdx"]): n["accidental"]},
                })
            i += 1
        total_grid = sum(x["duration"] for x in merged)
        measures_out.append({"notes": merged, "totalGrids": total_grid})

    return measures_out, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("musicxml", help="入力MusicXMLファイル")
    parser.add_argument(
        "--grids-per-quarter", type=int, default=4,
        help="4分音符を何グリッドとして出力するか（StaffToFretboardの既定は4）",
    )
    args = parser.parse_args()

    measures, warnings = parse_measures(args.musicxml, args.grids_per_quarter)

    for i, m in enumerate(measures):
        total = m["totalGrids"]
        gridsPerMeasure = args.grids_per_quarter * 4
        flag = "" if total == gridsPerMeasure else f"  ⚠️ 合計{total}グリッド(4/4なら{gridsPerMeasure}グリッド想定)"
        print(f"// 小節{i + 1}{flag}", file=sys.stderr)

    print(json.dumps([m["notes"] for m in measures], ensure_ascii=False, indent=2))

    if warnings:
        print("\n--- 警告 ---", file=sys.stderr)
        for w in warnings:
            print(w, file=sys.stderr)


if __name__ == "__main__":
    main()
