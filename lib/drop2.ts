// Drop 2 ボイシング: 4和音(R・3・5・7)の「上から2番目の音を1オクターブ下げた」形を、
// 隣り合う4本の弦に並べたもの。弦の組み合わせ(6-3 / 5-2 / 4-1弦)× 最低音(R・3・5・7)の12種類。
// 指板(0〜maxFret)のどの位置にも現れるので、表示範囲の中にあるものを全部返す。
import { CHORD_TYPES } from "./chords";

// 開放弦(s: 0=1弦 … 5=6弦)のMIDIノート番号
const OPEN_MIDI = [64, 59, 55, 50, 45, 40];

export type Drop2Voicing = {
  /** 最低音の種類(0=R 1=3 2=5 3=7)。色分けに使う */
  bass: number;
  /** 弦の組み合わせ(0=6-3弦 1=5-2弦 2=4-1弦) */
  set: number;
  start: number;
  full: boolean;
  notes: { s: number; f: number; role: "R" }[];
};

// 最低音ごとの、低い方から高い方への和音構成音の並び(0=R 1=3 2=5 3=7)
export const DROP2_BASS_ORDER: number[][] = [
  [0, 2, 3, 1], // 最低音R : R-5-7-3
  [1, 3, 0, 2], // 最低音3 : 3-7-R-5
  [2, 0, 1, 3], // 最低音5 : 5-R-3-7
  [3, 1, 2, 0], // 最低音7 : 7-3-5-R
];

// 弦の組み合わせ: 低い方の弦のインデックス(s)から上へ4本
export const DROP2_SETS = [
  { label: "6-3", sBottom: 5 },
  { label: "5-2", sBottom: 4 },
  { label: "4-1", sBottom: 3 },
];

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function drop2Voicings(root: number, kind: string, maxFret = 17): Drop2Voicing[] {
  const iv = CHORD_TYPES[kind];
  if (!iv || iv.length < 4) return [];
  const out: Drop2Voicing[] = [];
  DROP2_SETS.forEach((set, setIdx) => {
    DROP2_BASS_ORDER.forEach((order, bass) => {
      for (let fb = 0; fb <= maxFret; fb++) {
        const bassMidi = OPEN_MIDI[set.sBottom] + fb;
        if (mod12(bassMidi - root) !== iv[order[0]]) continue;
        // 低い音から順に、次の構成音を「直前の音より上で一番近い高さ」に置く
        let prev = bassMidi;
        const notes = [{ s: set.sBottom, f: fb, role: "R" as const }];
        let ok = true;
        for (let k = 1; k < 4; k++) {
          const s = set.sBottom - k;
          let m = prev + 1;
          while (mod12(m - root) !== iv[order[k]]) m++;
          const f = m - OPEN_MIDI[s];
          if (f < 0 || f > maxFret) {
            ok = false;
            break;
          }
          notes.push({ s, f, role: "R" });
          prev = m;
        }
        if (!ok) continue;
        const frets = notes.map((n) => n.f);
        if (Math.max(...frets) - Math.min(...frets) > 4) continue;
        out.push({ bass, set: setIdx, start: Math.min(...frets), full: true, notes });
      }
    });
  });
  return out;
}
