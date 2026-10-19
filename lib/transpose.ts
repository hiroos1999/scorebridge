// 譜面全体の移調。コードのルートは半音数どおりに動かし、メロディは五線上でできるだけ
// 元の音域に近い方向（±6半音以内）へ動かす。黒鍵の綴りは移調後のキーの♯/♭に合わせる。
import type { Measure, Note } from "@/components/StaffToFretboard";

// 五線の行番号(0=C6 … 19=E3)ごとの自然音のMIDI番号。
const ROW_MIDI = [84, 83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52];

// 移調後のキー(Do = pc)で♭系の綴りを使うか。F・B♭・E♭・A♭・D♭・G♭は♭、それ以外は♯。
export function prefersFlats(rootPc: number): boolean {
  return [5, 10, 3, 8, 1, 6].includes(((rootPc % 12) + 12) % 12);
}

function midiToRow(midi: number, useFlats: boolean): { row: number; accidental: number } {
  let m = midi;
  while (m < 52) m += 12;
  while (m > 84) m -= 12;
  const direct = ROW_MIDI.indexOf(m);
  if (direct >= 0) return { row: direct, accidental: 0 };
  const accidental = useFlats ? -1 : 1;
  const row = ROW_MIDI.indexOf(m - accidental);
  if (row >= 0) return { row, accidental };
  // 五線の端で綴りが収まらない場合は、反対側の綴りにする
  const alt = -accidental;
  return { row: Math.max(0, ROW_MIDI.indexOf(m - alt)), accidental: alt };
}

// n半音上へ移調した新しい譜面を返す（元の配列は変更しない）。
export function transposeMeasures(measures: Measure[], semitones: number, useFlats: boolean): Measure[] {
  const n = ((semitones % 12) + 12) % 12;
  const noteShift = ((n + 6) % 12) - 6;
  return measures.map((m) => ({
    ...m,
    notes: m.notes.map((note): Note => {
      if (note.isRest || note.rowIdxList.length === 0) return note;
      const rowIdxList: number[] = [];
      const accidentals: Record<number, number> = {};
      for (const r of note.rowIdxList) {
        const midi = ROW_MIDI[r] + (note.accidentals[r] ?? 0) + noteShift;
        const t = midiToRow(midi, useFlats);
        rowIdxList.push(t.row);
        accidentals[t.row] = t.accidental;
      }
      return { ...note, rowIdxList, accidentals };
    }),
    harmonies: m.harmonies.map((h) => ({ ...h, root: (h.root + n) % 12 })),
  }));
}

// 12キーを回る順番（元のキーからの半音数）。
export const PRACTICE_ORDERS = {
  fourths: [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7], // 4度上へ（サイクル・オブ・フォース）
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // 半音ずつ上へ
} as const;
