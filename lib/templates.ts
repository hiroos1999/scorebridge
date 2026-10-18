import { CHORD_TYPES } from "@/lib/chords";
import type { Harmony, Measure, Note, TimeSignature } from "@/components/StaffToFretboard";

// 曲テンプレート（ジャズスタンダードの練習用プリセット）。
// 「テンプレート」選択UIから読み込むと、measures・root(キー)・useFlats・timeSigを
// 丸ごと差し替える初期値として使われる。読み込み後はStaffToFretboard側の通常の
// state（自由に編集できるデータ）として扱われ、テンプレート自体は不変のまま残る。
export type Template = {
  id: string;
  label: string;
  root: number; // キー（ピッチクラス）
  useFlats: boolean;
  timeSig: TimeSignature;
  measures: Measure[];
};

// rows配列（StaffToFretboard内、C6〜E3）のインデックスに対応する早見表。
// 0:C6 1:B5 2:A5 3:G5 4:F5 5:E5 6:D5 7:C5 8:B4 9:A4 10:G4 11:F4
// 12:E4 13:D4 14:C4 15:B3 16:A3 17:G3 18:F3 19:E3
// フラット系の音（Eb, Ab, Bb等）は、1半音上の自然音の段にaccidental=-1を
// 付けて表す（例: Eb4 = E4の段(rowIdx12) + accidental -1）。

function note(startGrid: number, duration: number, rowIdx: number, accidental = 0): Note {
  return { startGrid, duration, isRest: false, rowIdxList: [rowIdx], accidentals: { [rowIdx]: accidental } };
}
function rest(startGrid: number, duration: number): Note {
  return { startGrid, duration, isRest: true, rowIdxList: [], accidentals: {} };
}

// ピッチクラス（NOTE_NAMES_FLAT/SHARPと同じ並び: C=0, Db/C#=1, D=2, Eb/D#=3,
// E=4, F=5, Gb/F#=6, G=7, Ab/G#=8, A=9, Bb/A#=10, B=11）。
const PC = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

// ---- 以下、9曲分のテンプレートを機械的に生成するための共通ヘルパー ----
// 手作業での書き写しによる音の誤りを避けるため、「各小節のコード構成音を
// 直前の音に近い段でアルペジオ化する」処理を関数化し、9曲すべてで共用する。
// （'S Wonderful/I Got Rhythm/But Not for Me/Tea for Twoの4曲は、
// ユーザーが目視で書き出した実際のメロディ（音名・音価）をnote()/rest()で
// 手書き変換したものに差し替え済み（harmoniesは以下の生成ロジックのまま）。
// 残り5曲は引き続きコードトーンのアルペジオ機械生成。）

// rows配列（StaffToFretboard内）のpc並びの複製。rowIdx 0..19 = C6,B5,A5,G5,F5,
// E5,D5,C5,B4,A4,G4,F4,E4,D4,C4,B3,A3,G3,F3,E3
const ROW_PCS = [0, 11, 9, 7, 5, 4, 2, 0, 11, 9, 7, 5, 4, 2, 0, 11, 9, 7, 5, 4];

// クロマチックなpc(1,3,6,8,10)を自然音+臨時記号でどう綴るか。
// StaffToFretboard内のCHROMATIC_SPELLINGテーブルと同じ考え方（flatBase/sharpBase）。
const CHROMATIC_FLAT_BASE: Record<number, number> = { 1: 2, 3: 4, 6: 7, 8: 9, 10: 11 };
const CHROMATIC_SHARP_BASE: Record<number, number> = { 1: 0, 3: 2, 6: 5, 8: 7, 10: 9 };

function spellPc(pc: number, useFlats: boolean): { naturalPc: number; accidental: number } {
  if (CHROMATIC_FLAT_BASE[pc] === undefined) return { naturalPc: pc, accidental: 0 };
  return useFlats
    ? { naturalPc: CHROMATIC_FLAT_BASE[pc], accidental: -1 }
    : { naturalPc: CHROMATIC_SHARP_BASE[pc], accidental: 1 };
}

// naturalPcを持つ段の中から、preferredRowIdxに最も近いものを選ぶ
// （メロディが小節をまたいで極端に跳躍しないようにするため）。
function nearestRowForNaturalPc(naturalPc: number, preferredRowIdx: number): number {
  let best = 7; // fallback: C5
  let bestDist = Infinity;
  for (let i = 0; i < ROW_PCS.length; i++) {
    if (ROW_PCS[i] !== naturalPc) continue;
    const dist = Math.abs(i - preferredRowIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// ピッチクラスをNoteの{rowIdx, accidental}に変換し、直前の段(preferredRowIdx)を
// 更新して返す。
function pitchToRow(pc: number, useFlats: boolean, preferredRowIdx: number) {
  const { naturalPc, accidental } = spellPc(pc, useFlats);
  const rowIdx = nearestRowForNaturalPc(naturalPc, preferredRowIdx);
  return { rowIdx, accidental };
}

// 1小節分のコード指定。要素が1つなら小節全体、2つなら前半/後半(offsetGrid 0/8)。
type BarSpec = { root: number; kind: string }[];

// BarSpecの配列から、各小節のharmoniesと「コードトーンをアルペジオ化した」
// notesを機械的に生成する。奇数小節目/偶数小節目でアルペジオの向き（上行/下行）
// を交互にして単調にならないようにし、最後の小節だけは、その小節の最初の
// コードのルート音を全音符で1つだけ置いて締める。
function buildStandardA(bars: BarSpec[], useFlats: boolean, startRow: number): Measure[] {
  let preferredRow = startRow;
  return bars.map((bar, bi) => {
    const isLast = bi === bars.length - 1;
    const harmonies: Harmony[] = [];
    const notes: Note[] = [];

    if (isLast) {
      const { root, kind } = bar[0];
      harmonies.push({ offsetGrid: 0, root, kind, inversion: 0 });
      const { rowIdx, accidental } = pitchToRow(root, useFlats, preferredRow);
      notes.push(note(0, 16, rowIdx, accidental));
      preferredRow = rowIdx;
      return { notes, harmonies };
    }

    if (bar.length === 1) {
      const { root, kind } = bar[0];
      harmonies.push({ offsetGrid: 0, root, kind, inversion: 0 });
      const intervals = CHORD_TYPES[kind];
      const order = bi % 2 === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0]; // 上行/下行を交互に
      for (let i = 0; i < 4; i++) {
        const pc = (root + intervals[order[i]]) % 12;
        const { rowIdx, accidental } = pitchToRow(pc, useFlats, preferredRow);
        notes.push(note(i * 4, 4, rowIdx, accidental));
        preferredRow = rowIdx;
      }
    } else {
      // 1小節に2コード：前半8グリッド/後半8グリッドに、それぞれ2音ずつ。
      bar.forEach((c, ci) => {
        const offsetGrid = ci * 8;
        harmonies.push({ offsetGrid, root: c.root, kind: c.kind, inversion: 0 });
        const intervals = CHORD_TYPES[c.kind];
        for (let i = 0; i < 2; i++) {
          const pc = (c.root + intervals[i]) % 12;
          const { rowIdx, accidental } = pitchToRow(pc, useFlats, preferredRow);
          notes.push(note(offsetGrid + i * 4, 4, rowIdx, accidental));
          preferredRow = rowIdx;
        }
      });
    }
    return { notes, harmonies };
  });
}

// メロディの初期音域の基準（G4付近）。どの曲もここから最も近い段を辿って始まる。
const START_ROW = 10;

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

// 以下9曲は、一般的に知られるスタンダードのAセクション進行（8小節）に基づき、
// buildStandardAでharmoniesとコードトーンのアルペジオ（notesの初期値）を機械生成
// したもの。原曲メロディの転写ではない。
// ただしI Got Rhythm/But Not for Me/Tea for Twoの3曲は、ユーザーが目視で
// 書き出した実際のメロディに基づき、withNotes()でnotesだけを差し替えている
// （harmoniesはbuildStandardAの生成結果のまま）。

// 2. Body and Soul（Johnny Green, 1930）— Db、ii-V-Iを軸にした進行。
const BODY_AND_SOUL_BARS: BarSpec[] = [
  [{ root: PC.Eb, kind: "m7" }],
  [{ root: PC.Ab, kind: "7" }],
  [{ root: PC.Db, kind: "maj7" }],
  [{ root: PC.Db, kind: "maj7" }],
  [{ root: PC.F, kind: "m7" }],
  [{ root: PC.Bb, kind: "7" }],
  [{ root: PC.Eb, kind: "m7" }],
  [{ root: PC.Ab, kind: "7" }],
];

// 3. Stardust（Hoagy Carmichael, 1927）— C、I-vi-ii-Vにiv(借用和音)を加えた進行。
const STARDUST_BARS: BarSpec[] = [
  [{ root: PC.C, kind: "maj7" }],
  [{ root: PC.A, kind: "m7" }],
  [{ root: PC.D, kind: "m7" }],
  [{ root: PC.G, kind: "7" }],
  [{ root: PC.C, kind: "maj7" }],
  [{ root: PC.F, kind: "m7" }],
  [
    { root: PC.C, kind: "maj7" },
    { root: PC.G, kind: "7" },
  ],
  [{ root: PC.C, kind: "maj7" }],
];

// 4. Georgia on My Mind（Hoagy Carmichael, 1930）— F、
//    relative minorへのセカンダリii-Vを含む進行。
const GEORGIA_BARS: BarSpec[] = [
  [{ root: PC.F, kind: "maj7" }],
  [
    { root: PC.E, kind: "m7b5" },
    { root: PC.A, kind: "7" },
  ],
  [{ root: PC.D, kind: "m7" }],
  [{ root: PC.G, kind: "7" }],
  [{ root: PC.C, kind: "m7" }],
  [{ root: PC.F, kind: "7" }],
  [{ root: PC.Bb, kind: "maj7" }],
  [{ root: PC.F, kind: "maj7" }],
];

// 5. On the Sunny Side of the Street（Jimmy McHugh, 1930）— F、I-V/ii-ii-V進行。
const SUNNY_SIDE_BARS: BarSpec[] = [
  [{ root: PC.F, kind: "maj7" }],
  [{ root: PC.D, kind: "7" }],
  [{ root: PC.G, kind: "m7" }],
  [{ root: PC.C, kind: "7" }],
  [{ root: PC.F, kind: "maj7" }],
  [{ root: PC.D, kind: "7" }],
  [
    { root: PC.G, kind: "m7" },
    { root: PC.C, kind: "7" },
  ],
  [{ root: PC.F, kind: "maj7" }],
];

// 7. I Can't Give You Anything But Love（Jimmy McHugh, 1928）— C、
//    I-iidimを含むスウィング期らしい進行。
const CANT_GIVE_YOU_BARS: BarSpec[] = [
  [{ root: PC.C, kind: "maj7" }],
  [{ root: PC.Eb, kind: "dim" }],
  [{ root: PC.D, kind: "m7" }],
  [{ root: PC.G, kind: "7" }],
  [{ root: PC.C, kind: "maj7" }],
  [{ root: PC.Eb, kind: "dim" }],
  [
    { root: PC.D, kind: "m7" },
    { root: PC.G, kind: "7" },
  ],
  [{ root: PC.C, kind: "maj7" }],
];

// 8. Bye Bye Blackbird（Ray Henderson, 1926）— F、I-I7-IV-#IVdimの定型進行。
const BLACKBIRD_BARS: BarSpec[] = [
  [{ root: PC.F, kind: "maj7" }],
  [{ root: PC.F, kind: "7" }],
  [{ root: PC.Bb, kind: "maj7" }],
  [{ root: PC.B, kind: "dim" }],
  [{ root: PC.F, kind: "maj7" }],
  [{ root: PC.D, kind: "7" }],
  [
    { root: PC.G, kind: "m7" },
    { root: PC.C, kind: "7" },
  ],
  [{ root: PC.F, kind: "maj7" }],
];

// 9. Tea for Two（Vincent Youmans, 1924 / パブリックドメイン）— Abのキー、フルコーラス32小節。
//    メロディは原典の楽譜の画像を拡大して、音の高さと長さを1音ずつ読み取って入力したもの。
//    形式: A(8, 1番かっこ) → B(8) → A(8, 2番かっこ) → C(8)。
//    コードは一般的な進行（Bbm7-Eb7-Abmaj7-Db7 …）。
type TeaChord = { root: number; kind: string; at: number; inv?: number };
const TEA_PITCH: Record<string, [number, number]> = {
  Eb4: [12, -1], E4: [12, 0], F4: [11, 0], G4: [10, 0], Ab4: [9, -1], A4: [9, 0], Bb4: [8, -1], B4: [8, 0],
  C5: [7, 0], Cb5: [7, -1], D5: [6, 0], Db5: [6, -1], Eb5: [5, -1], E5: [5, 0], F5: [4, 0],
};
// [音名または"r"(休符), 開始グリッド, 長さ(グリッド数。4=4分, 2=8分, 6=付点4分)]
type TeaNote = [string, number, number];
function teaBar(notes: TeaNote[], chords: TeaChord[]): Measure {
  return {
    notes: notes.map(([name, g, d]) => {
      if (name === "r") return rest(g, d);
      const [row, acc] = TEA_PITCH[name];
      return note(g, d, row, acc);
    }),
    harmonies: chords.map((c) => ({ offsetGrid: c.at, root: c.root, kind: c.kind, inversion: c.inv ?? 0 })),
  };
}
const tc = (root: number, kind: string, at = 0, inv = 0): TeaChord => ({ root, kind, at, inv });
const BBM7_EB7 = [tc(PC.Bb, "m7"), tc(PC.Eb, "7", 8)];
const DM7_G7 = [tc(PC.D, "m7"), tc(PC.G, "7", 8)];

// A: 1〜6小節（共通）
const TEA_A_COMMON: Measure[] = [
  teaBar([["Ab4", 0, 6], ["F4", 6, 2], ["G4", 8, 6], ["F4", 14, 2]], BBM7_EB7),
  teaBar([["Ab4", 0, 4], ["F4", 4, 2], ["G4", 6, 2], ["G4", 8, 6], ["Eb4", 14, 2]], BBM7_EB7),
  teaBar([["G4", 0, 6], ["Eb4", 6, 2], ["F4", 8, 6], ["Eb4", 14, 2]], [tc(PC.Ab, "maj7"), tc(PC.Db, "7", 8)]),
  teaBar([["G4", 0, 4], ["Eb4", 4, 2], ["F4", 6, 2], ["F4", 8, 6], ["F4", 14, 2]], [tc(PC.C, "m7"), tc(PC.B, "dim", 8)]),
  teaBar([["Ab4", 0, 6], ["F4", 6, 2], ["G4", 8, 6], ["F4", 14, 2]], BBM7_EB7),
  teaBar([["Ab4", 0, 6], ["F4", 6, 2], ["G4", 8, 4], ["Eb4", 12, 4]], BBM7_EB7),
];
// A 1番かっこ（Bへ）
const TEA_A_END1: Measure[] = [
  teaBar([["C5", 0, 16]], [tc(PC.Ab, "maj7"), tc(PC.Bb, "m7", 8)]),
  teaBar([["C5", 0, 4], ["r", 4, 4], ["r", 8, 8]], [tc(PC.C, "m7"), tc(PC.Db, "maj7", 8)]),
];
// A 2番かっこ（Cへ）
const TEA_A_END2: Measure[] = [
  teaBar([["Eb5", 0, 16]], [tc(PC.C, "m7b5")]),
  teaBar([["Eb5", 0, 16]], [tc(PC.F, "7")]),
];
// B（キーはC。4フラットの調号に対してナチュラルを付けて書かれている）
const TEA_B: Measure[] = [
  teaBar([["C5", 0, 4], ["C5", 4, 2], ["A4", 6, 2], ["B4", 8, 4], ["B4", 12, 2], ["A4", 14, 2]], DM7_G7),
  teaBar([["C5", 0, 4], ["C5", 4, 2], ["A4", 6, 2], ["B4", 8, 4], ["r", 12, 2], ["G4", 14, 2]], DM7_G7),
  teaBar([["B4", 0, 4], ["B4", 4, 2], ["G4", 6, 2], ["A4", 8, 4], ["A4", 12, 2], ["G4", 14, 2]], [tc(PC.C, "maj7"), tc(PC.D, "m7", 8)]),
  teaBar([["B4", 0, 4], ["B4", 4, 2], ["G4", 6, 2], ["A4", 8, 4], ["r", 12, 2], ["A4", 14, 2]], [tc(PC.E, "m7"), tc(PC.Eb, "dim", 8)]),
  teaBar([["C5", 0, 4], ["C5", 4, 2], ["A4", 6, 2], ["B4", 8, 4], ["B4", 12, 2], ["A4", 14, 2]], DM7_G7),
  teaBar([["C5", 0, 4], ["C5", 4, 2], ["A4", 6, 2], ["B4", 8, 4], ["G4", 12, 4]], DM7_G7),
  teaBar([["E5", 0, 16]], [tc(PC.C, "maj7")]),
  teaBar([["Eb5", 0, 8], ["r", 8, 8]], BBM7_EB7),
];
// C（Abに戻る8小節）
const TEA_C: Measure[] = [
  teaBar([["F5", 0, 6], ["F5", 6, 2], ["Eb5", 8, 6], ["Eb5", 14, 2]], [tc(PC.Bb, "m7"), tc(PC.F, "7", 8)]),
  teaBar([["Db5", 0, 6], ["Db5", 6, 2], ["C5", 8, 6], ["C5", 14, 2]], [tc(PC.Gb, "7"), tc(PC.F, "7", 8)]),
  teaBar([["Eb5", 0, 6], ["Eb5", 6, 2], ["Db5", 8, 6], ["Db5", 14, 2]], [tc(PC.A, "dim"), tc(PC.Bb, "m7", 8)]),
  teaBar([["C5", 0, 4], ["C5", 4, 2], ["Bb4", 6, 2], ["Bb4", 8, 8]], [tc(PC.Db, "mMaj7"), tc(PC.Gb, "7", 8)]),
  teaBar([["Ab4", 0, 6], ["F4", 6, 2], ["G4", 8, 6], ["F4", 14, 2]], [tc(PC.Ab, "maj7"), tc(PC.B, "dim", 8)]),
  teaBar([["Ab4", 0, 6], ["F4", 6, 2], ["G4", 8, 4], ["C5", 12, 4]], BBM7_EB7),
  teaBar([["Ab4", 0, 16]], [tc(PC.Ab, "maj7")]),
  teaBar([["Ab4", 0, 16]], [tc(PC.C, "m7b5"), tc(PC.F, "7", 8)]),
];
const TEA_FOR_TWO_FULL: Measure[] = [
  ...TEA_A_COMMON, ...TEA_A_END1,
  ...TEA_B,
  ...TEA_A_COMMON, ...TEA_A_END2,
  ...TEA_C,
];

// 10. 'S Wonderful（George Gershwin, 1927 / パブリックドメイン）— Ebのキー、フルコーラス32小節。
//    メロディは原典の楽譜の画像を拡大して、音の高さと長さを1音ずつ読み取って入力したもの。
//    形式: A(8) → A(8, 2番かっこ) → B(8, Gのキー) → C(8)。コードは一般的な進行。
const EB = tc(PC.Eb, "maj7");
const SW_A_SHARED: Measure[] = [
  teaBar([["Bb4", 0, 6], ["Bb4", 6, 2], ["G4", 8, 8]], [EB]),
  teaBar([["G4", 0, 16]], []),
  teaBar([["Bb4", 0, 6], ["Bb4", 6, 2], ["G4", 8, 8]], [tc(PC.E, "dim")]),
  teaBar([["G4", 0, 16]], []),
  teaBar([["Bb4", 0, 6], ["Bb4", 6, 2], ["G4", 8, 8]], [tc(PC.F, "m7")]),
  teaBar([["G4", 0, 8], ["Bb4", 8, 8]], [tc(PC.Bb, "7")]),
];
const SW_A1_END: Measure[] = [
  teaBar([["Eb4", 0, 16]], [EB, tc(PC.C, "m7", 8)]),
  teaBar([["Eb4", 0, 12], ["r", 12, 4]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
];
const SW_A2_END: Measure[] = [
  teaBar([["C5", 0, 16]], [EB]),
  teaBar([["C5", 0, 8], ["Eb5", 8, 8]], [tc(PC.A, "m7b5"), tc(PC.D, "7", 8)]),
];
const SW_B: Measure[] = [
  teaBar([["D5", 0, 16]], [tc(PC.G, "maj7"), tc(PC.E, "m7", 8)]),
  teaBar([["r", 0, 4], ["D5", 4, 4], ["D5", 8, 4], ["D5", 12, 4]], [tc(PC.A, "m7"), tc(PC.D, "7", 8)]),
  teaBar([["E5", 0, 6], ["D5", 6, 2], ["D5", 8, 8]], [tc(PC.B, "m7"), tc(PC.E, "7", 8)]),
  teaBar([["D5", 0, 16]], [tc(PC.A, "m7"), tc(PC.D, "7", 8)]),
  teaBar([["r", 0, 4], ["D5", 4, 4], ["D5", 8, 4], ["D5", 12, 4]], [tc(PC.G, "7")]),
  teaBar([["D5", 0, 4], ["D5", 4, 4], ["D5", 8, 4], ["D5", 12, 4]], [tc(PC.C, "7")]),
  teaBar([["D5", 0, 6], ["C5", 6, 2], ["C5", 8, 8]], [tc(PC.F, "m7")]),
  teaBar([["C5", 0, 8], ["Cb5", 8, 8]], [tc(PC.Bb, "7")]),
];
const SW_C: Measure[] = [
  teaBar([["Bb4", 0, 6], ["Bb4", 6, 2], ["G4", 8, 8]], [EB]),
  teaBar([["G4", 0, 16]], []),
  teaBar([["Eb5", 0, 6], ["Eb5", 6, 2], ["C5", 8, 8]], [tc(PC.Gb, "dim")]),
  teaBar([["C5", 0, 16]], []),
  teaBar([["r", 0, 4], ["Eb5", 4, 4], ["Ab4", 8, 4], ["G4", 12, 4]], [tc(PC.F, "m7")]),
  teaBar([["Bb4", 0, 8], ["G4", 8, 8]], [tc(PC.Bb, "7")]),
  teaBar([["Eb4", 0, 16]], [EB, tc(PC.C, "m7", 8)]),
  teaBar([["Eb4", 0, 12], ["r", 12, 4]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
];
const S_WONDERFUL_FULL: Measure[] = [
  ...SW_A_SHARED, ...SW_A1_END,
  ...SW_A_SHARED, ...SW_A2_END,
  ...SW_B,
  ...SW_C,
];

// ---- オリジナルのビバップ ii–V–I フレーズ ----
// Cのキーで書いた1つのフレーズを、キーごとに半音数だけ平行移動して作る
// （F・Bbは、ギターで12フレット以内に収まるよう下方向に移す）。
// 音は [MIDI番号, 音価(グリッド数: 2=8分, 4=4分, 8=2分)] の並びで、
// ビート頭にはコードトーン(3rd・7th・5th・9th)を置き、8分音符のラインと
// 半音の経過音・囲み(エンクロージャー)で次のコードの3rdに解決する。
// But Not for Me（Gershwin, 1930）フルコーラス Eb。楽譜画像から読み取り。
const BNM_EBM7 = [tc(PC.Eb, "maj7")];
const BNM_RUN = [["r", 0, 4], ["F4", 4, 4], ["G4", 8, 4], ["F4", 12, 4]] as TeaNote[];
const BNM_PICKUP: Measure[] = [teaBar(BNM_RUN, [tc(PC.Bb, "7")])];
const BNM_A: Measure[] = [
  teaBar([["G4", 0, 8], ["F4", 8, 4], ["Eb4", 12, 4]], [tc(PC.F, "7")]),
  teaBar([["Eb4", 0, 4], ["F4", 4, 4], ["G4", 8, 4], ["F4", 12, 4]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
  teaBar([["G4", 0, 16]], BNM_EBM7),
  teaBar(BNM_RUN, [tc(PC.G, "m7"), tc(PC.C, "7", 8)]),
  teaBar([["G4", 0, 8], ["F4", 8, 4], ["Eb4", 12, 4]], [tc(PC.F, "7")]),
  teaBar([["Eb4", 0, 4], ["F4", 4, 4], ["G4", 8, 4], ["F4", 12, 4]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
  teaBar([["G4", 0, 16]], BNM_EBM7),
  teaBar([["r", 0, 4], ["G4", 4, 4], ["Ab4", 8, 4], ["Bb4", 12, 4]], [tc(PC.Bb, "m7"), tc(PC.Eb, "7", 8)]),
];
const BNM_B_COMMON: Measure[] = [
  teaBar([["B4", 0, 8], ["C5", 8, 4], ["Eb5", 12, 4]], [tc(PC.Ab, "maj7")]),
  teaBar([["r", 0, 4], ["F4", 4, 4], ["G4", 8, 4], ["Ab4", 12, 4]], [tc(PC.Ab, "m7"), tc(PC.Db, "7", 8)]),
];
const BNM_B_1: Measure[] = [
  teaBar([["A4", 0, 8], ["Bb4", 8, 4], ["Eb5", 12, 4]], BNM_EBM7),
  teaBar([["r", 0, 4], ["Eb4", 4, 4], ["F4", 8, 4], ["G4", 12, 4]], BNM_EBM7),
  teaBar([["G4", 0, 8], ["Ab4", 8, 4], ["Eb5", 12, 4]], [tc(PC.C, "m7")]),
  teaBar([["r", 0, 4], ["Eb5", 4, 4], ["C5", 8, 4], ["Ab4", 12, 4]], [tc(PC.F, "7")]),
  teaBar([["F4", 0, 16]], [tc(PC.F, "m7")]),
  teaBar(BNM_RUN, [tc(PC.Bb, "7")]),
];
const BNM_C_2: Measure[] = [
  teaBar([["A4", 0, 8], ["Bb4", 8, 4], ["F5", 12, 4]], BNM_EBM7),
  teaBar([["r", 0, 4], ["Eb5", 4, 4], ["C5", 8, 4], ["Ab4", 12, 4]], [tc(PC.C, "m7")]),
  teaBar([["G4", 0, 16]], [tc(PC.F, "m7")]),
  teaBar([["F4", 0, 16]], [tc(PC.Bb, "7")]),
  teaBar([["Eb4", 0, 16]], [tc(PC.Eb, "6")]),
  teaBar([["Eb4", 0, 12], ["r", 12, 4]], [tc(PC.Eb, "6")]),
];
const BUT_NOT_FOR_ME_FULL: Measure[] = [
  ...BNM_PICKUP, ...BNM_A, ...BNM_B_COMMON, ...BNM_B_1, ...BNM_A, ...BNM_B_COMMON, ...BNM_C_2,
];

// I Got Rhythm（Gershwin, 1930）フルコーラス Bb。楽譜画像から読み取り。
// 形式: A（8）+ A（8）+ B（8）+ 最後のA（8＋2小節のタグ）= 34小節。
const RH_A: Measure[] = [
  teaBar([["r", 0, 4], ["F4", 4, 8], ["G4", 12, 4]], [tc(PC.Bb, "maj7"), tc(PC.G, "m7", 8)]),
  teaBar([["Bb4", 0, 6], ["C5", 6, 10]], [tc(PC.C, "m7"), tc(PC.F, "7", 8)]),
  teaBar([["r", 0, 4], ["C5", 4, 8], ["Bb4", 12, 4]], [tc(PC.D, "m7"), tc(PC.G, "m7", 8)]),
  teaBar([["G4", 0, 6], ["F4", 6, 10]], [tc(PC.C, "m7"), tc(PC.F, "7", 8)]),
  teaBar([["r", 0, 4], ["F4", 4, 8], ["G4", 12, 4]], [tc(PC.Bb, "maj7"), tc(PC.Bb, "7", 8, 1)]),
  teaBar([["Bb4", 0, 6], ["C5", 6, 2], ["r", 8, 2], ["Eb5", 10, 2], ["r", 12, 2], ["C5", 14, 2]], [tc(PC.Eb, "6"), tc(PC.E, "dim", 8)]),
];
const RH_A_END: Measure[] = [
  teaBar([["D5", 0, 4], ["D5", 4, 4], ["C5", 8, 2], ["D5", 10, 2], ["C5", 12, 2], ["Bb4", 14, 2]],
    [tc(PC.D, "m7"), tc(PC.G, "7", 4), tc(PC.C, "m7", 8), tc(PC.F, "7", 12)]),
  teaBar([["Bb4", 0, 16]], [tc(PC.Bb, "maj7")]),
];
const RH_B: Measure[] = [
  teaBar([["r", 0, 4], ["D5", 4, 6], ["D5", 10, 6]], [tc(PC.A, "m7")]),
  teaBar([["D5", 0, 6], ["E5", 6, 10]], [tc(PC.D, "7")]),
  teaBar([["r", 0, 4], ["D5", 4, 6], ["D5", 10, 6]], [tc(PC.D, "m7")]),
  teaBar([["D5", 0, 6], ["G4", 6, 10]], [tc(PC.G, "7")]),
  teaBar([["r", 0, 4], ["C5", 4, 6], ["C5", 10, 6]], [tc(PC.G, "m7")]),
  teaBar([["C5", 0, 6], ["D5", 6, 10]], [tc(PC.C, "7")]),
  teaBar([["r", 0, 4], ["C5", 4, 6], ["C5", 10, 6]], [tc(PC.C, "m7")]),
  teaBar([["C5", 0, 12], ["r", 12, 4]], [tc(PC.F, "7")]),
];
const RH_C_END: Measure[] = [
  teaBar([["D5", 0, 4], ["D5", 4, 4], ["C5", 8, 2], ["D5", 10, 2], ["Eb5", 12, 2], ["F5", 14, 2]], [tc(PC.D, "m7")]),
  teaBar([["F5", 0, 8], ["r", 8, 2], ["Eb5", 10, 2], ["r", 12, 2], ["C5", 14, 2]], [tc(PC.G, "7")]),
];
const I_GOT_RHYTHM_FULL: Measure[] = [
  ...RH_A, ...RH_A_END, ...RH_A, ...RH_A_END, ...RH_B, ...RH_A, ...RH_C_END, ...RH_A_END,
];

// Summertime（Gershwin, 1935 / Porgy and Bess）フルコーラス Am。楽譜画像から読み取り。
// 形式: 頭の1小節（アウフタクト）+ 16小節。
const SU_AM = [tc(PC.A, "m7")];
const SU_B5E7 = [tc(PC.B, "m7b5"), tc(PC.E, "7", 8)];
const SU_BAR2 = (): Measure =>
  teaBar([["E5", 0, 4], ["D5", 4, 2], ["C5", 6, 2], ["D5", 8, 2], ["E5", 10, 2], ["C5", 12, 4]], SU_B5E7);
const SUMMERTIME_FULL: Measure[] = [
  teaBar([["r", 0, 8], ["E5", 8, 4], ["C5", 12, 4]], SU_AM),
  teaBar([["E5", 0, 16]], SU_AM),
  SU_BAR2(),
  teaBar([["A4", 0, 8], ["E4", 8, 8]], SU_AM),
  teaBar([["E4", 0, 8], ["E5", 8, 4], ["C5", 12, 4]], SU_AM),
  teaBar([["D5", 0, 2], ["D5", 2, 6], ["D5", 8, 8]], [tc(PC.D, "m7"), tc(PC.G, "7", 8)]),
  teaBar([["D5", 0, 4], ["C5", 4, 2], ["A4", 6, 2], ["C5", 8, 2], ["A4", 10, 2], ["C5", 12, 4]], [tc(PC.C, "m7"), tc(PC.F, "7", 8)]),
  teaBar([["B4", 0, 16]], [tc(PC.B, "m7b5")]),
  teaBar([["B4", 0, 8], ["r", 8, 2], ["E5", 10, 4], ["C5", 14, 2]], [tc(PC.E, "7")]),
  teaBar([["E5", 0, 2], ["E5", 2, 4], ["E5", 6, 10]], SU_AM),
  SU_BAR2(),
  teaBar([["A4", 0, 8], ["E4", 8, 8]], SU_AM),
  teaBar([["E4", 0, 12], ["E4", 12, 4]], [tc(PC.D, "m7"), tc(PC.G, "7", 8)]),
  teaBar([["G4", 0, 4], ["E4", 4, 2], ["G4", 6, 2], ["A4", 8, 4], ["C5", 12, 4]], [tc(PC.C, "maj7"), tc(PC.F, "maj7", 8)]),
  teaBar([["E5", 0, 2], ["D5", 2, 6], ["C5", 8, 8]], SU_B5E7),
  teaBar([["A4", 0, 16]], SU_AM),
  teaBar([["A4", 0, 8], ["r", 8, 8]], SU_B5E7),
];

const ROW_MIDI = [84, 83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52];
function midiToNote(startGrid: number, duration: number, midi: number): Note {
  let rowIdx = ROW_MIDI.indexOf(midi);
  if (rowIdx >= 0) return note(startGrid, duration, rowIdx);
  // 黒鍵はフラットで綴る（半音上の自然音の段 + accidental -1）
  rowIdx = ROW_MIDI.indexOf(midi + 1);
  if (rowIdx < 0) throw new Error(`midiToNote: MIDI ${midi} is out of range`);
  return note(startGrid, duration, rowIdx, -1);
}
function phraseMeasure(
  line: [number, number][],
  shift: number,
  chord: { root: number; kind: string },
): Measure {
  const notes: Note[] = [];
  let g = 0;
  for (const [midi, dur] of line) {
    notes.push(midiToNote(g, dur, midi + shift));
    g += dur;
  }
  return { notes, harmonies: [{ offsetGrid: 0, root: chord.root, kind: chord.kind, inversion: 0 }] };
}
// Dm7 | G7 | Cmaj7（Cのキー）
const BEBOP_251_C: [number, number][][] = [
  // Dm7: Dm7のアルペジオで上がり、9th(E)から下がって7th(C)で止める
  [[62, 2], [65, 2], [69, 2], [72, 2], [76, 2], [74, 2], [72, 4]],
  // G7: 3rd(B)始まり。9th(A)を経てD→B→G、7th(F)から半音下(Eb)へ。次のEを下から囲む
  [[71, 2], [74, 2], [76, 2], [74, 2], [71, 2], [67, 2], [65, 2], [63, 2]],
  // Cmaj7: 3rd(E)に解決し、G・B・Dと上がって、ルート(C)を2分音符で伸ばす
  [[64, 2], [67, 2], [71, 2], [74, 2], [72, 8]],
];
function bebop251(key: number, shift: number): Measure[] {
  const ii = { root: (key + 2) % 12, kind: "m7" };
  const V = { root: (key + 7) % 12, kind: "7" };
  const I = { root: key, kind: "maj7" };
  return [
    phraseMeasure(BEBOP_251_C[0], shift, ii),
    phraseMeasure(BEBOP_251_C[1], shift, V),
    phraseMeasure(BEBOP_251_C[2], shift, I),
  ];
}

export const TEMPLATES: Template[] = [
  {
    id: "bebop-251-c",
    label: "Bebop ii–V–I lick in C (original)",
    root: PC.C,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: bebop251(PC.C, 0),
  },
  {
    id: "bebop-251-f",
    label: "Bebop ii–V–I lick in F (original)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: bebop251(PC.F, -7),
  },
  {
    id: "bebop-251-bb",
    label: "Bebop ii–V–I lick in Bb (original)",
    root: PC.Bb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: bebop251(PC.Bb, -2),
  },
  {
    id: "summertime",
    label: "Summertime — full chorus (Am, Gershwin)",
    root: PC.C,
    useFlats: false,
    timeSig: FOUR_FOUR,
    measures: SUMMERTIME_FULL,
  },
  {
    id: "swonderful",
    label: "'S Wonderful — full chorus (Eb, Gershwin)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: S_WONDERFUL_FULL,
  },
  {
    id: "rhythm",
    label: "I Got Rhythm — full chorus (Bb, Gershwin)",
    root: PC.Bb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: I_GOT_RHYTHM_FULL,
  },
  {
    id: "body-and-soul-a",
    label: "Body and Soul — Aセクション (Db, Green)",
    root: PC.Db,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(BODY_AND_SOUL_BARS, true, START_ROW),
  },
  {
    id: "stardust-a",
    label: "Stardust — Aセクション (C, Carmichael)",
    root: PC.C,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(STARDUST_BARS, true, START_ROW),
  },
  {
    id: "georgia-a",
    label: "Georgia on My Mind — Aセクション (F, Carmichael)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(GEORGIA_BARS, true, START_ROW),
  },
  {
    id: "sunny-side-a",
    label: "On the Sunny Side of the Street — Aセクション (F, McHugh)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(SUNNY_SIDE_BARS, true, START_ROW),
  },
  {
    id: "but-not-for-me",
    label: "But Not for Me — full chorus (Eb, Gershwin)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: BUT_NOT_FOR_ME_FULL,
  },
  {
    id: "cant-give-you-a",
    label: "I Can't Give You Anything But Love — Aセクション (C, McHugh)",
    root: PC.C,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(CANT_GIVE_YOU_BARS, true, START_ROW),
  },
  {
    id: "blackbird-a",
    label: "Bye Bye Blackbird — Aセクション (F, Henderson)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(BLACKBIRD_BARS, true, START_ROW),
  },
  {
    id: "tea-for-two",
    label: "Tea for Two — full chorus (Ab, Youmans)",
    root: PC.Ab,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: TEA_FOR_TWO_FULL,
  },
];
