"use client";

import { useEffect, useRef, useState } from "react";

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

const STAFF_VB_H = 280;
const STAFF_TOP = 100;
const rowNames = ["A5", "G5", "F5", "E5", "D5", "C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"];
const rowPcs = [9, 7, 5, 4, 2, 0, 11, 9, 7, 5, 4, 2, 0];
const rows = rowNames.map((name, i) => ({
  y: STAFF_TOP - 20 + i * 10,
  name,
  pc: rowPcs[i],
  octave: parseInt(name.slice(-1), 10),
}));
const MIDDLE_LINE_Y = rows[6].y; // B4, 五線の中央線

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
  return (m.yMin + m.yMax) / 2;
}

const SHARP_KEY_ROWS = [2, 5, 1, 4, 7, 3, 6];
const FLAT_KEY_ROWS = [6, 3, 7, 4, 1, 5, 2];
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

// A4 (pc=9, octave=4) -> absPitch = 4*12+9 = 57 を440Hzの基準点とする。
const A4_ABS_PITCH = 57;
const QUARTER_NOTE_MS = 500;

function pitchToFrequency(absPitch: number) {
  return 440 * Math.pow(2, (absPitch - A4_ABS_PITCH) / 12);
}

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

type Note = {
  startGrid: number;
  duration: number;
  isRest: boolean;
  rowIdx: number | null;
  accidental: number;
};

type TimeSignature = { numerator: number; denominator: number };
const TIME_SIG_OPTIONS: TimeSignature[] = [
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 2, denominator: 4 },
  { numerator: 6, denominator: 8 },
];

const GRID_UNIT_WIDTH = 24;
// 前回縮小した五線譜の高さ（見た目のスケール）を固定し、横幅だけが
// GRID_UNIT_WIDTH に応じて自然に伸びるようにするための基準高さ(px)。
const STAFF_RENDER_HEIGHT_PX = 296;
const NOTE_AREA_MARGIN_RIGHT = 40;
const MEASURE_COUNT = 2;

export default function StaffToFretboard() {
  const [useFlats, setUseFlats] = useState(true);
  const [root, setRoot] = useState(0);
  const [timeSig, setTimeSig] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteKey, setSelectedNoteKey] = useState<number | null>(null);
  const [restMode, setRestMode] = useState(false);
  const [fullFeedback, setFullFeedback] = useState(false);
  const [currentMeasureIndex, setCurrentMeasureIndex] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playingNoteKey, setPlayingNoteKey] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearScheduledPlayback() {
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current = [];
  }

  function stopPlayback() {
    clearScheduledPlayback();
    setIsPlaying(false);
    setPlayingNoteKey(null);
  }

  useEffect(() => {
    return () => {
      clearScheduledPlayback();
      audioContextRef.current?.close();
    };
  }, []);

  function playTone(absPitch: number, durationSec: number) {
    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    const freq = pitchToFrequency(absPitch);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;

    const now = ctx.currentTime;
    const attack = 0.01;
    const release = Math.min(0.05, durationSec / 4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + attack);
    gain.gain.setValueAtTime(0.3, now + durationSec - release);
    gain.gain.linearRampToValueAtTime(0, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);
  }

  function handlePlayClick() {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    if (notes.length === 0) return;

    const sorted = [...notes].sort((a, b) => a.startGrid - b.startGrid);
    const firstGrid = sorted[0].startGrid;
    setIsPlaying(true);
    // 再生開始時点で、最初の音符が属する小節にただちに表示を合わせる。
    setCurrentMeasureIndex(Math.floor(firstGrid / gridsPerMeasure));
    sorted.forEach((note, idx) => {
      const startMs = gridToMs(note.startGrid - firstGrid);
      const toneSec = durationToMs(note.duration) / 1000;
      const timeoutId = setTimeout(() => {
        // 再生中の音符/休符が属する小節に自動的に表示を追従させる。
        setCurrentMeasureIndex(Math.floor(note.startGrid / gridsPerMeasure));
        if (!note.isRest && note.rowIdx !== null) {
          const absPitch = rows[note.rowIdx].octave * 12 + rows[note.rowIdx].pc + note.accidental;
          setPlayingNoteKey(note.startGrid);
          playTone(absPitch, toneSec);
        } else {
          // 休符の間は、前の音符のハイライトが残ったままにならないよう解除する。
          setPlayingNoteKey(null);
        }

        if (idx === sorted.length - 1) {
          const endTimeoutId = setTimeout(() => {
            setIsPlaying(false);
            setPlayingNoteKey(null);
          }, toneSec * 1000);
          timeoutIdsRef.current.push(endTimeoutId);
        }
      }, startMs);
      timeoutIdsRef.current.push(timeoutId);
    });
  }

  const keySig = getKeySignature(root, useFlats);
  const sigRows = keySig.type === "sharp" ? SHARP_KEY_ROWS : FLAT_KEY_ROWS;
  const sigGlyphName = keySig.type === "sharp" ? "accidentalSharp" : "accidentalFlat";
  const sigChar = bravuraChar(sigGlyphName);
  const sigStartX = 140;
  const sigSpacing = 16;
  const TIME_SIG_RESERVED_W = 95;
  const keySigEndX = sigStartX + keySig.count * sigSpacing + 30;
  const timeSigCenterX = keySigEndX + TIME_SIG_RESERVED_W / 2;
  const LEFT = keySigEndX + TIME_SIG_RESERVED_W;

  const gridsPerBeat = 16 / timeSig.denominator;
  const gridsPerMeasure = timeSig.numerator * gridsPerBeat;
  const totalGrids = gridsPerMeasure * MEASURE_COUNT;
  // 現在表示中の小節の先頭（グローバルなグリッド番号）。
  const measureStartGrid = currentMeasureIndex * gridsPerMeasure;
  // グローバルなグリッド番号を受け取り、現在表示中の小節を基準にした
  // ローカルなx座標を返す（表示中の小節だけがviewBoxに収まる）。
  const xForGrid = (g: number) => LEFT + (g - measureStartGrid) * GRID_UNIT_WIDTH;
  const STAFF_VB_W = LEFT + gridsPerMeasure * GRID_UNIT_WIDTH + NOTE_AREA_MARGIN_RIGHT;
  // 高さを STAFF_RENDER_HEIGHT_PX に固定したまま、viewBoxの縦横比に応じて
  // 横幅だけを自然に伸ばす（縦のスケール＝ト音記号や五線の間隔は変えない）。
  const staffRenderedWidth = STAFF_RENDER_HEIGHT_PX * (STAFF_VB_W / STAFF_VB_H);

  // 表示専用: 小節の頭（小節線と同じグリッド）に音符が来る場合、玉が小節線と
  // 重なって見づらいため、描画位置だけを少し右にずらす。startGrid（拍・グリッド計算、
  // 再生タイミング、クリック判定）には一切影響しない。
  const BARLINE_NOTE_VISUAL_OFFSET = 14;
  const displayXForNote = (startGrid: number) => {
    const rawX = xForGrid(startGrid);
    const isAtBarline = startGrid > 0 && startGrid % gridsPerMeasure === 0;
    return isAtBarline ? rawX + BARLINE_NOTE_VISUAL_OFFSET : rawX;
  };

  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

  function handleTimeSigChange(numerator: number, denominator: number) {
    const newGridsPerMeasure = numerator * (16 / denominator);
    const newTotalGrids = newGridsPerMeasure * 2;
    setTimeSig({ numerator, denominator });
    setNotes((prev) => prev.filter((n) => n.startGrid + n.duration <= newTotalGrids));
  }

  function handleStaffClick(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (STAFF_VB_W / rect.width);
    const y = (e.clientY - rect.top) * (STAFF_VB_H / rect.height);
    let localGrid = Math.round((x - LEFT) / GRID_UNIT_WIDTH);
    localGrid = Math.max(0, Math.min(gridsPerMeasure - 1, localGrid));
    const grid = localGrid + measureStartGrid;
    let rowIdx = Math.round((y - rows[0].y) / 10);
    rowIdx = Math.max(0, Math.min(rows.length - 1, rowIdx));

    const covering = notes.find((n) => grid >= n.startGrid && grid < n.startGrid + n.duration);
    if (covering) {
      if (restMode) {
        if (covering.isRest) {
          setNotes(notes.filter((n) => n !== covering));
          setSelectedNoteKey((prev) => (prev === covering.startGrid ? null : prev));
        } else {
          setNotes(
            notes.map((n) => (n === covering ? { ...n, isRest: true, rowIdx: null, accidental: 0 } : n))
          );
          setSelectedNoteKey(covering.startGrid);
        }
      } else {
        if (covering.isRest) {
          setNotes(notes.map((n) => (n === covering ? { ...n, isRest: false, rowIdx, accidental: 0 } : n)));
          setSelectedNoteKey(covering.startGrid);
        } else if (covering.rowIdx === rowIdx) {
          setNotes(notes.filter((n) => n !== covering));
          setSelectedNoteKey((prev) => (prev === covering.startGrid ? null : prev));
        } else {
          setNotes(notes.map((n) => (n === covering ? { ...n, rowIdx, accidental: 0 } : n)));
          setSelectedNoteKey(covering.startGrid);
        }
      }
      return;
    }

    // 空きエリアをクリックした場合、クリックしたx座標(グリッド)は使わず、
    // 現在配置されている音符・休符のうち一番右端（末尾）の直後の
    // 空きグリッドに自動追加する。y座標（音高）だけがクリック内容を左右する。
    const appendGrid = notes.length === 0 ? 0 : Math.max(...notes.map((n) => n.startGrid + n.duration));
    if (appendGrid >= totalGrids) {
      setFullFeedback(true);
      setTimeout(() => setFullFeedback(false), 250);
      return;
    }
    const duration = Math.min(DEFAULT_DURATION, totalGrids - appendGrid);
    const newNote: Note = restMode
      ? { startGrid: appendGrid, duration, isRest: true, rowIdx: null, accidental: 0 }
      : { startGrid: appendGrid, duration, isRest: false, rowIdx, accidental: 0 };
    setNotes([...notes, newNote].sort((a, b) => a.startGrid - b.startGrid));
    setSelectedNoteKey(appendGrid);
  }

  // ▲: #でなければ#にする、既に#ならナチュラルに戻す。
  function pressSharp(startGrid: number) {
    setNotes((prev) =>
      prev.map((n) => (n.startGrid === startGrid ? { ...n, accidental: n.accidental === 1 ? 0 : 1 } : n))
    );
  }

  // ▼: ♭でなければ♭にする、既に♭ならナチュラルに戻す。
  function pressFlat(startGrid: number) {
    setNotes((prev) =>
      prev.map((n) => (n.startGrid === startGrid ? { ...n, accidental: n.accidental === -1 ? 0 : -1 } : n))
    );
  }

  function cycleDuration(startGrid: number) {
    setNotes((prev) => {
      const sorted = [...prev].sort((a, b) => a.startGrid - b.startGrid);
      const idx = sorted.findIndex((n) => n.startGrid === startGrid);
      if (idx === -1) return prev;
      const note = sorted[idx];
      const nextNote = sorted[idx + 1];
      const maxAllowed = nextNote ? nextNote.startGrid - note.startGrid : totalGrids - note.startGrid;

      // 直後の候補が入らない場合、そこで諦めず、入る音価が見つかるまで
      // サイクル順に探し続ける（入らない値をスキップして先に進む）。
      let candidate = nextDurationInCycle(note.duration);
      for (let i = 0; i < DURATION_CYCLE.length && candidate > maxAllowed; i++) {
        candidate = nextDurationInCycle(candidate);
      }
      if (candidate > maxAllowed) return prev;
      return sorted.map((n, i) => (i === idx ? { ...n, duration: candidate } : n));
    });
  }

  function handleClear() {
    setNotes([]);
    setSelectedNoteKey(null);
  }

  // オクターブを含めた実際の音の高さ（絶対ピッチ = octave*12 + pc + 臨時記号）で
  // 一致判定する。ピッチクラスでの mod 12 は行わないため、臨時記号によって
  // オクターブをまたぐ場合も自然に正しい絶対ピッチになる。
  // ギター（移調楽器）の記譜慣習により、実際に鳴る音は記譜より1オクターブ低いため、
  // 指板とのマッチング判定にのみ -12 半音する（度数ラベルや調号などの表示には影響させない）。
  const GUITAR_SOUNDING_OCTAVE_OFFSET = -12;
  const activePitches = new Set(
    notes
      .filter((n): n is Note & { rowIdx: number } => !n.isRest && n.rowIdx !== null)
      .map((n) => rows[n.rowIdx].octave * 12 + rows[n.rowIdx].pc + n.accidental + GUITAR_SOUNDING_OCTAVE_OFFSET)
  );
  // 再生中の音符（休符やnullの場合はnull）の実際の音の高さ。指板側のハイライトに使う。
  const playingNote = notes.find((n) => n.startGrid === playingNoteKey);
  const playingAbsPitch =
    playingNote && !playingNote.isRest && playingNote.rowIdx !== null
      ? rows[playingNote.rowIdx].octave * 12 +
        rows[playingNote.rowIdx].pc +
        playingNote.accidental +
        GUITAR_SOUNDING_OCTAVE_OFFSET
      : null;

  const fbLeft = 100;
  const fbTop = 30;
  const fretW = 68;
  const stringGap = 30;

  // SMuFL(Bravura)は符頭・符幹・旗が別グリフの合成方式。符頭はnoteheadWhole/Half/Black、
  // 符幹はSVGの直線（SMuFL標準アンカーpointで符頭に接続）、旗（8分=1本・16分=2本）は
  // flag8thUp/Down・flag16thUp/Downを符幹の先端に配置する。16分音符も含め全音価が
  // フォントグリフのみで描画できる（手描きフォールバックは不要）。
  const NOTEHEAD_XMAX: Record<string, number> = { noteheadWhole: 422, noteheadHalf: 295, noteheadBlack: 295 };
  function renderNoteGlyph(x: number, rowY: number, duration: number, fill: string) {
    const stemDown = rowY < MIDDLE_LINE_Y;
    const scale = BRAVURA_FONT_SIZE / BRAVURA_UPM;

    const noteheadGlyph = duration === 16 ? "noteheadWhole" : duration === 8 ? "noteheadHalf" : "noteheadBlack";
    // noteheadWhole/Half/Black はいずれも yMin=-125,yMax=125 で原点(0)が符頭の中心と一致する。
    const baselineY = rowY;
    const halfWidth = (NOTEHEAD_XMAX[noteheadGlyph] / 2) * scale;

    const hasStem = duration <= 8;
    let stemLine = null;
    let stemAttachX = x;
    let stemTipY = rowY;
    if (hasStem) {
      const anchor = stemDown ? STEM_DOWN_NW : STEM_UP_SE;
      stemAttachX = stemDown ? x - halfWidth : x + halfWidth;
      const attachY = rowY - anchor.dy * scale;
      stemTipY = stemDown ? attachY + STEM_LENGTH_UNITS * scale : attachY - STEM_LENGTH_UNITS * scale;
      stemLine = <line x1={stemAttachX} y1={attachY} x2={stemAttachX} y2={stemTipY} stroke={fill} strokeWidth={1.5} />;
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
        <text x={x} y={baselineY} fontSize={BRAVURA_FONT_SIZE} fontFamily="Bravura" textAnchor="middle" fill={fill}>
          {bravuraChar(noteheadGlyph)}
        </text>
        {stemLine}
        {flagGlyph && (
          <text x={stemAttachX} y={stemTipY} fontSize={BRAVURA_FONT_SIZE} fontFamily="Bravura" fill={fill}>
            {bravuraChar(flagGlyph)}
          </text>
        )}
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
    const glyph = glyphMap[duration];
    const centerUnits = glyphBBoxCenterUnits(glyph);
    const baselineY = baselineYForGlyphCenter(LINE3_Y, BRAVURA_FONT_SIZE, centerUnits);
    return (
      <text x={x} y={baselineY} fontSize={BRAVURA_FONT_SIZE} fontFamily="Bravura" textAnchor="middle" fill={fill}>
        {bravuraChar(glyph)}
      </text>
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
          onClick={() => setCurrentMeasureIndex((i) => Math.max(0, i - 1))}
          disabled={currentMeasureIndex === 0}
        >
          ◀
        </button>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {currentMeasureIndex + 1}/{MEASURE_COUNT}小節目
        </span>
        <button
          id="measure-next-btn"
          onClick={() => setCurrentMeasureIndex((i) => Math.min(MEASURE_COUNT - 1, i + 1))}
          disabled={currentMeasureIndex === MEASURE_COUNT - 1}
        >
          ▶
        </button>
        <button id="play-btn" style={{ marginLeft: "auto" }} onClick={handlePlayClick}>
          {isPlaying ? "■ 停止" : "▶ Play"}
        </button>
        <button id="clear-btn" onClick={handleClear}>
          クリア
        </button>
      </div>

      <div id="staff-wrap" style={{ overflowX: "auto" }}>
      <svg
        id="staff"
        viewBox={`0 0 ${STAFF_VB_W} 280`}
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
          x={0}
          y={rows[8].y /* G4線: SMuFL標準でgClefの原点はG4線に一致させる */}
          fontSize={BRAVURA_FONT_SIZE}
          fontFamily="Bravura"
          fill="var(--text-primary)"
        >
          {bravuraChar("gClef")}
        </text>

        {Array.from({ length: keySig.count }, (_, k) => {
          const row = rows[sigRows[k]];
          const centerUnits = glyphBBoxCenterUnits(sigGlyphName);
          const baselineY = baselineYForGlyphCenter(row.y, BRAVURA_FONT_SIZE, centerUnits);
          return (
            <text
              key={k}
              x={sigStartX + k * sigSpacing}
              y={baselineY}
              fontSize={BRAVURA_FONT_SIZE}
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
          const numY = baselineYForGlyphCenter(rows[4].y, BRAVURA_FONT_SIZE, glyphBBoxCenterUnits(numGlyph));
          const denY = baselineYForGlyphCenter(rows[8].y, BRAVURA_FONT_SIZE, glyphBBoxCenterUnits(denGlyph));
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
          const lineX = xForGrid(measureStartGrid + gridsPerMeasure);
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
          const beatGrid = measureStartGrid + (b + 1) * gridsPerBeat;
          const lineX = xForGrid(beatGrid);
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

        {notes
          .filter((note) => note.startGrid >= measureStartGrid && note.startGrid < measureStartGrid + gridsPerMeasure)
          .map((note) => {
          const x = displayXForNote(note.startGrid);

          if (note.isRest) {
            return (
              <g key={note.startGrid}>
                {renderRestGlyph(x, note.duration, "var(--text-secondary)")}
              </g>
            );
          }

          const row = rows[note.rowIdx as number];
          const acc = note.accidental;
          const pc = (row.pc + acc + 12) % 12;
          const deg = degreeFor(pc, root);
          const [fill] = colorFor(DEGREE_ROLE[deg]);
          const showLedger = row.y <= STAFF_TOP - 10 || row.y >= STAFF_TOP + 100;
          return (
            <g key={note.startGrid}>
              {showLedger && (
                <line x1={x - 12} x2={x + 12} y1={row.y} y2={row.y} stroke="var(--border-strong)" />
              )}
              {acc !== 0 && (
                <text
                  x={x - 22}
                  y={baselineYForGlyphCenter(
                    row.y,
                    BRAVURA_FONT_SIZE,
                    glyphBBoxCenterUnits(acc === 1 ? "accidentalSharp" : "accidentalFlat")
                  )}
                  fontSize={BRAVURA_FONT_SIZE}
                  fontFamily="Bravura"
                  textAnchor="middle"
                  fill="var(--text-primary)"
                >
                  {bravuraChar(acc === 1 ? "accidentalSharp" : "accidentalFlat")}
                </text>
              )}
              {renderNoteGlyph(x, row.y, note.duration, fill)}
              {playingNoteKey === note.startGrid && (
                <circle cx={x} cy={row.y} r={16} fill="none" stroke="var(--danger)" strokeWidth={2} />
              )}
            </g>
          );
        })}

        <rect
          x={LEFT - 40}
          y={2}
          width={STAFF_VB_W - (LEFT - 40) - 10}
          height={276}
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
      </div>

      <div style={{ margin: "0 0 1.5rem", height: "72px", overflowX: "auto" }}>
      <div style={{ position: "relative", width: `${staffRenderedWidth}px`, height: "72px" }}>
        {(() => {
          const selectedNote = notes.find((n) => n.startGrid === selectedNoteKey);
          if (!selectedNote) return null;
          if (selectedNote.startGrid < measureStartGrid || selectedNote.startGrid >= measureStartGrid + gridsPerMeasure) {
            return null;
          }
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
              {!selectedNote.isRest && (
                <button style={btnStyle} onClick={() => pressSharp(selectedNote.startGrid)}>
                  ▲
                </button>
              )}
              <button style={btnStyle} onClick={() => cycleDuration(selectedNote.startGrid)}>
                {durationLabel}
              </button>
              {!selectedNote.isRest && (
                <button style={btnStyle} onClick={() => pressFlat(selectedNote.startGrid)}>
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
                  if (!activePitches.has(absPitch)) return null;
                  const pc = (st.open + f) % 12;
                  const x = fbLeft + (f === 0 ? 0 : f * fretW - fretW / 2);
                  const deg = degreeFor(pc, root);
                  const [fill] = colorFor(DEGREE_ROLE[deg]);
                  const isPlaying = playingAbsPitch === absPitch;
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
                      <circle cx={x} cy={y} r={isPlaying ? 14 : 12} style={{ fill }} />
                      <text
                        x={x}
                        y={y + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight="bold"
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
