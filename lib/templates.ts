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

// ピッチクラス（NOTE_NAMES_FLAT/SHARPと同じ並び: C=0, Db/C#=1, D=2, Eb/D#=3,
// E=4, F=5, Gb/F#=6, G=7, Ab/G#=8, A=9, Bb/A#=10, B=11）。
const PC = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

// ---- 以下、9曲分のテンプレートを機械的に生成するための共通ヘルパー ----
// 手作業での書き写しによる音の誤りを避けるため、「各小節のコード構成音を
// 直前の音に近い段でアルペジオ化する」処理を関数化し、9曲すべてで共用する。
// （'S Wonderfulは検証済みのため、上のS_WONDERFUL_Aは手書きのまま変更しない。）

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

// 'S Wonderful（George Gershwin, 1927 / パブリックドメイン）のAセクション
// （最初の8小節）。コード進行はEbメジャーキーの、このスタンダードで一般的に
// 知られている進行（Ebmaj7-Cm7-Fm7-Bb7を軸にした、いわゆるI-vi-ii-V系の
// 循環）に基づく。メロディは原曲旋律の書き写しではなく、著作権に配慮し、
// 各小節のコードトーンをアルペジオ化しただけのシンプルな練習フレーズとして
// 新たに作成したもの（4分音符中心、最終小節のみ全音符でトニックに着地）。
const S_WONDERFUL_A: Measure[] = [
  // 1. Ebmaj7 — Eb4-G4-Bb4-D5 (上行アルペジオ)
  {
    notes: [note(0, 4, 12, -1), note(4, 4, 10), note(8, 4, 8, -1), note(12, 4, 6)],
    harmonies: [{ offsetGrid: 0, root: PC.Eb, kind: "maj7", inversion: 0 }],
  },
  // 2. Cm7 — Bb4-G4-Eb4-C4 (下行アルペジオ)
  {
    notes: [note(0, 4, 8, -1), note(4, 4, 10), note(8, 4, 12, -1), note(12, 4, 14)],
    harmonies: [{ offsetGrid: 0, root: PC.C, kind: "m7", inversion: 0 }],
  },
  // 3. Fm7 — Eb4-F4-Ab4-C5 (上行アルペジオ)
  {
    notes: [note(0, 4, 12, -1), note(4, 4, 11), note(8, 4, 9, -1), note(12, 4, 7)],
    harmonies: [{ offsetGrid: 0, root: PC.F, kind: "m7", inversion: 0 }],
  },
  // 4. Bb7 — D5-C5-Bb4-Ab4 (下行アルペジオ、次の小節のEbへ滑らかに接続)
  {
    notes: [note(0, 4, 6), note(4, 4, 7), note(8, 4, 8, -1), note(12, 4, 9, -1)],
    harmonies: [{ offsetGrid: 0, root: PC.Bb, kind: "7", inversion: 0 }],
  },
  // 5. Ebmaj7 — Eb4-Bb4-G4-D5 (構成音の並びを変えて変化を付ける)
  {
    notes: [note(0, 4, 12, -1), note(4, 4, 8, -1), note(8, 4, 10), note(12, 4, 6)],
    harmonies: [{ offsetGrid: 0, root: PC.Eb, kind: "maj7", inversion: 0 }],
  },
  // 6. Cm7 — Eb4-G4-Bb4-C5 (上行アルペジオ)
  {
    notes: [note(0, 4, 12, -1), note(4, 4, 10), note(8, 4, 8, -1), note(12, 4, 7)],
    harmonies: [{ offsetGrid: 0, root: PC.C, kind: "m7", inversion: 0 }],
  },
  // 7. Fm7(1-2拍) → Bb7(3-4拍) — 1小節に2つのコード。メロディはF4-Ab4-Bb4-Ab4
  {
    notes: [note(0, 4, 11), note(4, 4, 9, -1), note(8, 4, 8, -1), note(12, 4, 9, -1)],
    harmonies: [
      { offsetGrid: 0, root: PC.F, kind: "m7", inversion: 0 },
      { offsetGrid: 8, root: PC.Bb, kind: "7", inversion: 0 },
    ],
  },
  // 8. Ebmaj7 — Eb5の全音符でトニックに着地して締める
  {
    notes: [note(0, 16, 5, -1)],
    harmonies: [{ offsetGrid: 0, root: PC.Eb, kind: "maj7", inversion: 0 }],
  },
];

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

// 以下9曲は、一般的に知られるスタンダードのAセクション進行（8小節）に基づき、
// buildStandardAでコードトーンのアルペジオを機械生成したもの。原曲メロディの
// 転写ではない。

// 1. I Got Rhythm（George Gershwin, 1930 / パブリックドメイン）— Bb、
//    いわゆる「リズムチェンジ」の典型的なI-VI7-ii-V7循環。
const RHYTHM_BARS: BarSpec[] = [
  [{ root: PC.Bb, kind: "maj7" }],
  [{ root: PC.G, kind: "7" }],
  [{ root: PC.C, kind: "m7" }],
  [{ root: PC.F, kind: "7" }],
  [{ root: PC.Bb, kind: "maj7" }],
  [{ root: PC.G, kind: "7" }],
  [
    { root: PC.C, kind: "m7" },
    { root: PC.F, kind: "7" },
  ],
  [{ root: PC.Bb, kind: "maj7" }],
];

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

// 6. But Not for Me（George Gershwin, 1930）— G、
//    唯一シャープ系のキーなのでuseFlats:falseで生成する。
const BUT_NOT_FOR_ME_BARS: BarSpec[] = [
  [{ root: PC.G, kind: "maj7" }],
  [
    { root: PC.B, kind: "m7" },
    { root: PC.E, kind: "7" },
  ],
  [{ root: PC.A, kind: "m7" }],
  [{ root: PC.D, kind: "7" }],
  [{ root: PC.G, kind: "maj7" }],
  [
    { root: PC.B, kind: "m7" },
    { root: PC.E, kind: "7" },
  ],
  [
    { root: PC.A, kind: "m7" },
    { root: PC.D, kind: "7" },
  ],
  [{ root: PC.G, kind: "maj7" }],
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

// 9. Tea for Two（Vincent Youmans, 1924）— C、
//    ii-V-Iを繰り返す循環進行で知られる（ご指定通りii-Vを含む）。
const TEA_FOR_TWO_BARS: BarSpec[] = [
  [
    { root: PC.D, kind: "m7" },
    { root: PC.G, kind: "7" },
  ],
  [{ root: PC.C, kind: "maj7" }],
  [
    { root: PC.D, kind: "m7" },
    { root: PC.G, kind: "7" },
  ],
  [{ root: PC.C, kind: "maj7" }],
  [
    { root: PC.E, kind: "m7" },
    { root: PC.A, kind: "7" },
  ],
  [
    { root: PC.D, kind: "m7" },
    { root: PC.G, kind: "7" },
  ],
  [{ root: PC.C, kind: "maj7" }],
  [{ root: PC.C, kind: "maj7" }],
];

export const TEMPLATES: Template[] = [
  {
    id: "swonderful-a",
    label: "'S Wonderful — Aセクション (Eb, Gershwin)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: S_WONDERFUL_A,
  },
  {
    id: "rhythm-a",
    label: "I Got Rhythm — Aセクション (Bb, Gershwin)",
    root: PC.Bb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(RHYTHM_BARS, true, START_ROW),
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
    id: "but-not-for-me-a",
    label: "But Not for Me — Aセクション (G, Gershwin)",
    root: PC.G,
    useFlats: false,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(BUT_NOT_FOR_ME_BARS, false, START_ROW),
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
    id: "tea-for-two-a",
    label: "Tea for Two — Aセクション (C, Youmans)",
    root: PC.C,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: buildStandardA(TEA_FOR_TWO_BARS, true, START_ROW),
  },
];
