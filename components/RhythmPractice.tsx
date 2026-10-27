"use client";
/* eslint-disable react-hooks/refs, react-hooks/purity, react-hooks/set-state-in-effect -- 音のスケジューラは命令的なrefベースで動かすため */

// Rhythm モード: メトロノームに合わせて、指板上の「光っている点」を拍の位置でタップする練習。
// 音程(ピッチクラス)とタイミング(ミリ秒)の両方を採点する。
// 既存の五線譜エディタとは独立した部品で、曲のコード(各小節の最初のharmony)を
// そのまま使う。コードが無いときは、コード選択(Chord)の値を使う。

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { CHORD_TYPES } from "@/lib/chords";
import type { Measure, TimeSignature } from "@/components/StaffToFretboard";
import { Switch, Stepper } from "@/components/IosControls";

type RhythmKind = "8th" | "triplet" | "16th" | "synco";
type Verdict = "on" | "early" | "late" | "wrong" | "miss";

type Props = {
  measures: Measure[];
  chordRoot: number;
  chordType: string;
  useFlats: boolean;
  timeSig: TimeSignature;
  tr?: (s: string) => string;
};

const KIND_LABEL: Record<RhythmKind, string> = {
  "8th": "8th notes",
  triplet: "Triplets",
  "16th": "16th notes",
  synco: "Syncopation",
};

// 小節内の音の位置(4分音符=1拍の単位)。小節ごとにランダムで1つ選ぶ。
const T3 = 1 / 3;
const PATTERNS: Record<RhythmKind, number[][]> = {
  "8th": [
    [0, 1, 1.5, 2, 3],
    [0, 0.5, 1, 2, 2.5, 3],
    [0, 1, 2, 2.5, 3, 3.5],
  ],
  triplet: [
    [0, 1, 1 + T3, 1 + 2 * T3, 2, 3, 3.5],
    [0, 1, 2, 2 + T3, 2 + 2 * T3, 3],
    [0, 0 + T3, 0 + 2 * T3, 1, 2, 3],
  ],
  "16th": [
    [0, 0.5, 0.75, 1, 2, 2.25, 2.5, 3],
    [0, 0.25, 0.5, 1, 2, 3, 3.25, 3.5],
    [0, 1, 1.25, 1.5, 2, 3],
  ],
  synco: [
    [0, 1.5, 2, 3.5],
    [0.5, 1.5, 2.5, 3.5],
    [0, 0.5, 2, 2.5, 3],
  ],
};

const ON_TIME_MS = 40;
const EPS = 1e-6;

// 開放弦(1弦=E4 … 6弦=E2)のMIDIノート番号
const OPEN_MIDI = [64, 59, 55, 50, 45, 40];
const FRETS = 12;
const TARGET_STRINGS = 6; // 出題は全弦・開放弦〜12フレット
const MIDI_LO = 48; // 出題する音域(五線に収まるよう C3〜C5 のギター音)
const MIDI_HI = 72;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const SHARP_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARP_ACC = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const FLAT_LETTER = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
const FLAT_ACC = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];
const DEGREE_BY_INTERVAL: Record<number, string> = { 0: "R", 3: "♭3", 4: "3", 6: "♭5", 7: "5", 9: "6", 10: "♭7", 11: "7" };

type Pos = { s: number; f: number };
type PlanEvent = { beat: number; dur: number; pos: Pos; pc: number; midi: number; written: number; degree: string };
type PlanBar = { chordRoot: number; chordKind: string; events: PlanEvent[] };

function mod12(n: number) {
  return ((n % 12) + 12) % 12;
}

function pickPos(pc: number, prev: Pos): Pos {
  let best: Pos | null = null;
  let bestCost = Infinity;
  for (let s = 0; s < TARGET_STRINGS; s++) {
    for (let f = 0; f <= FRETS; f++) {
      const m = OPEN_MIDI[s] + f;
      if (mod12(m) !== pc || m < MIDI_LO || m > MIDI_HI) continue;
      const cost = Math.abs(s - prev.s) * 2 + Math.abs(f - prev.f) + Math.abs(m - (OPEN_MIDI[prev.s] + prev.f)) * 0.6;
      if (cost < bestCost) {
        bestCost = cost;
        best = { s, f };
      }
    }
  }
  return best ?? prev;
}

function freq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export default function RhythmPractice({ measures, chordRoot, chordType, useFlats, timeSig, tr: trProp }: Props) {
  const tr = trProp ?? ((x: string) => x);
  const [kind, setKind] = useState<RhythmKind>("8th");
  const [tempo, setTempo] = useState(70);
  const [countIn, setCountIn] = useState(true);
  const [running, setRunning] = useState(false);
  const [nowT, setNowT] = useState(0);
  const [rounds, setRounds] = useState(8);
  const [guide, setGuide] = useState(true);
  const guideRef = useRef(true);
  guideRef.current = guide;
  const guidedRef = useRef<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (finished) document.getElementById("rh-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [finished]);
  const roundsRef = useRef(8);
  roundsRef.current = rounds;
  const [results, setResults] = useState<Record<string, { verdict: Verdict; ms: number }>>({});
  const [lastTap, setLastTap] = useState<{ s: number; f: number; verdict: Verdict } | null>(null);

  const barBeats = Math.max(1, Math.round((timeSig.numerator * 4) / timeSig.denominator));

  // --- 出題(plan): 小節ごとにリズムと音を決める。stateではなくrefに持つ(再生中に増える) ---
  const planRef = useRef<PlanBar[]>([]);
  const prevPosRef = useRef<Pos>({ s: 2, f: 5 });
  const degreeCursorRef = useRef(1);

  // 曲のコード進行(各小節の最初のコード)。無ければChord選択の値。
  const chordsPerBar = useMemo(() => {
    const list = measures.map((m) => m.harmonies[0] ?? null);
    const firstFound = list.find((h) => h) ?? null;
    if (!firstFound) return [{ root: chordRoot, kind: chordType }];
    let last = { root: firstFound.root, kind: firstFound.kind };
    return list.map((h) => {
      if (h) last = { root: h.root, kind: h.kind };
      return last;
    });
  }, [measures, chordRoot, chordType]);

  const settingsRef = useRef({ kind, barBeats, chordsPerBar });
  settingsRef.current = { kind, barBeats, chordsPerBar };

  function ensurePlan(upTo: number) {
    const plan = planRef.current;
    while (plan.length <= upTo) {
      const i = plan.length;
      const { kind: k, barBeats: bb, chordsPerBar: cpb } = settingsRef.current;
      const chord = cpb[i % cpb.length];
      const intervals = CHORD_TYPES[chord.kind] ?? CHORD_TYPES.maj7;
      const candidates = PATTERNS[k].map((p) => p.filter((b) => b < bb - EPS)).filter((p) => p.length > 0);
      const beats = candidates[Math.floor(Math.random() * candidates.length)] ?? [0];
      const order = [1, 2, 3, 2, 1, 0];
      const events: PlanEvent[] = beats.map((beat, idx) => {
        const iv = intervals[order[degreeCursorRef.current % order.length] % intervals.length];
        degreeCursorRef.current += 1;
        const pc = mod12(chord.root + iv);
        const pos = pickPos(pc, prevPosRef.current);
        prevPosRef.current = pos;
        const midi = OPEN_MIDI[pos.s] + pos.f;
        const written = midi + 12; // 記譜はギターの実音の1オクターブ上
        const next = idx + 1 < beats.length ? beats[idx + 1] : bb;
        return { beat, dur: next - beat, pos, pc, midi, written, degree: DEGREE_BY_INTERVAL[iv] ?? "" };
      });
      plan.push({ chordRoot: chord.root, chordKind: chord.kind, events });
    }
  }

  // --- 音(Web Audio) ---
  const ctxRef = useRef<AudioContext | null>(null);
  const t0Ref = useRef(0); // 0小節目の頭の時刻(AudioContext time)
  const beatDurRef = useRef(0.75);
  const nextClickRef = useRef(0); // 次に鳴らすクリックの通し拍番号(カウントインは負)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const resultsRef = useRef<Record<string, { verdict: Verdict; ms: number }>>({});

  function click(time: number, accent: boolean) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function tone(midi: number, at?: number, soft = false) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t = at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = soft ? "sine" : "triangle";
    osc.frequency.value = freq(midi);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(soft ? 0.28 : 0.35, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  function setResult(key: string, r: { verdict: Verdict; ms: number }) {
    resultsRef.current[key] = r;
    setResults({ ...resultsRef.current });
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) void ctx.close();
    setRunning(false);
  }

  function start() {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    ctxRef.current = ctx;
    const beatDur = 60 / tempo;
    beatDurRef.current = beatDur;
    planRef.current = [];
    prevPosRef.current = { s: 2, f: 5 };
    degreeCursorRef.current = 1;
    resultsRef.current = {};
    guidedRef.current = new Set();
    setResults({});
    setLastTap(null);
    setFinished(false);
    const countInBeats = countIn ? barBeats : 0;
    t0Ref.current = ctx.currentTime + 0.2 + countInBeats * beatDur;
    nextClickRef.current = -countInBeats;
    ensurePlan(2);

    timerRef.current = setInterval(() => {
      const c = ctxRef.current;
      if (!c) return;
      while (t0Ref.current + nextClickRef.current * beatDurRef.current < c.currentTime + 0.12) {
        const k = nextClickRef.current;
        const accent = mod12(k) % 1 === 0 && ((k % barBeats) + barBeats) % barBeats === 0;
        click(t0Ref.current + k * beatDurRef.current, accent);
        nextClickRef.current = k + 1;
      }
      // お手本の音: 正解の音を、正解のタイミングで鳴らす
      if (guideRef.current) {
        const bpos = (c.currentTime - t0Ref.current) / beatDurRef.current;
        const cb = Math.max(0, Math.floor(bpos / barBeats));
        for (let b = cb; b <= Math.min(cb + 1, roundsRef.current - 1); b++) {
          ensurePlan(b);
          planRef.current[b].events.forEach((ev, i) => {
            const key = `${b}:${i}`;
            const T = t0Ref.current + (b * barBeats + ev.beat) * beatDurRef.current;
            if (!guidedRef.current.has(key) && T < c.currentTime + 0.12 && T > c.currentTime - 0.05) {
              guidedRef.current.add(key);
              tone(ev.midi, Math.max(T, c.currentTime), true);
            }
          });
        }
      }
    }, 25);

    const loop = () => {
      const c = ctxRef.current;
      if (!c) return;
      const t = c.currentTime;
      setNowT(t);
      // 取りこぼし(miss)の判定
      const windowSec = Math.min(0.28, beatDurRef.current * 0.45);
      const posBeats = (t - t0Ref.current) / beatDurRef.current;
      const curBar = Math.floor(posBeats / barBeats);
      ensurePlan(Math.max(0, curBar) + 2);
      let changed = false;
      for (let b = Math.max(0, curBar - 1); b <= curBar; b++) {
        planRef.current[b]?.events.forEach((ev, i) => {
          const key = `${b}:${i}`;
          const T = t0Ref.current + (b * barBeats + ev.beat) * beatDurRef.current;
          if (!resultsRef.current[key] && t > T + windowSec) {
            resultsRef.current[key] = { verdict: "miss", ms: 0 };
            changed = true;
          }
        });
      }
      // 最後の小節が終わったら自動で終了して採点画面へ
      const endT = t0Ref.current + roundsRef.current * barBeats * beatDurRef.current + windowSec;
      if (t > endT) {
        for (let b = 0; b < roundsRef.current; b++) {
          planRef.current[b]?.events.forEach((ev, i) => {
            const key = `${b}:${i}`;
            if (!resultsRef.current[key]) resultsRef.current[key] = { verdict: "miss", ms: 0 };
          });
        }
        setResults({ ...resultsRef.current });
        setFinished(true);
        stop();
        return;
      }
      if (changed) setResults({ ...resultsRef.current });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    setRunning(true);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const ctx = ctxRef.current;
      if (ctx) void ctx.close();
    };
  }, []);

  // 設定が変わったら止める(テンポ・種類・拍子・曲の切り替え)
  useEffect(() => {
    if (running) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, tempo, barBeats, chordsPerBar, rounds]);

  // --- 指板のタップ ---
  const FB = { w: 940, h: 214, left: 124, fretW: 66, top: 34, gap: 28 };
  const fx = (f: number) => (f === 0 ? FB.left - 20 : FB.left + f * FB.fretW - FB.fretW / 2);
  function onFretboardPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const ctx = ctxRef.current;
    if (!ctx || !running) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * FB.w;
    const y = ((e.clientY - rect.top) / rect.height) * FB.h;
    const s = Math.min(5, Math.max(0, Math.round((y - FB.top) / FB.gap)));
    const f = x < FB.left ? 0 : Math.min(FRETS, Math.floor((x - FB.left) / FB.fretW) + 1);
    const midi = OPEN_MIDI[s] + f;
    tone(midi);

    // タップ時刻をAudioContext時間に変換(イベントの発生時刻を使い、描画の遅れを除く)
    const delaySec = Math.max(0, (performance.now() - e.timeStamp) / 1000);
    const tapT = ctx.currentTime - Math.min(delaySec, 0.2);
    const windowSec = Math.min(0.28, beatDurRef.current * 0.45);
    const posBeats = (tapT - t0Ref.current) / beatDurRef.current;
    const curBar = Math.floor(posBeats / barBeats);
    let bestKey: string | null = null;
    let bestEv: PlanEvent | null = null;
    let bestDelta = Infinity;
    for (let b = Math.max(0, curBar - 1); b <= Math.min(curBar + 1, roundsRef.current - 1); b++) {
      planRef.current[b]?.events.forEach((ev, i) => {
        const key = `${b}:${i}`;
        if (resultsRef.current[key]) return;
        const T = t0Ref.current + (b * barBeats + ev.beat) * beatDurRef.current;
        const d = tapT - T;
        if (Math.abs(d) <= windowSec && Math.abs(d) < Math.abs(bestDelta)) {
          bestDelta = d;
          bestKey = key;
          bestEv = ev;
        }
      });
    }
    if (!bestKey || !bestEv) {
      setLastTap({ s, f, verdict: "wrong" });
      return;
    }
    const ms = Math.round(bestDelta * 1000);
    const ev = bestEv as PlanEvent;
    let verdict: Verdict;
    if (midi !== ev.midi) verdict = "wrong";
    else if (Math.abs(ms) <= ON_TIME_MS) verdict = "on";
    else verdict = ms < 0 ? "early" : "late";
    setResult(bestKey, { verdict, ms });
    setLastTap({ s, f, verdict });
  }

  // --- 表示用の計算 ---
  const beatDur = 60 / tempo;
  const posBeats = running ? (nowT - t0Ref.current) / beatDur : -1;
  const curBar = running && posBeats >= 0 ? Math.floor(posBeats / barBeats) : 0;
  const inCountIn = running && posBeats < 0;
  if (running) ensurePlan(curBar + 1);
  const leftPlan: PlanBar | undefined = planRef.current[curBar];
  const rightPlan: PlanBar | undefined = curBar + 1 < rounds ? planRef.current[curBar + 1] : undefined;
  const beatInBar = running && posBeats >= 0 ? Math.floor(posBeats - curBar * barBeats + EPS) : inCountIn ? Math.floor(posBeats + barBeats + EPS) : -1;
  const playheadBeat = running && posBeats >= 0 ? posBeats - curBar * barBeats : null;

  // 次の目標(まだ結果が無い最初の音。現在の小節と次の小節から探す)
  let target: { ev: PlanEvent; key: string } | null = null;
  for (const b of [curBar, curBar + 1].filter((x) => x < rounds)) {
    const bar = planRef.current[b];
    if (!bar) continue;
    for (let i = 0; i < bar.events.length; i++) {
      const key = `${b}:${i}`;
      if (!results[key]) {
        target = { ev: bar.events[i], key };
        break;
      }
    }
    if (target) break;
  }

  const stats = useMemo(() => {
    const vals = Object.values(results);
    const on = vals.filter((r) => r.verdict === "on").length;
    const early = vals.filter((r) => r.verdict === "early").length;
    const late = vals.filter((r) => r.verdict === "late").length;
    const wrong = vals.filter((r) => r.verdict === "wrong").length;
    const miss = vals.filter((r) => r.verdict === "miss").length;
    const timed = vals.filter((r) => r.verdict === "on" || r.verdict === "early" || r.verdict === "late");
    const avg = timed.length ? Math.round(timed.reduce((a, r) => a + r.ms, 0) / timed.length) : 0;
    return { total: vals.length, on, early, late, wrong, miss, avg };
  }, [results]);

  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  const chordLabel = (root: number, k: string) => `${names[mod12(root)]}${k === "dim" ? "dim" : k === "m7b5" ? "m7♭5" : k === "mMaj7" ? "m(maj7)" : k}`;

  // 五線譜のジオメトリ(Chord tones の五線譜と同じ: 線間隔20、Bravura フォント、同じ配色)
  const STAFF_TOP = 100;
  const STAFF_BOT = STAFF_TOP + 80;
  const HALF = 10;
  const VB_W = 940;
  const BAR_W = 390;
  const LEFT_X = 160;
  const NH_FS = 72; // 符頭のフォントサイズ(Chord tones と同じ 80×0.9)
  const NH_HALF = (1.18 * NH_FS) / 8; // 符頭の半幅(符頭の幅1.18スペース÷2)
  const STEM_LEN = 63;
  const xOf = (barIdx: 0 | 1, beat: number) => LEFT_X + barIdx * BAR_W + 26 + (beat / barBeats) * (BAR_W - 52);
  const letters = useFlats ? FLAT_LETTER : SHARP_LETTER;
  const accs = useFlats ? FLAT_ACC : SHARP_ACC;
  function staffPos(written: number) {
    const pc = mod12(written);
    const octave = Math.floor(written / 12) - 1;
    const d = octave * 7 + letters[pc];
    return { d, y: STAFF_BOT - (d - 30) * HALF, acc: accs[pc] };
  }
  const g = (cp: number) => String.fromCodePoint(cp);
  const TS = [0xe080, 0xe081, 0xe082, 0xe083, 0xe084, 0xe085, 0xe086, 0xe087, 0xe088, 0xe089];
  const timeSigStr = (n: number) => String(n).split("").map((c) => g(TS[Number(c)])).join("");

  const verdictColor: Record<Verdict, string> = { on: "#0E7C66", early: "#B4530A", late: "#6A3FB5", wrong: "#C0392B", miss: "#8A8376" };
  const verdictText: Record<Verdict, string> = { on: tr("On time"), early: tr("Early"), late: tr("Late"), wrong: tr("Wrong note"), miss: tr("Missed") };

  function renderBar(plan: PlanBar | undefined, barIdx: 0 | 1, barNo: number) {
    if (!plan) return null;
    const dim = barIdx === 1;
    const op = dim ? 0.4 : 1;
    const out: React.ReactNode[] = [];
    const pts = plan.events.map((ev) => ({ ev, x: xOf(barIdx, ev.beat), ...staffPos(ev.written) }));
    // 加線
    pts.forEach((p, i) => {
      const lines: number[] = [];
      if (p.y > STAFF_BOT) for (let y = STAFF_BOT + 20; y <= p.y + 0.1; y += 20) lines.push(y);
      if (p.y < STAFF_TOP) for (let y = STAFF_TOP - 20; y >= p.y - 0.1; y -= 20) lines.push(y);
      lines.forEach((y) => out.push(<line key={`l${barIdx}-${i}-${y}`} x1={p.x - NH_HALF - 6} x2={p.x + NH_HALF + 6} y1={y} y2={y} stroke="var(--text-primary)" strokeWidth={1.5} opacity={op} />));
    });
    // 連桁グループ: 同じ拍の中の、4分音符より短い音
    const groups: number[][] = [];
    pts.forEach((p, i) => {
      if (p.ev.dur >= 1 - EPS) return;
      const last = groups[groups.length - 1];
      if (last && Math.floor(pts[last[0]].ev.beat + EPS) === Math.floor(p.ev.beat + EPS)) last.push(i);
      else groups.push([i]);
    });
    const inGroup: Record<number, number[]> = {};
    groups.forEach((gr) => gr.forEach((i) => (inGroup[i] = gr)));
    const MID = STAFF_TOP + 40;
    const stemsDownOf = (idxs: number[]) => idxs.reduce((a, i) => a + Math.abs(pts[i].y - MID), 0) > 0 && idxs.reduce((a, i) => a + (pts[i].y - MID), 0) / idxs.length < 0;
    const stemX = (i: number, down: boolean) => pts[i].x + (down ? -NH_HALF : NH_HALF);
    pts.forEach((p, i) => {
      const gr = inGroup[i] ?? [i];
      const down = stemsDownOf(gr);
      const key = `${barIdx === 0 ? curBar : curBar + 1}:${i}`;
      const res = results[key];
      const fill = res ? verdictColor[res.verdict] : "var(--text-primary)";
      const tipY = gr.length > 1 ? (down ? Math.max(...gr.map((k) => pts[k].y)) + STEM_LEN : Math.min(...gr.map((k) => pts[k].y)) - STEM_LEN) : down ? p.y + STEM_LEN : p.y - STEM_LEN;
      const sx = stemX(i, down);
      out.push(
        <g key={`n${barIdx}-${i}`} opacity={op}>
          <text x={p.x} y={p.y} fontSize={NH_FS} fontFamily="Bravura" textAnchor="middle" fill={fill}>
            {g(0xe0a4)}
          </text>
          <line x1={sx} x2={sx} y1={p.y + (down ? 3 : -3)} y2={tipY} stroke="var(--text-primary)" strokeWidth={1.5} />
          {p.acc !== 0 && (
            <text x={p.x - NH_HALF - 12} y={p.y} fontSize={44} fontFamily="Bravura" textAnchor="middle" fill="var(--text-primary)">
              {g(p.acc > 0 ? 0xe262 : 0xe260)}
            </text>
          )}
          {!dim && (
            <text x={p.x} y={STAFF_BOT + 52} fontSize={14} fontWeight={700} textAnchor="middle" fill="var(--warning)">
              {p.ev.degree}
            </text>
          )}
          {!dim && res && res.verdict !== "miss" && (
            <text x={p.x} y={STAFF_BOT + 72} fontSize={13} fontWeight={700} textAnchor="middle" fill={verdictColor[res.verdict]}>
              {res.verdict === "wrong" ? "×" : res.ms > 0 ? `+${res.ms}` : `${res.ms}`}
            </text>
          )}
          {!dim && res && res.verdict === "miss" && (
            <text x={p.x} y={STAFF_BOT + 72} fontSize={12} textAnchor="middle" fill={verdictColor.miss}>
              –
            </text>
          )}
        </g>
      );
      // 単独の8分・16分音符には旗
      if (gr.length === 1 && p.ev.dur < 1 - EPS) {
        out.push(
          <text key={`fl${barIdx}-${i}`} x={sx} y={tipY} fontSize={NH_FS} fontFamily="Bravura" fill="var(--text-primary)" opacity={op}>
            {g(p.ev.dur <= 0.26 ? (down ? 0xe243 : 0xe242) : down ? 0xe241 : 0xe240)}
          </text>
        );
      }
    });
    groups.forEach((gr, gi) => {
      if (gr.length < 2) return;
      const down = stemsDownOf(gr);
      const tipY = down ? Math.max(...gr.map((k) => pts[k].y)) + STEM_LEN : Math.min(...gr.map((k) => pts[k].y)) - STEM_LEN;
      const x1 = stemX(gr[0], down) - 0.75;
      const x2 = stemX(gr[gr.length - 1], down) + 0.75;
      const by = (n: number) => (down ? tipY - 8 - n * 12 : tipY + n * 12);
      out.push(<rect key={`b${barIdx}-${gi}`} x={x1} y={by(0)} width={x2 - x1} height={8} fill="var(--text-primary)" opacity={op} />);
      if (gr.every((i) => pts[i].ev.dur <= 0.26)) out.push(<rect key={`b2${barIdx}-${gi}`} x={x1} y={by(1)} width={x2 - x1} height={8} fill="var(--text-primary)" opacity={op} />);
      if (gr.length === 3 && gr.every((i) => Math.abs(pts[i].ev.dur - T3) < 0.02)) {
        const bx = down ? tipY + 12 : tipY - 14;
        const dirY = down ? 8 : -8;
        out.push(
          <g key={`t${barIdx}-${gi}`} opacity={op}>
            <path d={`M${x1} ${bx - dirY} V${bx} H${x2} V${bx - dirY}`} fill="none" stroke="var(--text-primary)" strokeWidth={1.4} />
            <text x={(x1 + x2) / 2} y={down ? bx + 18 : bx - 6} fontSize={18} fontStyle="italic" textAnchor="middle" fill="var(--text-primary)" fontFamily="serif">
              3
            </text>
          </g>
        );
      }
    });
    out.push(
      <text key={`c${barIdx}`} x={LEFT_X + barIdx * BAR_W + 8} y={STAFF_TOP - 28} fontSize={24} fontWeight={600} fill="var(--text-primary)" opacity={dim ? 0.55 : 1}>
        {chordLabel(plan.chordRoot, plan.chordKind)}
      </text>
    );
    out.push(
      <text key={`bn${barIdx}`} x={LEFT_X + barIdx * BAR_W + BAR_W - 6} y={STAFF_TOP - 28} fontSize={12} textAnchor="end" fill="var(--text-secondary)">
        {barNo}/{rounds}
      </text>
    );
    return out;
  }

  return (
    <>
      {finished && (() => {
        const total = Math.max(1, stats.total);
        const pts = stats.on + (stats.early + stats.late) * 0.6;
        const score = Math.round((pts / total) * 100);
        const grade = score >= 90 ? "S" : score >= 75 ? "A" : score >= 55 ? "B" : "C";
        const tendency = stats.early + stats.late === 0 ? "" : stats.early > stats.late * 1.5 ? tr("Tends to rush (early).") : stats.late > stats.early * 1.5 ? tr("Tends to drag (late).") : tr("Early and late are balanced.");
        return (
          <section id="rh-results" className="sb-paper" style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", margin: "0 0 10px" }}>
            <div style={{ textAlign: "center", minWidth: 120 }}>
              <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1, color: "#2a2721" }}>{score}</div>
              <div style={{ fontSize: 13, color: "#6c6455" }}>{tr("points")} · {tr("grade")} {grade}</div>
            </div>
            <div style={{ flex: "1 1 260px", fontSize: 15, color: "#2a2721", lineHeight: 1.7 }}>
              <div>
                <b style={{ color: verdictColor.on }}>{tr("On time")} {stats.on}</b> / {stats.total} {tr("notes")} · {tr("Early")} {stats.early} · {tr("Late")} {stats.late} · {tr("Wrong note")} {stats.wrong} · {tr("Missed")} {stats.miss}
              </div>
              <div>
                {tr("Average timing")} {stats.avg >= 0 ? "+" : ""}
                {stats.avg} ms. {tendency}
              </div>
              <div style={{ fontSize: 12, color: "#6c6455" }}>{tr("On time = 100, early/late = 60, wrong or missed = 0 per note.")}</div>
            </div>
            <button
              type="button"
              className="icon-btn icon-btn-text icon-btn-primary"
              style={{ width: "auto", padding: "0 18px" }}
              onClick={() => start()}
            >
              {tr("Try again")}
            </button>
          </section>
        );
      })()}

      <div className="sb-rh-sticky">
      <button
        type="button"
        className="sb-startbar"
        onClick={() => (running ? stop() : start())}
      >
        {running ? <Square size={18} /> : <Play size={18} />}
        {running ? tr("Stop") : tr("Start")}
      </button>

      <section className="sb-paper">
        <svg viewBox={`0 0 ${VB_W} 300`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={tr("Rhythm staff: current and next bar")}>
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1={0} x2={VB_W - 20} y1={STAFF_TOP + i * 20} y2={STAFF_TOP + i * 20} stroke="var(--border-strong)" strokeWidth={1} />
          ))}
          <line x1={LEFT_X + BAR_W} x2={LEFT_X + BAR_W} y1={STAFF_TOP} y2={STAFF_BOT} stroke="var(--text-primary)" strokeWidth={1.5} />
          <line x1={VB_W - 20} x2={VB_W - 20} y1={STAFF_TOP} y2={STAFF_BOT} stroke="var(--text-primary)" strokeWidth={1.5} />
          <text x={0} y={STAFF_TOP + 60} fontSize={80} fontFamily="Bravura" fill="var(--text-primary)">
            {g(0xe050)}
          </text>
          <text x={104} y={STAFF_TOP + 20} fontSize={80} fontFamily="Bravura" textAnchor="middle" fill="var(--text-primary)">
            {timeSigStr(timeSig.numerator)}
          </text>
          <text x={104} y={STAFF_TOP + 60} fontSize={80} fontFamily="Bravura" textAnchor="middle" fill="var(--text-primary)">
            {timeSigStr(timeSig.denominator)}
          </text>
          {running && leftPlan && renderBar(leftPlan, 0, curBar + 1)}
          {running && rightPlan && renderBar(rightPlan, 1, curBar + 2)}
          {!running && (() => {
            const parts = tr("Press Start. You hear the right note on each beat; tap any glowing dot with it.").split(/(?<=[。.])\s*/).filter(Boolean);
            return parts.map((t, i) => (
              <text key={i} x={LEFT_X + 20} y={STAFF_TOP + 30 + i * 28} fontSize={20} fill="var(--text-secondary)">
                {t}
              </text>
            ));
          })()}
          {playheadBeat !== null && <rect x={xOf(0, playheadBeat) - 2} y={STAFF_TOP - 36} width={4} height={160} rx={2} fill="var(--accent)" />}
          <g stroke="var(--border-strong)" strokeWidth={1.4}>
            <line x1={LEFT_X} x2={LEFT_X + 2 * BAR_W} y1={282} y2={282} />
            {Array.from({ length: barBeats * 2 + 1 }, (_, b) => (
              <line key={b} x1={LEFT_X + (b / barBeats) * BAR_W} x2={LEFT_X + (b / barBeats) * BAR_W} y1={277} y2={287} />
            ))}
          </g>
        </svg>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13, color: "#4a453c", padding: "0 2px 4px" }}>
          {(["on", "early", "late"] as Verdict[]).map((v) => (
            <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden style={{ width: 11, height: 11, borderRadius: "50%", background: verdictColor[v], display: "inline-block" }} />
              {v === "on" ? `${tr("On time")} (±${ON_TIME_MS} ms)` : verdictText[v]}
            </span>
          ))}
          <span style={{ marginLeft: "auto", fontWeight: 700 }}>
            {inCountIn
              ? `${tr("Count-in")}… ${beatInBar + 1}`
              : stats.total === 0
                ? tr("Waiting for your first note")
                : `${tr("On time")} ${stats.on} / ${stats.total} · ${tr("avg")} ${stats.avg >= 0 ? "+" : ""}${stats.avg} ms${stats.wrong ? ` · ${tr("Wrong note")} ${stats.wrong}` : ""}${stats.miss ? ` · ${tr("Missed")} ${stats.miss}` : ""}`}
          </span>
        </div>
      </section>

      <section className="sb-board">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 6, padding: "0 4px 4px", fontSize: 13 }}>
          <span style={{ color: "var(--accent)", fontWeight: 700 }}>
            {running && target ? `${tr("Next")}: ${target.ev.degree} (${names[target.ev.pc]}) — ${tr("tap any glowing dot on the beat")}` : tr("Chord tones of the current chord")}
          </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {lastTap ? `${tr("Last tap")}: ${verdictText[lastTap.verdict]}` : tr("Pitch and timing are both scored")}
          </span>
        </div>
        <div id="fretboard-wrap">
          <svg
            viewBox={`0 0 ${FB.w} ${FB.h}`}
            style={{ width: "100%", height: "auto", display: "block", minWidth: 660, touchAction: "none", cursor: running ? "pointer" : "default" }}
            onPointerDown={onFretboardPointerDown}
            role="img"
            aria-label={tr("Guitar fretboard: glowing dots are the next note")}
          >
            <defs>
              <linearGradient id="ebony-r" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#34251b" />
                <stop offset="1" stopColor="#1b120d" />
              </linearGradient>
            </defs>
            <rect x={FB.left} y={FB.top - 16} width={FRETS * FB.fretW} height={5 * FB.gap + 32} rx={4} fill="url(#ebony-r)" />
            {[3, 5, 7, 9].map((f) => (
              <circle key={f} cx={FB.left + f * FB.fretW - FB.fretW / 2} cy={FB.top + 2.5 * FB.gap} r={5} fill="#e8e2d2" opacity={0.22} />
            ))}
            {[1.5, 3.5].map((k) => (
              <circle key={k} cx={FB.left + FRETS * FB.fretW - FB.fretW / 2} cy={FB.top + k * FB.gap} r={5} fill="#e8e2d2" opacity={0.22} />
            ))}
            {Array.from({ length: FRETS + 1 }, (_, f) => (
              <g key={f}>
                <line x1={FB.left + f * FB.fretW} x2={FB.left + f * FB.fretW} y1={FB.top} y2={FB.top + 5 * FB.gap} stroke={f === 0 ? "#d8d2c4" : "#8d877b"} strokeWidth={f === 0 ? 5 : 2} />
                {[3, 5, 7, 9, 12].includes(f) && (
                  <text x={FB.left + f * FB.fretW - FB.fretW / 2} y={FB.top - 22} textAnchor="middle" fontSize={13} fill="var(--text-secondary)">
                    {f}
                  </text>
                )}
              </g>
            ))}
            {OPEN_MIDI.map((_, s) => (
              <g key={s}>
                <line x1={FB.left} x2={FB.left + FRETS * FB.fretW} y1={FB.top + s * FB.gap} y2={FB.top + s * FB.gap} stroke="#cfc8b8" strokeOpacity={0.75} strokeWidth={0.8 + s * 0.35} />
                <text x={FB.left - 40} y={FB.top + s * FB.gap + 4} textAnchor="end" fontSize={12} fill="var(--text-secondary)">
                  {`${tr("String")} ${s + 1} · ${["E", "B", "G", "D", "A", "E"][s]}`}
                </text>
              </g>
            ))}
            {/* 現在のコードの構成音(Chord tones と同じ色分け) */}
            {running &&
              leftPlan &&
              (() => {
                const intervals = CHORD_TYPES[leftPlan.chordKind] ?? CHORD_TYPES.maj7;
                const role = (iv: number) => (iv === 0 ? "danger" : iv === 3 || iv === 4 ? "warning" : iv === 6 || iv === 7 || iv === 10 || iv === 11 ? "success" : "pro");
                const dots: React.ReactNode[] = [];
                for (let s = 0; s < TARGET_STRINGS; s++) {
                  for (let f = 0; f <= FRETS; f++) {
                    if (OPEN_MIDI[s] + f < MIDI_LO || OPEN_MIDI[s] + f > MIDI_HI) continue;
                    const iv = intervals.find((v) => mod12(leftPlan.chordRoot + v) === mod12(OPEN_MIDI[s] + f));
                    if (iv === undefined) continue;
                    const r = role(iv);
                    const cx = fx(f);
                    const cy = FB.top + s * FB.gap;
                    dots.push(
                      <g key={`${s}-${f}`} opacity={0.7}>
                        <circle cx={cx} cy={cy} r={10} fill={`var(--${r})`} />
                        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={`var(--on-${r})`}>
                          {DEGREE_BY_INTERVAL[iv] ?? ""}
                        </text>
                      </g>
                    );
                  }
                }
                return dots;
              })()}
            {/* 次の目標: 同じ音(ピッチクラス)が指板上のどこにあっても、全部光らせる */}
            {running && target && (
              <g>
                {OPEN_MIDI.flatMap((open, s) =>
                  Array.from({ length: FRETS + 1 }, (_, i) => i)
                    .filter((f) => open + f === target.ev.midi)
                    .map((f) => {
                      const cx = fx(f);
                      const cy = FB.top + s * FB.gap;
                      return (
                        <g key={`t${s}-${f}`}>
                          <circle cx={cx} cy={cy} r={24} fill="none" stroke="#d9b65a" strokeWidth={3} />
                          <circle cx={cx} cy={cy} r={31} fill="none" stroke="#d9b65a" strokeWidth={1.5} opacity={0.5} />
                          <circle cx={cx} cy={cy} r={13} fill="#d9b65a" />
                          <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#1a1511">
                            {target.ev.degree}
                          </text>
                        </g>
                      );
                    })
                )}
              </g>
            )}
            {/* 直前のタップ位置 */}
            {lastTap && (
              <circle cx={fx(lastTap.f)} cy={FB.top + lastTap.s * FB.gap} r={16} fill="none" stroke={verdictColor[lastTap.verdict]} strokeWidth={4} />
            )}
          </svg>
        </div>
        <div id="degree-legend" aria-label={tr("Colour key")} style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", marginTop: "0.5rem", fontSize: 12, color: "var(--text-secondary)" }}>
          {[
            { label: tr("R · root"), role: "danger" },
            { label: tr("3 · 3rd"), role: "warning" },
            { label: tr("5, 7 · 5th, 7th"), role: "success" },
            { label: tr("6 · 6th"), role: "pro" },
          ].map((it) => (
            <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", display: "inline-block", background: `var(--${it.role})` }} />
              {it.label}
            </span>
          ))}
        </div>
        <div id="legend">{tr("Notes come from the chord tones of the current bar. Tap the exact pitch: the same note at another octave does not count.")}</div>
      </section>
      </div>

      <div className="sb-rh-controls">
        <div className="sb-seg" role="group" aria-label={tr("Rhythm type")} style={{ width: "100%" }}>
          {(Object.keys(KIND_LABEL) as RhythmKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "sb-seg-on" : ""} style={{ flex: 1 }} onClick={() => setKind(k)}>
              {tr(KIND_LABEL[k])}
            </button>
          ))}
        </div>
        <div className="sb-group" style={{ marginTop: 12 }}>
          <div className="sb-item">
            <span>{tr("Tempo")}</span>
            <Stepper minus value={`${tempo}`} downLabel={tr("Slower")} upLabel={tr("Faster")} downDisabled={tempo <= 40} upDisabled={tempo >= 200} onDown={() => setTempo((t) => Math.max(40, t - 5))} onUp={() => setTempo((t) => Math.min(200, t + 5))} />
          </div>
          <div className="sb-item">
            <span>{tr("Length")}</span>
            <Stepper minus value={`${rounds} ${tr("bars")}`} downLabel={tr("Fewer bars")} upLabel={tr("More bars")} downDisabled={rounds <= 4} upDisabled={rounds >= 16} onDown={() => setRounds((r) => Math.max(4, r - 4))} onUp={() => setRounds((r) => Math.min(16, r + 4))} />
          </div>
          <div className="sb-item">
            <span>{tr("Guide sound")}</span>
            <Switch on={guide} label={tr("Guide sound")} onClick={() => setGuide((v) => !v)} />
          </div>
          <div className="sb-item">
            <span>{tr("Count-in (1 bar)")}</span>
            <Switch on={countIn} label={tr("Count-in (1 bar)")} onClick={() => setCountIn((v) => !v)} />
          </div>
        </div>
      </div>

    </>
  );
}
