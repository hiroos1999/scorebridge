"use client";

import { LANG_STORAGE_KEY, makeTr, type Lang } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eraser, Play, Plus, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { CHORD_TYPES } from "@/lib/chords";
import { noteSpan, snapGrid } from "@/lib/grid";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from "@/lib/templates";
import { PRACTICE_ORDERS, prefersFlats, transposeMeasures } from "@/lib/transpose";
import { applyPatternToMeasures, parsePattern, PATTERN_PRESETS } from "@/lib/patterns";
import { parseMusicXmlFile } from "@/lib/musicxmlImport";
import { deleteImportedSong, listImportedSongs, saveImportedSong, type ImportedSong } from "@/lib/importStorage";
import { SHAPE_ORDER, shapeNotes, shapeQualityFor, type ShapeName } from "@/lib/caged";
import IconButton from "@/components/IconButton";
import RhythmPractice from "@/components/RhythmPractice";
import { Switch, Stepper } from "@/components/IosControls";
import { ChordIcon, FlatIcon, RestIcon, SharpIcon, TripletIcon } from "@/components/MusicIcons";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const DEGREE_NAMES = ["Do", "Di", "Re", "Me", "Mi", "Fa", "Fi", "Sol", "Le", "La", "Te", "Ti"];
// コード基準の度数表記(半音数 → 表記)。ルート=1、3度=3/♭3、5度=5/♭5、7度=7/♭7。
const CHORD_DEGREE_NAMES = ["1", "♭9", "9", "♭3", "3", "11", "♭5", "5", "♭13", "13", "♭7", "7"];
const CHORD_DEGREE_ROLE = ["danger", "gray", "pro", "warning", "warning", "accent", "success", "success", "gray", "pro", "success", "success"];
const DEGREE_ROLE = [
  "danger",
  "gray",
  "pro",
  "gray",
  "warning",
  "accent",
  "gray",
  "success",
  "gray",
  "pro",
  "gray",
  "success",
];

const STAFF_VB_H = 300;
const STAFF_TOP = 100;
// レギュラーチューニング6弦ギターの実音域（6弦開放=実音E2〜1弦12フレット=実音E5）を、
// ギターの記譜慣習（実音より1オクターブ高く書く）に従って五線譜上に配置できるよう、
// 下は加線3本のE3、上は加線2本のC6まで対応する（rows配列は上から下へ並ぶ）。
const rowNames = [
  "C6", "B5", "A5", "G5", "F5", "E5", "D5", "C5", "B4", "A4",
  "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3", "E3",
];
const rowPcs = [0, 11, 9, 7, 5, 4, 2, 0, 11, 9, 7, 5, 4, 2, 0, 11, 9, 7, 5, 4];
const rows = rowNames.map((name, i) => ({
  y: STAFF_TOP - 40 + i * 10,
  name,
  pc: rowPcs[i],
  octave: parseInt(name.slice(-1), 10),
}));
const MIDDLE_LINE_Y = rows[8].y; // B4, 五線の中央線

// 五線からはみ出た音符に必要な加線のy座標を全て返す（記譜法通り、線の位置に
// あたる行のみに加線を引く。空間の位置の行は、その手前までの加線だけが
// 表示されれば正しい）。五線の上端(STAFF_TOP)・下端(STAFF_TOP+80)から
// 20px間隔（diatonic 2段ごと）で必要な本数だけ生成する。
function ledgerLineYsForRow(rowY: number): number[] {
  const staffTopLineY = STAFF_TOP;
  const staffBottomLineY = STAFF_TOP + 80;
  const ys: number[] = [];
  if (rowY < staffTopLineY) {
    const count = Math.floor((staffTopLineY - rowY) / 10 / 2);
    for (let k = 1; k <= count; k++) ys.push(staffTopLineY - 20 * k);
  } else if (rowY > staffBottomLineY) {
    const count = Math.floor((rowY - staffBottomLineY) / 10 / 2);
    for (let k = 1; k <= count; k++) ys.push(staffBottomLineY + 20 * k);
  }
  return ys;
}

// Bravura (SMuFL準拠, unitsPerEm=1000) のグリフ実測値。fontToolsのBoundsPenで
// public/fonts/bravura.otf から直接取得し、SMuFL公式コードポイント表
// (https://w3c.github.io/smufl/latest/tables/index.html) と突き合わせて
// 実際にレンダリングし目視確認済み。
const BRAVURA_UPM = 1000;
const BRAVURA_CODEPOINT: Record<string, number> = {
  gClef: 0xe050,
  timeSig0: 0xe080,
  timeSig1: 0xe081,
  timeSig2: 0xe082,
  timeSig3: 0xe083,
  timeSig4: 0xe084,
  timeSig5: 0xe085,
  timeSig6: 0xe086,
  timeSig7: 0xe087,
  timeSig8: 0xe088,
  timeSig9: 0xe089,
  noteheadWhole: 0xe0a2,
  noteheadHalf: 0xe0a3,
  noteheadBlack: 0xe0a4,
  accidentalFlat: 0xe260,
  accidentalNatural: 0xe261,
  accidentalSharp: 0xe262,
  restWhole: 0xe4e3,
  restHalf: 0xe4e4,
  restQuarter: 0xe4e5,
  rest8th: 0xe4e6,
  rest16th: 0xe4e7,
  flag8thUp: 0xe240,
  flag8thDown: 0xe241,
  flag16thUp: 0xe242,
  flag16thDown: 0xe243,
};
function bravuraChar(name: string): string {
  return String.fromCodePoint(BRAVURA_CODEPOINT[name]);
}
const BRAVURA_GLYPH_METRICS: Record<string, { yMin: number; yMax: number }> = {
  gClef: { yMin: -658, yMax: 1098 },
  timeSig0: { yMin: -250, yMax: 251 },
  timeSig1: { yMin: -250, yMax: 251 },
  timeSig2: { yMin: -257, yMax: 254 },
  timeSig3: { yMin: -251, yMax: 249 },
  timeSig4: { yMin: -250, yMax: 251 },
  timeSig5: { yMin: -251, yMax: 246 },
  timeSig6: { yMin: -249, yMax: 251 },
  timeSig7: { yMin: -250, yMax: 249 },
  timeSig8: { yMin: -259, yMax: 259 },
  timeSig9: { yMin: -249, yMax: 251 },
  noteheadWhole: { yMin: -125, yMax: 125 },
  noteheadHalf: { yMin: -125, yMax: 125 },
  noteheadBlack: { yMin: -125, yMax: 125 },
  accidentalFlat: { yMin: -175, yMax: 439 },
  accidentalNatural: { yMin: -335, yMax: 341 },
  accidentalSharp: { yMin: -348, yMax: 350 },
  restWhole: { yMin: -135, yMax: 9 },
  restHalf: { yMin: -2, yMax: 142 },
  restQuarter: { yMin: -375, yMax: 373 },
  rest8th: { yMin: -251, yMax: 174 },
  rest16th: { yMin: -500, yMax: 179 },
};
// SMuFL標準アンカーポイント（metadata.jsonのglyphsWithAnchorsより、単位=スタッフスペース。
// 1スタッフスペース = unitsPerEm/4 = 250 units）。符幹の符頭への接続位置に使う。
const STAFF_SPACE_UNITS = BRAVURA_UPM / 4;
const STEM_UP_SE = { dx: 1.18 * STAFF_SPACE_UNITS, dy: 0.168 * STAFF_SPACE_UNITS };
const STEM_DOWN_NW = { dx: 0, dy: -0.168 * STAFF_SPACE_UNITS };
const STEM_LENGTH_UNITS = 875; // SMuFLの'stem'グリフ(U+E210)自体の高さ

// 符頭の高さ(250 units)が五線の間隔(20px)にちょうど一致するよう実測の上で調整した値。
// (レンダリング結果を画素解析して算出。詳細は実装ログを参照)
const BRAVURA_FONT_SIZE = 80;

function baselineYForGlyphCenter(targetY: number, fontSize: number, centerUnits: number) {
  return targetY + centerUnits * (fontSize / BRAVURA_UPM);
}
function glyphBBoxCenterUnits(glyphName: string) {
  const m = BRAVURA_GLYPH_METRICS[glyphName];
  if (!m) {
    // BRAVURA_GLYPH_METRICSに無いグリフ名が渡されるのは、本来は呼び出し側の
    // バグ（未対応の音価等をこの関数まで素通しした）を意味する。ここで例外に
    // せず中央(0)にフォールバックし、描画自体は止めない。
    console.warn(`glyphBBoxCenterUnits: BRAVURA_GLYPH_METRICSに"${glyphName}"が見つかりません。中央(0)にフォールバックします。`);
    return 0;
  }
  return (m.yMin + m.yMax) / 2;
}

// F,C,G,D,A,E,B(シャープ) / B,E,A,D,G,C,F(フラット)の順で、rows配列内の
// 対応する行（F5,C5,G5,D5,A4,E5,B4 / B4,E5,A4,D5,G5,C5,F5）のインデックス。
const SHARP_KEY_ROWS = [4, 7, 3, 6, 9, 5, 8];
const FLAT_KEY_ROWS = [8, 5, 9, 6, 3, 7, 4];
const SHARP_COUNT: Record<number, number> = { 0: 0, 2: 2, 4: 4, 7: 1, 9: 3, 11: 5 };
const FLAT_COUNT: Record<number, number> = { 0: 0, 3: 3, 5: 1, 8: 4, 10: 2 };
const AMBIG_SHARP: Record<number, number> = { 1: 7, 6: 6 };
const AMBIG_FLAT: Record<number, number> = { 1: 5, 6: 6 };

function getKeySignature(root: number, useFlats: boolean): { type: "sharp" | "flat"; count: number } {
  if (SHARP_COUNT[root] !== undefined && FLAT_COUNT[root] === undefined) {
    return { type: "sharp", count: SHARP_COUNT[root] };
  }
  if (FLAT_COUNT[root] !== undefined && SHARP_COUNT[root] === undefined) {
    return { type: "flat", count: FLAT_COUNT[root] };
  }
  if (AMBIG_SHARP[root] !== undefined) {
    return useFlats ? { type: "flat", count: AMBIG_FLAT[root] } : { type: "sharp", count: AMBIG_SHARP[root] };
  }
  return { type: "sharp", count: 0 };
}

const strings = [
  { open: 4, octave: 4, num: 1, label: "E" },
  { open: 11, octave: 3, num: 2, label: "B" },
  { open: 7, octave: 3, num: 3, label: "G" },
  { open: 2, octave: 3, num: 4, label: "D" },
  { open: 9, octave: 2, num: 5, label: "A" },
  { open: 4, octave: 2, num: 6, label: "E" },
];
const FRETS = 17; // 描画・データの最大フレット(通常表示は viewFrets で12/17を切り替える)

function degreeFor(pc: number, root: number) {
  return (((pc - root) % 12) + 12) % 12;
}

function colorFor(role: string): [string, string] {
  const map: Record<string, [string, string]> = {
    danger: ["var(--danger)", "var(--on-danger)"],
    warning: ["var(--warning)", "var(--on-warning)"],
    success: ["var(--success)", "var(--on-success)"],
    pro: ["var(--pro)", "var(--on-pro)"],
    accent: ["var(--accent)", "var(--on-accent)"],
    gray: ["var(--gray)", "var(--on-gray)"],
  };
  return map[role] || map.gray;
}

const QUARTER_NOTE_MS = 500;

// ---- サンプル音源（ギター/ベースの単音mp3）----
// public/audio/melody, public/audio/bass に、音名ごとの単音サンプルを配置している
// （出典: FluidR3_GM soundfont, via github.com/gleitz/midi-js-soundfonts, MIT License）。
// ファイル名は "C4.mp3" のような音名+オクターブ（フラット表記、例: Eb3）。
// この曲アプリのabsPitch表記（A4=57）はscientific pitch notation（C4=中央ド）と
// 一致しているため、そのまま音名に変換できる。
const SAMPLE_PC_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function absPitchToSampleName(absPitch: number): string {
  const octave = Math.floor(absPitch / 12);
  const pc = ((absPitch % 12) + 12) % 12;
  return `${SAMPLE_PC_NAMES_FLAT[pc]}${octave}`;
}

// メロディ用サンプルの音域: 五線がカバーするE3〜C6（rows参照）に、臨時記号による
// ±半音の余裕を持たせる。ベース用サンプルの音域は、ウォーキングベース生成で
// 使っているBASS_MIN_ABS_PITCH〜BASS_MAX_ABS_PITCHとそのまま揃える。
const MELODY_SAMPLE_MIN_ABS_PITCH = 39; // Eb3
const MELODY_SAMPLE_MAX_ABS_PITCH = 73; // Db6

// ピアノ風コンピング用サンプルの音域: buildChordVoicing()が生成しうる全ての
// 組み合わせ（12ルート×7コードタイプ×4転回形）を実際に列挙し、1オクターブ
// 下げた（COMP_OCTAVE_SHIFT）上での絶対最小・最大からC3〜Bb4を採用した
// （メロディの音域(E3〜C6)より低め＝ピアノ伴奏らしい、かつベース(C2〜G3)とも
// 大きくは被らない帯域）。
const COMP_SAMPLE_MIN_ABS_PITCH = 36; // C3
const COMP_SAMPLE_MAX_ABS_PITCH = 58; // Bb4
const COMP_OCTAVE_SHIFT = -12;
// コンピングは「コード区間いっぱい鳴り続ける」のではなく、コード開始時に
// 短く鳴らすスタブにする（実際のコード区間はharmonyによっては数小節にも
// 及ぶため、そのまま伸ばすとサステインパッドのようになってしまう）。
const COMP_STAB_MAX_SEC = 0.45;

type SampleInstrument = "melody" | "bass" | "comp";

// absPitchちょうどのサンプルが無い場合（音域外）は、範囲内で最も近い音の
// サンプルをplaybackRateでピッチシフトして代用する。範囲内であれば必ず実サンプル
// そのままの音高で鳴る。
function clampToSampleRange(absPitch: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, absPitch));
}

// ---- ドラムサンプル ----
// public/audio/drums に、パーツごとに1発ずつの単発サンプルを配置している
// （出典: sonic-pi プロジェクトが freesound.org から収集したCC0音源の一部を、
// 個別に選んでmp3化。sonic-pi自体はfreesound.orgの各投稿者による個別CC0表示を
// そのまま踏襲しているだけなので、実質の出典はfreesound.org）。
// ride: ride_tri.flac (trivialAccapella), hihat: drum_cymbal_pedal.flac (menegass),
// kick: bd_jazz.flac (tripjazz), snare: drum_snare_soft.flac (menegass)
const DRUM_VOICES = ["ride", "hihat", "kick", "snare"] as const;
type DrumVoice = (typeof DRUM_VOICES)[number];
// パーツごとの再生音量。ドラムのサンプル(freesoundの生録音)はmelody/bass/comp
// のサンプルよりずっとホットに正規化されている（実測max_volume: ride -3.1dB,
// hihat -2.5dB, kick -0.9dB, snare -5.6dB。対してmelody -18.1dB, bass -18.2dB,
// comp -20.8dB）。同じgain値を使うとドラムだけ突出して聞こえるため、各サンプル
// の実測ピークから逆算し、他パートの実効ピーク(melody実効-19dB、bass実効-13dB
// 前後、comp実効-28dB前後)に対して「ride/hihatは常時鳴るので控えめに、
// kick/snareは1小節に1回程度なので少しだけ前に出す」狙いの実効ピークになる
// よう決めた値（ride/hihat≈-19〜-20dB、kick/snare≈-16〜-17dB）。
const DRUM_VOICE_GAIN: Record<DrumVoice, number> = { ride: 0.14, hihat: 0.17, kick: 0.18, snare: 0.27 };
// ライドシンバルは生音のサステインが約4.7秒と長く、パターン通り連打すると
// 減衰音が積み重なって濁ってしまうため、鳴り始めてから約1.3秒でフェードアウト
// させて次の1打に道を譲らせる（他のパーツは元々短い一発音なのでそのまま）。
const DRUM_VOICE_MAX_DURATION_SEC: Partial<Record<DrumVoice, number>> = { ride: 1.3 };

// 音価は16分音符=1グリッドとしたグリッド数で表す。全音符=16, 2分=8, 4分=4, 8分=2, 16分=1。
const DURATION_CYCLE = [16, 8, 4, 2, 1];
const DEFAULT_DURATION = 4;
function nextDurationInCycle(d: number): number {
  const idx = DURATION_CYCLE.indexOf(d);
  return DURATION_CYCLE[(idx + 1) % DURATION_CYCLE.length];
}
function durationToMs(durationGrids: number) {
  return (durationGrids / 4) * QUARTER_NOTE_MS;
}
function gridToMs(grid: number) {
  return (grid / 4) * QUARTER_NOTE_MS;
}

// メロディ（音価に応じて左から詰めて配置される単音・手動積み上げ和音）のみを表す。
// startGridは自分が属するMeasure内でのローカルなグリッド番号（0〜gridsPerMeasure-1）。
// lib/templates.ts（曲テンプレートデータ）からも参照するためexportする。
export type Note = {
  startGrid: number;
  duration: number;
  isRest: boolean;
  rowIdxList: number[]; // 単音なら要素1つ、手動で積み上げた和音なら複数
  accidentals: Record<number, number>; // rowIdx -> 臨時記号（未設定キーは0扱い）
  // 3連符かどうか。durationは記譜上の音価のまま、実際に占める長さはその2/3になる
  // （lib/grid.tsのnoteSpan参照）。省略時は通常の音符（既存データとの互換のため任意）。
  triplet?: boolean;
};

// コード選択UIで配置されるコードシンボル。MusicXMLのharmony要素に相当し、
// 音価を持たず「小節内のどのタイミングか」「ルート」「コードの種類」
// 「転回形（分数コードのベース音に相当）」だけを持つ、notesとは独立したデータ。
export type Harmony = {
  offsetGrid: number; // 小節内でのタイミング（グリッド単位、MusicXMLのoffsetに相当）
  root: number; // ルート音のピッチクラス
  kind: string; // コードタイプ（maj7, m7, 7, dim, m7b5等。MusicXMLのkind相当）
  inversion: number; // 転回形（0=基本形, 1=第1転回形…）。MusicXMLのinversion相当
};

export type Measure = {
  notes: Note[];
  harmonies: Harmony[];
};

// 基本的な7thコード（ルートからの半音間隔）。lib/chords.tsに定義（理由はそちらの
// コメント参照: lib/templates.tsとの循環importを避けるため）。
const CHORD_TYPE_LABELS: Record<string, string> = {
  maj7: "maj7",
  m7: "m7",
  "7": "7",
  dim: "dim",
  m7b5: "m7♭5",
  mMaj7: "m(maj7)",
  "6": "6",
  m6: "m6",
};
// 転回形のラベル（インデックス=ベースになる構成音の順位。0=ルート）。
// 3和音なら第2転回形まで、4和音（7thコード）なら第3転回形まで存在する。
const INVERSION_LABELS = ["Root position", "1st inversion", "2nd inversion", "3rd inversion"];

// 五線上の段(rows)は自然音名のみを持つため、半音（黒鍵相当）のピッチクラスを
// どの自然音の段に臨時記号を付けて表すかのテーブル（#表記/♭表記どちらで書くか）。
const CHROMATIC_SPELLING: Record<number, { sharpBase: number; flatBase: number }> = {
  1: { sharpBase: 0, flatBase: 2 },
  3: { sharpBase: 2, flatBase: 4 },
  6: { sharpBase: 5, flatBase: 7 },
  8: { sharpBase: 7, flatBase: 9 },
  10: { sharpBase: 9, flatBase: 11 },
};
function naturalPcAndAccidentalForPc(pc: number, useFlats: boolean): { naturalPc: number; accidental: number } {
  const spelling = CHROMATIC_SPELLING[pc];
  if (!spelling) return { naturalPc: pc, accidental: 0 };
  return useFlats
    ? { naturalPc: spelling.flatBase, accidental: -1 }
    : { naturalPc: spelling.sharpBase, accidental: 1 };
}

// 指定した自然音のピッチクラス・オクターブに対応する rows のインデックスを探す。
// 五線の表示範囲(A5〜C4)に収まらない場合は近いオクターブにフォールバックする。
function findRowIndex(naturalPc: number, octave: number): number {
  let idx = rows.findIndex((r) => r.pc === naturalPc && r.octave === octave);
  if (idx !== -1) return idx;
  for (const delta of [1, -1, 2, -2]) {
    idx = rows.findIndex((r) => r.pc === naturalPc && r.octave === octave + delta);
    if (idx !== -1) return idx;
  }
  idx = rows.findIndex((r) => r.pc === naturalPc);
  return idx !== -1 ? idx : 8;
}

// ルート音・コード種類・転回形から、各構成音を「直前の音より真上で一番近い」音に
// なるよう積み上げていく簡易ボイシング（近い音域にまとまった自然な配置になる）。
// 転回形は、構成音の並び順（何の音が一番下＝ベースになるか）をローテーションする
// ことで表現する。例えばmaj7=[root,3rd,5th,7th]の第1転回形なら
// [3rd,5th,7th,root]の順で一番下から積み上げる（rootは1オクターブ上に来る）。
// buildChordVoicing（指板・五線譜表示用）とplayCompChord（コンピング再生用）の
// 両方で使う、絶対ピッチ(absPitch)自体の積み上げ計算。
function buildChordVoicingAbsPitches(rootPc: number, chordType: string, inversion = 0): number[] {
  const intervals = CHORD_TYPES[chordType];
  const inv = Math.min(Math.max(inversion, 0), intervals.length - 1);
  const rotatedIntervals = [...intervals.slice(inv), ...intervals.slice(0, inv)];
  const baseOctave = 4;
  let prevAbs = baseOctave * 12 + ((rootPc + rotatedIntervals[0]) % 12);
  const absPitches = [prevAbs];
  for (let i = 1; i < rotatedIntervals.length; i++) {
    const pc = (rootPc + rotatedIntervals[i]) % 12;
    let abs = prevAbs + 1;
    while (((abs % 12) + 12) % 12 !== pc) abs++;
    absPitches.push(abs);
    prevAbs = abs;
  }
  return absPitches;
}

function buildChordVoicing(
  rootPc: number,
  chordType: string,
  useFlats: boolean,
  inversion = 0
): { rowIdx: number; accidental: number }[] {
  const absPitches = buildChordVoicingAbsPitches(rootPc, chordType, inversion);
  return absPitches.map((abs) => {
    const octave = Math.floor(abs / 12);
    const pc = ((abs % 12) + 12) % 12;
    const { naturalPc, accidental } = naturalPcAndAccidentalForPc(pc, useFlats);
    return { rowIdx: findRowIndex(naturalPc, octave), accidental };
  });
}

export type TimeSignature = { numerator: number; denominator: number };
// 分母が8かつ分子が3の倍数（3/8, 6/8, 9/8, 12/8等）を複合拍子として扱う簡易判定。
// 複合拍子では1拍＝付点4分音符（8分音符3つ＝グリッド6単位）になるため、
// 連桁のグループ分け単位もこれに合わせて切り替える（単純拍子は4グリッド＝4分音符1つ分）。
function isCompoundMeter(ts: TimeSignature): boolean {
  return ts.denominator === 8 && ts.numerator % 3 === 0;
}

// ---- ウォーキングベースライン生成 ----
// ベースの音域（メロディよりおおよそ1〜2オクターブ下を狙う）。C0=0とする
// absPitch表記で、C2(24)〜G3(43)のおよそ1.5オクターブに収める。
const BASS_MIN_ABS_PITCH = 24;
const BASS_MAX_ABS_PITCH = 43;
const BASS_ANCHOR_ABS_PITCH = 28; // E2。再生開始時・直前音がまだ無い場合の基準点。

// 指定ピッチクラスのうち、直前のベース音(prevAbsPitch)から見て最も近い音高を、
// ベース音域内から選ぶ（buildChordVoicingの「常に直前より真上」とは違い、上下
// どちらの方向にも動けるようにして、実際のウォーキングベースらしい自然な
// 音のつながりにする）。
function nearestBassPitch(pc: number, prevAbsPitch: number): number {
  let best = BASS_ANCHOR_ABS_PITCH;
  let bestDist = Infinity;
  for (let oct = 0; oct <= 6; oct++) {
    const candidate = oct * 12 + pc;
    if (candidate < BASS_MIN_ABS_PITCH || candidate > BASS_MAX_ABS_PITCH) continue;
    const dist = Math.abs(candidate - prevAbsPitch);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

// harmonies（コード進行）から、1拍1音のウォーキングベースラインを生成する。
// 各小節のharmoniesを「曲頭からの絶対グリッド位置」の1本の時系列に並べ直し、
// harmonies が置かれていない区間（小節をまたいでも）は直前のコードが鳴り続けている
// ものとして扱う（そうしないと、コードを置いていない小節でベースが途切れてしまう）。
// 各コードの持続拍数に応じたパターン:
//   1拍だけ:  ルートのみ
//   2拍:      ルート → 次のコードへのアプローチ音（半音下）
//   3拍以上:  ルート → 3度→5度→(7度)…とコード構成音を巡回 → 最後の拍だけ
//             次のコードへのアプローチ音（次のコードが無い最後の区間はルートを維持）
function buildWalkingBassEvents(
  measures: Measure[],
  gridsPerMeasure: number,
  timeSig: TimeSignature
): { atGrid: number; durationGrid: number; absPitch: number }[] {
  const beatUnit = isCompoundMeter(timeSig) ? 6 : 4;

  const flat: { atGrid: number; root: number; kind: string }[] = [];
  measures.forEach((m, mi) => {
    m.harmonies.forEach((h) => {
      flat.push({ atGrid: mi * gridsPerMeasure + h.offsetGrid, root: h.root, kind: h.kind });
    });
  });
  if (flat.length === 0) return [];
  flat.sort((a, b) => a.atGrid - b.atGrid);

  const totalGrid = measures.length * gridsPerMeasure;
  const events: { atGrid: number; durationGrid: number; absPitch: number }[] = [];
  let prevAbsPitch = BASS_ANCHOR_ABS_PITCH;

  flat.forEach((h, i) => {
    const nextAtGrid = i + 1 < flat.length ? flat[i + 1].atGrid : totalGrid;
    const durationGrid = nextAtGrid - h.atGrid;
    if (durationGrid <= 0) return;
    const beats = Math.max(1, Math.round(durationGrid / beatUnit));
    const spacing = durationGrid / beats;
    const nextRoot = i + 1 < flat.length ? flat[i + 1].root : null;
    const intervals = CHORD_TYPES[h.kind] ?? [0];

    for (let b = 0; b < beats; b++) {
      let pc: number;
      if (b === 0) {
        pc = h.root;
      } else if (b === beats - 1 && beats > 1) {
        // 次のコードのルートへ半音下から進むアプローチ音（次が無ければルートを維持）。
        pc = nextRoot !== null ? (((nextRoot - 1) % 12) + 12) % 12 : h.root;
      } else {
        const chordToneIdx = 1 + ((b - 1) % Math.max(1, intervals.length - 1));
        pc = (h.root + (intervals[chordToneIdx] ?? 0)) % 12;
      }
      const absPitch = nearestBassPitch(pc, prevAbsPitch);
      prevAbsPitch = absPitch;
      events.push({
        atGrid: h.atGrid + Math.round(b * spacing),
        durationGrid: Math.round(spacing),
        absPitch,
      });
    }
  });

  return events;
}

// ---- ドラムパターン生成 ----
// まずはシンプルな4/4のジャズ基本パターンのみ対応（それ以外の拍子は無音のまま）。
// ライド・ハイハットのグリッド量子化（16分=1グリッド）とは別に、スウィングの
// 「裏」は3連符換算で1拍の2/3の位置に来るため、絶対ms時間で直接計算する
// （小節・音符のスケジューリングと同じ絶対時間軸に載せて、他パートと同期させる）。
type DrumEvent = { atMs: number; measureIndex: number; voice: DrumVoice };

function buildDrumEvents(
  measureCount: number,
  measureDurationMs: number,
  quarterNoteMs: number,
  timeSig: TimeSignature
): DrumEvent[] {
  if (timeSig.numerator !== 4 || timeSig.denominator !== 4) return [];

  const swingMs = quarterNoteMs * (2 / 3); // 3連符の2つ目=スウィングした裏拍の位置
  const events: DrumEvent[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const measureStartMs = measureIndex * measureDurationMs;
    const beatMs = (beat: number) => measureStartMs + beat * quarterNoteMs;

    // ライドシンバル「チーン・チキ・チーン・チキ」: 1拍目・2拍目裏・3拍目・4拍目裏
    events.push({ atMs: beatMs(0), measureIndex, voice: "ride" });
    events.push({ atMs: beatMs(1) + swingMs, measureIndex, voice: "ride" });
    events.push({ atMs: beatMs(2), measureIndex, voice: "ride" });
    events.push({ atMs: beatMs(3) + swingMs, measureIndex, voice: "ride" });

    // フットハイハット: 2拍目・4拍目のアクセント
    events.push({ atMs: beatMs(1), measureIndex, voice: "hihat" });
    events.push({ atMs: beatMs(3), measureIndex, voice: "hihat" });

    // キック・スネアは控えめに、1小節に1回ずつだけ（キック=1拍目、スネア=3拍目の軽いコンプ）。
    events.push({ atMs: beatMs(0), measureIndex, voice: "kick" });
    events.push({ atMs: beatMs(2), measureIndex, voice: "snare" });
  }
  return events;
}

const TIME_SIG_OPTIONS: TimeSignature[] = [
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 2, denominator: 4 },
  { numerator: 3, denominator: 8 },
  { numerator: 6, denominator: 8 },
];

// 前回縮小した五線譜の高さ（見た目のスケール）を固定し、横幅だけが
// 1グリッドの幅に応じて自然に伸びるようにするための基準高さ(px)。
// viewBox(STAFF_VB_W/STAFF_VB_H)自体は変えず、CSS表示サイズのみ縮小して
// 画面の縦占有量を抑える。クリック判定はgetBoundingClientRect()を使って
// 描画サイズから動的に座標変換しているため、この値を変えても影響しない
// （handleStaffClick参照）。
const STAFF_RENDER_HEIGHT_PX = 240;
const NOTE_AREA_MARGIN_RIGHT = 20;
// 小節数はもう固定ではなく、measures配列の長さ（可変長）で決まる。
// これは起動時・「クリア」時の初期小節数としてのみ使う。
const INITIAL_MEASURE_COUNT = 2;

// 小節線の向こうに次の小節の頭をプレビュー表示するための設定。
// 拍子によってGRID_UNIT_WIDTHが変わっても表示幅全体(STAFF_VB_W)は
// 拍子に依存させたくないため、プレビューに使う横幅は固定ピクセル値にし、
// その範囲に収まる分だけ次の小節の音符を（startGridで）表示する
// （「1拍分程度で構わない」という仕様どおり、拍子によって実際に見える
// 拍数は多少前後する）。見た目は現在の小節と同じ濃さ・大きさにし、
// クリック編集の対象にならない点だけが機能面での違いとする。
// 幅は、拍の単位が最も広くなるケース（2/4の4分音符1拍、6/8の付点4分音符
// 1拍はどちらも192px相当）でも1拍分の連桁グループがまるごと収まるよう
// 余裕を持たせている。
const PREVIEW_GAP_PX = 16;
const PREVIEW_WIDTH_PX = 200;
const PREVIEW_SCALE = 1;
const PREVIEW_OPACITY = 1;

// 音符が置かれるエリア（LEFTから小節末尾まで）の表示幅を拍子によらず
// 常に一定に保つための固定値。1グリッドあたりの幅(GRID_UNIT_WIDTH)は
// このNOTE_AREA_WIDTHを1小節分のグリッド数で割って動的に算出する
// （拍数が少ない拍子ほどグリッド1つが太くなり、多い拍子ほど細くなる）。
const NOTE_AREA_WIDTH = 384;

// ト音記号・拍子記号は調号（#/bの数）が変わっても位置がずれないよう、
// 常に固定のx座標に描画する。調号の#/bはクレフの右側から固定間隔で
// 可変長に並び、最大想定数（7個: 理論上の最大調号）でも拍子記号と
// 重ならないよう、拍子記号の位置はその最大幅を見込んだ固定値にしてある。
const CLEF_X = 0;
// コード名(Cmaj7等)を表示する固定y座標。ト音記号の最上部(約y=72)・調号・
// 五線範囲内の最高音(C6, y=60)よりもはっきり上になるよう、音符の実際の
// 高さに関わらず常にこの固定位置に表示する（実際の楽譜のコードネーム表記と
// 同様、音符の高さに追従させない）。
const CHORD_LABEL_Y = 40;
// 調号(#/♭)のグリフサイズ。通常のBRAVURA_FONT_SIZEより一回り小さくする。
const KEY_SIG_FONT_SIZE = BRAVURA_FONT_SIZE * 0.75;
const KEY_SIG_START_X = 64;
const KEY_SIG_SPACING = 8;
const MAX_KEY_SIG_COUNT = 7;
// KEY_SIG_FONT_SIZEで実測したaccidentalSharp/Flatグリフの半幅相当。
const KEY_SIG_ACCIDENTAL_HALF_WIDTH = 7.5;
const KEY_SIG_TO_TIME_SIG_MARGIN = 5;
const TIME_SIG_HALF_WIDTH = 19;
const TIME_SIG_CENTER_X =
  KEY_SIG_START_X +
  (MAX_KEY_SIG_COUNT - 1) * KEY_SIG_SPACING +
  KEY_SIG_ACCIDENTAL_HALF_WIDTH +
  KEY_SIG_TO_TIME_SIG_MARGIN +
  TIME_SIG_HALF_WIDTH;
const TIME_SIG_RESERVED_W = 95;
// 拍子記号の右側の余白を確保した上での、音符エリア開始位置（固定）。
const LEFT_FIXED = TIME_SIG_CENTER_X + TIME_SIG_RESERVED_W / 2;
// 休符は、五線の間隔（BRAVURA_FONT_SIZE=80で校正済み）は変えずに、見た目の
// グリフサイズだけを現在の80%程度に縮小する。クリック判定などの座標計算は
// rows[].yやGRID_UNIT_WIDTHなど別の値に基づくため、この縮小の影響を受けない。
const REST_VISUAL_SCALE = 0.8;
const REST_FONT_SIZE = BRAVURA_FONT_SIZE * REST_VISUAL_SCALE;
// 符頭は視認性のため、五線の間隔からはみ出しすぎない範囲でやや大きめにする
// （0.8倍だった従来サイズの約1.125倍 = 全体としては元のBRAVURA_FONT_SIZEの0.9倍）。
// 符幹・連桁・旗の位置/長さはすべてこのNOTEHEAD_FONT_SIZEから算出されるため、
// 符頭の拡大に自動的に追従する。
const NOTEHEAD_VISUAL_SCALE = 0.9;
const NOTEHEAD_FONT_SIZE = BRAVURA_FONT_SIZE * NOTEHEAD_VISUAL_SCALE;
// 音符の臨時記号のフォントサイズは通常のグリフよりさらに一回り小さくする。
const NOTE_ACCIDENTAL_FONT_SIZE = BRAVURA_FONT_SIZE * 0.55;

// devの検証画面など、テンプレート選択UIを経由せずに初期データを直接
// 差し込みたい場合に使うprop。省略時は従来通りの空の初期状態になるため、
// 通常のapp/page.tsx（<StaffToFretboard />をprops無しで呼ぶ）の挙動は変わらない。
export type StaffToFretboardInitialData = {
  root: number;
  useFlats: boolean;
  timeSig: TimeSignature;
  measures: Measure[];
};

export default function StaffToFretboard({
  initialTemplate,
}: { initialTemplate?: StaffToFretboardInitialData } = {}) {
  const [useFlats, setUseFlats] = useState(initialTemplate?.useFlats ?? true);
  const [root, setRoot] = useState(initialTemplate?.root ?? 0);
  const [timeSig, setTimeSig] = useState<TimeSignature>(
    initialTemplate?.timeSig ?? { numerator: 4, denominator: 4 }
  );
  // メロディ(notes)とコードシンボル(harmonies)は、MusicXMLのmeasure要素に倣い
  // 小節ごとに独立したデータとして持つ。互いの追加・削除・編集は一切影響しない。
  // measures配列は固定長ではなく、＋/削除ボタンで自由に伸縮する可変長配列。
  const [measures, setMeasures] = useState<Measure[]>(
    () =>
      initialTemplate?.measures ??
      Array.from({ length: INITIAL_MEASURE_COUNT }, () => ({ notes: [], harmonies: [] }))
  );
  const [selectedNoteKey, setSelectedNoteKey] = useState<number | null>(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  // 「和音を配置」が次にどのoffsetGridへ置かれるかを示すカーソル。notesの配置・
  // 削除ロジックとは無関係に、五線譜クリックのたびに実際にクリックされたグリッド
  // 位置がそのまま入る（空きエリアクリックでnoteが末尾に自動追加される場合も、
  // クリックした位置自体はここに反映される）。
  const [chordTargetGrid, setChordTargetGrid] = useState(0);
  // 新規配置する音符・休符のデフォルト音価。音価切り替えボタンで変更した
  // 音価を次の新規配置にも引き継ぐ（起動時・クリア後はDEFAULT_DURATIONに戻す）。
  const [defaultDuration, setDefaultDuration] = useState(DEFAULT_DURATION);
  const [restMode, setRestMode] = useState(false);
  const [mode, setMode] = useState<"tones" | "rhythm">("tones");
  const [editOpen, setEditOpen] = useState(false);
  const [shapesOn, setShapesOn] = useState(true);
  // 初期画面をすっきりさせるための折りたたみ(機能自体は変えず、見せ方だけ)
  // 表示言語(日本語/英語)。選択は端末に保存する
  const [lang, setLang] = useState<Lang>("ja");
  useEffect(() => {
    const load = () => {
      try {
        const v = localStorage.getItem(LANG_STORAGE_KEY);
        if (v === "ja" || v === "en") setLang(v);
      } catch {}
    };
    load();
  }, []);
  const tr = makeTr(lang);
  const changeLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch {}
  };
  const [scoreOpen, setScoreOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [sheetBottom, setSheetBottom] = useState(0);
  const boardRef = useRef<HTMLElement>(null);
  const [focusOn, setFocusOn] = useState(true);
  const [viewFrets, setViewFrets] = useState<12 | 17>(12);
  const [focusLoState, setFocusLoState] = useState(0);
  const [focusW, setFocusW] = useState(5);
  const [labelMode, setLabelMode] = useState<"key" | "chord">("chord");
  const [shapeSel, setShapeSel] = useState<ShapeName | null>(null);
  // ONの間、新規配置する音符・休符を3連符にする（休符モードと同様のトグル）。
  const [tripletMode, setTripletMode] = useState(false);
  const [fullFeedback, setFullFeedback] = useState(false);
  const [currentMeasureIndex, setCurrentMeasureIndex] = useState(0);
  // MusicXMLインポート（サーバーには送信せず、ブラウザのIndexedDBにのみ保存する）。
  const [importedSongs, setImportedSongs] = useState<ImportedSong[]>([]);
  const [selectedImportId, setSelectedImportId] = useState("");
  // パターン適用(コードの度数を並べたメロディの自動生成)の入力状態
  const [patternText, setPatternText] = useState("3 7");
  const [patternOctave, setPatternOctave] = useState(0);
  const [patternScope, setPatternScope] = useState<"all" | "measure" | "from">("all");
  const [patternError, setPatternError] = useState(false);
  // 12キー練習: 譜面を次々に移調しながら続けて再生する
  const [practiceMode, setPracticeMode] = useState<"off" | "fourths" | "chromatic">("off");
  const [practiceStatus, setPracticeStatus] = useState("");
  const practiceRef = useRef<{ measures: Measure[]; root: number; useFlats: boolean } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastImportWarnings, setLastImportWarnings] = useState<{ fileName: string; warnings: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 表示中の小節のnotes/harmoniesだけを操作する各種ハンドラから使う短縮参照。
  const notes = measures[currentMeasureIndex].notes;
  const harmonies = measures[currentMeasureIndex].harmonies;
  function updateMeasureNotes(measureIndex: number, updater: (notes: Note[]) => Note[]) {
    setMeasures((prev) => prev.map((m, i) => (i === measureIndex ? { ...m, notes: updater(m.notes) } : m)));
  }
  function updateMeasureHarmonies(measureIndex: number, updater: (harmonies: Harmony[]) => Harmony[]) {
    setMeasures((prev) =>
      prev.map((m, i) => (i === measureIndex ? { ...m, harmonies: updater(m.harmonies) } : m))
    );
  }
  const [chordRoot, setChordRoot] = useState(0);
  const [chordType, setChordType] = useState<string>("maj7");
  const [chordInversion, setChordInversion] = useState(0);

  // スマホなど狭い画面では指板を0〜7フレットに絞り、音の丸を読める大きさで表示する
  const [narrowFretboard, setNarrowFretboard] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrowFretboard(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // 狭い画面では五線譜の表示高さを抑え、指板と同時に見えるようにする
  // 譜面の大きさ(小/中/大)。縦持ちのスマホでは、小さくすると次の小節まで見える。選択は端末に保存する
  const PHONE_STAFF_HEIGHTS = [140, 170, 200] as const;
  const [phoneStaffSize, setPhoneStaffSize] = useState(0);
  useEffect(() => {
    const load = () => {
      try {
        const v = parseInt(localStorage.getItem("sb-staff-size") ?? "", 10);
        if (v >= 0 && v <= 2) setPhoneStaffSize(v);
      } catch {}
    };
    load();
  }, []);
  const staffH = narrowFretboard ? PHONE_STAFF_HEIGHTS[phoneStaffSize] : STAFF_RENDER_HEIGHT_PX;
  // 五線譜の表示領域の幅。画面が広いときは、表示中の小節の右側に後続の小節も並べて表示する。
  const staffWrapRef = useRef<HTMLDivElement>(null);
  // 入力・再生中の小節が変わったら、その小節が見える位置まで横スクロールする。
  // （1小節目は先頭=ト音記号の位置まで戻す）
  useEffect(() => {
    const el = staffWrapRef.current;
    if (!el) return;
    const scale = staffH / STAFF_VB_H;
    const slotLeftPx = (LEFT_FIXED + currentMeasureIndex * (NOTE_AREA_WIDTH + PREVIEW_GAP_PX)) * scale;
    const target = currentMeasureIndex === 0 ? 0 : Math.max(0, slotLeftPx - 70 * scale);
    const visible = el.scrollLeft <= slotLeftPx - 20 && slotLeftPx + NOTE_AREA_WIDTH * scale <= el.scrollLeft + el.clientWidth;
    if (!visible) el.scrollTo({ left: target, behavior: "smooth" });
  }, [currentMeasureIndex, measures.length, staffH]);
  const [isPlaying, setIsPlaying] = useState(false);
  // ローカルなstartGridは小節をまたいで一意ではないため、どの小節の音符かも保持する。
  const [playingNoteKey, setPlayingNoteKey] = useState<{ measureIndex: number; startGrid: number } | null>(null);
  // 現在鳴っているharmony(コード)。noteのイベントが挟まっても途切れず、次のharmony
  // イベントが鳴るまで（＝そのコードの区間が続く間）保持される。指板の半透明
  // ハイライトを「今鳴っているコード」だけに絞り込むために使う。
  const [playingHarmonyKey, setPlayingHarmonyKey] = useState<{ measureIndex: number; offsetGrid: number } | null>(
    null
  );
  const audioContextRef = useRef<AudioContext | null>(null);
  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 音名(absPitch)ごとの単音サンプルをデコード済みAudioBufferとしてキャッシュする。
  const melodySampleCacheRef = useRef<Map<number, AudioBuffer>>(new Map());
  const bassSampleCacheRef = useRef<Map<number, AudioBuffer>>(new Map());
  // ピアノ風コンピング（ハーモニー開始時に薄く鳴らすコード音）用。
  const compSampleCacheRef = useRef<Map<number, AudioBuffer>>(new Map());
  // ドラムはパーツ(DrumVoice)ごとに1発だけなので、absPitchではなくvoice名をキーにする。
  const drumSampleCacheRef = useRef<Map<DrumVoice, AudioBuffer>>(new Map());
  const sampleLoadPromiseRef = useRef<Promise<void> | null>(null);
  const [samplesReady, setSamplesReady] = useState(false);

  function clearScheduledPlayback() {
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current = [];
  }

  function stopPlayback() {
    clearScheduledPlayback();
    setIsPlaying(false);
    setPlayingNoteKey(null);
    setPlayingHarmonyKey(null);
  }

  useEffect(() => {
    return () => {
      clearScheduledPlayback();
      audioContextRef.current?.close();
    };
  }, []);

  function ensureAudioContext(): AudioContext {
    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    return ctx;
  }

  async function fetchAndDecodeAudio(ctx: AudioContext, url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    // Safari等ではPromise版decodeAudioDataが未対応な場合があるためコールバック版でラップする。
    return await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(arrayBuffer, resolve, reject);
    });
  }

  function loadPitchSampleBuffer(ctx: AudioContext, instrument: SampleInstrument, absPitch: number) {
    const name = absPitchToSampleName(absPitch);
    return fetchAndDecodeAudio(ctx, `/audio/${instrument}/${name}.mp3`);
  }

  // ページ表示後すぐに（Playが押される前から）バックグラウンドで全サンプルを
  // 先読みしておく。ensureAudioContext()はユーザー操作前に呼んでもAudioContextの
  // 生成自体は問題なく、decodeAudioDataもsuspended状態のまま実行できる。
  function ensureSamplesLoaded(): Promise<void> {
    if (!sampleLoadPromiseRef.current) {
      const ctx = ensureAudioContext();
      const jobs: Promise<void>[] = [];
      for (let ap = MELODY_SAMPLE_MIN_ABS_PITCH; ap <= MELODY_SAMPLE_MAX_ABS_PITCH; ap++) {
        const absPitch = ap;
        jobs.push(
          loadPitchSampleBuffer(ctx, "melody", absPitch).then((buf) => {
            melodySampleCacheRef.current.set(absPitch, buf);
          })
        );
      }
      for (let ap = BASS_MIN_ABS_PITCH; ap <= BASS_MAX_ABS_PITCH; ap++) {
        const absPitch = ap;
        jobs.push(
          loadPitchSampleBuffer(ctx, "bass", absPitch).then((buf) => {
            bassSampleCacheRef.current.set(absPitch, buf);
          })
        );
      }
      for (let ap = COMP_SAMPLE_MIN_ABS_PITCH; ap <= COMP_SAMPLE_MAX_ABS_PITCH; ap++) {
        const absPitch = ap;
        jobs.push(
          loadPitchSampleBuffer(ctx, "comp", absPitch).then((buf) => {
            compSampleCacheRef.current.set(absPitch, buf);
          })
        );
      }
      DRUM_VOICES.forEach((voice) => {
        jobs.push(
          fetchAndDecodeAudio(ctx, `/audio/drums/${voice}.mp3`).then((buf) => {
            drumSampleCacheRef.current.set(voice, buf);
          })
        );
      });
      sampleLoadPromiseRef.current = Promise.all(jobs).then(() => {
        setSamplesReady(true);
      });
    }
    return sampleLoadPromiseRef.current;
  }

  useEffect(() => {
    ensureSamplesLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // absPitchちょうどのサンプルをそのまま再生する。範囲外（通常は起きない想定）の
  // 音だけは、範囲内で一番近い音のサンプルをplaybackRateでピッチシフトして代用する。
  // ゲインエンベロープは、サンプル自体のアタック/減衰を活かしつつ、開始・終端の
  // クリックノイズ防止と、次の音に被らないよう音価いっぱいで軽くフェードアウト
  // させる役割に絞っている（合成音時代の4段エンベロープは不要になった）。
  function playSample(
    cache: Map<number, AudioBuffer>,
    absPitch: number,
    minPitch: number,
    maxPitch: number,
    durationSec: number,
    peakGain: number,
    at?: number
  ) {
    const ctx = ensureAudioContext();
    const clamped = clampToSampleRange(absPitch, minPitch, maxPitch);
    const buffer = cache.get(clamped);
    if (!buffer) return; // 通常はPlay開始前にロード済みのため起きない
    // at: AudioContext時計での開始時刻(先読みスケジューラ用)。省略時は今すぐ。
    const now = Math.max(at ?? 0, ctx.currentTime);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (absPitch - clamped) / 12);

    const gain = ctx.createGain();
    const attack = Math.min(0.005, durationSec * 0.2);
    const release = Math.min(0.05, durationSec * 0.3);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + attack);
    gain.gain.setValueAtTime(peakGain, now + Math.max(attack, durationSec - release));
    gain.gain.linearRampToValueAtTime(0, now + durationSec);

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + durationSec + 0.05);
  }

  function playMelodyTone(absPitch: number, durationSec: number, at?: number) {
    playSample(melodySampleCacheRef.current, absPitch, MELODY_SAMPLE_MIN_ABS_PITCH, MELODY_SAMPLE_MAX_ABS_PITCH, durationSec, 0.9, at);
  }

  function playBassTone(absPitch: number, durationSec: number, at?: number) {
    // 低音は等ラウドネス曲線の影響で同じgain値でも高い音より小さく聞こえるため、
    // メロディ(0.9)よりgain自体を大きめにしている（サンプルの実測ピークは
    // 約-18dBなので、この値でもクリップの心配はない）。
    playSample(bassSampleCacheRef.current, absPitch, BASS_MIN_ABS_PITCH, BASS_MAX_ABS_PITCH, durationSec, 1.8, at);
  }

  // ピアノ風の薄いコンピング。ハーモニー(コード)の開始タイミングごとに、
  // buildChordVoicingと同じボイシングを1オクターブ下げて短く鳴らす
  // （メロディ・ウォーキングベースの主役を邪魔しないよう、音量は控えめ・
  // 音価もそのコード区間いっぱいではなく短いスタブに留める）。
  function playCompChord(rootPc: number, chordType: string, inversion: number, durationSec: number, at?: number) {
    const absPitches = buildChordVoicingAbsPitches(rootPc, chordType, inversion);
    absPitches.forEach((abs) => {
      playSample(
        compSampleCacheRef.current,
        abs + COMP_OCTAVE_SHIFT,
        COMP_SAMPLE_MIN_ABS_PITCH,
        COMP_SAMPLE_MAX_ABS_PITCH,
        durationSec,
        0.42,
        at
      );
    });
  }

  // ドラムは音価を持たない単発トリガーなので、音符/ベースのようなdurationSec
  // 指定は不要（サンプル自体の自然な減衰に任せる）。ライドだけは音の重なりで
  // 濁らないよう、DRUM_VOICE_MAX_DURATION_SECの長さでフェードアウトさせる。
  function playDrumHit(voice: DrumVoice, at?: number) {
    const ctx = ensureAudioContext();
    const buffer = drumSampleCacheRef.current.get(voice);
    if (!buffer) return; // 通常はPlay開始前にロード済みのため起きない
    const now = Math.max(at ?? 0, ctx.currentTime);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    const peak = DRUM_VOICE_GAIN[voice];
    const maxDurationSec = DRUM_VOICE_MAX_DURATION_SEC[voice];
    if (maxDurationSec) {
      const release = 0.25;
      gain.gain.setValueAtTime(peak, now);
      gain.gain.setValueAtTime(peak, now + Math.max(0, maxDurationSec - release));
      gain.gain.linearRampToValueAtTime(0, now + maxDurationSec);
    } else {
      gain.gain.value = peak;
    }

    source.connect(gain);
    gain.connect(ctx.destination);
    // stop()はstart()の後でなければ呼べない（先に呼ぶとInvalidStateErrorになる）ため、
    // フェードアウトの予約はstart()の後に行う。
    source.start(now);
    if (maxDurationSec) {
      source.stop(now + maxDurationSec + 0.02);
    }
  }

  // notes(メロディ)とharmonies(コード)は完全に独立したデータなので、再生も
  // それぞれ別の音源として小節の絶対時刻にスケジューリングし、最後にまとめて
  // 時系列順に鳴らす。両者の対応関係は「同じ小節・同じ絶対時刻」だけで、
  // データ上の結びつきは一切ない。
  type PlaybackEvent =
    | { atMs: number; endMs: number; measureIndex: number; kind: "note"; note: Note }
    | { atMs: number; endMs: number; measureIndex: number; kind: "bass"; absPitch: number }
    | { atMs: number; endMs: number; measureIndex: number; kind: "harmony"; harmony: Harmony }
    | { atMs: number; endMs: number; measureIndex: number; kind: "drum"; voice: DrumVoice };

  async function handlePlayClick() {
    if (isPlaying) {
      abortPractice(true);
      stopPlayback();
      return;
    }
    if (practiceMode !== "off") {
      await startPractice();
      return;
    }
    await playScore(measures);
  }

  // 12キー練習を中断/終了する。restoreなら、練習前の譜面・キーに戻す。
  function abortPractice(restore: boolean) {
    const saved = practiceRef.current;
    practiceRef.current = null;
    setPracticeStatus("");
    if (saved && restore) {
      setMeasures(saved.measures);
      setRoot(saved.root);
      setUseFlats(saved.useFlats);
    }
  }

  // 現在の譜面を元のキーから順に移調しながら、12キー分を続けて再生する。
  async function startPractice() {
    const base = { measures, root, useFlats };
    if (!measures.some((m) => m.harmonies.length > 0 || m.notes.length > 0)) return;
    practiceRef.current = base;
    const order = PRACTICE_ORDERS[practiceMode === "chromatic" ? "chromatic" : "fourths"];
    const runStep = (k: number) => {
      if (practiceRef.current !== base) return; // 停止された
      const shift = order[k];
      const newRoot = (base.root + shift) % 12;
      const flats = prefersFlats(newRoot);
      const transposed = transposeMeasures(base.measures, shift, flats);
      setMeasures(transposed);
      setRoot(newRoot);
      setUseFlats(flats);
      setPracticeStatus(`${tr("Key")} ${k + 1} / ${order.length}: Do = ${(flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[newRoot]}`);
      void playScore(transposed, () => {
        if (practiceRef.current !== base) return;
        if (k + 1 < order.length) runStep(k + 1);
        else abortPractice(true);
      });
    };
    runStep(0);
  }

  async function playScore(score: Measure[], onFinished?: () => void) {
    const hasContent = score.some((m) => m.notes.length > 0 || m.harmonies.length > 0);
    if (!hasContent) return;
    // 通常はPlayボタンがsamplesReadyになるまで無効化されているため素通りするが、
    // 念のためここでも先読みの完了を待つ。
    await ensureSamplesLoaded();

    const measureDurationMs = gridToMs(gridsPerMeasure);
    const events: PlaybackEvent[] = [];
    score.forEach((m, measureIndex) => {
      const measureStartMs = measureIndex * measureDurationMs;
      m.notes.forEach((note) => {
        const atMs = measureStartMs + gridToMs(note.startGrid);
        const toneSec = durationToMs(noteSpan(note)) / 1000;
        events.push({ atMs, endMs: atMs + toneSec * 1000, measureIndex, kind: "note", note });
      });
      // harmonyは音価を持たないため、そのoffsetGridから「次のharmonyのoffsetGrid
      // （無ければ小節の終わり）」までを自分の区間として鳴らす。1小節に複数の
      // コードを置いた場合、それぞれが自分の区間だけ鳴る。
      // 音（ブロックコード）はもう鳴らさず、和音ハイライト表示のためだけに使う
      // （実際の低音の音はウォーキングベースが担う）。
      const sortedHarmonies = [...m.harmonies].sort((a, b) => a.offsetGrid - b.offsetGrid);
      sortedHarmonies.forEach((harmony, hi) => {
        const nextOffset = sortedHarmonies[hi + 1]?.offsetGrid ?? gridsPerMeasure;
        const atMs = measureStartMs + gridToMs(harmony.offsetGrid);
        const toneSec = gridToMs(nextOffset - harmony.offsetGrid) / 1000;
        events.push({ atMs, endMs: atMs + toneSec * 1000, measureIndex, kind: "harmony", harmony });
      });
    });
    // ウォーキングベース: harmoniesから1拍1音のベースラインを生成し、
    // メロディ・コードハイライトと同じ絶対時間軸に載せる。
    buildWalkingBassEvents(score, gridsPerMeasure, timeSig).forEach((be) => {
      const atMs = gridToMs(be.atGrid);
      const toneSec = gridToMs(be.durationGrid) / 1000;
      const measureIndex = Math.floor(be.atGrid / gridsPerMeasure);
      events.push({ atMs, endMs: atMs + toneSec * 1000, measureIndex, kind: "bass", absPitch: be.absPitch });
    });
    // ドラム: メロディ・ベースと同じ絶対時間軸（measureDurationMs・QUARTER_NOTE_MS）
    // に載せることで、テンポが変わってもドラムだけ走る/遅れるということが起きない。
    // 現状は4/4のジャズ基本パターンのみ対応（それ以外の拍子では無音）。
    buildDrumEvents(score.length, measureDurationMs, QUARTER_NOTE_MS, timeSig).forEach((de) => {
      events.push({ atMs: de.atMs, endMs: de.atMs, measureIndex: de.measureIndex, kind: "drum", voice: de.voice });
    });
    if (events.length === 0) return;
    events.sort((a, b) => a.atMs - b.atMs);
    const overallEndMs = Math.max(...events.map((e) => e.endMs));

    setIsPlaying(true);
    // 再生開始時点で、最初のイベントが属する小節にただちに表示を合わせる。
    setCurrentMeasureIndex(events[0].measureIndex);

    // 音は「AudioContextの時計」に先読みでスケジュールする(画面の再描画が重くても
    // 音のタイミングがぶれない)。画面の更新(ハイライト・小節追従)は、その音と
    // 同じ時刻にタイマーで行う。
    const actx = ensureAudioContext();
    const LEAD_SEC = 0.15;
    const LOOKAHEAD_SEC = 0.25;
    const t0 = actx.currentTime + LEAD_SEC;
    let nextIdx = 0;
    const fire = (ev: PlaybackEvent, at: number) => {
      const toneSec = (ev.endMs - ev.atMs) / 1000;
      // 音(先読みスケジュール)
      if (ev.kind === "note") {
        const note = ev.note;
        if (!note.isRest && note.rowIdxList.length > 0) {
          note.rowIdxList.forEach((rowIdx) => {
            const absPitch = rows[rowIdx].octave * 12 + rows[rowIdx].pc + (note.accidentals[rowIdx] ?? 0);
            playMelodyTone(absPitch, toneSec, at);
          });
        }
      } else if (ev.kind === "bass") {
        // 音符同士をわずかに切り離し、指ではじくベースらしい粒立ちを出す。
        playBassTone(ev.absPitch, toneSec * 0.92, at);
      } else if (ev.kind === "drum") {
        playDrumHit(ev.voice, at);
      } else {
        // ピアノ風の薄いコンピング(実際の低音はウォーキングベースが担当)。
        playCompChord(ev.harmony.root, ev.harmony.kind, ev.harmony.inversion, Math.min(toneSec, COMP_STAB_MAX_SEC), at);
      }
      // 画面(ハイライト)は音と同じ時刻に更新する。ドラムは画面に出さない。
      if (ev.kind === "drum" || ev.kind === "bass") return;
      const delayMs = Math.max(0, (at - actx.currentTime) * 1000);
      const visualId = setTimeout(() => {
        setCurrentMeasureIndex(ev.measureIndex);
        if (ev.kind === "note") {
          const note = ev.note;
          if (!note.isRest && note.rowIdxList.length > 0) setPlayingNoteKey({ measureIndex: ev.measureIndex, startGrid: note.startGrid });
          else setPlayingNoteKey(null); // 休符の間は前の音符のハイライトを消す
        } else if (ev.kind === "harmony") {
          setPlayingHarmonyKey({ measureIndex: ev.measureIndex, offsetGrid: ev.harmony.offsetGrid });
        }
      }, delayMs);
      timeoutIdsRef.current.push(visualId);
    };
    const pump = () => {
      const horizon = actx.currentTime + LOOKAHEAD_SEC;
      while (nextIdx < events.length && t0 + events[nextIdx].atMs / 1000 < horizon) {
        const ev = events[nextIdx];
        fire(ev, t0 + ev.atMs / 1000);
        nextIdx += 1;
      }
    };
    pump();
    const pumpId = setInterval(pump, 25);
    timeoutIdsRef.current.push(pumpId as unknown as ReturnType<typeof setTimeout>);

    const endTimeoutId = setTimeout(() => {
      clearInterval(pumpId);
      setIsPlaying(false);
      setPlayingNoteKey(null);
      setPlayingHarmonyKey(null);
      onFinished?.();
    }, overallEndMs + LEAD_SEC * 1000);
    timeoutIdsRef.current.push(endTimeoutId);
  }

  const keySig = getKeySignature(root, useFlats);
  const sigRows = keySig.type === "sharp" ? SHARP_KEY_ROWS : FLAT_KEY_ROWS;
  // 現在のキーの調号で#/♭が付く自然音名（ピッチクラス）の集合。
  // 例: Ebメジャー(♭3つ: B,E,A)なら pc={11,4,9}。
  const keySigAffectedPcs = new Set(sigRows.slice(0, keySig.count).map((idx) => rows[idx].pc));
  // 新規に配置する音の臨時記号のデフォルト値。その音の自然音名が現在の
  // キーの調号に含まれていれば#(+1)/♭(-1)、含まれていなければナチュラル(0)。
  // ユーザーが▲/▼で明示的に変更した後は、その値がaccidentalsに直接
  // 上書きされるため、この関数は「配置した瞬間の初期値」にのみ使われる。
  function defaultAccidentalForRow(rowIdx: number): number {
    if (!keySigAffectedPcs.has(rows[rowIdx].pc)) return 0;
    return keySig.type === "sharp" ? 1 : -1;
  }

  // 正しい記譜法に沿った臨時記号の「表示」判定。実際の音の高さ計算
  // （accidentalの値そのもの）には一切影響しない、表示のみのロジック。
  // - その音が調号の対象で、accidentalが調号通りならすでに調号で示されているため非表示
  // - 調号の対象で、accidentalが0（ナチュラルに戻す指定）なら♮を表示
  // - それ以外（調号と異なる方向へさらに変化、または調号の対象外でaccidental!==0）は
  //   #/♭を通常通り表示
  function accidentalDisplayGlyph(rowIdx: number, accidental: number): "accidentalSharp" | "accidentalFlat" | "accidentalNatural" | null {
    const keySigDefault = defaultAccidentalForRow(rowIdx);
    if (keySigDefault !== 0) {
      if (accidental === keySigDefault) return null;
      if (accidental === 0) return "accidentalNatural";
      return accidental === 1 ? "accidentalSharp" : "accidentalFlat";
    }
    if (accidental === 0) return null;
    return accidental === 1 ? "accidentalSharp" : "accidentalFlat";
  }
  const sigGlyphName = keySig.type === "sharp" ? "accidentalSharp" : "accidentalFlat";
  const sigChar = bravuraChar(sigGlyphName);
  // ト音記号(CLEF_X)・拍子記号(TIME_SIG_CENTER_X)は常に固定位置。調号の#/bは
  // KEY_SIG_START_Xから固定間隔で可変長に並ぶだけで、これらの位置には影響しない。
  const sigStartX = KEY_SIG_START_X;
  const sigSpacing = KEY_SIG_SPACING;
  const timeSigCenterX = TIME_SIG_CENTER_X;
  // 実際の調号がMAX_KEY_SIG_COUNTを超えることは想定していないが、
  // 万一に備えて音符エリア開始位置(LEFT)は実際の調号末尾も考慮する。
  const keySigActualEndX = sigStartX + keySig.count * sigSpacing + KEY_SIG_ACCIDENTAL_HALF_WIDTH;
  const LEFT = Math.max(LEFT_FIXED, keySigActualEndX + KEY_SIG_TO_TIME_SIG_MARGIN);

  const gridsPerBeat = 16 / timeSig.denominator;
  const gridsPerMeasure = timeSig.numerator * gridsPerBeat;
  // 連桁のグループ分けに使う「1拍」の単位。単純拍子は4分音符(4グリッド)、
  // 複合拍子は付点4分音符(6グリッド=8分音符3つ)ごとに区切る。
  const beamGroupingUnit = isCompoundMeter(timeSig) ? 6 : 4;
  // 拍子によらず音符エリアの表示幅(NOTE_AREA_WIDTH)を一定に保つため、
  // 1グリッドあたりの幅を1小節のグリッド数から動的に算出する
  // （拍数が少ない拍子ほど1グリッドが太く、多い拍子ほど細くなる）。
  const GRID_UNIT_WIDTH = NOTE_AREA_WIDTH / gridsPerMeasure;
  // Note.startGrid・Harmony.offsetGridは自分が属する小節内のローカルなグリッド番号
  // なので、表示中の小節を基準にしたx座標への変換にオフセットは不要。
  // ---- 複数小節の表示ウィンドウ ----
  // 画面が広いときは、1行に複数の小節を並べて表示し、並んだ小節はどれもその場で入力できる。
  // 入力・再生の対象になっている小節(currentMeasureIndex)が「アクティブ」で、ウィンドウの何番目の
  // スロットに居るか(activeSlot)に応じて、x座標の原点(originX)がずれる。
  // スロットsの音符エリアは LEFT + s*MEASURE_UNIT_W から始まる（先頭スロットだけ調号・拍子記号の右）。
  const MEASURE_UNIT_W = NOTE_AREA_WIDTH + PREVIEW_GAP_PX;
  const firstBarlineX = LEFT + NOTE_AREA_WIDTH;
  // 全小節を横一列に並べ、はみ出した分は #staff-wrap の横スクロールで見る。
  // 入力中の小節(currentMeasureIndex)が変わったら、下のeffectでその小節までスクロールする。
  const windowSize = measures.length;
  const windowStart = 0;
  const activeSlot = currentMeasureIndex - windowStart;
  const originX = LEFT + activeSlot * MEASURE_UNIT_W;
  const xForGrid = (g: number) => originX + g * GRID_UNIT_WIDTH;
  // アクティブな小節の小節線の位置。windowSize===1のときは、この右側に次の小節の頭のプレビューを描画する。
  const barlineX = originX + NOTE_AREA_WIDTH;
  const previewXForGrid = (g: number) => barlineX + PREVIEW_GAP_PX + g * GRID_UNIT_WIDTH;
  // 最後の小節まで表示できていて、右にまだ余白があるときは、「小節を追加」の枠を置く。
  // 枠をクリックすると末尾に小節が増え、そのまま入力できる。
  const lastSlotEndX = firstBarlineX + (windowSize - 1) * MEASURE_UNIT_W;
  // 末尾には常に「小節を追加」の枠を置く（クリックで末尾に小節が増える）。
  const ghostShown = true;
  const ghostWidth = MEASURE_UNIT_W;
  const STAFF_VB_W = lastSlotEndX + ghostWidth + NOTE_AREA_MARGIN_RIGHT;
  // クリックしたx座標がどのスロットか（先頭スロットの小節線より右は、以降のスロットを等間隔で割る）。
  const slotForX = (x: number) =>
    x <= firstBarlineX ? 0 : Math.min(windowSize - 1, Math.floor((x - firstBarlineX) / MEASURE_UNIT_W) + 1);
  // 高さを STAFF_RENDER_HEIGHT_PX に固定したまま、viewBoxの縦横比に応じて
  // 横幅だけを自然に伸ばす（縦のスケール＝ト音記号や五線の間隔は変えない）。
  const staffRenderedWidth = staffH * (STAFF_VB_W / STAFF_VB_H);

  // 1小節ずつ表示するページネーションでは、表示中の小節の先頭（LEFT）には
  // 小節線が描画されない（小節線は表示中の小節の右端にのみ描画される）ため、
  // 小節の頭に音符が来ても小節線と重なることはない。そのためxForGridの値を
  // そのまま使う（以前は小節線との重なり回避のオフセットを加えていたが、
  // 1小節ずつのページネーション導入後は不要になっていたため削除した）。
  const displayXForNote = (startGrid: number) => xForGrid(startGrid);

  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

  function handleTimeSigChange(numerator: number, denominator: number) {
    const newGridsPerMeasure = numerator * (16 / denominator);
    setTimeSig({ numerator, denominator });
    // 小節の長さが変わることで収まらなくなったnote・harmonyだけを取り除く
    // （harmonyは今や小節内の任意のoffsetGridを取り得るため、拍子を縮めると
    // 無効になるものが出てくる）。
    setMeasures((prev) =>
      prev.map((m) => ({
        ...m,
        notes: m.notes.filter((n) => snapGrid(n.startGrid + noteSpan(n)) <= newGridsPerMeasure),
        harmonies: m.harmonies.filter((h) => h.offsetGrid < newGridsPerMeasure),
      }))
    );
    setChordTargetGrid((g) => Math.min(g, newGridsPerMeasure - 1));
  }

  // 五線譜のクリックによる配置・削除はnotes（メロディ）だけを対象にする。
  // harmonies（コード）はこのハンドラでは一切参照・変更しない。
  function handleStaffClick(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (STAFF_VB_W / rect.width);
    const y = (e.clientY - rect.top) * (STAFF_VB_H / rect.height);
    // 並んだ小節のどれをクリックしても、そのまま入力できる（クリックした小節がアクティブになる）。
    // 小節が1つしか見えない狭い画面では、先頭小節の小節線より右（次の小節のプレビュー）は無視する。
    if (ghostShown && x > lastSlotEndX) {
      handleAddMeasure();
      return;
    }
    if (windowSize === 1 && x > firstBarlineX) return;
    const slot = slotForX(x);
    const targetMeasureIndex = windowStart + slot;
    if (targetMeasureIndex >= measures.length) return;
    const targetNotes = measures[targetMeasureIndex].notes;
    if (targetMeasureIndex !== currentMeasureIndex) {
      setCurrentMeasureIndex(targetMeasureIndex);
      setChordTargetGrid(0);
    }
    // 3連符はstartGridが1/3グリッド刻みになるため、グリッドへの丸めはせずに
    // 小数のままのグリッド位置で当たり判定する。各音符の判定範囲は、符頭の位置
    // (startGrid)の少し手前から始まるよう、占める長さの半分(最大0.5グリッド)だけ
    // 左にずらす（整数グリッドの音符では、従来のMath.roundによる判定と一致する）。
    const rawGrid = Math.max(0, Math.min(gridsPerMeasure - 1, (x - LEFT - slot * MEASURE_UNIT_W) / GRID_UNIT_WIDTH));
    let rowIdx = Math.round((y - rows[0].y) / 10);
    rowIdx = Math.max(0, Math.min(rows.length - 1, rowIdx));

    const covering = targetNotes.find((n) => {
      const span = noteSpan(n);
      const lead = Math.min(0.5, span / 2);
      return rawGrid >= n.startGrid - lead && rawGrid < n.startGrid + span - lead;
    });
    if (covering) {
      if (restMode) {
        if (covering.isRest) {
          updateMeasureNotes(targetMeasureIndex, (ns) => ns.filter((n) => n !== covering));
          setSelectedNoteKey((prev) => (prev === covering.startGrid ? null : prev));
          setSelectedRowIdx(null);
        } else {
          updateMeasureNotes(targetMeasureIndex, (ns) =>
            ns.map((n) => (n === covering ? { ...n, isRest: true, rowIdxList: [], accidentals: {} } : n))
          );
          setSelectedNoteKey(covering.startGrid);
          setSelectedRowIdx(null);
        }
      } else {
        if (covering.isRest) {
          updateMeasureNotes(targetMeasureIndex, (ns) =>
            ns.map((n) =>
              n === covering
                ? {
                    ...n,
                    isRest: false,
                    rowIdxList: [rowIdx],
                    accidentals: { [rowIdx]: defaultAccidentalForRow(rowIdx) },
                  }
                : n
            )
          );
          setSelectedNoteKey(covering.startGrid);
          setSelectedRowIdx(rowIdx);
        } else if (covering.rowIdxList.includes(rowIdx)) {
          // 既に和音に含まれる音を同じ段でクリック -> その音だけ和音から削除。
          const newList = covering.rowIdxList.filter((r) => r !== rowIdx);
          const newAccidentals = { ...covering.accidentals };
          delete newAccidentals[rowIdx];
          if (newList.length === 0) {
            updateMeasureNotes(targetMeasureIndex, (ns) => ns.filter((n) => n !== covering));
            setSelectedNoteKey((prev) => (prev === covering.startGrid ? null : prev));
            setSelectedRowIdx(null);
          } else {
            updateMeasureNotes(targetMeasureIndex, (ns) =>
              ns.map((n) => (n === covering ? { ...n, rowIdxList: newList, accidentals: newAccidentals } : n))
            );
            setSelectedNoteKey(covering.startGrid);
            setSelectedRowIdx((prev) => (prev === rowIdx ? newList[0] : prev));
          }
        } else {
          // 既存音符がある位置で違う段をクリック -> その音を和音に追加する。
          const newList = [...covering.rowIdxList, rowIdx].sort((a, b) => a - b);
          const newAccidentals = { ...covering.accidentals, [rowIdx]: defaultAccidentalForRow(rowIdx) };
          updateMeasureNotes(targetMeasureIndex, (ns) =>
            ns.map((n) => (n === covering ? { ...n, rowIdxList: newList, accidentals: newAccidentals } : n))
          );
          setSelectedNoteKey(covering.startGrid);
          setSelectedRowIdx(rowIdx);
        }
      }
      return;
    }

    // 空きエリアをクリックした場合、クリックしたx座標(グリッド)は使わず、
    // 現在配置されている音符・休符のうち一番右端（末尾）の直後の
    // 空きグリッドに自動追加する。y座標（音高）だけがクリック内容を左右する。
    const appendGrid = targetNotes.length === 0 ? 0 : Math.max(...targetNotes.map((n) => snapGrid(n.startGrid + noteSpan(n))));
    const remaining = snapGrid(gridsPerMeasure - appendGrid);
    // 3連符モードでは、記譜上の音価(defaultDuration)の3連符が残りに収まらなければ、
    // 収まる中で一番長い標準音価の3連符にする。通常の音符は従来通り残りグリッド数で
    // 切り詰める（3連符の後ろで残りが1/3刻みの端数になった場合は整数に切り捨てる）。
    const duration = tripletMode
      ? (DURATION_CYCLE.find((d) => d <= defaultDuration && noteSpan({ duration: d, triplet: true }) <= remaining) ?? 0)
      : Math.min(defaultDuration, Math.floor(remaining));
    if (duration <= 0) {
      setFullFeedback(true);
      setTimeout(() => setFullFeedback(false), 250);
      return;
    }
    const tripletProp = tripletMode ? { triplet: true } : {};
    const newNote: Note = restMode
      ? { startGrid: appendGrid, duration, isRest: true, rowIdxList: [], accidentals: {}, ...tripletProp }
      : {
          startGrid: appendGrid,
          duration,
          isRest: false,
          rowIdxList: [rowIdx],
          accidentals: { [rowIdx]: defaultAccidentalForRow(rowIdx) },
          ...tripletProp,
        };
    updateMeasureNotes(targetMeasureIndex, (ns) => [...ns, newNote].sort((a, b) => a.startGrid - b.startGrid));
    setSelectedNoteKey(appendGrid);
    setSelectedRowIdx(restMode ? null : rowIdx);
  }

  // 「和音を配置」専用のタイムライン行のクリック処理。座標系はhandleStaffClickと
  // 共有する(LEFT・GRID_UNIT_WIDTH・gridsPerMeasure)ため、五線譜本体と同じx位置が
  // 同じグリッドを指す。chordTargetGridを更新するだけで、notesには一切触れない。
  function handleChordTimelineClick(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (STAFF_VB_W / rect.width);
    if (ghostShown && x > lastSlotEndX) return;
    if (windowSize === 1 && x > firstBarlineX) return;
    const slot = slotForX(x);
    const targetMeasureIndex = windowStart + slot;
    if (targetMeasureIndex >= measures.length) return;
    let grid = Math.round((x - LEFT - slot * MEASURE_UNIT_W) / GRID_UNIT_WIDTH);
    grid = Math.max(0, Math.min(gridsPerMeasure - 1, grid));
    if (targetMeasureIndex !== currentMeasureIndex) {
      setCurrentMeasureIndex(targetMeasureIndex);
      setSelectedNoteKey(null);
      setSelectedRowIdx(null);
    }
    setChordTargetGrid(grid);
  }

  // ▲: 選択中のピッチが#でなければ#にする、既に#ならナチュラルに戻す。
  function pressSharp(startGrid: number, targetRowIdx: number) {
    updateMeasureNotes(currentMeasureIndex, (ns) =>
      ns.map((n) => {
        if (n.startGrid !== startGrid) return n;
        const current = n.accidentals[targetRowIdx] ?? 0;
        return { ...n, accidentals: { ...n.accidentals, [targetRowIdx]: current === 1 ? 0 : 1 } };
      })
    );
  }

  // ▼: 選択中のピッチが♭でなければ♭にする、既に♭ならナチュラルに戻す。
  function pressFlat(startGrid: number, targetRowIdx: number) {
    updateMeasureNotes(currentMeasureIndex, (ns) =>
      ns.map((n) => {
        if (n.startGrid !== startGrid) return n;
        const current = n.accidentals[targetRowIdx] ?? 0;
        return { ...n, accidentals: { ...n.accidentals, [targetRowIdx]: current === -1 ? 0 : -1 } };
      })
    );
  }

  // 「和音を配置」は表示中の小節のharmoniesだけを対象にする。notesには一切触れない。
  // 配置先は、専用のコード配置タイムライン行でクリックした位置(chordTargetGrid、
  // その行の▼マーカーで示される)。五線譜本体のクリックはnotesの配置・削除だけを
  // 行い、chordTargetGridには一切影響しない。同じoffsetGridに既にharmonyがあれば
  // 置き換え、なければ追加するので、異なるoffsetGridに複数のharmonyを積み上げていける。
  function handlePlaceChord() {
    const offsetGrid = chordTargetGrid;
    const harmony: Harmony = { offsetGrid, root: chordRoot, kind: chordType, inversion: chordInversion };
    updateMeasureHarmonies(currentMeasureIndex, (hs) => [
      ...hs.filter((h) => h.offsetGrid !== offsetGrid),
      harmony,
    ]);
  }

  function cycleDuration(startGrid: number) {
    updateMeasureNotes(currentMeasureIndex, (prev) => {
      const sorted = [...prev].sort((a, b) => a.startGrid - b.startGrid);
      const idx = sorted.findIndex((n) => n.startGrid === startGrid);
      if (idx === -1) return prev;
      const note = sorted[idx];
      const nextNote = sorted[idx + 1];
      const maxAllowed = snapGrid((nextNote ? nextNote.startGrid : gridsPerMeasure) - note.startGrid);
      // 3連符は記譜上の音価のまま切り替え、実際に占める長さ(2/3)で収まるかを判定する。
      const fits = (d: number) => noteSpan({ duration: d, triplet: note.triplet }) <= maxAllowed;

      // 直後の候補が入らない場合、そこで諦めず、入る音価が見つかるまで
      // サイクル順に探し続ける（入らない値をスキップして先に進む）。
      let candidate = nextDurationInCycle(note.duration);
      for (let i = 0; i < DURATION_CYCLE.length && !fits(candidate); i++) {
        candidate = nextDurationInCycle(candidate);
      }
      if (!fits(candidate)) return prev;
      // 音価切り替えボタンで変更した音価を、次に新規配置する音符・休符のデフォルトにも引き継ぐ。
      setDefaultDuration(candidate);
      return sorted.map((n, i) => (i === idx ? { ...n, duration: candidate } : n));
    });
  }

  // 選択中の音符・休符の3連符/通常を切り替える。3連符にすると実際の長さは2/3に
  // 縮むので常に収まるが、通常に戻す場合は直後の音符（無ければ小節末）までに
  // 収まらなければ切り替えない（音価切り替えと同様、入らない場合は何もしない）。
  // 切り替えた状態は3連符モード(tripletMode)にも引き継ぎ、続けて配置する
  // 音符・休符も同じ種類になるようにする。
  function toggleTriplet(startGrid: number) {
    const sorted = [...notes].sort((a, b) => a.startGrid - b.startGrid);
    const idx = sorted.findIndex((n) => n.startGrid === startGrid);
    if (idx === -1) return;
    const note = sorted[idx];
    const nextNote = sorted[idx + 1];
    const maxAllowed = snapGrid((nextNote ? nextNote.startGrid : gridsPerMeasure) - note.startGrid);
    const triplet = !note.triplet;
    if (noteSpan({ duration: note.duration, triplet }) > maxAllowed) {
      setFullFeedback(true);
      setTimeout(() => setFullFeedback(false), 250);
      return;
    }
    updateMeasureNotes(currentMeasureIndex, (ns) =>
      ns.map((n) => (n.startGrid === startGrid ? { ...n, triplet } : n))
    );
    setTripletMode(triplet);
    setDefaultDuration(note.duration);
  }

  // 全小節のnotes・harmoniesを両方まとめてリセットする（従来の「クリア」ボタンの
  // 挙動を、独立した2つのデータに対しても踏襲する）。ユーザーが＋/削除で組み立てた
  // 小節数そのものは維持し、中身だけを空にする（小節構成をクリアで失わせない）。
  function handleClear() {
    setMeasures((prev) => prev.map(() => ({ notes: [], harmonies: [] })));
    setSelectedNoteKey(null);
    setSelectedRowIdx(null);
    setDefaultDuration(DEFAULT_DURATION);
    setTripletMode(false);
    setSelectedImportId("");
  }

  // テンプレート・インポート済み曲のどちらも、measures・キー・拍子を初期値として
  // 丸ごと読み込む処理は共通（読み込み元(lib/templates.tsの固定配列 or IndexedDB)は
  // 不変のまま、そのコピーがstateにセットされる）。
  function loadInitialData(data: { root: number; useFlats: boolean; timeSig: TimeSignature; measures: Measure[] }) {
    setMeasures(data.measures.map((m) => ({ notes: [...m.notes], harmonies: [...m.harmonies] })));
    setRoot(data.root);
    setUseFlats(data.useFlats);
    setTimeSig(data.timeSig);
    setCurrentMeasureIndex(0);
    setSelectedNoteKey(null);
    setSelectedRowIdx(null);
    setChordTargetGrid(0);
    setDefaultDuration(DEFAULT_DURATION);
  }

  // テンプレート選択UIから、曲テンプレートのmeasures・キー・拍子を初期値として
  // 丸ごと読み込む。読み込んだ後はこれまで通りの通常のmeasures stateになるため、
  // 以後の音符追加・削除・音価変更・コード配置などの編集は一切制限されない
  // （テンプレート自体(lib/templates.ts)は不変のまま、そのコピーがセットされる）。
  function handleLoadTemplate(templateId: string) {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    loadInitialData(template);
    setSelectedImportId("");
  }

  // 譜面上のコード(harmonies)に、度数パターンを当てはめてメロディを作り直す。
  // 範囲(Scope)内の既存メロディ(notes)は置き換わる。コードの入っていない小節は直前のコードを引き継ぐ。
  function handleApplyPattern() {
    const tokens = parsePattern(patternText);
    if (!tokens) {
      setPatternError(true);
      return;
    }
    setPatternError(false);
    setMeasures((prev) =>
      applyPatternToMeasures(prev, {
        tokens,
        octave: patternOctave,
        useFlats,
        gridsPerMeasure,
        range:
          patternScope === "all"
            ? undefined
            : { from: currentMeasureIndex, to: patternScope === "measure" ? currentMeasureIndex : prev.length - 1 },
      })
    );
    setSelectedNoteKey(null);
    setSelectedRowIdx(null);
  }

  // ページ表示時に、IndexedDBに保存済みのインポート曲一覧を読み込んでおく
  // （サーバーには問い合わせない。ブラウザローカルのIndexedDBだけを見る）。
  useEffect(() => {
    listImportedSongs()
      .then(setImportedSongs)
      .catch((err) => console.error("インポート済み曲の読み込みに失敗しました", err));
  }, []);

  // 「マイインポート」選択UIから、保存済みインポート曲を読み込む。テンプレートと
  // 同様、読み込んだ後は通常のmeasures stateとして自由に編集できる。
  function handleLoadImportedSong(id: string) {
    const song = importedSongs.find((s) => s.id === id);
    if (!song) return;
    loadInitialData(song);
  }

  async function handleDeleteImportedSong(id: string) {
    await deleteImportedSong(id);
    setImportedSongs((prev) => prev.filter((s) => s.id !== id));
    setSelectedImportId((prev) => (prev === id ? "" : prev));
  }

  // MusicXMLファイル選択時のハンドラ。読み込み→パース→曲名入力→IndexedDB保存
  // まで全てブラウザ内で完結する（fetch等のネットワーク送信は一切行わない）。
  async function handleImportFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを連続で選び直しても onChange が発火するようにする
    if (!file) return;

    setIsImporting(true);
    try {
      const bytes = await file.arrayBuffer();
      const result = await parseMusicXmlFile(bytes);

      const defaultName = file.name.replace(/\.(musicxml|xml|mxl)$/i, "");
      const name = window.prompt("インポートする曲名を入力してください", defaultName);
      if (name === null) return; // キャンセル

      const song: ImportedSong = {
        id: crypto.randomUUID(),
        name: name.trim() || defaultName,
        fileName: file.name,
        importedAt: Date.now(),
        root: result.root,
        useFlats: result.useFlats,
        timeSig: result.timeSig,
        measures: result.measures,
        warnings: result.warnings,
      };
      await saveImportedSong(song);
      setImportedSongs((prev) => [song, ...prev]);
      setSelectedImportId(song.id);
      setLastImportWarnings({ fileName: file.name, warnings: result.warnings });
      loadInitialData(song);
    } catch (err) {
      window.alert(`MusicXMLのインポートに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsImporting(false);
    }
  }

  // 末尾に空の小節を1つ追加し、追加した小節に表示を移動する。
  function handleAddMeasure() {
    setMeasures((prev) => [...prev, { notes: [], harmonies: [] }]);
    setCurrentMeasureIndex(measures.length); // 追加後の末尾インデックス
    setSelectedNoteKey(null);
    setSelectedRowIdx(null);
    setChordTargetGrid(0);
  }

  // 表示中の小節を削除する。最低1小節は必ず残す。削除後は、削除した位置の
  // 1つ前の小節（先頭を削除した場合は新しい先頭=0）を表示する。
  function handleDeleteMeasure() {
    if (measures.length <= 1) return;
    const deletedIndex = currentMeasureIndex;
    setMeasures((prev) => prev.filter((_, i) => i !== deletedIndex));
    setCurrentMeasureIndex(Math.max(0, deletedIndex - 1));
    setSelectedNoteKey(null);
    setSelectedRowIdx(null);
    setChordTargetGrid(0);
  }

  // オクターブを含めた実際の音の高さ（絶対ピッチ = octave*12 + pc + 臨時記号）で
  // 一致判定する。ピッチクラスでの mod 12 は行わないため、臨時記号によって
  // オクターブをまたぐ場合も自然に正しい絶対ピッチになる。
  // ギター（移調楽器）の記譜慣習により、実際に鳴る音は記譜より1オクターブ低いため、
  // 指板とのマッチング判定にのみ -12 半音する（度数ラベルや調号などの表示には影響させない）。
  const GUITAR_SOUNDING_OCTAVE_OFFSET = -12;

  // 指板には「今実際に鳴っている音」だけを表示する。曲全体や小節全体の音符を
  // まとめて出すことはしない（過去はactivePitchesが全小節を対象にしていたが、
  // 弾いている音が分からなくなるため廃止）。
  //   - 再生中: playingNoteKey（再生スケジューラが今この瞬間に鳴らしている音符）
  //   - 停止中: selectedNoteKey（五線譜上でクリックして選択中の音符）
  // どちらも「小節内ローカルなstartGrid」なのでmeasureIndex(再生中はイベント側の
  // measureIndex、停止中はcurrentMeasureIndex)と組み合わせて特定する。
  const playingNote = playingNoteKey
    ? measures[playingNoteKey.measureIndex]?.notes.find((n) => n.startGrid === playingNoteKey.startGrid)
    : undefined;
  const playingAbsPitches = new Set(
    playingNote && !playingNote.isRest
      ? playingNote.rowIdxList.map(
          (rowIdx) =>
            rows[rowIdx].octave * 12 +
            rows[rowIdx].pc +
            (playingNote.accidentals[rowIdx] ?? 0) +
            GUITAR_SOUNDING_OCTAVE_OFFSET
        )
      : []
  );
  const selectedNote = selectedNoteKey !== null ? notes.find((n) => n.startGrid === selectedNoteKey) : undefined;
  const selectedMelodyAbsPitches = new Set(
    selectedNote && !selectedNote.isRest
      ? selectedNote.rowIdxList.map(
          (rowIdx) =>
            rows[rowIdx].octave * 12 +
            rows[rowIdx].pc +
            (selectedNote.accidentals[rowIdx] ?? 0) +
            GUITAR_SOUNDING_OCTAVE_OFFSET
        )
      : []
  );
  const displayedMelodyAbsPitches = isPlaying ? playingAbsPitches : selectedMelodyAbsPitches;

  // コードも同じ考え方: 再生中は「今鳴っているharmony」、停止中は「和音配置
  // カーソル(chordTargetGrid)が指しているharmony」だけを、指板上の「全ポジション」に
  // 半透明マーカーで示す。メロディと違って特定のオクターブには結びつけず、同じ
  // 音名なら弦・フレットを問わず該当させる（コードの押さえ方を探す用途のため）。
  // 転回形はベース音の選び方であって構成音の集合自体は変わらないため、ここでは
  // 考慮しない。
  const playingHarmonyInCurrentMeasure =
    isPlaying && playingHarmonyKey?.measureIndex === currentMeasureIndex
      ? harmonies.find((h) => h.offsetGrid === playingHarmonyKey.offsetGrid)
      : undefined;
  // chordTargetGridは「次に和音を配置する位置」のカーソルだが、既存harmonyの
  // 位置に一致するとは限らない（カーソルがコードの少し後ろにある等）ため、
  // 「そのカーソル位置で実際に効いているコード」＝offsetGridがchordTargetGrid以下で
  // 最大のharmonyを選ぶ。該当が無ければコード表示なし。
  const chordCursorHarmony = !isPlaying
    ? harmonies.filter((h) => h.offsetGrid <= chordTargetGrid).sort((a, b) => b.offsetGrid - a.offsetGrid)[0]
    : undefined;
  const displayedHarmony = isPlaying ? playingHarmonyInCurrentMeasure : chordCursorHarmony;
  const harmonyPitchClasses = new Set(
    (displayedHarmony ? [displayedHarmony] : []).flatMap((h) =>
      (CHORD_TYPES[h.kind] ?? []).map((interval) => (h.root + interval) % 12)
    )
  );

  // CAGEDシェイプ: 表示中のコードがmaj7/7/6/m7/m6/mMaj7のときだけ有効
  const SHAPE_COLORS: Record<ShapeName, string> = { E: "#4b8be0", D: "#a07be0", C: "#e0574b", A: "#e0b84a", G: "#4bb38b" };
  const shapeQuality = displayedHarmony ? shapeQualityFor(displayedHarmony.kind) : null;
  const shapeList =
    shapesOn && displayedHarmony && shapeQuality
      ? SHAPE_ORDER.map((name) => ({ name, ...shapeNotes(name, displayedHarmony.root, shapeQuality, FRETS) })).filter((sh) => sh.notes.length >= 2)
      : [];
  // Focus: フレット範囲を固定して拡大表示する(シェイプやコードが変わっても範囲は動かない)
  const focusLo = Math.max(0, Math.min(focusLoState, FRETS - focusW + 1));
  const focusHi = Math.min(FRETS, focusLo + focusW - 1);
  const focusShape = focusOn ? true : undefined;
  const shiftFocus = (d: number) => setFocusLoState(Math.max(0, Math.min(FRETS - focusW + 1, focusLo + d)));
  // ナット(0フレットの線)のx座標。開放弦の音は、ナットの1フレット分(fretW)左に、他のフレットと同じ間隔で置く
  const fbLeft = 150;
  const focusX0 = focusShape ? (focusLo === 0 ? 0 : fbLeft + (focusLo - 1) * 68 - 34) : 0;
  const focusX1 = focusShape ? fbLeft + focusHi * 68 + 12 : fbLeft + 12 * 68 + 24;
  const wholeX1 = fbLeft + (viewFrets === 17 ? 17 : 12) * 68 + 24;
  // 12フレット目より上の位置(1オクターブ上のシェイプ)も描く
  const shapeInstances = shapeList.flatMap((sh) => {
    const up = shapeQuality && displayedHarmony ? shapeNotes(sh.name, displayedHarmony.root, shapeQuality, FRETS, 1) : null;
    return up && up.full ? [sh, { name: sh.name, ...up }] : [sh];
  });
  const visibleShapes = shapeInstances.filter((sh) => shapeSel === null || sh.name === shapeSel);
  const shapeNoteKeys = new Set(visibleShapes.flatMap((sh) => sh.notes.map((n) => `${n.s}:${n.f}`)));

  const fbTop = 30;
  const fretW = 68;
  const stringGap = 30;

  // SMuFL(Bravura)は符頭・符幹・旗が別グリフの合成方式。符頭はnoteheadWhole/Half/Black、
  // 符幹はSVGの直線（SMuFL標準アンカーpointで符頭に接続）、旗（8分=1本・16分=2本）は
  // flag8thUp/Down・flag16thUp/Downを符幹の先端に配置する。16分音符も含め全音価が
  // フォントグリフのみで描画できる（手描きフォールバックは不要）。
  const NOTEHEAD_XMAX: Record<string, number> = { noteheadWhole: 422, noteheadHalf: 295, noteheadBlack: 295 };
  function noteheadGlyphForDuration(duration: number) {
    return duration === 16 ? "noteheadWhole" : duration === 8 ? "noteheadHalf" : "noteheadBlack";
  }
  function renderChordNoteheadsOnly(
    x: number,
    pitches: { rowY: number; fill: string; opacity?: number }[],
    duration: number
  ) {
    const noteheadGlyph = noteheadGlyphForDuration(duration);
    return (
      <>
        {pitches.map((p, i) => (
          <text
            key={i}
            x={x}
            y={p.rowY}
            fontSize={NOTEHEAD_FONT_SIZE}
            fontFamily="Bravura"
            textAnchor="middle"
            fill={p.fill}
            opacity={p.opacity ?? 1}
          >
            {bravuraChar(noteheadGlyph)}
          </text>
        ))}
      </>
    );
  }

  // 単音は要素1つの「和音」として扱う。符幹の向きは全構成音のうち中央線から
  // 最も遠い音で決め、符幹は近い側の符頭から遠い側の符頭を通り抜けてさらに
  // STEM_LENGTH_UNITS分伸びる1本の直線として描く（符頭が1つの場合は元の単音の
  // 計算式に厳密に一致する）。連桁でつながるグループに属する音符は、この関数ではなく
  // renderBeamedGroup（符幹）+ renderChordNoteheadsOnly（符頭のみ）で描画される。
  function renderChordNoteheadsAndStem(
    x: number,
    pitches: { rowY: number; fill: string; opacity?: number }[],
    duration: number
  ) {
    const scale = NOTEHEAD_FONT_SIZE / BRAVURA_UPM;
    const noteheadGlyph = noteheadGlyphForDuration(duration);
    const halfWidth = (NOTEHEAD_XMAX[noteheadGlyph] / 2) * scale;

    const ys = pitches.map((p) => p.rowY);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const stemDown = MIDDLE_LINE_Y - minY > maxY - MIDDLE_LINE_Y;
    const stemColor = pitches.length === 1 ? pitches[0].fill : "var(--text-primary)";

    const hasStem = duration <= 8;
    let stemLine = null;
    let stemAttachX = x;
    let stemTipY = pitches[0]?.rowY ?? MIDDLE_LINE_Y;
    if (hasStem) {
      const anchor = stemDown ? STEM_DOWN_NW : STEM_UP_SE;
      stemAttachX = stemDown ? x - halfWidth : x + halfWidth;
      let attachY: number;
      if (stemDown) {
        attachY = minY - anchor.dy * scale;
        stemTipY = maxY - anchor.dy * scale + STEM_LENGTH_UNITS * scale;
      } else {
        attachY = maxY - anchor.dy * scale;
        stemTipY = minY - anchor.dy * scale - STEM_LENGTH_UNITS * scale;
      }
      stemLine = (
        <line x1={stemAttachX} y1={attachY} x2={stemAttachX} y2={stemTipY} stroke={stemColor} strokeWidth={1.5} />
      );
    }

    const flagGlyph =
      duration === 2
        ? stemDown
          ? "flag8thDown"
          : "flag8thUp"
        : duration === 1
          ? stemDown
            ? "flag16thDown"
            : "flag16thUp"
          : null;

    return (
      <>
        {renderChordNoteheadsOnly(x, pitches, duration)}
        {stemLine}
        {flagGlyph && (
          <text x={stemAttachX} y={stemTipY} fontSize={NOTEHEAD_FONT_SIZE} fontFamily="Bravura" fill={stemColor}>
            {bravuraChar(flagGlyph)}
          </text>
        )}
      </>
    );
  }

  type BeamCandidate = { note: Note; x: number; pitches: { rowY: number; fill: string }[] };

  // 表示中の音符列（休符含む）を先頭から走査し、8分・16分音符が同じ拍内で
  // 隙間なく連続している区間だけを連桁グループとしてまとめる。休符・
  // 連桁対象外の音価（4分以上）・拍をまたぐ場合はグループを区切る。
  function computeBeamGroups(candidates: BeamCandidate[]): BeamCandidate[][] {
    const groups: BeamCandidate[][] = [];
    let current: BeamCandidate[] = [];
    let currentBeatIdx: number | null = null;
    for (const c of candidates) {
      // 連桁の対象は4分音符未満（8分・付点8分・16分）のみ。4分音符の3連符同士が
      // 同じ拍に収まって連桁でつながってしまわないよう、音価で明示的に絞る。
      const beamable = !c.note.isRest && c.note.duration < 4;
      if (!beamable) {
        if (current.length) groups.push(current);
        current = [];
        currentBeatIdx = null;
        continue;
      }
      // note.startGridは自分が属する小節内のローカルなグリッド番号なので、そのまま使う。
      const beatIdx = Math.floor(c.note.startGrid / beamGroupingUnit);
      const prev = current[current.length - 1];
      const contiguous = !prev || snapGrid(prev.note.startGrid + noteSpan(prev.note)) === c.note.startGrid;
      if (current.length > 0 && beatIdx === currentBeatIdx && contiguous) {
        current.push(c);
      } else {
        if (current.length) groups.push(current);
        current = [c];
        currentBeatIdx = beatIdx;
      }
    }
    if (current.length) groups.push(current);
    return groups;
  }

  const BEAM_THICKNESS = 4;
  const BEAM_GAP = 6;

  // グループ内の符幹の向きは、全構成音（和音を含む）のうち中央線から最も
  // 遠い音を基準に1つに統一する（既存の単音/和音の判定ロジックの拡張）。
  // 連桁の高さは、各音符が単独の符幹だった場合の先端位置のうち最も外側の
  // ものを採用し、他の音符の符幹はその高さまで伸ばして接続する。
  function renderBeamedGroup(group: BeamCandidate[]) {
    const scale = NOTEHEAD_FONT_SIZE / BRAVURA_UPM;
    const halfWidth = (NOTEHEAD_XMAX.noteheadBlack / 2) * scale;

    const allYs = group.flatMap((n) => n.pitches.map((p) => p.rowY));
    const minY = Math.min(...allYs);
    const maxY = Math.max(...allYs);
    const stemDown = MIDDLE_LINE_Y - minY > maxY - MIDDLE_LINE_Y;
    const anchor = stemDown ? STEM_DOWN_NW : STEM_UP_SE;

    function naturalTipY(n: BeamCandidate) {
      const ys = n.pitches.map((p) => p.rowY);
      const nMinY = Math.min(...ys);
      const nMaxY = Math.max(...ys);
      return stemDown
        ? nMaxY - anchor.dy * scale + STEM_LENGTH_UNITS * scale
        : nMinY - anchor.dy * scale - STEM_LENGTH_UNITS * scale;
    }
    const naturalTips = group.map(naturalTipY);
    const beamY = stemDown ? Math.max(...naturalTips) : Math.min(...naturalTips);
    const secondaryBeamY = stemDown ? beamY - BEAM_GAP : beamY + BEAM_GAP;

    const stems = group.map((n) => {
      const ys = n.pitches.map((p) => p.rowY);
      const nMinY = Math.min(...ys);
      const nMaxY = Math.max(...ys);
      const attachY = stemDown ? nMinY - anchor.dy * scale : nMaxY - anchor.dy * scale;
      const stemAttachX = stemDown ? n.x - halfWidth : n.x + halfWidth;
      const stemColor = n.pitches.length === 1 ? n.pitches[0].fill : "var(--text-primary)";
      return { stemAttachX, attachY, stemColor };
    });

    // 16分音符が2つ以上連続する区間だけ副連桁（2本目）を部分連桁として描く。
    const secondarySegments: { fromX: number; toX: number }[] = [];
    let runStart: number | null = null;
    for (let i = 0; i <= group.length; i++) {
      const is16th = i < group.length && group[i].note.duration === 1;
      if (is16th) {
        if (runStart === null) runStart = i;
      } else {
        if (runStart !== null && i - runStart >= 2) {
          secondarySegments.push({ fromX: stems[runStart].stemAttachX, toX: stems[i - 1].stemAttachX });
        }
        runStart = null;
      }
    }

    return (
      <>
        {stems.map((s, i) => (
          <line
            key={`stem-${i}`}
            x1={s.stemAttachX}
            y1={s.attachY}
            x2={s.stemAttachX}
            y2={beamY}
            stroke={s.stemColor}
            strokeWidth={1.5}
          />
        ))}
        <line
          x1={stems[0].stemAttachX}
          y1={beamY}
          x2={stems[stems.length - 1].stemAttachX}
          y2={beamY}
          stroke="var(--text-primary)"
          strokeWidth={BEAM_THICKNESS}
        />
        {secondarySegments.map((seg, i) => (
          <line
            key={`beam2-${i}`}
            x1={seg.fromX}
            y1={secondaryBeamY}
            x2={seg.toX}
            y2={secondaryBeamY}
            stroke="var(--text-primary)"
            strokeWidth={BEAM_THICKNESS}
          />
        ))}
      </>
    );
  }

  // 休符もBravuraのグリフ（全休符/2分休符/4分休符/8分休符/16分休符）で描画する。
  function renderRestGlyph(x: number, duration: number, fill: string) {
    const LINE3_Y = STAFF_TOP + 40; // 第3線（中央線）
    const glyphMap: Record<number, string> = {
      16: "restWhole",
      8: "restHalf",
      4: "restQuarter",
      2: "rest8th",
      1: "rest16th",
    };
    // durationが16/8/4/2/1のどれとも一致しない場合（3連符を丸めた結果の3等、
    // MusicXMLインポートで実際に発生する）は、noteheadGlyphForDurationと同じ
    // 考え方で「それ以下で一番近い標準音価」の休符グリフに丸めて表示する
    // （見た目は近似になるが、再生タイミング自体は元のdurationのまま正しい。
    // ここで未対応のグリフ名をそのまま渡すとglyphBBoxCenterUnitsが落ちるため、
    // 必ずglyphMapのキーのどれかに解決してから渡す）。
    const glyph =
      glyphMap[duration] ?? glyphMap[DURATION_CYCLE.find((d) => duration >= d) ?? 1];
    const centerUnits = glyphBBoxCenterUnits(glyph);
    const baselineY = baselineYForGlyphCenter(LINE3_Y, REST_FONT_SIZE, centerUnits);
    return (
      <text x={x} y={baselineY} fontSize={REST_FONT_SIZE} fontFamily="Bravura" textAnchor="middle" fill={fill}>
        {bravuraChar(glyph)}
      </text>
    );
  }

  // 通常表示中の小節と、次の小節のプレビューの両方から共通で使う描画処理。
  // 連桁のグループ化（computeBeamGroups、複合拍子対応を含む）を含めて完全に
  // 共有することで、両者の見た目・連桁化ロジックが常に一致するようにする。
  // showPlayingRingだけを呼び出し側で切り替える（プレビューでは再生中マーカーを出さない）。
  function renderNotesWithBeams(
    notesToRender: Note[],
    xForNote: (startGrid: number) => number,
    showPlayingRing: boolean,
    measureIndex: number
  ) {
    const candidates: BeamCandidate[] = notesToRender.map((note) => ({
      note,
      x: xForNote(note.startGrid),
      pitches: note.isRest
        ? []
        : note.rowIdxList.map((rowIdx) => {
            const row = rows[rowIdx];
            const acc = note.accidentals[rowIdx] ?? 0;
            const pc = (row.pc + acc + 12) % 12;
            const deg = degreeFor(pc, root);
            const [fill] = colorFor(DEGREE_ROLE[deg]);
            return { rowY: row.y, fill };
          }),
    }));
    const beamGroups = computeBeamGroups(candidates).filter((g) => g.length >= 2);
    const beamedStartGrids = new Set(beamGroups.flatMap((g) => g.map((c) => c.note.startGrid)));
    const beamGroupIndexByStartGrid = new Map(
      beamGroups.flatMap((g, gi) => g.map((c) => [c.note.startGrid, gi] as const))
    );
    const tripletGroups = computeTripletGroups(notesToRender);

    return (
      <>
        {notesToRender.map((note) => {
          const x = xForNote(note.startGrid);

          if (note.isRest) {
            return (
              <g key={note.startGrid}>{renderRestGlyph(x, note.duration, "var(--text-secondary)")}</g>
            );
          }

          const pitchInfos = note.rowIdxList.map((rowIdx) => {
            const row = rows[rowIdx];
            const acc = note.accidentals[rowIdx] ?? 0;
            const pc = (row.pc + acc + 12) % 12;
            const deg = degreeFor(pc, root);
            const [fill] = colorFor(DEGREE_ROLE[deg]);
            const ledgerYs = ledgerLineYsForRow(row.y);
            return { rowIdx, row, acc, fill, ledgerYs };
          });
          const isBeamed = beamedStartGrids.has(note.startGrid);
          return (
            <g key={note.startGrid}>
              {pitchInfos.map((p) =>
                p.ledgerYs.map((ly) => (
                  <line
                    key={`ledger-${p.rowIdx}-${ly}`}
                    x1={x - 12}
                    x2={x + 12}
                    y1={ly}
                    y2={ly}
                    stroke="var(--border-strong)"
                  />
                ))
              )}
              {pitchInfos.map((p) => {
                const glyph = accidentalDisplayGlyph(p.rowIdx, p.acc);
                if (!glyph) return null;
                return (
                  <text
                    key={`acc-${p.rowIdx}`}
                    x={x - 18}
                    y={p.row.y}
                    fontSize={NOTE_ACCIDENTAL_FONT_SIZE}
                    fontFamily="Bravura"
                    textAnchor="middle"
                    fill="var(--text-primary)"
                  >
                    {bravuraChar(glyph)}
                  </text>
                );
              })}
              {isBeamed
                ? renderChordNoteheadsOnly(
                    x,
                    pitchInfos.map((p) => ({ rowY: p.row.y, fill: p.fill })),
                    note.duration
                  )
                : renderChordNoteheadsAndStem(
                    x,
                    pitchInfos.map((p) => ({ rowY: p.row.y, fill: p.fill })),
                    note.duration
                  )}
              {showPlayingRing &&
                playingNoteKey?.measureIndex === measureIndex &&
                playingNoteKey?.startGrid === note.startGrid &&
                pitchInfos.map((p) => (
                  <circle
                    key={`ring-${p.rowIdx}`}
                    cx={x}
                    cy={p.row.y}
                    r={16}
                    fill="none"
                    stroke="var(--danger)"
                    strokeWidth={2}
                  />
                ))}
            </g>
          );
        })}
        {beamGroups.map((group, i) => (
          <g key={`beam-${i}`}>{renderBeamedGroup(group)}</g>
        ))}
        {tripletGroups.map((group, i) => {
          // 1本の連桁がちょうどこのグループの音符だけをつないでいる場合は、連桁自体が
          // まとまりを示すので数字「3」だけを出し、そうでなければ括弧も描く。
          const beamIdx = beamGroupIndexByStartGrid.get(group[0].startGrid);
          const numberOnly =
            beamIdx !== undefined &&
            beamGroups[beamIdx].length === group.length &&
            group.every((n) => beamGroupIndexByStartGrid.get(n.startGrid) === beamIdx);
          return (
            <g key={`triplet-${i}`} pointerEvents="none">
              {renderTripletBracket(group, xForNote, numberOnly)}
            </g>
          );
        })}
      </>
    );
  }

  // 連続する3連符を、括弧（数字「3」）でくくる単位にまとめる。記譜上の音価の
  // 合計が3の倍数になった時点（＝実際の長さがちょうど整数グリッド、8分3連なら
  // 4分音符1つ分）で1グループを閉じる。これで8分3連×3・4分3連×3・4分3連+8分3連
  // などの組み合わせをそのまま区切れる。3連符でない音符や隙間を挟んだ場合は
  // その時点でグループを打ち切る（不完全なグループにも「3」は表示する）。
  function computeTripletGroups(notesToRender: Note[]): Note[][] {
    const groups: Note[][] = [];
    let current: Note[] = [];
    let durationSum = 0;
    const flush = () => {
      if (current.length) groups.push(current);
      current = [];
      durationSum = 0;
    };
    for (const n of [...notesToRender].sort((a, b) => a.startGrid - b.startGrid)) {
      if (!n.triplet) {
        flush();
        continue;
      }
      const prev = current[current.length - 1];
      if (prev && snapGrid(prev.startGrid + noteSpan(prev)) !== n.startGrid) flush();
      current.push(n);
      durationSum += n.duration;
      if (durationSum % 3 === 0) flush();
    }
    flush();
    return groups;
  }

  // 3連符の括弧と数字を、符幹のある側（符幹が上向きなら音符の上、下向きなら下）に描く。
  // 符幹の向きはrenderChordNoteheadsAndStem/renderBeamedGroupと同じく、グループ内で
  // 中央線から最も遠い音で決める。
  function renderTripletBracket(group: Note[], xForNote: (startGrid: number) => number, numberOnly: boolean) {
    const scale = NOTEHEAD_FONT_SIZE / BRAVURA_UPM;
    const ys = group.flatMap((n) => (n.isRest ? [MIDDLE_LINE_Y] : n.rowIdxList.map((r) => rows[r].y)));
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const stemDown = MIDDLE_LINE_Y - minY > maxY - MIDDLE_LINE_Y;
    const hasStem = group.some((n) => !n.isRest && n.duration <= 8);
    const reach = (hasStem ? STEM_LENGTH_UNITS * scale : 0) + 14;
    const bracketY = Math.max(12, Math.min(STAFF_VB_H - 12, stemDown ? maxY + reach : minY - reach));
    // 括弧の端は符頭の少し外側まで。フックは音符側に向ける。
    const x1 = xForNote(group[0].startGrid) - 10;
    const x2 = xForNote(group[group.length - 1].startGrid) + 10;
    const midX = (x1 + x2) / 2;
    const hook = stemDown ? -6 : 6;
    const numberGap = 7;
    const label = (
      <text
        x={midX}
        y={bracketY}
        fontSize={13}
        fontFamily="'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-primary)"
      >
        3
      </text>
    );
    if (numberOnly) return label;
    const stroke = { stroke: "var(--text-primary)", strokeWidth: 1 };
    return (
      <>
        <polyline
          points={`${x1},${bracketY + hook} ${x1},${bracketY} ${midX - numberGap},${bracketY}`}
          fill="none"
          {...stroke}
        />
        <polyline
          points={`${midX + numberGap},${bracketY} ${x2},${bracketY} ${x2},${bracketY + hook}`}
          fill="none"
          {...stroke}
        />
        {label}
      </>
    );
  }

  // harmonies(コード記号)は音価もクリック編集も持たない、notesとは完全に独立した
  // 表示専用レイヤー。root/kind/inversionからその場でボイシングを計算し、透明な
  // 符頭(全音符型、符幹なし)とコード名を重ねて描画するだけで、notesの描画・
  // クリック判定には一切関与しない。
  // コード名は、画面上で読みやすい大きさ(デスクトップ15px/スマホ17px程度)になるように、
  // 五線の縮尺(staffH / STAFF_VB_H)に合わせて viewBox 単位の大きさを決める
  const chordLabelFontSize = Math.max(13, Math.min(34, (narrowFretboard ? 17 : 15) / (staffH / STAFF_VB_H)));
  function renderHarmoniesLayer(harmoniesToRender: Harmony[], xForOffset: (offsetGrid: number) => number) {
    return (
      <>
        {harmoniesToRender.map((h, hi) => {
          const x = xForOffset(h.offsetGrid);
          const voiced = buildChordVoicing(h.root, h.kind, useFlats, h.inversion);
          const label = `${names[h.root]}${CHORD_TYPE_LABELS[h.kind] ?? h.kind}`;
          return (
            <g key={`harmony-${h.offsetGrid}-${hi}`}>
              <text
                x={x}
                y={CHORD_LABEL_Y}
                fontSize={chordLabelFontSize}
                fontFamily="-apple-system, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif"
                fontWeight="bold"
                textAnchor="middle"
                fill="var(--text-primary)"
              >
                {label}
              </text>
              {voiced.map(({ rowIdx }) =>
                ledgerLineYsForRow(rows[rowIdx].y).map((ly) => (
                  <line
                    key={`hledger-${hi}-${rowIdx}-${ly}`}
                    x1={x - 12}
                    x2={x + 12}
                    y1={ly}
                    y2={ly}
                    stroke="var(--border-strong)"
                  />
                ))
              )}
              {voiced.map(({ rowIdx, accidental }) => {
                const glyph = accidentalDisplayGlyph(rowIdx, accidental);
                if (!glyph) return null;
                return (
                  <text
                    key={`hacc-${hi}-${rowIdx}`}
                    x={x - 18}
                    y={rows[rowIdx].y}
                    fontSize={NOTE_ACCIDENTAL_FONT_SIZE}
                    fontFamily="Bravura"
                    textAnchor="middle"
                    fill="var(--text-primary)"
                  >
                    {bravuraChar(glyph)}
                  </text>
                );
              })}
              {renderChordNoteheadsOnly(
                x,
                voiced.map(({ rowIdx, accidental }) => {
                  const pc = (rows[rowIdx].pc + accidental + 12) % 12;
                  const deg = degreeFor(pc, root);
                  const [fill] = colorFor(DEGREE_ROLE[deg]);
                  return { rowY: rows[rowIdx].y, fill, opacity: 0.35 };
                }),
                16 // noteheadWhole固定（harmonyは音価を持たないため）
              )}
            </g>
          );
        })}
      </>
    );
  }

  return (
    <>
      <style>{`
        @font-face {
          font-family: "Bravura";
          src:
            url("/fonts/bravura.woff2") format("woff2"),
            url("/fonts/bravura.otf") format("opentype");
          font-display: block;
        }
        /* 配色: 暗い部屋(ink)に、譜面(paper)と指板(ebony)の2つの素材を置く。
           操作部は暗い面、五線譜は紙の面、指板は黒檀の面で、それぞれ変数を切り替える。 */
        :root {
          color-scheme: dark;
          --border: rgba(84, 84, 88, 0.6);
          --border-strong: rgba(120, 120, 128, 0.5);
          --text-primary: #ffffff;
          --text-secondary: rgba(235, 235, 245, 0.6);
          --surface-0: #000000;
          --surface-1: #1c1c1e;
          --surface-2: #2c2c2e;
          --danger: #ff453a; --on-danger:#ffffff;
          --warning: #ff9f0a; --on-warning:#1a1000;
          --success: #30d158; --on-success:#04170a;
          --pro: #bf5af2; --on-pro:#ffffff;
          --gray: #8e8e93; --on-gray:#000000;
          --accent: #e0b84f; --on-accent:#2a2108;
        }
        .sb-paper {
          --border: rgba(42, 39, 33, 0.12);
          --border-strong: rgba(42, 39, 33, 0.28);
          --text-primary: #2a2721;
          --text-secondary: #6c6455;
          --surface-0: #f3efe3;
          --surface-1: #e9e2d0;
          --surface-2: #ddd4bc;
          --danger: #d6412a; --on-danger:#fff2ec;
          --warning: #b5730c; --on-warning:#fff8ea;
          --success: #157a55; --on-success:#e9fbf3;
          --pro: #5b52c9; --on-pro:#f1f0ff;
          --gray: #6c6455; --on-gray:#f5f0e0;
          --accent: #b8942f; --on-accent:#2a2721;
          color-scheme: light;
          color: var(--text-primary);
          background: #f4efe2;
          border-radius: 22px;
          padding: 10px 14px 8px;
          margin: 0 0 14px;
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 22px 44px -24px rgba(0, 0, 0, 0.75);
        }
        .sb-board {
          border-radius: 22px;
          padding: 14px 14px 10px;
          background: #1c1c1e;
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.07) inset, 0 22px 44px -24px rgba(0, 0, 0, 0.8);
        }
        .sb-header { display: flex; align-items: center; gap: 10px; margin: 2px 0 14px; }
        .sb-header .sb-name { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; color: var(--text-primary); }
        .sb-header .sb-sub { font-size: 12px; color: var(--text-secondary); margin-left: 2px; }
        select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        body {
          font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
          background: var(--surface-0);
          color: var(--text-primary);
          max-width: 1100px;
          margin: 0 auto;
          padding: 0.75rem;
          padding-left: max(0.75rem, env(safe-area-inset-left));
          padding-right: max(0.75rem, env(safe-area-inset-right));
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        }
        /* iPhone/iPadなどタッチ操作: ボタンは44px以上、フォームは16px以上(iOSの自動ズーム防止) */
        @media (pointer: coarse) {
          select, button { height: 44px; font-size: 16px; }
          .icon-btn { width: 44px; height: 44px; }
          .icon-btn-text { width: auto; }
          #controls { gap: 8px; }
        }
        select { min-width:0; max-width:100%; }
        select, button {
          height: 36px;
          border-radius: 10px;
          border: 1px solid var(--border-strong);
          background: var(--surface-1);
          color: var(--text-primary);
          padding: 0 10px;
          font-size: 13px;
        }
        button:hover { background: var(--surface-2); cursor: pointer; }
        button:disabled { opacity: 0.4; cursor: default; }
        #controls { display:flex; align-items:stretch; gap:8px; margin: 0 0 0.75rem; flex-wrap: wrap; }
        .toolbar-group {
          display:flex; flex-wrap:wrap; align-items:center; gap:6px; max-width:100%;
          padding:8px 10px 10px; background: var(--surface-1);
          border:none; border-radius:16px;
        }
        .toolbar-group[data-cap]::before {
          content: attr(data-cap); flex-basis:100%; font-size:11px; line-height:1;
          color: var(--text-secondary); margin: 0 0 2px 2px;
        }
        .toolbar-group select, .toolbar-group button { background: var(--surface-0); border-color: var(--border); }
        .toolbar-group select:hover, .toolbar-group button:hover:not(:disabled) { border-color: var(--border-strong); background: var(--surface-2); }
        .sb-row { display:flex; flex-basis:100%; align-items:stretch; gap:8px; flex-wrap:wrap; }
        .sb-seg { display:flex; align-items:center; gap:2px; padding:2px; background: rgba(118,118,128,0.24); border:none; border-radius:10px; }
        .sb-seg button { border:none; background:transparent; font-weight:500; padding:0 16px; height:36px; border-radius:8px; color: var(--text-primary); }
        .sb-seg button.sb-seg-on, .sb-seg button.sb-seg-on:hover { background: #636366; color: #fff; font-weight:600; box-shadow: 0 3px 8px rgba(0,0,0,0.35); }
        .sb-glow { transform-box: fill-box; transform-origin: center; animation: sb-glow-pulse 0.9s ease-in-out infinite alternate; }
        @keyframes sb-glow-pulse { from { transform: scale(0.85); opacity: 0.75; } to { transform: scale(1.1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .sb-glow { animation: none; } }
        .sb-summary { display:flex; flex-basis:100%; align-items:center; gap:14px; flex-wrap:wrap; font-size:13px; color: var(--text-secondary); padding:0 2px; }
        .sb-summary button { margin-left:auto; background: transparent; border-color: rgba(217,182,90,0.55); color: var(--accent); border-radius:999px; padding:0 14px; font-weight:600; }
        .sb-mobile-only { display: none; }
        @media (max-width: 640px) {
          .sb-header .sb-sub { display: none; }
          .sb-header { margin-bottom: 8px; }
          .sb-row { min-width: 0; }
          .sb-song { flex: 1 1 100%; padding: 6px 8px; }
          .sb-song[data-cap]::before { display: none; }
          .sb-song select { flex: 1 1 0; min-width: 0; }
          .sb-playgroup { display: none !important; }
          .toolbar-group[data-cap]::before { display: none; }
          .toolbar-group { padding: 6px 8px; }
          .sb-summary { gap: 8px; }
          .sb-summary button { margin-left: 0; }
          .sb-paper { margin-bottom: 8px; padding: 8px 10px 4px; }
          .sb-board-tones {
            position: sticky; bottom: 0; z-index: 20;
            margin: 0 -0.75rem;
            padding: 8px 10px calc(6px + env(safe-area-inset-bottom));
            border-radius: 14px 14px 0 0;
          }
          .sb-hide-phone { display: none !important; }
          .sb-seg button { padding: 0 10px; }
          .sb-mode-seg, .sb-key-group { flex: 1 1 100%; width: 100%; box-sizing: border-box; }
          .sb-mode-seg { padding: 4px; border-radius: 16px; background: var(--surface-1); }
          .sb-mode-seg button { flex: 1; height: 40px; border-radius: 12px; white-space: nowrap; }
          .sb-key-group { flex-wrap: nowrap; padding: 4px; }
          .sb-key-group select { flex: 0 0 auto; }
          .sb-key-group > button { flex: 1; min-width: 0; }
          .sb-mobile-only .icon-btn-primary, .sb-mobile-only .icon-btn-primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); color: var(--on-accent); box-shadow: 0 0 0 3px rgba(217,182,90,0.16); }
          .sb-mobile-only { display: inline-flex; align-items: center; }
        }
        .sb-sheet-backdrop { position: fixed; left: 0; right: 0; top: 0; z-index: 40; background: rgba(0,0,0,0.4); }
        .sb-sheet {
          position: fixed; left: 0; right: 0; margin: 0 auto; z-index: 41; width: min(560px, 100%); box-sizing: border-box;
          max-height: 72vh; overflow-y: auto; background: #1c1c1e; border-radius: 28px 28px 0 0;
          padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); box-shadow: 0 -20px 50px rgba(0,0,0,0.6);
        }
        .sb-sheet-grabber { width: 36px; height: 5px; border-radius: 3px; background: rgba(235,235,245,0.3); margin: 0 auto 6px; }
        .sb-sheet-head { display: flex; align-items: center; justify-content: space-between; min-height: 44px; }
        .sb-sheet-title { font-size: 17px; font-weight: 600; }
        .sb-sheet-done { width: 64px; border: none; background: transparent; color: var(--accent); font-size: 17px; font-weight: 600; text-align: right; padding: 0; }
        .sb-sheet-done:hover { background: transparent; }
        .sb-startbar { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; height:50px; margin:12px 0; border:none; border-radius:14px; background: var(--accent); color: var(--on-accent); font-size:17px; font-weight:700; }
        .sb-startbar:hover { background: var(--accent); }
        .sb-rh-controls { margin: 0 0 14px; }
        .sb-rh-controls .sb-seg button { padding: 0 4px; font-size: 13px; white-space: nowrap; }
        .sb-lang { margin-left:auto; } .sb-lang button { height:30px; padding:0 10px; font-size:13px; }
        .sb-group-title { font-size: 13px; color: var(--text-secondary); padding: 16px 16px 6px; }
        .sb-group { border-radius: 14px; background: #2c2c2e; overflow: hidden; }
        .sb-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 4px 16px; border-bottom: 1px solid var(--border); font-size: 17px; }
        .sb-item:last-child { border-bottom: none; }
        .sb-item .sb-seg { background: rgba(118,118,128,0.32); }
        .sb-switch { position: relative; width: 51px; height: 31px; padding: 0; border: none; border-radius: 16px; background: rgba(120,120,128,0.32); transition: background 0.2s; flex-shrink: 0; }
        .sb-switch:hover { background: rgba(120,120,128,0.32); }
        .sb-switch[data-on="1"], .sb-switch[data-on="1"]:hover { background: #30d158; }
        .sb-switch span { position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 14px; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.3); transition: transform 0.2s; }
        .sb-switch[data-on="1"] span { transform: translateX(20px); }
        .sb-stepper { display: inline-flex; align-items: center; gap: 10px; }
        .sb-stepper button { width: 44px; height: 34px; border: none; border-radius: 17px; background: rgba(120,120,128,0.32); color: #fff; font-size: 20px; line-height: 1; padding: 0; }
        .sb-stepper-val { font-size: 17px; font-weight: 600; min-width: 74px; text-align: center; }
        .sb-chip { height: 36px; padding: 0 14px; border-radius: 18px; border: 2px solid var(--border-strong); font-size: 15px; font-weight: 600; box-sizing: border-box; background: transparent; color: var(--text-primary); }
        .sb-edit { align-items:flex-start; }
        .sb-song { flex:1 1 300px; min-width:0; }
        .sb-song select { flex:1 1 150px; }
        #legend { font-size: 12px; color: var(--text-secondary); margin-top: 0.5rem; }
        #fretboard-wrap { overflow-x: auto; }

        .icon-btn {
          width: 36px;
          height: 36px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          font-size: 18px;
          line-height: 1;
        }
        .icon-btn:hover { color: var(--text-primary); border-color: var(--border-strong); }
        .icon-btn-active {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--on-accent);
        }
        .icon-btn-active:hover { background: var(--accent); color: var(--on-accent); }
        .icon-btn-text { width:auto; padding:0 14px; gap:7px; font-size:13px; font-weight:600; color: var(--text-primary); border-radius:999px; }
        .toolbar-group .icon-btn-primary, .toolbar-group .icon-btn-primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); color: var(--on-accent); box-shadow: 0 0 0 3px rgba(217,182,90,0.16); }
        .toolbar-group .icon-btn-primary:disabled { opacity:0.55; box-shadow:none; }
        .icon-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
        .toolbar-group .icon-btn-outline { color: var(--accent); border-color: rgba(217,182,90,0.55) !important; }
        .icon-btn-outline:hover:not(:disabled) { background: rgba(217,182,90,0.12) !important; border-color: var(--accent) !important; }
        .icon-btn-tip {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--surface-2);
          color: var(--text-primary);
          border: 1px solid var(--border-strong);
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 12px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 10;
        }
      `}</style>

      <header className="sb-header">
        <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
          <path d="M2 22 C 8 2, 26 2, 32 22" fill="none" stroke="#d9b65a" strokeWidth="2.4" strokeLinecap="round" />
          <g stroke="#a39b8c" strokeLinecap="round">
            <line x1="6.0" y1="22" x2="6.0" y2="14.7" strokeWidth="0.8" /><line x1="10.4" y1="22" x2="10.4" y2="10.3" strokeWidth="0.95" /><line x1="14.8" y1="22" x2="14.8" y2="8.4" strokeWidth="1.1" /><line x1="19.2" y1="22" x2="19.2" y2="8.4" strokeWidth="1.3" /><line x1="23.6" y1="22" x2="23.6" y2="10.3" strokeWidth="1.5" /><line x1="28.0" y1="22" x2="28.0" y2="14.7" strokeWidth="1.7" />
          </g>
        </svg>
        <span className="sb-name">{tr("ScoreBridge")}</span>
        <span className="sb-sub">{tr("From staff to fretboard")}</span>
        <div className="sb-seg sb-lang" role="group" aria-label="Language">
          <button type="button" aria-pressed={lang === "ja"} className={lang === "ja" ? "sb-seg-on" : ""} onClick={() => changeLang("ja")}>日本語</button>
          <button type="button" aria-pressed={lang === "en"} className={lang === "en" ? "sb-seg-on" : ""} onClick={() => changeLang("en")}>EN</button>
        </div>
      </header>

      <div id="controls">
        <div className="sb-row">
        <div className="toolbar-group sb-song" data-cap={tr("Song")}>
          <select
            id="template-select"
            defaultValue=""
            aria-label={tr("Song template")}
            onChange={(e) => {
              if (!e.target.value) return;
              handleLoadTemplate(e.target.value);
              e.target.value = ""; // 読み込み後は「未選択」に戻す(measuresは通常のstateとして編集可能)
            }}
          >
            <option value="">{tr("Song templates…")}</option>
            {(Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]).map((cat) => (
              <optgroup key={cat} label={TEMPLATE_CATEGORY_LABELS[cat]}>
                {TEMPLATES.filter((t) => t.category === cat).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <select
            id="my-imports-select"
            aria-label={tr("My imports")}
            value={selectedImportId}
            onChange={(e) => {
              setSelectedImportId(e.target.value);
              if (e.target.value) handleLoadImportedSong(e.target.value);
            }}
          >
            <option value="">{importedSongs.length === 0 ? tr("My imports (none yet)") : tr("My imports…")}</option>
            {importedSongs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedImportId && (
            <IconButton
              id="my-imports-delete-btn"
              label={tr("Delete selected import")}
              icon={<Trash2 size={16} />}
              onClick={() => void handleDeleteImportedSong(selectedImportId)}
            />
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            style={{ display: "none" }}
            onChange={handleImportFileSelected}
          />
          <IconButton
            id="import-musicxml-btn"
            label={isImporting ? tr("Importing…") : tr("Import MusicXML")}
            icon={<Upload size={16} />}
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          />
        </div>

        {mode === "tones" && (
        <div className="toolbar-group sb-playgroup" style={{ marginLeft: "auto", background: "transparent", borderColor: "transparent", paddingRight: 0 }}>
          <IconButton
            id="play-btn"
            label={isPlaying ? tr("Stop") : samplesReady ? tr("Play") : tr("Loading sounds…")}
            text={isPlaying ? tr("Stop") : samplesReady ? tr("Play") : tr("Loading…")}
            variant="primary"
            icon={isPlaying ? <Square size={16} /> : <Play size={16} />}
            active={isPlaying}
            disabled={!samplesReady && !isPlaying}
            onClick={handlePlayClick}
          />
          <IconButton id="clear-btn" label={tr("Clear all")} icon={<Eraser size={16} />} onClick={handleClear} />
        </div>
        )}
        </div>
        <div className="sb-row">
        <div className="sb-seg sb-mode-seg" role="group" aria-label={tr("Practice mode")}>
          <button type="button" aria-pressed={mode === "tones"} className={mode === "tones" ? "sb-seg-on" : ""} onClick={() => setMode("tones")}>
            {tr("Chord tones")}
          </button>
          <button type="button" aria-pressed={mode === "rhythm"} className={mode === "rhythm" ? "sb-seg-on" : ""} onClick={() => setMode("rhythm")}>
            {tr("Rhythm")}
          </button>
        </div>
        <div className="toolbar-group sb-key-group" data-cap={tr("Key & meter")}>
          <select aria-label={tr("Key (movable Do)")} value={root} onChange={(e) => setRoot(parseInt(e.target.value, 10))}>
            {names.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-expanded={scoreOpen}
            onClick={() => setScoreOpen((v) => !v)}
            style={{ minHeight: 40, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(217,182,90,0.55)", background: "transparent", color: "var(--accent)", fontWeight: 600 }}
          >
            {`${timeSig.numerator}/${timeSig.denominator} · m${currentMeasureIndex + 1}/${measures.length} ${scoreOpen ? "▴" : "▾"}`}
          </button>
          {scoreOpen && (
            <>
          <IconButton
            id="accidental-toggle"
            label={useFlats ? tr("Use sharps") : tr("Use flats")}
            icon={useFlats ? <SharpIcon /> : <FlatIcon />}
            onClick={() => setUseFlats((prev) => !prev)}
          />
          <select
            aria-label={tr("Time signature")}
            value={`${timeSig.numerator}/${timeSig.denominator}`}
            onChange={(e) => {
              const [num, den] = e.target.value.split("/").map(Number);
              handleTimeSigChange(num, den);
            }}
          >
            {TIME_SIG_OPTIONS.map((opt) => (
              <option key={`${opt.numerator}/${opt.denominator}`} value={`${opt.numerator}/${opt.denominator}`}>
                {opt.numerator}/{opt.denominator}
              </option>
            ))}
          </select>
            </>
          )}
        </div>

        {scoreOpen && (
        <div className="toolbar-group" data-cap={tr("Measure")}>
          <IconButton
            id="measure-prev-btn"
            label={tr("Previous measure")}
            icon={<ChevronLeft size={18} />}
            disabled={currentMeasureIndex === 0}
            onClick={() => {
              setCurrentMeasureIndex((i) => Math.max(0, i - 1));
              // ローカルなstartGridは小節をまたいで一意ではないため、選択状態は
              // 小節移動のたびにリセットする（別の小節の音符が誤って選択中扱いに
              // ならないようにする）。
              setSelectedNoteKey(null);
              setSelectedRowIdx(null);
              setChordTargetGrid(0);
            }}
          />
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Measure {currentMeasureIndex + 1} / {measures.length}
          </span>
          <IconButton
            id="measure-next-btn"
            label={tr("Next measure")}
            icon={<ChevronRight size={18} />}
            disabled={currentMeasureIndex === measures.length - 1}
            onClick={() => {
              setCurrentMeasureIndex((i) => Math.min(measures.length - 1, i + 1));
              setSelectedNoteKey(null);
              setSelectedRowIdx(null);
              setChordTargetGrid(0);
            }}
          />
        </div>
        )}

        </div>
        {mode === "tones" && (
        <div className="sb-summary">
          <span>Pattern: {patternText.trim() || "—"}</span>
          <span className="sb-hide-phone">Oct {patternOctave > 0 ? "+" : ""}{patternOctave}</span>
          <span className="sb-hide-phone">{patternScope === "all" ? tr("All measures") : patternScope === "measure" ? tr("This measure") : tr("From this measure")}</span>
          <button type="button" aria-expanded={editOpen} onClick={() => setEditOpen((v) => !v)}>
            {editOpen ? tr("Hide chords & pattern ▴") : tr("Edit chords & pattern ▾")}
          </button>
        </div>
        )}
        {mode === "tones" && editOpen && (
          <div className="sb-row sb-edit">
        <div className="toolbar-group" data-cap={tr("Entry & measures")}>
          <IconButton
            id="rest-toggle"
            label={tr("Rest mode")}
            icon={<RestIcon />}
            active={restMode}
            onClick={() => setRestMode((prev) => !prev)}
          />
          <IconButton
            id="triplet-toggle"
            label={tr("Triplet mode")}
            icon={<TripletIcon />}
            active={tripletMode}
            onClick={() => setTripletMode((prev) => !prev)}
          />
          <IconButton id="measure-add-btn" label={tr("Add measure at end")} icon={<Plus size={16} />} onClick={handleAddMeasure} />
          <IconButton
            id="measure-delete-btn"
            label={tr("Delete this measure")}
            icon={<Trash2 size={16} />}
            disabled={measures.length <= 1}
            onClick={handleDeleteMeasure}
          />
        </div>
        <div className="toolbar-group" data-cap={tr("Chord")}>
          <select
            id="chord-root-select"
            aria-label={tr("Chord root")}
            value={chordRoot}
            onChange={(e) => setChordRoot(parseInt(e.target.value, 10))}
          >
            {names.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select id="chord-type-select" aria-label={tr("Chord quality")} value={chordType} onChange={(e) => setChordType(e.target.value)}>
            {Object.keys(CHORD_TYPES).map((type) => (
              <option key={type} value={type}>
                {CHORD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select
            id="chord-inversion-select"
            aria-label={tr("Chord inversion")}
            value={chordInversion}
            onChange={(e) => setChordInversion(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: CHORD_TYPES[chordType].length }, (_, i) => i).map((inv) => (
              <option key={inv} value={inv}>
                {INVERSION_LABELS[inv]}
              </option>
            ))}
          </select>
          <IconButton id="chord-place-btn" label={tr("Place chord")} text="Place chord" variant="outline" icon={<ChordIcon />} onClick={handlePlaceChord} />
        </div>

        <div className="toolbar-group" data-cap={tr("Pattern (chord tones)")}>
          <select
            aria-label={tr("Pattern preset")}
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setPatternText(e.target.value);
              setPatternError(false);
            }}
          >
            <option value="">{tr("Presets…")}</option>
            {PATTERN_PRESETS.map((p) => (
              <option key={p.label} value={p.text}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            id="pattern-input"
            type="text"
            aria-label={tr("Chord-tone pattern (e.g. 3 1 5+ 7)")}
            aria-invalid={patternError}
            title="1 3 5 7 9 11 13 を空白区切りで。b9 / #11 のように♭♯、5+ / 5- で直前の音より上/下"
            value={patternText}
            onChange={(e) => {
              setPatternText(e.target.value);
              setPatternError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApplyPattern();
            }}
            style={{
              height: 36,
              width: 130,
              borderRadius: 8,
              padding: "0 10px",
              fontSize: 13,
              background: "var(--surface-0)",
              color: "var(--text-primary)",
              border: `1px solid ${patternError ? "#e5645a" : "var(--border)"}`,
            }}
          />
          <select
            aria-label={tr("Pattern octave")}
            value={patternOctave}
            onChange={(e) => setPatternOctave(parseInt(e.target.value, 10))}
          >
            <option value={-1}>{tr("Oct −1")}</option>
            <option value={0}>{tr("Oct 0")}</option>
            <option value={1}>{tr("Oct +1")}</option>
          </select>
          <select
            aria-label={tr("Pattern scope")}
            value={patternScope}
            onChange={(e) => setPatternScope(e.target.value as "all" | "measure" | "from")}
          >
            <option value="all">{tr("All measures")}</option>
            <option value="measure">{tr("This measure")}</option>
            <option value="from">{tr("From this measure")}</option>
          </select>
          <IconButton
            id="pattern-apply-btn"
            label={tr("Apply pattern to chords (replaces melody)")}
            icon={<Sparkles size={16} />}
            text={tr("Apply")}
            variant="outline"
            onClick={handleApplyPattern}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flexBasis: "100%" }}>
            {["1", "3", "5", "7", "9", "11", "13", "b9", "#11", "b13", "+", "-"].map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`${tr("Add")} ${t}`}
                style={{ height: 28, minWidth: 30, padding: "0 8px", fontSize: 12 }}
                onClick={() => {
                  setPatternText((prev) =>
                    t === "+" || t === "-" ? prev.trimEnd() + t : (prev.trim() ? prev.trimEnd() + " " : "") + t
                  );
                  setPatternError(false);
                }}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              aria-label={tr("Remove last")}
              style={{ height: 28, padding: "0 8px", fontSize: 12 }}
              onClick={() => setPatternText((prev) => prev.trim().split(/\s+/).slice(0, -1).join(" "))}
            >
              ⌫
            </button>
          </div>
          {patternError && (
            <span role="alert" style={{ fontSize: 12, color: "#e5645a" }}>
              {tr("Use degrees like 1 3 5 7 9 11 13")}
            </span>
          )}
        </div>

        <div className="toolbar-group" data-cap={tr("Practice")}>
          <select
            aria-label={tr("12-key practice")}
            value={practiceMode}
            disabled={isPlaying}
            onChange={(e) => setPracticeMode(e.target.value as "off" | "fourths" | "chromatic")}
          >
            <option value="off">{tr("12 keys: off")}</option>
            <option value="fourths">{tr("12 keys: up a 4th")}</option>
            <option value="chromatic">{tr("12 keys: up a semitone")}</option>
          </select>
          {practiceStatus && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{practiceStatus}</span>}
        </div>

          </div>
        )}
      </div>

      {lastImportWarnings && (
        <div
          id="import-warnings"
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 10px",
            margin: "0 0 0.5rem",
          }}
        >
          <details>
            <summary style={{ cursor: "pointer" }}>
              Import result for “{lastImportWarnings.fileName}”:{" "}
              {lastImportWarnings.warnings.length === 0 ? "no warnings" : `${lastImportWarnings.warnings.length} warning(s) (click to show)`}
            </summary>
            {lastImportWarnings.warnings.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {lastImportWarnings.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}

      {mode === "rhythm" && (
        <RhythmPractice measures={measures} chordRoot={chordRoot} chordType={chordType} useFlats={useFlats} timeSig={timeSig} tr={tr} />
      )}
      {mode === "tones" && (
      <>
      <section className="sb-paper">
      <div className="sb-mobile-only" role="group" aria-label={tr("Staff size")} style={{ justifyContent: "flex-end", alignItems: "center", gap: 6, margin: "0 0 4px" }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{tr("Staff size")}</span>
        {(["S", "M", "L"] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={phoneStaffSize === i}
            style={{ height: 32, minWidth: 40, borderRadius: 999, border: "1px solid var(--border-strong)", background: phoneStaffSize === i ? "var(--accent)" : "transparent", color: phoneStaffSize === i ? "var(--on-accent)" : "var(--text-primary)", fontWeight: 700, fontSize: 14 }}
            onClick={() => {
              setPhoneStaffSize(i);
              try { localStorage.setItem("sb-staff-size", String(i)); } catch {}
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="staff-wrap" ref={staffWrapRef} style={{ overflowX: "auto" }}>
      <svg
        id="staff"
        viewBox={`0 0 ${STAFF_VB_W} ${STAFF_VB_H}`}
        style={{
          width: `${staffRenderedWidth}px`,
          height: `${staffH}px`,
          display: "block",
          cursor: "pointer",
          touchAction: "manipulation",
          pointerEvents: "auto",
        }}
        onClick={handleStaffClick}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const y = STAFF_TOP + i * 20;
          return (
            <line
              key={i}
              x1={0}
              x2={STAFF_VB_W - 20}
              y1={y}
              y2={y}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          );
        })}

        <text
          x={CLEF_X}
          y={rows[10].y /* G4線: SMuFL標準でgClefの原点はG4線に一致させる */}
          fontSize={BRAVURA_FONT_SIZE}
          fontFamily="Bravura"
          fill="var(--text-primary)"
        >
          {bravuraChar("gClef")}
        </text>

        {Array.from({ length: keySig.count }, (_, k) => {
          const row = rows[sigRows[k]];
          // accidentalSharp/Flatは符頭・クレフと同様、原点(text baseline)がそのまま
          // 対象の線・間に一致するようデザインされている。accidentalFlatは符幹が
          // 上に長く伸びる非対称なグリフのため、bboxの中心（glyphBBoxCenterUnits）で
          // 位置合わせすると符幹側に引っ張られて実際より低い位置にずれてしまう
          // （実測で約1段分近くずれることを確認済み）。そのためy=row.yをそのまま使う。
          return (
            <text
              key={k}
              x={sigStartX + k * sigSpacing}
              y={row.y}
              fontSize={KEY_SIG_FONT_SIZE}
              fontFamily="Bravura"
              textAnchor="middle"
              fill="var(--text-primary)"
            >
              {sigChar}
            </text>
          );
        })}

        {(() => {
          const numGlyph = "timeSig" + timeSig.numerator;
          const denGlyph = "timeSig" + timeSig.denominator;
          const numY = baselineYForGlyphCenter(rows[6].y, BRAVURA_FONT_SIZE, glyphBBoxCenterUnits(numGlyph));
          const denY = baselineYForGlyphCenter(rows[10].y, BRAVURA_FONT_SIZE, glyphBBoxCenterUnits(denGlyph));
          return (
            <>
              <text
                x={timeSigCenterX}
                y={numY}
                fontSize={BRAVURA_FONT_SIZE}
                fontFamily="Bravura"
                textAnchor="middle"
                fill="var(--text-primary)"
              >
                {bravuraChar(numGlyph)}
              </text>
              <text
                x={timeSigCenterX}
                y={denY}
                fontSize={BRAVURA_FONT_SIZE}
                fontFamily="Bravura"
                textAnchor="middle"
                fill="var(--text-primary)"
              >
                {bravuraChar(denGlyph)}
              </text>
            </>
          );
        })()}

        {(() => {
          const lineX = xForGrid(gridsPerMeasure);
          return (
            <line
              x1={lineX}
              x2={lineX}
              y1={STAFF_TOP}
              y2={STAFF_TOP + 80}
              stroke="var(--text-primary)"
              strokeWidth={1.5}
            />
          );
        })()}

        {/* 拍の位置を示す補助線（小節線とは重ならない、表示中の小節内の拍区切りのみ）。
            見た目だけのガイドで、クリック判定・配置ロジックには一切関与しない。 */}
        {Array.from({ length: timeSig.numerator - 1 }, (_, b) => {
          const lineX = xForGrid((b + 1) * gridsPerBeat);
          return (
            <line
              key={b}
              x1={lineX}
              x2={lineX}
              y1={STAFF_TOP - 5}
              y2={STAFF_TOP + 85}
              stroke="var(--border)"
              strokeWidth={1}
              pointerEvents="none"
            />
          );
        })}

        {/* notes(メロディ)とharmonies(コード)は完全に独立したレイヤーとして重ねて
            描画するだけで、互いの描画・データには一切依存しない。 */}
        {renderHarmoniesLayer(harmonies, displayXForNote)}
        {renderNotesWithBeams(notes, displayXForNote, true, currentMeasureIndex)}

        {/* 並んで表示している他の小節。クリックするとその小節がアクティブになって入力できる。
            アクティブでない小節は少し薄く描画して、入力先との違いが分かるようにする。 */}
        {windowSize >= 2 &&
          Array.from({ length: windowSize }, (_, slot) => {
            if (slot === activeSlot) return null;
            const m = measures[windowStart + slot];
            if (!m) return null;
            const xFor = (g: number) => LEFT + slot * MEASURE_UNIT_W + g * GRID_UNIT_WIDTH;
            const endX = LEFT + slot * MEASURE_UNIT_W + NOTE_AREA_WIDTH;
            return (
              <g key={`slot-${slot}`} pointerEvents="none">
                <g opacity={0.65}>
                  {renderHarmoniesLayer(m.harmonies, xFor)}
                  {renderNotesWithBeams(m.notes, xFor, false, windowStart + slot)}
                </g>
                <line x1={endX} x2={endX} y1={STAFF_TOP} y2={STAFF_TOP + 80} stroke="var(--text-primary)" strokeWidth={1.5} />
              </g>
            );
          })}

        {ghostShown && (
          <g pointerEvents="none">
            <rect
              x={lastSlotEndX + PREVIEW_GAP_PX}
              y={STAFF_TOP - 10}
              width={ghostWidth - PREVIEW_GAP_PX - 8}
              height={100}
              rx={10}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1.5}
              strokeDasharray="6 6"
            />
            <text
              x={lastSlotEndX + PREVIEW_GAP_PX + (ghostWidth - PREVIEW_GAP_PX - 8) / 2}
              y={STAFF_TOP + 46}
              textAnchor="middle"
              fontSize={22}
              fill="var(--text-secondary)"
            >
              ＋ Add measure
            </text>
          </g>
        )}

        {(() => {
          const nextMeasure = measures[currentMeasureIndex + 1];
          const previewNotes = nextMeasure
            ? nextMeasure.notes.filter((note) => note.startGrid * GRID_UNIT_WIDTH < PREVIEW_WIDTH_PX)
            : [];
          const previewHarmonies = nextMeasure
            ? nextMeasure.harmonies.filter((h) => h.offsetGrid * GRID_UNIT_WIDTH < PREVIEW_WIDTH_PX)
            : [];
          if (windowSize >= 2 || (previewNotes.length === 0 && previewHarmonies.length === 0)) return null;
          const anchorX = barlineX;
          const anchorY = MIDDLE_LINE_Y;
          return (
            <g
              opacity={PREVIEW_OPACITY}
              pointerEvents="none"
              transform={`translate(${anchorX},${anchorY}) scale(${PREVIEW_SCALE}) translate(${-anchorX},${-anchorY})`}
            >
              {renderHarmoniesLayer(previewHarmonies, previewXForGrid)}
              {renderNotesWithBeams(previewNotes, previewXForGrid, false, currentMeasureIndex + 1)}
            </g>
          );
        })()}

        <rect
          x={LEFT - 40}
          y={2}
          width={STAFF_VB_W - (LEFT - 40)}
          height={STAFF_VB_H - 4}
          fill="transparent"
          style={{ pointerEvents: "auto", touchAction: "manipulation" }}
        />

        <rect
          x={0}
          y={0}
          width={STAFF_VB_W}
          height={STAFF_VB_H}
          fill="var(--danger)"
          opacity={fullFeedback ? 0.2 : 0}
          style={{ transition: "opacity 0.25s", pointerEvents: "none" }}
        />
      </svg>

      {/* 「和音を配置」専用のクリック可能なタイムライン行。五線譜本体
          (#staff)とは完全に別のクリックハンドラを持ち、notesには一切
          触れずchordTargetGridだけを更新する。#staff-wrapと同じ
          overflowXコンテナ内に置くことで、横スクロールが常に連動する。
          座標系(LEFT・GRID_UNIT_WIDTH・STAFF_VB_W)を共有しているため、
          x位置は五線譜本体とぴったり揃う。 */}
      <div style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "4px 0 2px" }}>
        {tr("Click to set where the chord goes")}
      </div>
      <svg
        id="chord-timeline"
        viewBox={`0 0 ${STAFF_VB_W} 26`}
        preserveAspectRatio="none"
        style={{ width: `${staffRenderedWidth}px`, height: "24px", display: "block", cursor: "pointer" }}
        onClick={handleChordTimelineClick}
      >
        {Array.from({ length: windowSize }, (_, slot) => {
          const slotOrigin = LEFT + slot * MEASURE_UNIT_W;
          return (
            <g key={`tl-${slot}`} opacity={slot === activeSlot ? 1 : 0.65}>
              <rect
                x={slotOrigin}
                y={5}
                width={NOTE_AREA_WIDTH}
                height={12}
                rx={3}
                fill="var(--surface-0)"
                stroke="var(--border)"
              />
              {/* 配置できる位置(16分音符のグリッド)の目盛り。拍の位置は五線譜の拍の補助線と同じxに
                  なるよう同じ原点・同じ幅で描き、どこにマーカーが止まるかが見えるようにする。 */}
              {Array.from({ length: gridsPerMeasure + 1 }, (_, g) => {
                const isBeat = g % gridsPerBeat === 0;
                const isEighth = g % 2 === 0;
                const x = slotOrigin + g * GRID_UNIT_WIDTH;
                return (
                  <line
                    key={g}
                    x1={x}
                    x2={x}
                    y1={isBeat ? 5 : isEighth ? 8 : 10}
                    y2={isBeat ? 17 : isEighth ? 14 : 12}
                    stroke={isBeat ? "var(--text-secondary)" : "var(--border-strong)"}
                    strokeWidth={isBeat ? 1.5 : 1}
                    pointerEvents="none"
                  />
                );
              })}
            </g>
          );
        })}
        {/* 配置予定位置(chordTargetGrid)を示す三角マーカー。 */}
        <polygon
          points={`${displayXForNote(chordTargetGrid) - 6},1 ${displayXForNote(chordTargetGrid) + 6},1 ${displayXForNote(chordTargetGrid)},13`}
          fill="var(--accent)"
          stroke="var(--text-primary)"
          strokeWidth={0.75}
        />
      </svg>
      </div>

      <div style={{ margin: "0 0 0.5rem", height: "72px", overflowX: "auto" }}>
      <div style={{ position: "relative", width: `${staffRenderedWidth}px`, height: "72px" }}>
        {(() => {
          // notesは既に表示中の小節(measures[currentMeasureIndex].notes)にスコープ
          // されているため、この中で見つかった時点で表示中の小節の音符だと確定する。
          const selectedNote = notes.find((n) => n.startGrid === selectedNoteKey);
          if (!selectedNote) return null;
          const leftPercent = (displayXForNote(selectedNote.startGrid) / STAFF_VB_W) * 100;
          const durationLabel =
            selectedNote.duration === 16
              ? "whole"
              : selectedNote.duration === 8
                ? "half"
                : selectedNote.duration === 4
                  ? "quarter"
                  : selectedNote.duration === 2
                    ? "8th"
                    : "16th";
          const btnStyle = { fontSize: "11px", padding: "0 4px", minWidth: "34px", height: "20px", lineHeight: "1" };
          // 和音の場合、臨時記号の操作対象はselectedRowIdx（選択中のピッチ）。
          // 未選択・和音外なら先頭の音を対象にする。
          const targetRowIdx =
            selectedRowIdx !== null && selectedNote.rowIdxList.includes(selectedRowIdx)
              ? selectedRowIdx
              : (selectedNote.rowIdxList[0] ?? null);
          return (
            <div
              style={{
                position: "absolute",
                left: `${leftPercent}%`,
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1px",
              }}
            >
              {!selectedNote.isRest && targetRowIdx !== null && (
                <button style={btnStyle} onClick={() => pressSharp(selectedNote.startGrid, targetRowIdx)}>
                  ▲
                </button>
              )}
              <div style={{ display: "flex", gap: "1px" }}>
                <button style={btnStyle} onClick={() => cycleDuration(selectedNote.startGrid)}>
                  {durationLabel}
                </button>
                <button
                  id="note-triplet-toggle"
                  aria-pressed={!!selectedNote.triplet}
                  className={selectedNote.triplet ? "icon-btn-active" : undefined}
                  style={btnStyle}
                  onClick={() => toggleTriplet(selectedNote.startGrid)}
                >
                  3
                </button>
              </div>
              {!selectedNote.isRest && targetRowIdx !== null && (
                <button style={btnStyle} onClick={() => pressFlat(selectedNote.startGrid, targetRowIdx)}>
                  ▼
                </button>
              )}
            </div>
          );
        })()}
      </div>
      </div>

      </section>

      <section ref={boardRef} className="sb-board sb-board-tones">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 8px" }}>
        <button
          type="button"
          aria-expanded={boardOpen}
          onClick={() => {
            setSheetBottom(narrowFretboard ? Math.round(boardRef.current?.getBoundingClientRect().height ?? 0) : 0);
            setBoardOpen((v) => !v);
          }}
          style={{ minHeight: 40, padding: "0 14px", borderRadius: 999, border: "1px solid rgba(224,184,79,0.55)", background: "transparent", color: "var(--accent)", fontWeight: 700 }}
        >
          {tr("Fretboard view")} {boardOpen ? "▴" : "▾"}
        </button>
        <span className="sb-mobile-only" style={{ marginLeft: "auto", gap: 6 }}>
          <IconButton
            id="play-btn-mobile"
            label={isPlaying ? tr("Stop") : samplesReady ? tr("Play") : tr("Loading sounds…")}
            text={isPlaying ? tr("Stop") : samplesReady ? tr("Play") : tr("Loading…")}
            variant="primary"
            icon={isPlaying ? <Square size={16} /> : <Play size={16} />}
            active={isPlaying}
            disabled={!samplesReady && !isPlaying}
            onClick={handlePlayClick}
          />
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {[
            shapesOn ? "CAGED" : null,
            focusOn ? `${tr("Focus")} ${focusLo}–${focusHi}` : `${viewFrets} ${tr("frets")}`,
            labelMode === "key" ? tr("Do Re Mi") : "1 3 5 7",
          ].filter(Boolean).join(" · ")}
        </span>
      </div>
      {boardOpen && (
        <>
          <div className="sb-sheet-backdrop" style={{ bottom: sheetBottom }} onClick={() => setBoardOpen(false)} />
          <div className="sb-sheet" role="dialog" aria-modal="true" aria-label={tr("Fretboard view")} style={{ bottom: sheetBottom }}>
            <div className="sb-sheet-grabber" aria-hidden="true" />
            <div className="sb-sheet-head">
              <span style={{ width: 64 }} />
              <span className="sb-sheet-title">{tr("Fretboard view")}</span>
              <button type="button" className="sb-sheet-done" onClick={() => setBoardOpen(false)}>{tr("Done")}</button>
            </div>

            <div className="sb-group-title">{tr("Display")}</div>
            <div className="sb-group">
              <div className="sb-item">
                <span>{tr("CAGED shapes")}</span>
                <Switch on={shapesOn} label={tr("CAGED shapes")} onClick={() => { setShapesOn((v) => !v); setShapeSel(null); }} />
              </div>
              <div className="sb-item">
                <span>{tr("Zoom frets (Focus)")}</span>
                <Switch on={focusOn} label={tr("Zoom frets (Focus)")} onClick={() => setFocusOn((v) => !v)} />
              </div>
              {focusOn ? (
                <>
                  <div className="sb-item">
                    <span>{tr("Range")}</span>
                    <Stepper
                      value={`${tr("Frets")} ${focusLo}–${focusHi}`}
                      downLabel={tr("Move range down")}
                      upLabel={tr("Move range up")}
                      downDisabled={focusLo <= 0}
                      upDisabled={focusHi >= FRETS}
                      onDown={() => shiftFocus(-1)}
                      onUp={() => shiftFocus(1)}
                    />
                  </div>
                  <div className="sb-item">
                    <span>{tr("Width")}</span>
                    <Stepper
                      value={`${focusW} ${tr("frets")}`}
                      downLabel={tr("Fewer frets")}
                      upLabel={tr("More frets")}
                      downDisabled={focusW <= 4}
                      upDisabled={focusW >= 8}
                      onDown={() => setFocusW((w) => Math.max(4, w - 1))}
                      onUp={() => setFocusW((w) => Math.min(8, w + 1))}
                      minus
                    />
                  </div>
                </>
              ) : (
                <div className="sb-item">
                  <span>{tr("Visible frets")}</span>
                  <div className="sb-seg" role="group" aria-label={tr("Visible frets")}>
                    {([12, 17] as const).map((n) => (
                      <button key={n} type="button" aria-pressed={viewFrets === n} className={viewFrets === n ? "sb-seg-on" : ""} onClick={() => setViewFrets(n)}>
                        {n} {tr("frets")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sb-group-title">{tr("Note labels")}</div>
            <div className="sb-seg" role="group" aria-label={tr("Note labels")} style={{ width: "100%" }}>
              {([["key", "Do Re Mi"], ["chord", "1 3 5 7"]] as const).map(([m, label]) => (
                <button key={m} type="button" aria-pressed={labelMode === m} className={labelMode === m ? "sb-seg-on" : ""} style={{ flex: 1 }} onClick={() => setLabelMode(m)}>
                  {tr(label)}
                </button>
              ))}
            </div>

            {shapesOn && (
              <>
                <div className="sb-group-title">{tr("Shapes")}</div>
                {shapeQuality ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button type="button" aria-pressed={shapeSel === null} className="sb-chip" style={{ background: shapeSel === null ? "var(--accent)" : "transparent", color: shapeSel === null ? "var(--on-accent)" : "var(--text-primary)", borderColor: shapeSel === null ? "var(--accent)" : "var(--border-strong)" }} onClick={() => setShapeSel(null)}>
                      {tr("All")}
                    </button>
                    {shapeList.map((sh) => (
                      <button
                        key={sh.name}
                        type="button"
                        aria-pressed={shapeSel === sh.name}
                        className="sb-chip"
                        style={{ borderColor: SHAPE_COLORS[sh.name], background: shapeSel === sh.name ? SHAPE_COLORS[sh.name] : "transparent", color: shapeSel === sh.name ? "#1a1511" : "var(--text-primary)" }}
                        onClick={() => {
                          setShapeSel(shapeSel === sh.name ? null : sh.name);
                          if (focusOn && shapeSel !== sh.name) setFocusLoState(Math.max(0, Math.min(...sh.notes.map((n) => n.f)) - 1));
                        }}
                      >
                        {sh.name} · {sh.start === 0 ? tr("open") : sh.start}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {tr("Shapes are available for maj7, 7, 6, m7, m6, mMaj7, dim and m7♭5 chords. Place or select one of these chords.")}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
      <div id="fretboard-wrap">
        <svg
          id="fretboard"
          viewBox={focusShape ? `${focusX0} -14 ${focusX1 - focusX0} 234` : narrowFretboard ? `0 -14 ${fbLeft + 7 * fretW + 8} 234` : `0 -14 ${wholeX1} 234`}
          style={{ width: "100%", height: "auto", display: "block", minWidth: focusShape || narrowFretboard ? undefined : viewFrets === 17 ? "880px" : "660px" }}
        >
          <defs>
            {(Object.keys(SHAPE_COLORS) as ShapeName[]).map((k) => (
              <g key={k}>
                <filter id={`shape-ring-${k}`} filterUnits="userSpaceOnUse" x="0" y="-14" width="1400" height="234" colorInterpolationFilters="sRGB">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b" />
                  <feComponentTransfer in="b" result="A"><feFuncA type="linear" slope="30" intercept="-10" /></feComponentTransfer>
                  <feMorphology in="A" operator="erode" radius="2.5" result="E" />
                  <feComposite in="A" in2="E" operator="out" result="R" />
                  <feFlood floodColor={SHAPE_COLORS[k]} result="C" />
                  <feComposite in="C" in2="R" operator="in" />
                </filter>
                <filter id={`shape-fill-${k}`} filterUnits="userSpaceOnUse" x="0" y="-14" width="1400" height="234" colorInterpolationFilters="sRGB">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b" />
                  <feComponentTransfer in="b" result="A"><feFuncA type="linear" slope="30" intercept="-10" /></feComponentTransfer>
                  <feFlood floodColor={SHAPE_COLORS[k]} result="C" />
                  <feComposite in="C" in2="A" operator="in" />
                </filter>
              </g>
            ))}
            <radialGradient id="sb-glow-grad">
              <stop offset="0.35" stopColor="#fff3c0" stopOpacity="0.95" />
              <stop offset="0.7" stopColor="#ffd75e" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ffd75e" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="ebony" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#34251b" />
              <stop offset="0.5" stopColor="#241912" />
              <stop offset="1" stopColor="#1b120d" />
            </linearGradient>
          </defs>
          <rect
            x={fbLeft}
            y={fbTop - 16}
            width={FRETS * fretW}
            height={5 * stringGap + 32}
            rx={4}
            fill="url(#ebony)"
          />
          {/* ポジションマーク(パールのインレイ): 3・5・7・9フレットは1つ、12フレットは2つ */}
          {[3, 5, 7, 9, 15, 17].map((f) => (
            <circle key={`inlay-${f}`} cx={fbLeft + f * fretW - fretW / 2} cy={fbTop + 2.5 * stringGap} r={5} fill="#e8e2d2" opacity={0.22} />
          ))}
          {[1.5, 3.5].map((k) => (
            <circle key={`inlay12-${k}`} cx={fbLeft + 12 * fretW - fretW / 2} cy={fbTop + k * stringGap} r={5} fill="#e8e2d2" opacity={0.22} />
          ))}

          {Array.from({ length: FRETS + 1 }, (_, f) => {
            const x = fbLeft + f * fretW;
            return (
              <g key={f}>
                <line
                  x1={x}
                  x2={x}
                  y1={fbTop}
                  y2={fbTop + 5 * stringGap}
                  stroke={f === 0 ? "#d8d2c4" : "#8d877b"}
                  strokeWidth={f === 0 ? 5 : 2}
                />
                {(focusShape ? f >= focusLo && f <= focusHi : [3, 5, 7, 9, 12, 15, 17].includes(f)) && f > 0 && (
                  <text
                    x={x - fretW / 2}
                    y={fbTop - 21}
                    textAnchor="middle"
                    fontSize={focusShape ? 18 : 13}
                    fontWeight={focusShape ? 700 : undefined}
                    fill="var(--text-secondary)"
                  >
                    {f}
                  </text>
                )}
              </g>
            );
          })}

          {strings.map((st, sIdx) => {
            const y = fbTop + sIdx * stringGap;
            return (
              <g key={sIdx}>
                <line
                  x1={fbLeft}
                  x2={fbLeft + FRETS * fretW}
                  y1={y}
                  y2={y}
                  stroke="#cfc8b8"
                  strokeOpacity={0.75}
                  strokeWidth={0.8 + sIdx * 0.35}
                />
                <text
                  x={focusShape && focusLo > 0 ? focusX0 + 3 : fbLeft - 82}
                  y={y + 4}
                  textAnchor={focusShape && focusLo > 0 ? "start" : "end"}
                  fontSize={12}
                  fill="var(--text-secondary)"
                  style={focusShape && focusLo > 0 ? { stroke: "#241912", strokeWidth: 5, paintOrder: "stroke" } : undefined}
                >
                  {focusShape && focusLo > 0 ? `${st.num}·${st.label}` : tr("String") + " " + st.num + " · " + st.label}
                </text>
              </g>
            );
          })}

          {visibleShapes.map((sh) => {
            const fxs = (f: number) => fbLeft + f * fretW - fretW / 2;
            const pts = sh.notes;
            const circles = pts.map((n) => <circle key={`c${n.s}-${n.f}`} cx={fxs(n.f)} cy={fbTop + n.s * stringGap} r={23} fill="#fff" />);
            const links = pts.flatMap((a) => {
              const next = pts.filter((b) => b.s === a.s + 1).sort((p, q) => Math.abs(p.f - a.f) - Math.abs(q.f - a.f))[0];
              return next
                ? [<line key={`l${a.s}-${a.f}`} x1={fxs(a.f)} y1={fbTop + a.s * stringGap} x2={fxs(next.f)} y2={fbTop + next.s * stringGap} stroke="#fff" strokeWidth={40} strokeLinecap="round" />]
                : [];
            });
            return (
              <g key={`shape-${sh.name}-${sh.start}`} pointerEvents="none">
                <g filter={`url(#shape-fill-${sh.name})`} opacity={0.16}>{circles}{links}</g>
                <g filter={`url(#shape-ring-${sh.name})`}>{circles}{links}</g>
              </g>
            );
          })}

          {strings.map((st, sIdx) => {
            const y = fbTop + sIdx * stringGap;
            return (
              <g key={sIdx}>
                {Array.from({ length: FRETS + 1 }, (_, f) => {
                  const absPitch = st.octave * 12 + st.open + f;
                  const pc = (st.open + f) % 12;
                  const isMelody = displayedMelodyAbsPitches.has(absPitch);
                  // 同じポジションが実際のメロディ音符でもある場合は、通常濃度の
                  // メロディ表示を優先し、半透明のコードマーカーは重ねて描かない。
                  const isHarmonyTone = !isMelody && harmonyPitchClasses.has(pc);
                  if (!isMelody && !isHarmonyTone) return null;
                  if (focusShape && (f < focusLo || f > focusHi)) return null;
                  const x = fbLeft + f * fretW - fretW / 2;
                  const useChordDeg = labelMode === "chord" && !!displayedHarmony;
                  const deg = degreeFor(pc, useChordDeg && displayedHarmony ? displayedHarmony.root : root);
                  const [fill] = colorFor((useChordDeg ? CHORD_DEGREE_ROLE : DEGREE_ROLE)[deg]);
                  const chordLabel =
                    deg === 9 && displayedHarmony
                      ? displayedHarmony.kind === "dim"
                        ? "♭♭7"
                        : displayedHarmony.kind.includes("6")
                          ? "6"
                          : "13"
                      : CHORD_DEGREE_NAMES[deg];
                  const isPlaying = playingAbsPitches.has(absPitch);
                  return (
                    <g key={f}>
                      {isPlaying && (
                        <g pointerEvents="none">
                          <circle className="sb-glow" cx={x} cy={y} r={34} fill="url(#sb-glow-grad)" />
                          <circle cx={x} cy={y} r={21} fill="none" stroke="#fff7d6" strokeWidth={3.5} />
                        </g>
                      )}
                      <circle
                        cx={x}
                        cy={y}
                        r={isPlaying ? 17 : 15}
                        style={{ fill }}
                        opacity={isHarmonyTone && !shapeNoteKeys.has(`${sIdx}:${f}`) ? 0.45 : 1}
                      />
                      <text
                        x={x}
                        y={y + 5}
                        textAnchor="middle"
                        fontSize={13}
                        fontWeight="bold"
                        opacity={isHarmonyTone && !shapeNoteKeys.has(`${sIdx}:${f}`) ? 0.7 : 1}
                        style={{
                          fill: "#ffffff",
                          stroke: "rgba(0,0,0,0.55)",
                          strokeWidth: 2,
                          paintOrder: "stroke",
                        }}
                      >
                        {useChordDeg ? chordLabel : DEGREE_NAMES[deg]}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div
        id="degree-legend"
        className="sb-hide-phone"
        aria-label={tr("Colour key")}
        style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", marginTop: "0.5rem", fontSize: 12, color: "var(--text-secondary)" }}
      >
        {(labelMode === "chord"
          ? [
              { label: "1 · root", role: "danger" },
              { label: "3, ♭3 · 3rd", role: "warning" },
              { label: "11 · 4th", role: "accent" },
              { label: "♭5, 5, ♭7, 7", role: "success" },
              { label: "9, 6/13", role: "pro" },
              { label: tr("Other"), role: "gray" },
            ]
          : [
              { label: tr("Do · root"), role: "danger" },
              { label: tr("Mi · 3rd"), role: "warning" },
              { label: tr("Fa · 4th"), role: "accent" },
              { label: tr("Sol, Ti · 5th, 7th"), role: "success" },
              { label: tr("Re, La · 2nd, 6th"), role: "pro" },
              { label: tr("Chromatic"), role: "gray" },
            ]
        ).map((it) => (
          <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              aria-hidden
              style={{ width: 12, height: 12, borderRadius: "50%", display: "inline-block", background: colorFor(it.role)[0] }}
            />
            {it.label}
          </span>
        ))}
      </div>
      {narrowFretboard && (
        <div className="sb-hide-phone" style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {tr("Showing frets 0–7. Rotate your device to see up to fret 12.")}
        </div>
      )}

      <div id="legend" className="sb-hide-phone">
        Click the staff to place a note; click the same spot again to remove it. A selected note shows accidental and duration controls below.
      </div>
      </section>
      </>
      )}
    </>
  );
}
