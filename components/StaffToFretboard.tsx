"use client";

import { useEffect, useRef, useState } from "react";
import { CHORD_TYPES } from "@/lib/chords";
import { TEMPLATES } from "@/lib/templates";
import { parseMusicXmlFile } from "@/lib/musicxmlImport";
import { deleteImportedSong, listImportedSongs, saveImportedSong, type ImportedSong } from "@/lib/importStorage";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const DEGREE_NAMES = ["Do", "Di", "Re", "Me", "Mi", "Fa", "Fi", "Sol", "Le", "La", "Te", "Ti"];
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
const FRETS = 12;

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
};
// 転回形のラベル（インデックス=ベースになる構成音の順位。0=ルート）。
// 3和音なら第2転回形まで、4和音（7thコード）なら第3転回形まで存在する。
const INVERSION_LABELS = ["基本形", "第1転回形", "第2転回形", "第3転回形"];

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
const STAFF_RENDER_HEIGHT_PX = 296;
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
  const [fullFeedback, setFullFeedback] = useState(false);
  const [currentMeasureIndex, setCurrentMeasureIndex] = useState(0);
  // MusicXMLインポート（サーバーには送信せず、ブラウザのIndexedDBにのみ保存する）。
  const [importedSongs, setImportedSongs] = useState<ImportedSong[]>([]);
  const [selectedImportId, setSelectedImportId] = useState("");
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
    peakGain: number
  ) {
    const ctx = ensureAudioContext();
    const clamped = clampToSampleRange(absPitch, minPitch, maxPitch);
    const buffer = cache.get(clamped);
    if (!buffer) return; // 通常はPlay開始前にロード済みのため起きない
    const now = ctx.currentTime;

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

  function playMelodyTone(absPitch: number, durationSec: number) {
    playSample(melodySampleCacheRef.current, absPitch, MELODY_SAMPLE_MIN_ABS_PITCH, MELODY_SAMPLE_MAX_ABS_PITCH, durationSec, 0.9);
  }

  function playBassTone(absPitch: number, durationSec: number) {
    // 低音は等ラウドネス曲線の影響で同じgain値でも高い音より小さく聞こえるため、
    // メロディ(0.9)よりgain自体を大きめにしている（サンプルの実測ピークは
    // 約-18dBなので、この値でもクリップの心配はない）。
    playSample(bassSampleCacheRef.current, absPitch, BASS_MIN_ABS_PITCH, BASS_MAX_ABS_PITCH, durationSec, 1.8);
  }

  // ピアノ風の薄いコンピング。ハーモニー(コード)の開始タイミングごとに、
  // buildChordVoicingと同じボイシングを1オクターブ下げて短く鳴らす
  // （メロディ・ウォーキングベースの主役を邪魔しないよう、音量は控えめ・
  // 音価もそのコード区間いっぱいではなく短いスタブに留める）。
  function playCompChord(rootPc: number, chordType: string, inversion: number, durationSec: number) {
    const absPitches = buildChordVoicingAbsPitches(rootPc, chordType, inversion);
    absPitches.forEach((abs) => {
      playSample(
        compSampleCacheRef.current,
        abs + COMP_OCTAVE_SHIFT,
        COMP_SAMPLE_MIN_ABS_PITCH,
        COMP_SAMPLE_MAX_ABS_PITCH,
        durationSec,
        0.42
      );
    });
  }

  // ドラムは音価を持たない単発トリガーなので、音符/ベースのようなdurationSec
  // 指定は不要（サンプル自体の自然な減衰に任せる）。ライドだけは音の重なりで
  // 濁らないよう、DRUM_VOICE_MAX_DURATION_SECの長さでフェードアウトさせる。
  function playDrumHit(voice: DrumVoice) {
    const ctx = ensureAudioContext();
    const buffer = drumSampleCacheRef.current.get(voice);
    if (!buffer) return; // 通常はPlay開始前にロード済みのため起きない
    const now = ctx.currentTime;

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
      stopPlayback();
      return;
    }
    const hasContent = measures.some((m) => m.notes.length > 0 || m.harmonies.length > 0);
    if (!hasContent) return;
    // 通常はPlayボタンがsamplesReadyになるまで無効化されているため素通りするが、
    // 念のためここでも先読みの完了を待つ。
    await ensureSamplesLoaded();

    const measureDurationMs = gridToMs(gridsPerMeasure);
    const events: PlaybackEvent[] = [];
    measures.forEach((m, measureIndex) => {
      const measureStartMs = measureIndex * measureDurationMs;
      m.notes.forEach((note) => {
        const atMs = measureStartMs + gridToMs(note.startGrid);
        const toneSec = durationToMs(note.duration) / 1000;
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
    buildWalkingBassEvents(measures, gridsPerMeasure, timeSig).forEach((be) => {
      const atMs = gridToMs(be.atGrid);
      const toneSec = gridToMs(be.durationGrid) / 1000;
      const measureIndex = Math.floor(be.atGrid / gridsPerMeasure);
      events.push({ atMs, endMs: atMs + toneSec * 1000, measureIndex, kind: "bass", absPitch: be.absPitch });
    });
    // ドラム: メロディ・ベースと同じ絶対時間軸（measureDurationMs・QUARTER_NOTE_MS）
    // に載せることで、テンポが変わってもドラムだけ走る/遅れるということが起きない。
    // 現状は4/4のジャズ基本パターンのみ対応（それ以外の拍子では無音）。
    buildDrumEvents(measures.length, measureDurationMs, QUARTER_NOTE_MS, timeSig).forEach((de) => {
      events.push({ atMs: de.atMs, endMs: de.atMs, measureIndex: de.measureIndex, kind: "drum", voice: de.voice });
    });
    if (events.length === 0) return;
    events.sort((a, b) => a.atMs - b.atMs);
    const overallEndMs = Math.max(...events.map((e) => e.endMs));

    setIsPlaying(true);
    // 再生開始時点で、最初のイベントが属する小節にただちに表示を合わせる。
    setCurrentMeasureIndex(events[0].measureIndex);

    events.forEach((ev) => {
      const timeoutId = setTimeout(() => {
        // 再生中の音符/コードが属する小節に自動的に表示を追従させる。
        setCurrentMeasureIndex(ev.measureIndex);
        const toneSec = (ev.endMs - ev.atMs) / 1000;
        if (ev.kind === "note") {
          const note = ev.note;
          if (!note.isRest && note.rowIdxList.length > 0) {
            setPlayingNoteKey({ measureIndex: ev.measureIndex, startGrid: note.startGrid });
            // 和音（手動積み上げ）の場合は含まれる全ての音を同じタイミングで鳴らす。
            note.rowIdxList.forEach((rowIdx) => {
              const absPitch = rows[rowIdx].octave * 12 + rows[rowIdx].pc + (note.accidentals[rowIdx] ?? 0);
              playMelodyTone(absPitch, toneSec);
            });
          } else {
            // 休符の間は、前の音符のハイライトが残ったままにならないよう解除する。
            setPlayingNoteKey(null);
          }
        } else if (ev.kind === "bass") {
          // 音符同士をわずかに切り離し、指ではじくベースらしい粒立ちを出す。
          playBassTone(ev.absPitch, toneSec * 0.92);
        } else if (ev.kind === "drum") {
          playDrumHit(ev.voice);
        } else {
          // harmonyのタイミングでコードハイライト表示を更新しつつ、ピアノ風の
          // 薄いコンピングも鳴らす（実際の低音はkind:"bass"のウォーキングベースが
          // 担当するので、コンピングはあくまで響きを添えるだけの短いスタブ）。
          setPlayingHarmonyKey({ measureIndex: ev.measureIndex, offsetGrid: ev.harmony.offsetGrid });
          playCompChord(ev.harmony.root, ev.harmony.kind, ev.harmony.inversion, Math.min(toneSec, COMP_STAB_MAX_SEC));
        }
      }, ev.atMs);
      timeoutIdsRef.current.push(timeoutId);
    });

    const endTimeoutId = setTimeout(() => {
      setIsPlaying(false);
      setPlayingNoteKey(null);
      setPlayingHarmonyKey(null);
    }, overallEndMs);
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
  const xForGrid = (g: number) => LEFT + g * GRID_UNIT_WIDTH;
  // 小節線(=xForGrid(gridsPerMeasure))の位置。この右側に次の小節の頭のプレビューを描画する。
  const barlineX = LEFT + NOTE_AREA_WIDTH;
  const previewXForGrid = (g: number) => barlineX + PREVIEW_GAP_PX + g * GRID_UNIT_WIDTH;
  const STAFF_VB_W = barlineX + PREVIEW_GAP_PX + PREVIEW_WIDTH_PX + NOTE_AREA_MARGIN_RIGHT;
  // 高さを STAFF_RENDER_HEIGHT_PX に固定したまま、viewBoxの縦横比に応じて
  // 横幅だけを自然に伸ばす（縦のスケール＝ト音記号や五線の間隔は変えない）。
  const staffRenderedWidth = STAFF_RENDER_HEIGHT_PX * (STAFF_VB_W / STAFF_VB_H);

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
        notes: m.notes.filter((n) => n.startGrid + n.duration <= newGridsPerMeasure),
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
    // 小節線より右側（次の小節のプレビュー領域）のクリックは無視する。
    // プレビューは表示のみで、クリック・編集の対象は表示中の小節に限る。
    if (x > barlineX) return;
    let grid = Math.round((x - LEFT) / GRID_UNIT_WIDTH);
    grid = Math.max(0, Math.min(gridsPerMeasure - 1, grid));
    let rowIdx = Math.round((y - rows[0].y) / 10);
    rowIdx = Math.max(0, Math.min(rows.length - 1, rowIdx));

    const covering = notes.find((n) => grid >= n.startGrid && grid < n.startGrid + n.duration);
    if (covering) {
      if (restMode) {
        if (covering.isRest) {
          updateMeasureNotes(currentMeasureIndex, (ns) => ns.filter((n) => n !== covering));
          setSelectedNoteKey((prev) => (prev === covering.startGrid ? null : prev));
          setSelectedRowIdx(null);
        } else {
          updateMeasureNotes(currentMeasureIndex, (ns) =>
            ns.map((n) => (n === covering ? { ...n, isRest: true, rowIdxList: [], accidentals: {} } : n))
          );
          setSelectedNoteKey(covering.startGrid);
          setSelectedRowIdx(null);
        }
      } else {
        if (covering.isRest) {
          updateMeasureNotes(currentMeasureIndex, (ns) =>
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
            updateMeasureNotes(currentMeasureIndex, (ns) => ns.filter((n) => n !== covering));
            setSelectedNoteKey((prev) => (prev === covering.startGrid ? null : prev));
            setSelectedRowIdx(null);
          } else {
            updateMeasureNotes(currentMeasureIndex, (ns) =>
              ns.map((n) => (n === covering ? { ...n, rowIdxList: newList, accidentals: newAccidentals } : n))
            );
            setSelectedNoteKey(covering.startGrid);
            setSelectedRowIdx((prev) => (prev === rowIdx ? newList[0] : prev));
          }
        } else {
          // 既存音符がある位置で違う段をクリック -> その音を和音に追加する。
          const newList = [...covering.rowIdxList, rowIdx].sort((a, b) => a - b);
          const newAccidentals = { ...covering.accidentals, [rowIdx]: defaultAccidentalForRow(rowIdx) };
          updateMeasureNotes(currentMeasureIndex, (ns) =>
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
    const appendGrid = notes.length === 0 ? 0 : Math.max(...notes.map((n) => n.startGrid + n.duration));
    if (appendGrid >= gridsPerMeasure) {
      setFullFeedback(true);
      setTimeout(() => setFullFeedback(false), 250);
      return;
    }
    const duration = Math.min(defaultDuration, gridsPerMeasure - appendGrid);
    const newNote: Note = restMode
      ? { startGrid: appendGrid, duration, isRest: true, rowIdxList: [], accidentals: {} }
      : {
          startGrid: appendGrid,
          duration,
          isRest: false,
          rowIdxList: [rowIdx],
          accidentals: { [rowIdx]: defaultAccidentalForRow(rowIdx) },
        };
    updateMeasureNotes(currentMeasureIndex, (ns) => [...ns, newNote].sort((a, b) => a.startGrid - b.startGrid));
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
    if (x > barlineX) return;
    let grid = Math.round((x - LEFT) / GRID_UNIT_WIDTH);
    grid = Math.max(0, Math.min(gridsPerMeasure - 1, grid));
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
      const maxAllowed = nextNote ? nextNote.startGrid - note.startGrid : gridsPerMeasure - note.startGrid;

      // 直後の候補が入らない場合、そこで諦めず、入る音価が見つかるまで
      // サイクル順に探し続ける（入らない値をスキップして先に進む）。
      let candidate = nextDurationInCycle(note.duration);
      for (let i = 0; i < DURATION_CYCLE.length && candidate > maxAllowed; i++) {
        candidate = nextDurationInCycle(candidate);
      }
      if (candidate > maxAllowed) return prev;
      // 音価切り替えボタンで変更した音価を、次に新規配置する音符・休符のデフォルトにも引き継ぐ。
      setDefaultDuration(candidate);
      return sorted.map((n, i) => (i === idx ? { ...n, duration: candidate } : n));
    });
  }

  // 全小節のnotes・harmoniesを両方まとめてリセットする（従来の「クリア」ボタンの
  // 挙動を、独立した2つのデータに対しても踏襲する）。ユーザーが＋/削除で組み立てた
  // 小節数そのものは維持し、中身だけを空にする（小節構成をクリアで失わせない）。
  function handleClear() {
    setMeasures((prev) => prev.map(() => ({ notes: [], harmonies: [] })));
    setSelectedNoteKey(null);
    setSelectedRowIdx(null);
    setDefaultDuration(DEFAULT_DURATION);
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

  const fbLeft = 100;
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
      const beamable = !c.note.isRest && c.note.duration <= 8;
      if (!beamable) {
        if (current.length) groups.push(current);
        current = [];
        currentBeatIdx = null;
        continue;
      }
      // note.startGridは自分が属する小節内のローカルなグリッド番号なので、そのまま使う。
      const beatIdx = Math.floor(c.note.startGrid / beamGroupingUnit);
      const prev = current[current.length - 1];
      const contiguous = !prev || prev.note.startGrid + prev.note.duration === c.note.startGrid;
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
      </>
    );
  }

  // harmonies(コード記号)は音価もクリック編集も持たない、notesとは完全に独立した
  // 表示専用レイヤー。root/kind/inversionからその場でボイシングを計算し、透明な
  // 符頭(全音符型、符幹なし)とコード名を重ねて描画するだけで、notesの描画・
  // クリック判定には一切関与しない。
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
                fontSize={13}
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
        :root {
          --border: #d3d1c7;
          --border-strong: #b4b2a9;
          --text-primary: #2c2c2a;
          --text-secondary: #5f5e5a;
          --surface-0: #f1efe8;
          --danger: #D85A30; --on-danger:#4A1B0C;
          --warning: #EF9F27; --on-warning:#412402;
          --success: #1D9E75; --on-success:#04342C;
          --pro: #7F77DD; --on-pro:#26215C;
          --gray: #888780; --on-gray:#2C2C2A;
          --accent: #378ADD; --on-accent:#042C53;
        }
        body {
          font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
          background: var(--surface-0);
          color: var(--text-primary);
          max-width: 760px;
          margin: 2rem auto;
          padding: 0 1rem;
        }
        select, button {
          height: 32px;
          border-radius: 6px;
          border: 1px solid var(--border-strong);
          background: white;
          padding: 0 10px;
          font-size: 13px;
        }
        button:hover { background: #f5f5f0; cursor: pointer; }
        #controls { display:flex; align-items:center; gap:10px; margin: 0 0 1rem; flex-wrap: wrap; }
        #legend { font-size: 12px; color: var(--text-secondary); margin-top: 1rem; }
        #fretboard-wrap { overflow-x: auto; }
      `}</style>

      <h2 style={{ fontSize: "18px", fontWeight: 500 }}>五線譜 → ギター指板 プロトタイプ</h2>

      <div id="controls">
        <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>テンプレート</label>
        <select
          id="template-select"
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            handleLoadTemplate(e.target.value);
            e.target.value = ""; // 読み込み後は「未選択」に戻す(measuresは通常のstateとして編集可能)
          }}
        >
          <option value="">選択…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>マイインポート</label>
        <select
          id="my-imports-select"
          value={selectedImportId}
          onChange={(e) => {
            setSelectedImportId(e.target.value);
            if (e.target.value) handleLoadImportedSong(e.target.value);
          }}
        >
          <option value="">{importedSongs.length === 0 ? "（まだありません）" : "選択…"}</option>
          {importedSongs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedImportId && (
          <button
            id="my-imports-delete-btn"
            title="選択中のマイインポートを削除"
            onClick={() => void handleDeleteImportedSong(selectedImportId)}
          >
            削除
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,.xml,.musicxml,.mxl"
          style={{ display: "none" }}
          onChange={handleImportFileSelected}
        />
        <button id="import-musicxml-btn" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
          {isImporting ? "インポート中…" : "MusicXMLをインポート"}
        </button>

        <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>キー（移動ドのDo）</label>
        <select value={root} onChange={(e) => setRoot(parseInt(e.target.value, 10))}>
          {names.map((n, i) => (
            <option key={i} value={i}>
              {n}
            </option>
          ))}
        </select>
        <button
          id="accidental-toggle"
          onClick={() => setUseFlats((prev) => !prev)}
        >
          {useFlats ? "#表記" : "♭表記"}
        </button>
        <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>拍子</label>
        <select
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
        <button
          id="rest-toggle"
          onClick={() => setRestMode((prev) => !prev)}
          style={restMode ? { background: "var(--accent)", color: "white" } : undefined}
        >
          休符
        </button>
        <button
          id="measure-prev-btn"
          onClick={() => {
            setCurrentMeasureIndex((i) => Math.max(0, i - 1));
            // ローカルなstartGridは小節をまたいで一意ではないため、選択状態は
            // 小節移動のたびにリセットする（別の小節の音符が誤って選択中扱いに
            // ならないようにする）。
            setSelectedNoteKey(null);
            setSelectedRowIdx(null);
            setChordTargetGrid(0);
          }}
          disabled={currentMeasureIndex === 0}
        >
          ◀
        </button>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {currentMeasureIndex + 1}/{measures.length}小節目
        </span>
        <button
          id="measure-next-btn"
          onClick={() => {
            setCurrentMeasureIndex((i) => Math.min(measures.length - 1, i + 1));
            setSelectedNoteKey(null);
            setSelectedRowIdx(null);
            setChordTargetGrid(0);
          }}
          disabled={currentMeasureIndex === measures.length - 1}
        >
          ▶
        </button>
        <button id="measure-add-btn" onClick={handleAddMeasure} title="末尾に小節を追加">
          ＋
        </button>
        <button
          id="measure-delete-btn"
          onClick={handleDeleteMeasure}
          disabled={measures.length <= 1}
          title="表示中の小節を削除"
        >
          削除
        </button>
        <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>コード</label>
        <select id="chord-root-select" value={chordRoot} onChange={(e) => setChordRoot(parseInt(e.target.value, 10))}>
          {names.map((n, i) => (
            <option key={i} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select id="chord-type-select" value={chordType} onChange={(e) => setChordType(e.target.value)}>
          {Object.keys(CHORD_TYPES).map((type) => (
            <option key={type} value={type}>
              {CHORD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <select
          id="chord-inversion-select"
          value={chordInversion}
          onChange={(e) => setChordInversion(parseInt(e.target.value, 10))}
        >
          {Array.from({ length: CHORD_TYPES[chordType].length }, (_, i) => i).map((inv) => (
            <option key={inv} value={inv}>
              {INVERSION_LABELS[inv]}
            </option>
          ))}
        </select>
        <button id="chord-place-btn" onClick={handlePlaceChord}>
          和音を配置
        </button>
        <button
          id="play-btn"
          style={{ marginLeft: "auto" }}
          onClick={handlePlayClick}
          disabled={!samplesReady && !isPlaying}
        >
          {isPlaying ? "■ 停止" : samplesReady ? "▶ Play" : "音源読み込み中…"}
        </button>
        <button id="clear-btn" onClick={handleClear}>
          クリア
        </button>
      </div>

      {lastImportWarnings && (
        <div
          id="import-warnings"
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            background: "var(--gray)",
            borderRadius: 6,
            padding: "6px 10px",
            margin: "0 0 1rem",
          }}
        >
          <details>
            <summary style={{ cursor: "pointer" }}>
              「{lastImportWarnings.fileName}」のインポート結果:{" "}
              {lastImportWarnings.warnings.length === 0 ? "警告なし" : `${lastImportWarnings.warnings.length}件の警告（クリックで表示）`}
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

      <div id="staff-wrap" style={{ overflowX: "auto" }}>
      <svg
        id="staff"
        viewBox={`0 0 ${STAFF_VB_W} ${STAFF_VB_H}`}
        style={{
          width: `${staffRenderedWidth}px`,
          height: `${STAFF_RENDER_HEIGHT_PX}px`,
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

        {/* 次の小節の頭を、小節線の向こうに半透明・小さめでプレビュー表示する。
            表示のみでクリック・編集の対象にはしない（pointerEvents="none"、
            handleStaffClick側でも小節線より右のクリックは無視する）。 */}
        {(() => {
          const nextMeasure = measures[currentMeasureIndex + 1];
          const previewNotes = nextMeasure
            ? nextMeasure.notes.filter((note) => note.startGrid * GRID_UNIT_WIDTH < PREVIEW_WIDTH_PX)
            : [];
          const previewHarmonies = nextMeasure
            ? nextMeasure.harmonies.filter((h) => h.offsetGrid * GRID_UNIT_WIDTH < PREVIEW_WIDTH_PX)
            : [];
          if (previewNotes.length === 0 && previewHarmonies.length === 0) return null;
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
          width={barlineX - (LEFT - 40)}
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
        コードを配置する位置をクリック
      </div>
      <svg
        id="chord-timeline"
        viewBox={`0 0 ${STAFF_VB_W} 26`}
        preserveAspectRatio="none"
        style={{ width: `${staffRenderedWidth}px`, height: "24px", display: "block", cursor: "pointer" }}
        onClick={handleChordTimelineClick}
      >
        <rect
          x={LEFT}
          y={5}
          width={barlineX - LEFT}
          height={12}
          rx={3}
          fill="var(--surface-0)"
          stroke="var(--border)"
        />
        {/* 配置予定位置(chordTargetGrid)を示す三角マーカー。 */}
        <polygon
          points={`${displayXForNote(chordTargetGrid) - 6},1 ${displayXForNote(chordTargetGrid) + 6},1 ${displayXForNote(chordTargetGrid)},13`}
          fill="var(--accent)"
        />
      </svg>
      </div>

      <div style={{ margin: "0 0 1.5rem", height: "72px", overflowX: "auto" }}>
      <div style={{ position: "relative", width: `${staffRenderedWidth}px`, height: "72px" }}>
        {(() => {
          // notesは既に表示中の小節(measures[currentMeasureIndex].notes)にスコープ
          // されているため、この中で見つかった時点で表示中の小節の音符だと確定する。
          const selectedNote = notes.find((n) => n.startGrid === selectedNoteKey);
          if (!selectedNote) return null;
          const leftPercent = (displayXForNote(selectedNote.startGrid) / STAFF_VB_W) * 100;
          const durationLabel =
            selectedNote.duration === 16
              ? "全"
              : selectedNote.duration === 8
                ? "2分"
                : selectedNote.duration === 4
                  ? "4分"
                  : selectedNote.duration === 2
                    ? "8分"
                    : "16分";
          const btnStyle = { fontSize: "11px", padding: "0 4px", width: "34px", height: "20px", lineHeight: "1" };
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
              <button style={btnStyle} onClick={() => cycleDuration(selectedNote.startGrid)}>
                {durationLabel}
              </button>
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

      <div id="fretboard-wrap">
        <svg
          id="fretboard"
          viewBox="0 0 940 220"
          style={{ width: "100%", height: "auto", display: "block", minWidth: "660px" }}
        >
          {Array.from({ length: FRETS + 1 }, (_, f) => {
            const x = fbLeft + f * fretW;
            return (
              <g key={f}>
                <line
                  x1={x}
                  x2={x}
                  y1={fbTop}
                  y2={fbTop + 5 * stringGap}
                  stroke="var(--border-strong)"
                  strokeWidth={f === 0 ? 3 : 1}
                />
                {[3, 5, 7, 9, 12].includes(f) && f > 0 && (
                  <text
                    x={x - fretW / 2}
                    y={fbTop - 10}
                    textAnchor="middle"
                    fontSize={13}
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
                  stroke="var(--border-strong)"
                />
                <text
                  x={fbLeft - 14}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={12}
                  fill="var(--text-secondary)"
                >
                  {st.num + "弦 " + st.label}
                </text>
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
                  const x = fbLeft + (f === 0 ? 0 : f * fretW - fretW / 2);
                  const deg = degreeFor(pc, root);
                  const [fill] = colorFor(DEGREE_ROLE[deg]);
                  const isPlaying = playingAbsPitches.has(absPitch);
                  return (
                    <g key={f}>
                      {isPlaying && (
                        <circle
                          cx={x}
                          cy={y}
                          r={17}
                          fill="none"
                          stroke="var(--danger)"
                          strokeWidth={3}
                          opacity={0.85}
                        />
                      )}
                      <circle
                        cx={x}
                        cy={y}
                        r={isPlaying ? 14 : 12}
                        style={{ fill }}
                        opacity={isHarmonyTone ? 0.35 : 1}
                      />
                      <text
                        x={x}
                        y={y + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight="bold"
                        opacity={isHarmonyTone ? 0.7 : 1}
                        style={{
                          fill: "#ffffff",
                          stroke: "rgba(0,0,0,0.55)",
                          strokeWidth: 2,
                          paintOrder: "stroke",
                        }}
                      >
                        {DEGREE_NAMES[deg]}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div id="legend">
        五線譜をクリックして音を置く（同じ場所をもう一度で消去）。音符が置かれると下に♮/#/♭・音価の切り替えボタンが出ます。
      </div>
    </>
  );
}
