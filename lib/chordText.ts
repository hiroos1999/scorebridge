// 「| Gm7 C7 | Cm7 | F Gm7 |」のようなコード進行テキストを、小節ごとのHarmonyに変換する。
// アプリが持つコードタイプは maj7 / m7 / 7 / dim / m7b5 / 6 / m6 / mMaj7 のみなので、
// それ以外（9th・sus・三和音など）は最も近いものに丸め、丸めた内容を警告として返す。
import type { Harmony } from "@/components/StaffToFretboard";

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type ParsedChord = { root: number; kind: string; label: string; approx: string | null };

function normalize(s: string): string {
  return s
    .replace(/[♭]/g, "b")
    .replace(/[♯＃]/g, "#")
    .replace(/[　]/g, " ")
    .replace(/[－−–—]/g, "-")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[｜]/g, "|")
    .replace(/[／]/g, "/");
}

export function parseChordSymbol(raw: string): ParsedChord | null {
  let s = raw.trim();
  // 括弧付きの任意コード "(Am7)" は括弧を外して読む
  if (/^\([A-G]/.test(s) && s.endsWith(")") && !/\)\(/.test(s)) {
    const inner = s.slice(1, -1);
    if (!/^\w*\(/.test(inner) || /^[A-G][#b]?[^()]*$/.test(inner)) s = inner;
  }
  const m = /^([A-G])([#b]?)(.*)$/.exec(s);
  if (!m) return null;
  let root = STEP_PC[m[1]];
  if (m[2] === "#") root += 1;
  if (m[2] === "b") root -= 1;
  root = ((root % 12) + 12) % 12;
  let rest = m[3];
  // オンコード（ベース音）は無視。6/9 は6として扱う。
  rest = rest.replace(/\/[A-G][#b]?$/, "");
  let kind: string;
  let canonical = false;
  if (/^(m7b5|m7\(b5\)|min7\(b5\)|min7b5|ø7?|-7\(b5\)|-7b5|m9b5|m7\(♭5\))/.test(rest) || /^ø/.test(rest)) {
    kind = "m7b5";
    canonical = /^(m7b5|m7\(b5\)|ø7?)$/.test(rest);
  } else if (/^(dim|o7|°|o)/.test(rest)) {
    kind = "dim";
    canonical = /^(dim7?|o7|°7?)$/.test(rest);
  } else if (/^(mMaj7|m\(maj7\)|mM7|minMaj7|-M7|-maj7|m△7|mΔ7|m∆7)/.test(rest)) {
    kind = "mMaj7";
    canonical = /^(mMaj7|m\(maj7\)|mM7)$/.test(rest);
  } else if (/^(maj|Maj|MAJ|M|Δ|△|∆|\^)/.test(rest)) {
    kind = "maj7";
    canonical = /^(maj7|Maj7|M7|Δ7|△7|∆7|\^7)$/.test(rest);
  } else if (/^(m|min|-)/.test(rest)) {
    const body = rest.replace(/^(min|m|-)/, "");
    if (/^6/.test(body) && !/7|9/.test(body)) {
      kind = "m6";
      canonical = body === "6";
    } else {
      kind = "m7";
      canonical = body === "7";
    }
  } else if (/^6/.test(rest)) {
    kind = "6";
    canonical = rest === "6";
  } else if (/^(7|9|11|13|alt|sus|\+|aug)/.test(rest)) {
    kind = "7";
    canonical = rest === "7";
  } else if (rest === "") {
    kind = "maj7"; // 三和音(メジャー)
    canonical = false;
  } else {
    return null;
  }
  return { root, kind, label: s, approx: canonical ? null : s };
}

export type ChordTextResult = { bars: Harmony[][]; warnings: string[] };

export function parseChordProgression(
  text: string,
  beatsPerMeasure: number,
  gridsPerBeat: number,
  rootName: (pc: number) => string,
  kindLabel: (kind: string) => string
): ChordTextResult {
  const warnings: string[] = [];
  const src = normalize(text).replace(/\|\|:|:\|\||\|:|:\|/g, "|").replace(/\[[^\]]*\]/g, " ");
  let barTexts: string[];
  if (src.includes("|")) {
    barTexts = src.split("|");
  } else {
    const lines = src.split(/\n/);
    barTexts = lines.length > 1 ? lines : src.split(/\s+/);
  }
  barTexts = barTexts.map((b) => b.trim()).filter((b) => b.length > 0);

  const gridsPerMeasure = beatsPerMeasure * gridsPerBeat;
  const bars: Harmony[][] = [];
  const approxSeen = new Set<string>();
  let prev: ParsedChord[] = [];
  barTexts.forEach((bt, bi) => {
    const tokens = bt.split(/[\s,]+/).filter((t) => t && !/^(\d+\.?|[A-Z]:|N\.?C\.?|-|\.)$/.test(t) || /^[A-G]/.test(t));
    let chords: ParsedChord[] = [];
    for (const t of tokens) {
      if (t === "%") { chords = prev; break; }
      const c = parseChordSymbol(t);
      if (!c) {
        if (!/^(\d+\.?|[A-Z]:|N\.?C\.?|-|\.)$/.test(t)) warnings.push(`小節${bi + 1}: "${t}" はコードとして読めないためスキップしました`);
        continue;
      }
      if (c.approx && !approxSeen.has(c.approx)) {
        approxSeen.add(c.approx);
        warnings.push(`"${c.approx}" は近いコード（${rootName(c.root)}${kindLabel(c.kind)}）に丸めました`);
      }
      chords.push(c);
    }
    prev = chords;
    const n = chords.length;
    bars.push(
      chords.map((c, i) => ({
        offsetGrid: n <= beatsPerMeasure ? Math.floor((i * beatsPerMeasure) / n) * gridsPerBeat : Math.floor((i * gridsPerMeasure) / n),
        root: c.root,
        kind: c.kind,
        inversion: 0,
      }))
    );
  });
  return { bars, warnings };
}
