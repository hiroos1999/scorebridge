// コードの構成音（度数）を並べたパターンから、メロディを自動生成する。
// 例: "3 1 5+ 7" を各コードに当てはめると、その時鳴っているコードの
// 3度 → 1度 → 5度 → 7度 を順に並べた音列になる。
//
// 度数の書き方: 1 3 5 7 9 11 13。♭/♯を前に付けられる（例: b9, #11）。
// 末尾に + を付けると「直前の音より上の最も近い音」、- を付けると「下の最も近い音」にする。
// 付けない場合は、直前の音に最も近い高さ（同じ距離なら上）。

import { CHORD_TYPES } from "@/lib/chords";
import type { Harmony, Measure, Note } from "@/components/StaffToFretboard";

// 五線の行番号(0=C6 … 19=E3)ごとの自然音のMIDI番号。
const ROW_MIDI = [84, 83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52];
const MIN_MIDI = 52;
const MAX_MIDI = 84;

// ルートの綴り（ピッチクラス → 自然音の文字と臨時記号）。
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const SHARP_SPELL: [number, number][] = [
  [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0],
];
const FLAT_SPELL: [number, number][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
];

export type DegreeToken = {
  degree: number; // 1 3 5 7 9 11 13
  alter: number; // -1(♭) 0 +1(♯)
  octaveShift: number; // +1: 直前の音より上 / -1: 直前の音より下 / 0: 最も近い音
};

export function parsePattern(text: string): DegreeToken[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const tokens: DegreeToken[] = [];
  for (const part of parts) {
    const m = /^([b♭#♯]?)(1|3|5|7|9|11|13)([+-]?)$/.exec(part);
    if (!m) return null;
    tokens.push({
      degree: parseInt(m[2], 10),
      alter: m[1] === "" ? 0 : m[1] === "b" || m[1] === "♭" ? -1 : 1,
      octaveShift: m[3] === "+" ? 1 : m[3] === "-" ? -1 : 0,
    });
  }
  return tokens;
}

const LETTER_STEP: Record<number, number> = { 1: 0, 3: 2, 5: 4, 7: 6, 9: 1, 11: 3, 13: 5 };

// コードの種類ごとの、ルートから見た度数の半音数。
function degreeSemitones(kind: string, degree: number): number {
  const iv = CHORD_TYPES[kind] ?? CHORD_TYPES["7"];
  switch (degree) {
    case 1: return 0;
    case 3: return iv[1];
    case 5: return iv[2];
    case 7: return iv[3];
    case 9: return kind === "m7b5" ? 13 : 14; // m7♭5は♭9（ロクリアン）
    case 11: return kind === "maj7" || kind === "6" ? 18 : 17; // maj7は♯11
    default: return kind === "m7b5" ? 20 : 21; // 13（m7♭5は♭13）
  }
}

export type SpelledPitch = { letterIdx: number; accidental: number; pc: number };

export function spellDegree(rootPc: number, kind: string, token: DegreeToken, useFlats: boolean): SpelledPitch {
  const spell = (useFlats ? FLAT_SPELL : SHARP_SPELL)[((rootPc % 12) + 12) % 12];
  const rootLetter = spell[0];
  const pc = (((rootPc + degreeSemitones(kind, token.degree) + token.alter) % 12) + 12) % 12;
  const letterIdx = (rootLetter + LETTER_STEP[token.degree]) % 7;
  let accidental = pc - LETTER_PC[letterIdx];
  while (accidental > 6) accidental -= 12;
  while (accidental < -6) accidental += 12;
  if (Math.abs(accidental) > 1) {
    // 重変記号になる場合は、シンプルな綴り（キーの♯/♭）に置き換える
    const [l, a] = (useFlats ? FLAT_SPELL : SHARP_SPELL)[pc];
    return { letterIdx: l, accidental: a, pc };
  }
  return { letterIdx, accidental, pc };
}

// 綴り(文字+臨時記号)で表せる音のうち、五線の範囲内にあるMIDI候補（昇順）。
function candidates(p: SpelledPitch): { midi: number; row: number }[] {
  const out: { midi: number; row: number }[] = [];
  for (let oct = 2; oct <= 7; oct++) {
    const natural = 12 * (oct + 1) + LETTER_PC[p.letterIdx];
    const row = ROW_MIDI.indexOf(natural);
    if (row < 0) continue;
    const midi = natural + p.accidental;
    if (midi < MIN_MIDI || midi > MAX_MIDI) continue;
    out.push({ midi, row });
  }
  return out;
}

function pickPitch(p: SpelledPitch, prevMidi: number, direction: number): { midi: number; row: number } | null {
  const cands = candidates(p);
  if (cands.length === 0) return null;
  // + / - : 直前の音より上（下）にある最も近い音。該当がなければ通常の「最も近い音」にする。
  if (direction > 0) {
    const above = cands.find((c) => c.midi > prevMidi);
    if (above) return above;
  } else if (direction < 0) {
    const below = [...cands].reverse().find((c) => c.midi < prevMidi);
    if (below) return below;
  }
  let best = cands[0];
  for (const c of cands) {
    const dBest = Math.abs(best.midi - prevMidi);
    const d = Math.abs(c.midi - prevMidi);
    if (d < dBest || (d === dBest && c.midi > best.midi)) best = c;
  }
  return best;
}

function makeNote(startGrid: number, duration: number, row: number, accidental: number): Note {
  return { startGrid, duration, isRest: false, rowIdxList: [row], accidentals: { [row]: accidental } };
}
function makeRest(startGrid: number, duration: number): Note {
  return { startGrid, duration, isRest: true, rowIdxList: [], accidentals: {} };
}

// 1コードの長さ(grid)に対して、パターンの音数に応じた音価を選ぶ。
// 割り切れない場合は2のべき乗のうち収まる最大の音価にして、パターンを繰り返して埋める。
function chooseDuration(span: number, count: number): number {
  const raw = span / count;
  let d = 16;
  while (d > 1 && d > raw) d /= 2;
  return Math.max(1, d);
}

export type ApplyOptions = {
  tokens: DegreeToken[];
  octave: number; // -1 0 +1: 全体の高さの目安をオクターブ単位でずらす
  useFlats: boolean;
  gridsPerMeasure: number;
  // 指定すると、この範囲（小節番号, 両端を含む）のメロディだけ作り直す。範囲外は変更しない。
  // コードの引き継ぎは範囲外の小節も含めて行う。
  range?: { from: number; to: number };
};

// 1コード分の音列を作る。最初の音は「パターン全体の平均の高さが目安(center)に最も近くなる」
// オクターブを選び、2音目以降は直前の音に近い高さにする。コードごとに同じ高さの範囲から
// 始め直すので、アルペジオが上がり続けたり下がり続けたりしない。
function buildLine(
  chord: Harmony,
  tokens: DegreeToken[],
  slots: number,
  useFlats: boolean,
  center: number,
): { midi: number; row: number; accidental: number }[] {
  const spelledAll = tokens.map((t) => spellDegree(chord.root, chord.kind, t, useFlats));
  const firstCands = candidates(spelledAll[0]);
  let best: { midi: number; row: number; accidental: number }[] | null = null;
  let bestScore = Infinity;
  for (let ci = 0; ci < firstCands.length; ci++) {
    const start = firstCands[ci]; // 1音目の+/-は無視（高さは全体の平均で決める）
    const line = [{ ...start, accidental: spelledAll[0].accidental }];
    for (let i = 1; i < slots; i++) {
      const k = i % tokens.length;
      const picked = pickPitch(spelledAll[k], line[i - 1].midi, tokens[k].octaveShift);
      if (!picked) break;
      line.push({ ...picked, accidental: spelledAll[k].accidental });
    }
    if (line.length < slots) continue;
    const mean = line.reduce((a, n) => a + n.midi, 0) / line.length;
    // 平均の高さが目安に近く、かつ大きく跳ばない（五線の端で折り返さない）並びを選ぶ
    let leaps = 0;
    for (let i = 1; i < line.length; i++) leaps += Math.abs(line[i].midi - line[i - 1].midi);
    const score = Math.abs(mean - center) + 0.25 * leaps;
    // 同点なら高い方
    if (score < bestScore || (score === bestScore && best && line[0].midi > best[0].midi)) {
      bestScore = score;
      best = line;
    }
  }
  return best ?? [];
}

// 全小節のコード（harmonies）にパターンを当てはめ、メロディ(notes)を作り直す。
// コードのない小節は、直前のコードを引き継ぐ。最初のコードより前の小節は空になる。
export function applyPatternToMeasures(measures: Measure[], opts: ApplyOptions): Measure[] {
  const { tokens, octave, useFlats, gridsPerMeasure, range } = opts;
  const center = 67 + 12 * octave;
  let carried: Harmony | null = null;
  return measures.map((m, mi) => {
    const sorted = [...m.harmonies].sort((a, b) => a.offsetGrid - b.offsetGrid);
    const starts: { at: number; chord: Harmony }[] = [];
    if (carried && (sorted.length === 0 || sorted[0].offsetGrid > 0)) starts.push({ at: 0, chord: carried });
    for (const h of sorted) starts.push({ at: h.offsetGrid, chord: h });
    if (sorted.length > 0) carried = sorted[sorted.length - 1];
    if (range && (mi < range.from || mi > range.to)) return m;
    if (starts.length === 0) return { ...m, notes: [] };

    const notes: Note[] = [];
    starts.forEach((s, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].at : gridsPerMeasure;
      const span = end - s.at;
      if (span <= 0) return;
      const d = chooseDuration(span, tokens.length);
      const slots = Math.floor(span / d);
      const line = buildLine(s.chord, tokens, slots, useFlats, center);
      for (let k = 0; k < slots; k++) {
        const p = line[k];
        notes.push(p ? makeNote(s.at + k * d, d, p.row, p.accidental) : makeRest(s.at + k * d, d));
      }
      const rest = span - slots * d;
      if (rest > 0 && [1, 2, 4, 8].includes(rest)) notes.push(makeRest(s.at + slots * d, rest));
    });
    return { ...m, notes };
  });
}

// UIに出すプリセット。度数の並びは、直前の音に近い高さで自動配置される
// （+ / - は、そこからさらに1オクターブ上/下）。
export const PATTERN_PRESETS: { label: string; text: string }[] = [
  { label: "3 7", text: "3 7" },
  { label: "1 3 5 7", text: "1 3 5 7" },
  { label: "3 1 5 7", text: "3 1 5+ 7" },
  { label: "3 5 1 7", text: "3 5 1 7" },
  { label: "3 5 7 9", text: "3 5 7 9" },
  { label: "7 5 3 1", text: "7 5 3 1" },
  { label: "9 7 5 3", text: "9 7 5 3" },
];
