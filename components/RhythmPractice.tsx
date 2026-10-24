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

type RhythmKind = "8th" | "triplet" | "16th" | "synco";
type Verdict = "on" | "early" | "late" | "wrong" | "miss";

type Props = {
  measures: Measure[];
  chordRoot: number;
  chordType: string;
  useFlats: boolean;
  timeSig: TimeSignature;
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
const TARGET_STRINGS = 4; // 出題は1〜4弦のみ

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
    for (let f = 1; f <= FRETS; f++) {
      if (mod12(OPEN_MIDI[s] + f) !== pc) continue;
      const cost = Math.abs(s - prev.s) * 2 + Math.abs(f - prev.f);
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

export default function RhythmPractice({ measures, chordRoot, chordType, useFlats, timeSig }: Props) {
  const [kind, setKind] = useState<RhythmKind>("triplet");
  const [tempo, setTempo] = useState(80);
  const [countIn, setCountIn] = useState(true);
  const [running, setRunning] = useState(false);
  const [nowT, setNowT] = useState(0);
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
        let written = midi + 12;
        while (written > 79) written -= 12;
        while (written < 60) written += 12;
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

  function tone(midi: number) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq(midi);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
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
    setResults({});
    setLastTap(null);
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
  }, [kind, tempo, barBeats, chordsPerBar]);

  // --- 指板のタップ ---
  const FB = { w: 780, h: 214, left: 70, fretW: 58, top: 34, gap: 28 };
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
    for (let b = Math.max(0, curBar - 1); b <= curBar + 1; b++) {
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
    if (mod12(midi) !== ev.pc) verdict = "wrong";
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
  const rightPlan: PlanBar | undefined = planRef.current[curBar + 1];
  const beatInBar = running && posBeats >= 0 ? Math.floor(posBeats - curBar * barBeats + EPS) : inCountIn ? Math.floor(posBeats + barBeats + EPS) : -1;
  const playheadBeat = running && posBeats >= 0 ? posBeats - curBar * barBeats : null;

  // 次の目標(まだ結果が無い最初の音。現在の小節と次の小節から探す)
  let target: { ev: PlanEvent; key: string } | null = null;
  for (const b of [curBar, curBar + 1]) {
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

  // 五線譜のジオメトリ
  const BAR_W = 316;
  const LEFT_X = 130;
  const STAFF_BOTTOM = 134;
  const HALF = 7;
  const xOf = (barIdx: 0 | 1, beat: number) => LEFT_X + barIdx * BAR_W + 18 + (beat / barBeats) * (BAR_W - 36);
  const letters = useFlats ? FLAT_LETTER : SHARP_LETTER;
  const accs = useFlats ? FLAT_ACC : SHARP_ACC;
  function staffPos(written: number) {
    const pc = mod12(written);
    const octave = Math.floor(written / 12) - 1;
    const d = octave * 7 + letters[pc];
    return { d, y: STAFF_BOTTOM - (d - 30) * HALF, acc: accs[pc] };
  }

  const verdictColor: Record<Verdict, string> = { on: "#0E7C66", early: "#B4530A", late: "#6A3FB5", wrong: "#C0392B", miss: "#8A8376" };
  const verdictText: Record<Verdict, string> = { on: "On time", early: "Early", late: "Late", wrong: "Wrong note", miss: "Missed" };

  function renderBar(plan: PlanBar | undefined, barIdx: 0 | 1, barNo: number) {
    if (!plan) return null;
    const dim = barIdx === 1;
    const out: React.ReactNode[] = [];
    const evs = plan.events;
    const pts = evs.map((ev) => {
      const sp = staffPos(ev.written);
      return { ev, x: xOf(barIdx, ev.beat), ...sp };
    });
    // ledger lines
    pts.forEach((p, i) => {
      for (let d = p.d <= 28 ? 28 : 40; p.d <= 28 ? d >= p.d : d <= p.d; d += p.d <= 28 ? -2 : 2) {
        const ly = STAFF_BOTTOM - (d - 30) * HALF;
        out.push(<line key={`l${barIdx}-${i}-${d}`} x1={p.x - 12} x2={p.x + 12} y1={ly} y2={ly} stroke="#2a2721" strokeWidth={1.4} opacity={dim ? 0.35 : 1} />);
      }
    });
    // beams: 同じ拍の中で、4分音符より短い音をまとめる
    const groups: number[][] = [];
    pts.forEach((p, i) => {
      if (p.ev.dur >= 1 - EPS) return;
      const g = groups[groups.length - 1];
      if (g && Math.floor(pts[g[0]].ev.beat + EPS) === Math.floor(p.ev.beat + EPS)) g.push(i);
      else groups.push([i]);
    });
    const beamTop: Record<number, number> = {};
    groups.forEach((g) => {
      const top = Math.min(...g.map((i) => pts[i].y)) - 36;
      g.forEach((i) => (beamTop[i] = top));
    });
    pts.forEach((p, i) => {
      const key = `${barIdx === 0 ? curBar : curBar + 1}:${i}`;
      const res = results[key];
      const fill = res ? verdictColor[res.verdict] : "#2a2721";
      const stemTop = beamTop[i] ?? p.y - 36;
      const op = dim ? 0.35 : 1;
      out.push(
        <g key={`n${barIdx}-${i}`} opacity={op}>
          <ellipse cx={p.x} cy={p.y} rx={8.5} ry={6.4} transform={`rotate(-20 ${p.x} ${p.y})`} fill={fill} />
          <line x1={p.x + 8} x2={p.x + 8} y1={p.y - 2} y2={stemTop} stroke="#2a2721" strokeWidth={2.2} />
          {p.acc !== 0 && (
            <text x={p.x - 22} y={p.y + 6} fontSize={20} fill="#2a2721" fontFamily="serif">
              {p.acc > 0 ? "♯" : "♭"}
            </text>
          )}
          {!dim && (
            <text x={p.x} y={170} fontSize={13} fontWeight={700} textAnchor="middle" fill="#8A6A0E">
              {p.ev.degree}
            </text>
          )}
          {!dim && res && res.verdict !== "miss" && (
            <text x={p.x} y={190} fontSize={13} fontWeight={700} textAnchor="middle" fill={verdictColor[res.verdict]}>
              {res.verdict === "wrong" ? "×" : res.ms > 0 ? `+${res.ms}` : `${res.ms}`}
            </text>
          )}
          {!dim && res && res.verdict === "miss" && (
            <text x={p.x} y={190} fontSize={12} textAnchor="middle" fill={verdictColor.miss}>
              –
            </text>
          )}
        </g>
      );
    });
    groups.forEach((g, gi) => {
      const first = pts[g[0]];
      const last = pts[g[g.length - 1]];
      const top = beamTop[g[0]];
      const op = dim ? 0.35 : 1;
      if (g.length >= 2) {
        out.push(<rect key={`b${barIdx}-${gi}`} x={first.x + 7} y={top - 2} width={last.x - first.x + 2} height={4.5} fill="#2a2721" opacity={op} />);
        if (g.every((i) => pts[i].ev.dur <= 0.26)) {
          out.push(<rect key={`b2${barIdx}-${gi}`} x={first.x + 7} y={top + 5} width={last.x - first.x + 2} height={4.5} fill="#2a2721" opacity={op} />);
        }
        if (g.length === 3 && g.every((i) => Math.abs(pts[i].ev.dur - T3) < 0.02)) {
          const cx = (first.x + last.x) / 2 + 8;
          out.push(
            <g key={`t${barIdx}-${gi}`} opacity={op}>
              <path d={`M${first.x + 8} ${top - 8} V${top - 14} H${last.x + 8} V${top - 8}`} fill="none" stroke="#2a2721" strokeWidth={1.4} />
              <text x={cx} y={top - 18} fontSize={14} fontStyle="italic" textAnchor="middle" fill="#2a2721" fontFamily="serif">
                3
              </text>
            </g>
          );
        }
      } else {
        out.push(<path key={`f${barIdx}-${gi}`} d={`M${first.x + 8} ${top} q9 8 6 20`} fill="none" stroke="#2a2721" strokeWidth={2.4} opacity={op} />);
      }
    });
    out.push(
      <text key={`c${barIdx}`} x={LEFT_X + barIdx * BAR_W + 6} y={22} fontSize={19} fontWeight={600} fill="#2a2721" opacity={dim ? 0.5 : 1}>
        {chordLabel(plan.chordRoot, plan.chordKind)}
      </text>
    );
    out.push(
      <text key={`bn${barIdx}`} x={LEFT_X + barIdx * BAR_W + BAR_W - 6} y={30} fontSize={12} textAnchor="end" fill="#6c6455">
        {barNo}
      </text>
    );
    return out;
  }

  const timeSigY1 = STAFF_BOTTOM - 28 - 2;
  const timeSigY2 = STAFF_BOTTOM - 2;

  return (
    <>
      <div className="sb-row" style={{ alignItems: "center", margin: "0 0 8px" }}>
        <div className="sb-seg" role="group" aria-label="Rhythm type">
          {(Object.keys(KIND_LABEL) as RhythmKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "sb-seg-on" : ""} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="toolbar-group" data-cap="Tempo">
          <button type="button" aria-label="Slower" disabled={tempo <= 40} onClick={() => setTempo((t) => Math.max(40, t - 5))}>
            −
          </button>
          <span style={{ minWidth: 36, textAlign: "center", fontWeight: 700 }}>{tempo}</span>
          <button type="button" aria-label="Faster" disabled={tempo >= 200} onClick={() => setTempo((t) => Math.min(200, t + 5))}>
            +
          </button>
        </div>
        <div className="toolbar-group" data-cap="Count-in">
          <button type="button" aria-pressed={countIn} style={{ minWidth: 64, color: countIn ? "var(--accent)" : "var(--text-secondary)", fontWeight: 700 }} onClick={() => setCountIn((v) => !v)}>
            {countIn ? "1 bar" : "Off"}
          </button>
        </div>
        <div className="toolbar-group" style={{ marginLeft: "auto", background: "transparent", borderColor: "transparent", paddingRight: 0 }}>
          <button
            type="button"
            className="icon-btn icon-btn-text icon-btn-primary"
            style={{ width: "auto", padding: "0 16px", display: "inline-flex", alignItems: "center", gap: 8 }}
            onClick={() => (running ? stop() : start())}
          >
            {running ? <Square size={16} /> : <Play size={16} />}
            {running ? "Stop" : "Start"}
          </button>
        </div>
      </div>

      <section className="sb-paper">
        <svg viewBox="0 0 772 220" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="リズム譜。現在の小節と次の小節">
          <g stroke="#2a2721" strokeWidth={1.4}>
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={i} x1={8} x2={764} y1={STAFF_BOTTOM - i * 14} y2={STAFF_BOTTOM - i * 14} />
            ))}
            <line x1={LEFT_X + BAR_W} x2={LEFT_X + BAR_W} y1={STAFF_BOTTOM - 56} y2={STAFF_BOTTOM} />
            <line x1={763} x2={763} y1={STAFF_BOTTOM - 56} y2={STAFF_BOTTOM} strokeWidth={3} />
          </g>
          <text x={8} y={STAFF_BOTTOM + 12} fontSize={92} fill="#2a2721" fontFamily="'Apple Symbols','Noto Music','Bravura',serif">
            𝄞
          </text>
          <text x={86} y={timeSigY1 + 2} fontSize={30} fontWeight={700} fill="#2a2721">
            {timeSig.numerator}
          </text>
          <text x={86} y={timeSigY2} fontSize={30} fontWeight={700} fill="#2a2721">
            {timeSig.denominator}
          </text>
          {Array.from({ length: barBeats }, (_, b) => (
            <line key={b} x1={xOf(0, b)} x2={xOf(0, b)} y1={STAFF_BOTTOM - 56} y2={STAFF_BOTTOM + 70} stroke="#9a9384" strokeWidth={1} strokeDasharray="2 4" opacity={0.0} />
          ))}
          {running && leftPlan && renderBar(leftPlan, 0, curBar + 1)}
          {running && rightPlan && renderBar(rightPlan, 1, curBar + 2)}
          {!running && (
            <text x={LEFT_X + 20} y={STAFF_BOTTOM - 20} fontSize={16} fill="#6c6455">
              Press Start. Tap the glowing dot on the fretboard on each beat.
            </text>
          )}
          {playheadBeat !== null && <rect x={xOf(0, playheadBeat) - 2} y={44} width={4} height={150} rx={2} fill="#b8942f" />}
          {/* 拍の目盛り */}
          <g stroke="#9a9384" strokeWidth={1.4}>
            <line x1={LEFT_X} x2={LEFT_X + 2 * BAR_W} y1={210} y2={210} />
            {Array.from({ length: barBeats * 2 + 1 }, (_, b) => (
              <line key={b} x1={LEFT_X + (b / barBeats) * BAR_W} x2={LEFT_X + (b / barBeats) * BAR_W} y1={205} y2={215} />
            ))}
          </g>
          {Array.from({ length: barBeats }, (_, b) => (
            <text key={b} x={xOf(0, b)} y={218} fontSize={11} textAnchor="middle" fontWeight={beatInBar === b ? 700 : 400} fill={beatInBar === b ? "#8A6A0E" : "#6c6455"} opacity={0}>
              {b + 1}
            </text>
          ))}
        </svg>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13, color: "#4a453c", padding: "0 2px 4px" }}>
          {(["on", "early", "late"] as Verdict[]).map((v) => (
            <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden style={{ width: 11, height: 11, borderRadius: "50%", background: verdictColor[v], display: "inline-block" }} />
              {v === "on" ? `On time (±${ON_TIME_MS} ms)` : verdictText[v]}
            </span>
          ))}
          <span style={{ marginLeft: "auto", fontWeight: 700 }}>
            {inCountIn
              ? `Count-in… ${beatInBar + 1}`
              : stats.total === 0
                ? "Waiting for your first note"
                : `On time ${stats.on} / ${stats.total} · avg ${stats.avg >= 0 ? "+" : ""}${stats.avg} ms${stats.wrong ? ` · wrong ${stats.wrong}` : ""}${stats.miss ? ` · missed ${stats.miss}` : ""}`}
          </span>
        </div>
      </section>

      <section className="sb-board">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 6, padding: "0 4px 4px", fontSize: 13 }}>
          <span style={{ color: "var(--accent)", fontWeight: 700 }}>
            {running && target ? `Next: ${target.ev.degree} (${names[target.ev.pc]}) — tap the glowing dot on the beat` : "Chord tones of the current chord"}
          </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {lastTap ? `Last tap: ${verdictText[lastTap.verdict]}` : "Pitch and timing are both scored"}
          </span>
        </div>
        <div id="fretboard-wrap">
          <svg
            viewBox={`0 0 ${FB.w} ${FB.h}`}
            style={{ width: "100%", height: "auto", display: "block", minWidth: 660, touchAction: "none", cursor: running ? "pointer" : "default" }}
            onPointerDown={onFretboardPointerDown}
            role="img"
            aria-label="ギター指板。光っている点が次に弾く音"
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
                <text x={FB.left - 12} y={FB.top + s * FB.gap + 4} textAnchor="end" fontSize={12} fill="var(--text-secondary)">
                  {`${s + 1}`}
                </text>
              </g>
            ))}
            {/* 現在のコードの構成音(薄く) */}
            {running &&
              leftPlan &&
              (() => {
                const intervals = CHORD_TYPES[leftPlan.chordKind] ?? CHORD_TYPES.maj7;
                const dots: React.ReactNode[] = [];
                for (let s = 0; s < TARGET_STRINGS; s++) {
                  for (let f = 1; f <= FRETS; f++) {
                    const iv = intervals.find((v) => mod12(leftPlan.chordRoot + v) === mod12(OPEN_MIDI[s] + f));
                    if (iv === undefined) continue;
                    dots.push(
                      <g key={`${s}-${f}`} opacity={0.5}>
                        <circle cx={FB.left + f * FB.fretW - FB.fretW / 2} cy={FB.top + s * FB.gap} r={10} fill="#9a9384" />
                        <text x={FB.left + f * FB.fretW - FB.fretW / 2} y={FB.top + s * FB.gap + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1a1511">
                          {DEGREE_BY_INTERVAL[iv] ?? ""}
                        </text>
                      </g>
                    );
                  }
                }
                return dots;
              })()}
            {/* 次の目標 */}
            {running && target && (
              <g>
                <circle cx={FB.left + target.ev.pos.f * FB.fretW - FB.fretW / 2} cy={FB.top + target.ev.pos.s * FB.gap} r={24} fill="none" stroke="#d9b65a" strokeWidth={3} />
                <circle cx={FB.left + target.ev.pos.f * FB.fretW - FB.fretW / 2} cy={FB.top + target.ev.pos.s * FB.gap} r={31} fill="none" stroke="#d9b65a" strokeWidth={1.5} opacity={0.5} />
                <circle cx={FB.left + target.ev.pos.f * FB.fretW - FB.fretW / 2} cy={FB.top + target.ev.pos.s * FB.gap} r={13} fill="#d9b65a" />
                <text x={FB.left + target.ev.pos.f * FB.fretW - FB.fretW / 2} y={FB.top + target.ev.pos.s * FB.gap + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#1a1511">
                  {target.ev.degree}
                </text>
              </g>
            )}
            {/* 直前のタップ位置 */}
            {lastTap && lastTap.f > 0 && (
              <circle cx={FB.left + lastTap.f * FB.fretW - FB.fretW / 2} cy={FB.top + lastTap.s * FB.gap} r={16} fill="none" stroke={verdictColor[lastTap.verdict]} strokeWidth={4} />
            )}
          </svg>
        </div>
        <div id="legend">
          Notes are chosen from the chord tones of the current bar. Strings 1–4 only. Any fret with the right note counts.
        </div>
      </section>
    </>
  );
}
