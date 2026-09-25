#!/usr/bin/env python3
"""
MusicXML（.musicxml/.xml、または圧縮形式の.mxl。OMRツール homr の出力や
MuseScoreのエクスポートを想定）を、components/StaffToFretboard.tsx の
Note型・Harmony型・TimeSignatureに変換するスクリプト。

Note型が前提とする座標系:
  - rows配列: rowIdx 0..19 = C6,B5,A5,G5,F5,E5,D5,C5,B4,A4,G4,F4,E4,D4,C4,B3,A3,G3,F3,E3
    （音名の「線・間」の位置。#/♭はrowIdxには含まれず、accidentalで別途表現する）
  - duration: 4分音符=4を基準としたグリッド単位（全音符=16, 2分=8, 4分=4, 8分=2, 16分=1）。
    MusicXMLの<duration>は<divisions>基準の値なので、divisions情報を使って
    「4分音符=4グリッド」の単位に変換する。
  - accidental: MusicXMLの<alter>の値をそのまま使う（自然音からの半音のずれ）。

Harmony型（コードシンボル）:
  <harmony>要素を、そのタイミングで積み上がっているgrid位置をoffsetGridとして
  {offsetGrid, root, kind}に変換する。<kind>のテキストは、lib/chords.tsの
  CHORD_TYPESに定義されているキー（maj7, m7, 7, dim, m7b5, 6, m6）に
  マッピングする。対応表に無い<kind>は変換できないため、その小節のharmonyを
  スキップして警告を出す（音を無音や別のコードとして誤って出力しない）。

TimeSignature・調号:
  <attributes><time>から{numerator, denominator}を、<attributes><key><fifths>から
  キー（ピッチクラス）とuseFlats（fifths<0ならフラット系）を、それぞれ最初に
  見つかった値を全体の値として採用する（曲中に拍子・調号が変わる曲には対応しない、
  既知の制約）。

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

3連符について:
  <time-modification>が3:2（3連符）の音符・休符は、Note型のtriplet=trueとして出力する。
  durationは記譜上の音価（8分3連符なら8分=2）のまま持ち、実際に占める長さはその2/3
  になる（lib/grid.tsのnoteSpan）。そのため3連符を含む小節ではstartGridが1/3グリッド
  刻みの小数になる（浮動小数点誤差を避けるため、位置は常にsnap_gridで1/3刻みに丸める）。
  3:2以外の比率の連符（5連符等）は表現できないため、グリッド数に丸めて警告する。

.mxl（圧縮MusicXML）対応:
  拡張子または実体（zipのマジックバイト）で圧縮形式と判定した場合、
  META-INF/container.xmlからルートファイルのパスを解決して展開する。

使い方:
  python3 scripts/musicxml_to_notes.py input.musicxml
  python3 scripts/musicxml_to_notes.py input.mxl
  python3 scripts/musicxml_to_notes.py input.musicxml --grids-per-quarter 4

標準ライブラリのみで動作する（追加インストール不要）。
"""

import argparse
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

# rows配列（StaffToFretboard.tsx）と同じ並び。(音名, オクターブ) -> rowIdx
ROW_INDEX = {
    ("C", 6): 0, ("B", 5): 1, ("A", 5): 2, ("G", 5): 3, ("F", 5): 4,
    ("E", 5): 5, ("D", 5): 6, ("C", 5): 7, ("B", 4): 8, ("A", 4): 9,
    ("G", 4): 10, ("F", 4): 11, ("E", 4): 12, ("D", 4): 13, ("C", 4): 14,
    ("B", 3): 15, ("A", 3): 16, ("G", 3): 17, ("F", 3): 18, ("E", 3): 19,
}

# <root-step>（自然音名）-> ピッチクラス。StaffToFretboard.tsxのNOTE_NAMES_*と同じ並び。
STEP_TO_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# MusicXMLの<kind>テキスト -> lib/chords.ts CHORD_TYPESのキー。
# ここに無い<kind>は変換できない（アプリ側にその和音タイプの定義が無いため）。
KIND_TO_APP_CHORD = {
    "major-seventh": "maj7",
    "minor-seventh": "m7",
    "dominant": "7",
    "dominant-seventh": "7",
    "diminished-seventh": "dim",
    "diminished": "dim",
    "half-diminished": "m7b5",
    "major-sixth": "6",
    "minor-sixth": "m6",
}


def snap_grid(grid: float) -> float:
    """グリッド位置を1/3刻みに丸める（lib/grid.tsのsnapGridと同じ）。
    整数になる場合はintで返し、3連符を含まない曲のJSON出力を従来と同じ整数表記に保つ。"""
    snapped = round(grid * 3) / 3
    return int(snapped) if snapped == int(snapped) else snapped


def note_span(duration: int, triplet: bool) -> float:
    """音符・休符が実際に占めるグリッド数（lib/grid.tsのnoteSpanと同じ）。"""
    return snap_grid(duration * 2 / 3) if triplet else duration


def load_root_xml(path: str) -> ET.Element:
    """.musicxml/.xmlはそのまま、.mxl(zip)はcontainer.xmlからルートファイルを
    解決して展開する。"""
    with open(path, "rb") as f:
        head = f.read(4)
    if head[:2] == b"PK":  # zipのマジックバイト（拡張子が.mxlでなくても圧縮形式として扱う）
        with zipfile.ZipFile(path) as zf:
            container = ET.fromstring(zf.read("META-INF/container.xml"))
            rootfile_path = container.find(".//rootfile").get("full-path")
            return ET.fromstring(zf.read(rootfile_path))
    return ET.parse(path).getroot()


def expand_repeat_order(repeat_meta: list[dict]) -> list[int]:
    """各小節の<repeat>/<ending>メタ情報(repeat_meta, raw_measuresと同じ順番・
    同じ長さ)から、実際に演奏される順番の元小節インデックス列を返す
    （繰り返し区間の小節は複数回登場する）。

    通常の五線譜の読み方をそのままシミュレートする: 小節を先頭から順に読み進め、
    repeatForwardの小節を「戻り先」として記憶し、repeatBackwardの小節に来たら
    (times回に達するまで)戻り先までジャンプする。番括弧(endingNumbers)が付いた
    小節は、現在の周回数(pass)がその番号群に含まれる時だけ演奏に含める。
    """
    order: list[int] = []
    n = len(repeat_meta)
    i = 0
    repeat_start = 0
    pass_num = 1
    backward_jump_count: dict[int, int] = {}  # measure index -> これまでのジャンプ回数
    guard = 0
    while i < n:
        guard += 1
        if guard > (n + 1) * 8:
            # 想定外の入力（矛盾したrepeat/ending指定）で無限ループする事故を防ぐ安全弁。
            break
        m = repeat_meta[i]
        if m["repeatForward"]:
            repeat_start = i
        endings = m["endingNumbers"]
        if endings is None or pass_num in endings:
            order.append(i)
        if m["repeatBackward"]:
            done = backward_jump_count.get(i, 0)
            if done < m["repeatBackwardTimes"] - 1:
                backward_jump_count[i] = done + 1
                pass_num += 1
                i = repeat_start
                continue
        i += 1
    return order


def parse_score(xml_path: str, grids_per_quarter: int = 4):
    root_el = load_root_xml(xml_path)

    part = root_el.find("part")
    if part is None:
        raise ValueError("<part>要素が見つかりません（想定外のMusicXML構造）")

    divisions = 1
    fifths = None  # 最初に見つかった値を曲全体の調号として採用
    time_beats = None
    time_beat_type = None
    warnings = []

    # ---- 1st pass: タイのマージはせず、1音ずつそのまま各小節のリストに積む。
    # harmonyも同じグリッド位置を進めるループの中で拾う。
    raw_measures: list[list[dict]] = []
    raw_harmonies: list[list[dict]] = []
    # 繰り返し記号（<repeat>）・番括弧（<ending>）を、小節ごとのメタ情報として
    # 並行して集める。実際の展開（プレイ順序への反映）は1st passが全小節分
    # 終わってから行う（後ろの小節を見ないと展開できないため）。
    raw_repeat_meta: list[dict] = []

    for m_idx, measure_el in enumerate(part.findall("measure")):
        for attrs in measure_el.findall("attributes"):
            div_el = attrs.find("divisions")
            if div_el is not None:
                divisions = int(div_el.text)
            fifths_el = attrs.find("key/fifths")
            if fifths_el is not None and fifths is None:
                fifths = int(fifths_el.text)
            beats_el = attrs.find("time/beats")
            beat_type_el = attrs.find("time/beat-type")
            if beats_el is not None and beat_type_el is not None and time_beats is None:
                time_beats = int(beats_el.text)
                time_beat_type = int(beat_type_el.text)

        raw_notes: list[dict] = []
        harmonies: list[dict] = []
        grid = 0
        repeat_forward = False
        repeat_backward = False
        repeat_backward_times = 2  # <repeat backward>のtimes属性（省略時は2回=1回だけ折り返す）
        ending_numbers: set[int] | None = None  # このmeasureが属する番括弧の番号群（無ければNone）

        def xml_dur_to_grids(xml_duration: int) -> int:
            return max(round(xml_duration / divisions * grids_per_quarter), 1)

        # 3連符を含む小節では位置が1/3グリッド刻みになるため、backup/forwardは
        # 整数に丸めず1/3刻みで扱う（整数グリッドの曲では従来と同じ値になる）。
        def xml_dur_to_snapped_grids(xml_duration: int) -> float:
            return max(snap_grid(xml_duration / divisions * grids_per_quarter), 1 / 3)

        for child in measure_el:
            if child.tag == "backup":
                grid = snap_grid(grid - xml_dur_to_snapped_grids(int(child.find("duration").text)))
            elif child.tag == "forward":
                grid = snap_grid(grid + xml_dur_to_snapped_grids(int(child.find("duration").text)))
            elif child.tag == "barline":
                repeat_el = child.find("repeat")
                if repeat_el is not None:
                    direction = repeat_el.get("direction")
                    if direction == "forward":
                        repeat_forward = True
                    elif direction == "backward":
                        repeat_backward = True
                        times_attr = repeat_el.get("times")
                        if times_attr is not None:
                            repeat_backward_times = int(times_attr)
                for ending_el in child.findall("ending"):
                    numbers_attr = (ending_el.get("number") or "").replace(" ", "")
                    numbers = {int(n) for n in numbers_attr.split(",") if n.isdigit()}
                    if numbers:
                        ending_numbers = (ending_numbers or set()) | numbers
            elif child.tag == "harmony":
                root_step_el = child.find("root/root-step")
                if root_step_el is None:
                    warnings.append(f"小節{m_idx + 1}: <harmony>にroot-stepが無いためスキップしました")
                    continue
                root_alter_el = child.find("root/root-alter")
                root_alter = int(float(root_alter_el.text)) if root_alter_el is not None else 0
                root_pc = (STEP_TO_PC[root_step_el.text] + root_alter) % 12

                kind_el = child.find("kind")
                kind_text = kind_el.text if kind_el is not None else None
                app_kind = KIND_TO_APP_CHORD.get(kind_text) if kind_text else None
                if app_kind is None:
                    warnings.append(
                        f"小節{m_idx + 1}: コード種別 \"{kind_text}\" はアプリ未対応のためこのharmonyをスキップしました"
                        "（lib/chords.tsのCHORD_TYPESに追加すれば対応可能）"
                    )
                    continue
                harmonies.append({"offsetGrid": grid, "root": root_pc, "kind": app_kind, "inversion": 0})
            elif child.tag == "note":
                dur_el = child.find("duration")
                if dur_el is None:
                    warnings.append(f"小節{m_idx + 1}: duration無しのnote要素をスキップ（装飾音符の可能性）")
                    continue
                if child.find("chord") is not None:
                    warnings.append(
                        f"小節{m_idx + 1}: <chord/>（和音）は単旋律採譜スクリプトでは未対応のため無視しました"
                    )
                    continue

                # <time-modification>（連符）: 3:2（3連符）だけはtripletで正確に表せるので、
                # 実際の長さ(duration)を3/2倍した記譜上の音価をdurationとして持たせる。
                time_mod_el = child.find("time-modification")
                actual_notes = int(time_mod_el.findtext("actual-notes") or 0) if time_mod_el is not None else 0
                normal_notes = int(time_mod_el.findtext("normal-notes") or 0) if time_mod_el is not None else 0
                triplet = time_mod_el is not None and actual_notes == 3 and normal_notes == 2
                if time_mod_el is not None and not triplet:
                    warnings.append(
                        f"小節{m_idx + 1}: {actual_notes}:{normal_notes}の連符を検出しました。3連符以外の連符には"
                        "未対応のため、丸められたタイミングで取り込まれます（既知の制約）"
                    )
                xml_duration = int(dur_el.text)
                if triplet:
                    duration = max(round(xml_duration / divisions * grids_per_quarter * 1.5), 1)
                else:
                    duration = xml_dur_to_grids(xml_duration)
                span = note_span(duration, triplet)

                rest_el = child.find("rest")
                if rest_el is not None:
                    raw_notes.append({
                        "startGrid": grid, "duration": duration, "isRest": True,
                        "rowIdx": None, "accidental": None,
                        "tieStart": False, "tieStop": False, "triplet": triplet,
                    })
                    grid = snap_grid(grid + span)
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
                    grid = snap_grid(grid + span)
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
                    "tieStart": tie_start, "tieStop": tie_stop, "triplet": triplet,
                })
                grid = snap_grid(grid + span)

        # ---- アウフタクト（弱起）対応 ----
        # 曲頭の小節だけを対象に、実際の中身が1小節分に満たない場合は
        # アウフタクトとみなし、先頭に休符を1つ足して1小節分の長さに揃える
        # （アプリのMeasure型は全小節が同じグリッド数である前提のため、
        # 可変長の小節そのものを表現する手段が無い。休符で頭を埋めても、
        # 2小節目以降の絶対時刻・小節番号はズレない＝タイミング上は等価になる。
        # 見た目だけ、本来の採譜のような「短い1小節目」ではなく「頭に休符が
        # 入った1小節目」になる、既知のトレードオフ）。
        # <measure implicit="yes">が明示されていればそれを、無ければ
        # 「曲頭小節の中身がgridsPerMeasureに満たない」ことをアウフタクトの
        # 判定に使う（MuseScoreのエクスポートではimplicit属性が付かない
        # ことがあるため、両方を見る）。
        if m_idx == 0:
            is_implicit = measure_el.get("implicit") == "yes"
            grids_per_measure_for_pickup = grids_per_quarter * ((time_beats or 4) * 4 // (time_beat_type or 4))
            content_grids = grid  # このmeasureで実際に進んだグリッド数
            if 0 < content_grids < grids_per_measure_for_pickup and (is_implicit or content_grids > 0):
                padding = snap_grid(grids_per_measure_for_pickup - content_grids)
                for n in raw_notes:
                    n["startGrid"] = snap_grid(n["startGrid"] + padding)
                for h in harmonies:
                    h["offsetGrid"] = snap_grid(h["offsetGrid"] + padding)
                raw_notes.insert(0, {
                    "startGrid": 0, "duration": padding, "isRest": True,
                    "rowIdx": None, "accidental": None,
                    "tieStart": False, "tieStop": False, "triplet": False,
                })
                warnings.append(
                    f"小節1: アウフタクト（弱起）を検出しました。{content_grids}グリッド分の実音の前に"
                    f"{padding}グリッドの休符を挿入し、1小節分の長さに揃えました"
                    "（可変長の小節はデータモデル上表現できないため。再生タイミングは正しく、"
                    "見た目だけ本来の記譜と異なります）"
                )

        raw_measures.append(raw_notes)
        raw_harmonies.append(harmonies)
        raw_repeat_meta.append({
            "repeatForward": repeat_forward,
            "repeatBackward": repeat_backward,
            "repeatBackwardTimes": repeat_backward_times,
            "endingNumbers": ending_numbers,
        })

    # ---- 繰り返し記号・番括弧の展開 ----
    # アプリのMeasure[]はループ再生の概念を持たない単純な配列なので、「実際に
    # 演奏される順番」に小節を並べ直した1本のリストに展開する（繰り返し区間に
    # 含まれる小節は複数回、配列に重複して現れることになる）。
    play_order = expand_repeat_order(raw_repeat_meta)
    if len(play_order) != len(raw_repeat_meta):
        skipped_or_repeated = len(play_order) - len(raw_repeat_meta)
        warnings.append(
            f"繰り返し記号・番括弧を展開し、元{len(raw_repeat_meta)}小節 → 演奏順{len(play_order)}小節"
            f"（差分{skipped_or_repeated:+d}）に並べ替えました。"
        )
    raw_measures = [raw_measures[i] for i in play_order]
    raw_harmonies = [raw_harmonies[i] for i in play_order]

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
                # 3連符と通常の音符のタイは、1つの音価（durationとtripletの組）では表せないため結合しない。
                and raw_notes[i + 1]["triplet"] == n["triplet"]
            ):
                nxt = raw_notes[i + 1]
                merged.append({
                    "startGrid": n["startGrid"],
                    "duration": n["duration"] + nxt["duration"],
                    "isRest": False,
                    "rowIdxList": [n["rowIdx"]],
                    "accidentals": {str(n["rowIdx"]): n["accidental"]},
                    **({"triplet": True} if n["triplet"] else {}),
                })
                i += 2
                continue
            if not n["isRest"] and n["tieStart"] and not (
                i + 1 < len(raw_notes) and raw_notes[i + 1]["tieStop"]
            ):
                warnings.append(
                    f"小節{play_order[m_idx] + 1}(演奏順{m_idx + 1}小節目): 小節をまたぐタイ"
                    "（または対応するtie stopが同じ小節内に無いタイ）を検出しました。"
                    "Note型では1音に結合できないため2つの別音符のまま出力します。"
                    "再生時に本来無いはずの再アタックが入ります。"
                )
            if not n["isRest"] and n["tieStop"] and not n["tieStart"]:
                # 直前でマージ済み、またはマージできなかった残骸。単独のtie stopは
                # そのまま出力すればよい（上のマージ処理で拾えなかった＝小節をまたいだ側）。
                pass
            triplet_prop = {"triplet": True} if n["triplet"] else {}
            if n["isRest"]:
                merged.append({
                    "startGrid": n["startGrid"], "duration": n["duration"], "isRest": True,
                    "rowIdxList": [], "accidentals": {}, **triplet_prop,
                })
            else:
                merged.append({
                    "startGrid": n["startGrid"], "duration": n["duration"], "isRest": False,
                    "rowIdxList": [n["rowIdx"]], "accidentals": {str(n["rowIdx"]): n["accidental"]},
                    **triplet_prop,
                })
            i += 1
        total_grid = snap_grid(sum(note_span(x["duration"], x.get("triplet", False)) for x in merged))
        measures_out.append({
            "notes": merged,
            "harmonies": raw_harmonies[m_idx],
            "totalGrids": total_grid,
        })

    # ---- 調号・拍子をアプリの表現に変換 ----
    # fifths(五度圏上の位置) -> ルートのピッチクラス。負の値=フラット系。
    FIFTHS_TO_ROOT_PC = {0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1, -1: 5, -2: 10, -3: 3, -4: 8, -5: 1, -6: 6}
    key_root = FIFTHS_TO_ROOT_PC.get(fifths, 0) if fifths is not None else 0
    use_flats = (fifths is not None and fifths < 0)
    time_sig = {"numerator": time_beats or 4, "denominator": time_beat_type or 4}

    return {
        "root": key_root,
        "useFlats": use_flats,
        "timeSig": time_sig,
        "measures": measures_out,
    }, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("musicxml", help="入力MusicXMLファイル（.musicxml/.xml/.mxl）")
    parser.add_argument(
        "--grids-per-quarter", type=int, default=4,
        help="4分音符を何グリッドとして出力するか（StaffToFretboardの既定は4）",
    )
    args = parser.parse_args()

    result, warnings = parse_score(args.musicxml, args.grids_per_quarter)

    grids_per_measure = args.grids_per_quarter * (result["timeSig"]["numerator"] * 4 // result["timeSig"]["denominator"])
    for i, m in enumerate(result["measures"]):
        total = m["totalGrids"]
        flag = "" if total == grids_per_measure else f"  ⚠️ 合計{total}グリッド({grids_per_measure}グリッド想定)"
        print(f"// 小節{i + 1}: notes={len(m['notes'])} harmonies={len(m['harmonies'])}{flag}", file=sys.stderr)

    output = {
        "root": result["root"],
        "useFlats": result["useFlats"],
        "timeSig": result["timeSig"],
        "measures": [{"notes": m["notes"], "harmonies": m["harmonies"]} for m in result["measures"]],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))

    if warnings:
        print("\n--- 警告 ---", file=sys.stderr)
        for w in warnings:
            print(w, file=sys.stderr)


if __name__ == "__main__":
    main()
