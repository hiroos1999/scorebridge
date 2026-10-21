import type { Harmony, Measure, Note, TimeSignature } from "@/components/StaffToFretboard";

// 曲テンプレート（ジャズスタンダードの練習用プリセット）。
// 「テンプレート」選択UIから読み込むと、measures・root(キー)・useFlats・timeSigを
// 丸ごと差し替える初期値として使われる。読み込み後はStaffToFretboard側の通常の
// state（自由に編集できるデータ）として扱われ、テンプレート自体は不変のまま残る。
// melody: 曲のメロディ入り / practice: コードトーン・フレーズ練習用（コード進行にガイドトーン等を当てたもの）
export type TemplateCategory = "melody" | "practice";
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  melody: "Songs with melody",
  practice: "Chord-tone practice",
};

export type Template = {
  id: string;
  category: TemplateCategory;
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

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

// Tea for Two（Vincent Youmans, 1924 / パブリックドメイン）— Abのキー、フルコーラス32小節。
//    メロディは原典の楽譜の画像を拡大して、音の高さと長さを1音ずつ読み取って入力したもの。
//    形式: A(8, 1番かっこ) → B(8) → A(8, 2番かっこ) → C(8)。
//    コードは一般的な進行（Bbm7-Eb7-Abmaj7-Db7 …）。
type TeaChord = { root: number; kind: string; at: number; inv?: number };
const TEA_PITCH: Record<string, [number, number]> = {
  Eb4: [12, -1], E4: [12, 0], "G#4": [10, 1], Db4: [13, -1], B3: [15, 0], Gb4: [10, -1], Bb3: [15, -1], Ab3: [16, -1], Cb4: [14, -1], D4: [13, 0], C4: [14, 0], G5: [3, 0], F4: [11, 0], G4: [10, 0], Ab4: [9, -1], A4: [9, 0], Bb4: [8, -1], B4: [8, 0],
  C5: [7, 0], Cb5: [7, -1], D5: [6, 0], Db5: [6, -1], Eb5: [5, -1], E5: [5, 0], F5: [4, 0],
};
// [音名または"r"(休符), 開始グリッド, 長さ(グリッド数。4=4分, 2=8分, 6=付点4分)]
type TeaNote = [string, number, number, boolean?]; // 4番目はtrueで3連符
function teaBar(notes: TeaNote[], chords: TeaChord[]): Measure {
  return {
    notes: notes.map(([name, g, d, tri]) => {
      if (name === "r") return rest(g, d);
      const [row, acc] = TEA_PITCH[name];
      const n = note(g, d, row, acc);
      return tri ? { ...n, triplet: true } : n;
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

// Danny Boy（Londonderry Air / 伝承曲）フルコーラス Eb。楽譜画像から読み取り。
// 形式: アウフタクト1小節 + A + A' + B + C（各8小節）。
const DB_EB = tc(PC.Eb, "maj7");
const DB_AB = tc(PC.Ab, "maj7");
const DB_A_HEAD: Measure[] = [
  teaBar([["G4", 0, 8], ["r", 8, 4], ["F4", 12, 4]], [DB_EB]),
  teaBar([["G4", 0, 4], ["C5", 4, 4], ["Bb4", 8, 4], ["G4", 12, 4]], [tc(PC.Eb, "7")]),
  teaBar([["F4", 0, 4], ["Eb4", 4, 4], ["C4", 8, 8]], [DB_AB]),
];
const DB_A_TAIL: Measure[] = [
  teaBar([["Bb4", 0, 8], ["r", 8, 4], ["C5", 12, 4]], [DB_EB]),
  teaBar([["Bb4", 0, 4], ["G4", 4, 4], ["Eb4", 8, 4], ["G4", 12, 4]], [tc(PC.C, "m7")]),
  teaBar([["F4", 0, 16]], [tc(PC.F, "m7")]),
  teaBar([["r", 0, 4], ["D4", 4, 4], ["Eb4", 8, 4], ["F4", 12, 4]], [tc(PC.Bb, "7")]),
];
const DANNY_BOY_FULL: Measure[] = [
  teaBar([["r", 0, 4], ["D4", 4, 4], ["Eb4", 8, 4], ["F4", 12, 4]], [tc(PC.Bb, "7")]),
  // A
  ...DB_A_HEAD,
  teaBar([["r", 0, 4], ["Eb4", 4, 4], ["G4", 8, 4], ["Ab4", 12, 4]], [tc(PC.Ab, "m6")]),
  ...DB_A_TAIL,
  // A'
  ...DB_A_HEAD,
  teaBar([["r", 0, 4], ["D4", 4, 4], ["Eb4", 8, 4], ["F4", 12, 4]], [tc(PC.Ab, "m7")]),
  teaBar([["G4", 0, 8], ["r", 8, 4], ["Ab4", 12, 4]], [DB_EB, tc(PC.C, "m7", 8)]),
  teaBar([["G4", 0, 4], ["F4", 4, 4], ["Eb4", 8, 4], ["F4", 12, 4]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
  teaBar([["Eb4", 0, 16]], [DB_EB]),
  teaBar([["r", 0, 4], ["Bb4", 4, 4], ["C5", 8, 4], ["D5", 12, 4]], [tc(PC.Bb, "7")]),
  // B
  teaBar([["Eb5", 0, 8], ["r", 8, 4], ["D5", 12, 4]], [DB_EB, tc(PC.G, "7", 8)]),
  teaBar([["D5", 0, 4], ["C5", 4, 4], ["Bb4", 8, 4], ["C5", 12, 4]], [tc(PC.Ab, "maj7"), tc(PC.Bb, "7", 8)]),
  teaBar([["Bb4", 0, 4], ["G4", 4, 4], ["Eb4", 8, 8]], [DB_EB]),
  teaBar([["r", 0, 4], ["Bb4", 4, 4], ["C5", 8, 4], ["D5", 12, 4]], [DB_EB, tc(PC.D, "m7b5", 8), tc(PC.G, "7", 12)]),
  teaBar([["Eb5", 0, 8], ["r", 8, 4], ["D5", 12, 4]], [tc(PC.C, "m7"), tc(PC.C, "m7", 8, 3)]),
  teaBar([["D5", 0, 4], ["C5", 4, 4], ["Bb4", 8, 4], ["G4", 12, 4]], [tc(PC.Ab, "maj7"), tc(PC.G, "m7", 8), tc(PC.C, "7", 12)]),
  teaBar([["F4", 0, 16]], [tc(PC.F, "7")]),
  teaBar([["r", 0, 4], ["Bb4", 4, 4], ["Bb4", 8, 4], ["Bb4", 12, 4]], [tc(PC.Bb, "7")]),
  // C
  teaBar([["G5", 0, 8], ["r", 8, 4], ["F5", 12, 4]], [DB_EB, tc(PC.G, "7", 8)]),
  teaBar([["F5", 0, 4], ["Eb5", 4, 4], ["C5", 8, 4], ["Eb5", 12, 4]], [DB_AB, tc(PC.A, "dim", 8)]),
  teaBar([["Bb4", 0, 4], ["G4", 4, 4], ["Eb4", 8, 8]], [tc(PC.Eb, "maj7", 0, 2), tc(PC.G, "7", 4, 1), tc(PC.C, "m7", 8)]),
  teaBar([["r", 0, 4], ["D4", 4, 4], ["Eb4", 8, 4], ["F4", 12, 4]], [tc(PC.C, "m7"), tc(PC.Ab, "m6", 8)]),
  teaBar([["G4", 0, 4], ["C5", 4, 4], ["Bb4", 8, 4], ["G4", 12, 4]], [DB_EB, tc(PC.C, "7", 8)]),
  teaBar([["F4", 0, 4], ["Eb4", 4, 4], ["C4", 8, 4], ["D4", 12, 4]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
  teaBar([["Eb4", 0, 16]], [DB_EB]),
  teaBar([["r", 0, 16]], [tc(PC.F, "m7"), tc(PC.Bb, "7", 8)]),
];

// Smoke Gets in Your Eyes（Jerome Kern, 1933）フルコーラス Eb。楽譜画像から読み取り。
// 形式: A（1番かっこ）+ A（2番かっこ）+ B（Gb調の中間部）+ A = 32小節。
// Bはキー(変ト長調)の調号を使わず、Eb調の調号のまま臨時記号で実音を表している。
const SG = { eb: tc(PC.Eb, "maj7"), fm: tc(PC.F, "m7") };
const SG_A_START: Measure[] = [
  teaBar([["Eb4", 0, 8], ["D4", 8, 2], ["F4", 10, 2], ["Eb4", 12, 2], ["C4", 14, 2]],
    [SG.eb, tc(PC.G, "m7", 8), tc(PC.Gb, "dim", 12)]),
  teaBar([["Ab4", 0, 8], ["G4", 8, 2], ["Bb4", 10, 2], ["Ab4", 12, 2], ["F4", 14, 2]], [SG.fm, tc(PC.Bb, "7", 8)]),
  teaBar([["Eb5", 0, 16]], [SG.eb, tc(PC.G, "7", 8)]),
  teaBar([["Eb5", 0, 8], ["F5", 8, 2], ["Eb5", 10, 2], ["B4", 12, 2], ["C5", 14, 2]], [tc(PC.Ab, "maj7"), tc(PC.A, "dim", 8)]),
];
const SG_A_MID: Measure[] = [
  teaBar([["D5", 0, 8], ["C5", 8, 2], ["Bb4", 10, 2], ["C4", 12, 2], ["Eb4", 14, 2]], [tc(PC.G, "m7", 0, 1), tc(PC.C, "m7", 8)]),
  teaBar([["Bb4", 0, 8], ["C5", 8, 2], ["Bb4", 10, 2], ["Bb3", 12, 2], ["C4", 14, 2]], [SG.fm, tc(PC.Bb, "7", 8)]),
];
const SG_END1: Measure[] = [
  teaBar([["G4", 0, 16]], [tc(PC.G, "7"), tc(PC.C, "7", 8)]),
  teaBar([["F4", 0, 16]], [SG.fm, tc(PC.Bb, "7", 8)]),
];
const SG_END2: Measure[] = [
  teaBar([["Eb4", 0, 16]], [SG.eb, tc(PC.Ab, "7", 8)]),
  teaBar([["Eb4", 0, 16]], [SG.eb, tc(PC.Db, "m7", 8), tc(PC.Gb, "7", 12)]),
];
const SG_B_START = (): Measure[] => [
  teaBar([["Eb4", 0, 2], ["Gb4", 2, 2], ["Eb5", 4, 4], ["Eb5", 8, 2], ["Bb4", 10, 2], ["Db5", 12, 2], ["Cb5", 14, 2]], [tc(PC.B, "maj7")]),
];
const SG_B: Measure[] = [
  ...SG_B_START(),
  teaBar([["Eb4", 0, 2], ["Gb4", 2, 2], ["Bb4", 4, 4], ["Bb4", 8, 2], ["Ab4", 10, 2],
    ["Gb4", 12, 2, true], ["Ab3", 40 / 3, 2, true], ["Cb4", 44 / 3, 2, true]], [tc(PC.Ab, "7")]),
  teaBar([["Gb4", 0, 8], ["Gb4", 8, 8]], [tc(PC.Db, "m7"), tc(PC.Ab, "7", 8)]),
  teaBar([["Gb4", 0, 16]], [tc(PC.Db, "m7"), tc(PC.Gb, "7", 8)]),
  ...SG_B_START(),
  teaBar([["Eb4", 0, 2], ["Gb4", 2, 2], ["Bb4", 4, 4], ["Bb4", 8, 2], ["Ab4", 10, 2], ["G4", 12, 2], ["F4", 14, 2]],
    [tc(PC.Ab, "m7"), tc(PC.Bb, "7", 8), tc(PC.Bb, "7", 12, 3)]),
  teaBar([["G4", 0, 8], ["G4", 8, 8]], [tc(PC.G, "m7"), tc(PC.C, "7", 8)]),
  teaBar([["F4", 0, 16]], [SG.fm, tc(PC.Bb, "7", 8)]),
];
const SG_A_LAST: Measure[] = [
  ...SG_A_START,
  teaBar([["D5", 0, 8], ["C5", 8, 2], ["Bb4", 10, 2], ["C4", 12, 2, true], ["Eb4", 40 / 3, 2, true], ["G4", 44 / 3, 2, true]],
    [tc(PC.G, "m7", 0, 1), tc(PC.C, "m7", 8)]),
  teaBar([["Bb4", 0, 8], ["C5", 8, 2], ["Bb4", 10, 2], ["Bb4", 12, 2], ["C5", 14, 2]], [SG.fm, tc(PC.Bb, "7", 8)]),
  teaBar([["Eb5", 0, 16]], [SG.eb]),
  teaBar([["r", 0, 16]], [SG.fm, tc(PC.Bb, "7", 8)]),
];
const SMOKE_GETS_FULL: Measure[] = [
  ...SG_A_START, ...SG_A_MID, ...SG_END1,
  ...SG_A_START, ...SG_A_MID, ...SG_END2,
  ...SG_B,
  ...SG_A_LAST,
];

// Yesterdays（Jerome Kern, 1933）フルコーラス Dm。楽譜画像から読み取り。
// 形式: A（8）+ B（4）+ 1番かっこ（4）、リピートして A（8）+ B（4）+ 2番かっこ（4）+ コーダの1小節 = 33小節。
const YD_DM = tc(PC.D, "m7");
const YD_A: Measure[] = [
  teaBar([["A4", 0, 12], ["F4", 12, 4]], [YD_DM]),
  teaBar([["G4", 0, 16]], [tc(PC.E, "m7b5"), tc(PC.A, "7", 8)]),
  teaBar([["A4", 0, 12], ["F4", 12, 4]], [YD_DM]),
  teaBar([["G4", 0, 16]], [tc(PC.E, "m7b5"), tc(PC.A, "7", 8)]),
  teaBar([["D4", 0, 4], ["E4", 4, 4], ["F4", 8, 4], ["G4", 12, 4]], [YD_DM]),
  teaBar([["G#4", 0, 4], ["A4", 4, 4], ["B4", 8, 4], ["C5", 12, 4]], [YD_DM]),
  teaBar([["F5", 0, 12], ["B4", 12, 4]], [tc(PC.B, "m7b5")]),
  teaBar([["E5", 0, 16]], [tc(PC.E, "7")]),
];
const YD_B: Measure[] = [
  teaBar([["F5", 0, 12], ["A4", 12, 4]], [tc(PC.A, "7")]),
  teaBar([["E5", 0, 16]], [tc(PC.D, "7")]),
  teaBar([["E5", 0, 12], ["G4", 12, 4]], [tc(PC.G, "7")]),
  teaBar([["D5", 0, 16]], [tc(PC.C, "7")]),
];
const YD_END: Measure[] = [
  teaBar([["D5", 0, 12], ["A4", 12, 4]], [tc(PC.F, "7")]),
  teaBar([["C5", 0, 4], ["Bb4", 4, 4], ["F4", 8, 4], ["G4", 12, 4]], [tc(PC.Bb, "maj7")]),
  teaBar([["A4", 0, 16]], [tc(PC.E, "m7b5")]),
  teaBar([["A4", 0, 8], ["A4", 8, 8]], [tc(PC.A, "7")]),
];
const YESTERDAYS_FULL: Measure[] = [
  ...YD_A, ...YD_B, ...YD_END, ...YD_A, ...YD_B, ...YD_END,
  teaBar([["A4", 0, 16]], [YD_DM]),
];

// All the Things You Are（Jerome Kern, 1939）フルコーラス Ab。楽譜画像から読み取り（イントロは省略）。
// 形式: A（8）+ B（8）+ C（8）+ D（12）= 36小節。
const AT_A_HEAD: Measure[] = [
  teaBar([["Ab4", 0, 16]], [tc(PC.F, "m7")]),
  teaBar([["Db5", 0, 12], ["Ab4", 12, 4]], [tc(PC.Bb, "m7")]),
  teaBar([["G4", 0, 4], ["G4", 4, 4], ["G4", 8, 4], ["G4", 12, 4]], [tc(PC.Eb, "7")]),
  teaBar([["G4", 0, 4], ["C5", 4, 8], ["G4", 12, 4]], [tc(PC.Ab, "maj7")]),
];
const AT_A: Measure[] = [
  ...AT_A_HEAD,
  teaBar([["F4", 0, 4], ["F4", 4, 4], ["F4", 8, 4], ["F4", 12, 4]], [tc(PC.Db, "maj7")]),
  teaBar([["F4", 0, 4], ["B4", 4, 8], ["F4", 12, 4]], [tc(PC.D, "m7b5"), tc(PC.G, "7", 8)]),
  teaBar([["E4", 0, 16]], [tc(PC.C, "maj7")]),
  teaBar([["E4", 0, 16]], [tc(PC.C, "maj7")]),
];
const AT_B: Measure[] = [
  teaBar([["Eb4", 0, 16]], [tc(PC.C, "m7")]),
  teaBar([["Ab4", 0, 12], ["Eb4", 12, 4]], [tc(PC.F, "m7")]),
  teaBar([["D4", 0, 4], ["D4", 4, 4], ["D4", 8, 4], ["D4", 12, 4]], [tc(PC.Bb, "7")]),
  teaBar([["D4", 0, 4], ["G4", 4, 8], ["D4", 12, 4]], [tc(PC.Eb, "maj7")]),
  teaBar([["C4", 0, 4], ["C4", 4, 4], ["C4", 8, 4], ["C4", 12, 4]], [tc(PC.Ab, "maj7")]),
  teaBar([["C4", 0, 4, true], ["D4", 8 / 3, 4, true], ["Eb4", 16 / 3, 4, true], ["D4", 8, 4], ["C4", 12, 4]],
    [tc(PC.A, "m7b5"), tc(PC.D, "7", 8)]),
  teaBar([["B3", 0, 16]], [tc(PC.G, "maj7")]),
  teaBar([["B3", 0, 4], ["D4", 4, 4], ["G4", 8, 4], ["D5", 12, 4]], [tc(PC.G, "maj7")]),
];
const AT_C: Measure[] = [
  teaBar([["D5", 0, 8], ["C5", 8, 8]], [tc(PC.A, "m7")]),
  teaBar([["C5", 0, 4], ["Eb4", 4, 4], ["E4", 8, 4], ["C5", 12, 4]], [tc(PC.D, "7")]),
  teaBar([["B4", 0, 16]], [tc(PC.G, "maj7")]),
  teaBar([["B4", 0, 4], ["D4", 4, 4], ["G4", 8, 4], ["B4", 12, 4]], [tc(PC.G, "maj7")]),
  teaBar([["B4", 0, 8], ["A4", 8, 8]], [tc(PC.Gb, "m7b5")]),
  teaBar([["A4", 0, 4], ["Bb3", 4, 4], ["B3", 8, 4], ["A4", 12, 4]], [tc(PC.B, "7")]),
  teaBar([["G#4", 0, 16]], [tc(PC.E, "maj7")]),
  teaBar([["G#4", 0, 16]], [tc(PC.C, "7")]),
];
const AT_D: Measure[] = [
  ...AT_A_HEAD,
  teaBar([["F4", 0, 16]], [tc(PC.Db, "maj7")]),
  teaBar([["Eb5", 0, 8], ["Db5", 8, 8]], [tc(PC.Db, "m7")]),
  teaBar([["Eb4", 0, 4], ["Eb4", 4, 4], ["Eb4", 8, 4, true], ["Eb4", 32 / 3, 4, true], ["Eb4", 40 / 3, 4, true]], [tc(PC.C, "m7")]),
  teaBar([["G4", 0, 12], ["F4", 12, 4]], [tc(PC.B, "dim")]),
  teaBar([["Db4", 0, 4], ["F4", 4, 4], ["Ab4", 8, 4], ["Db5", 12, 4]], [tc(PC.Bb, "m7")]),
  teaBar([["F5", 0, 8], ["G4", 8, 8]], [tc(PC.Eb, "7")]),
  teaBar([["Ab4", 0, 16]], [tc(PC.Ab, "maj7")]),
  teaBar([["Ab4", 0, 16]], [tc(PC.Ab, "maj7")]),
];
const ALL_THE_THINGS_FULL: Measure[] = [...AT_A, ...AT_B, ...AT_C, ...AT_D];

const ROW_MIDI = [84, 83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52];
function midiToNote(startGrid: number, duration: number, midi: number): Note {
  let rowIdx = ROW_MIDI.indexOf(midi);
  if (rowIdx >= 0) return note(startGrid, duration, rowIdx);
  // 黒鍵はフラットで綴る（半音上の自然音の段 + accidental -1）
  rowIdx = ROW_MIDI.indexOf(midi + 1);
  if (rowIdx < 0) throw new Error(`midiToNote: MIDI ${midi} is out of range`);
  return note(startGrid, duration, rowIdx, -1);
}
// ジャズブルース（F）12小節。メロディは「その時鳴っているコードの3度を1拍目、7度を3拍目」に
// 置いたガイドトーン・ライン。各音は直前の音に最も近いオクターブを選ぶ。
// コード: [ルート, 種類, 3度, 7度]。3度・7度は「音名+臨時記号」（例: "Eb"、"F#"）。
type BluesChord = [number, string, string, string];
const BL_F7: BluesChord = [PC.F, "7", "A", "Eb"];
const BL_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const BL_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const BL_BDIM: BluesChord = [PC.B, "dim", "D", "Ab"];
const BL_AM7B5: BluesChord = [PC.A, "m7b5", "C", "G"];
const BL_D7: BluesChord = [PC.D, "7", "F#", "C"];
const BL_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const BL_C7: BluesChord = [PC.C, "7", "E", "Bb"];
// 1小節 = 1拍目のコードと3拍目のコード（同じなら1つ）
const JAZZ_BLUES_F_BARS: [BluesChord, BluesChord][] = [
  [BL_F7, BL_F7], [BL_BB7, BL_BB7], [BL_F7, BL_F7], [BL_CM7, BL_F7],
  [BL_BB7, BL_BB7], [BL_BDIM, BL_BDIM], [BL_F7, BL_F7], [BL_AM7B5, BL_D7],
  [BL_GM7, BL_GM7], [BL_C7, BL_C7], [BL_F7, BL_D7], [BL_GM7, BL_C7],
];
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function guideToneNote(name: string, startGrid: number, prevMidi: number, duration = 8, lo = 62, hi = 81): { note: Note; midi: number } {
  const letter = name[0];
  const acc = name.length > 1 ? (name[1] === "#" ? 1 : -1) : 0;
  let best = -1;
  for (let oct = 3; oct <= 6; oct++) {
    const natural = 12 * (oct + 1) + NATURAL_PC[letter];
    if (ROW_MIDI.indexOf(natural) < 0) continue;
    const midi = natural + acc;
    if (midi < lo || midi > hi) continue;
    if (best < 0 || Math.abs(midi - prevMidi) < Math.abs(best - prevMidi)) best = midi;
  }
  const natural = best - acc;
  return { note: note(startGrid, duration, ROW_MIDI.indexOf(natural), acc), midi: best };
}
// 1コーラス分のガイドトーン・ライン。bars は1小節ごとに [1拍目のコード, 3拍目のコード]。
function guideToneChorus(bars: [BluesChord, BluesChord][], lo = 62, hi = 81): Measure[] {
  let prev = 69; // A4付近から開始
  return bars.map(([c1, c3]) => {
    const harmonies: Harmony[] = [{ offsetGrid: 0, root: c1[0], kind: c1[1], inversion: 0 }];
    if (c3 !== c1) {
      // 1小節に2コード: 各コードの3度→7度を4分音符で（倍速）
      harmonies.push({ offsetGrid: 8, root: c3[0], kind: c3[1], inversion: 0 });
      const picks: [string, number][] = [[c1[2], 0], [c1[3], 4], [c3[2], 8], [c3[3], 12]];
      const notes: Note[] = [];
      for (const [name, at] of picks) {
        const g = guideToneNote(name, at, prev, 4, lo, hi);
        notes.push(g.note);
        prev = g.midi;
      }
      return { notes, harmonies };
    }
    const third = guideToneNote(c1[2], 0, prev, 8, lo, hi);
    const seventh = guideToneNote(c3[3], 8, third.midi, 8, lo, hi);
    prev = seventh.midi;
    return { notes: [third.note, seventh.note], harmonies };
  });
}
// 2コーラス: 2コーラス目は同じ旋律を1オクターブ上（五線上で7段上）に。
function twoChoruses(chorus1: Measure[]): Measure[] {
  const chorus2: Measure[] = chorus1.map((m) => ({
    ...m,
    notes: m.notes.map((n) => {
      const r = n.rowIdxList[0];
      if (r < 7) throw new Error("twoChoruses: octave-up is out of staff range");
      return note(n.startGrid, n.duration, r - 7, n.accidentals[r] ?? 0);
    }),
    harmonies: m.harmonies.map((h) => ({ ...h })),
  }));
  return [...chorus1, ...chorus2];
}
function jazzBluesF(): Measure[] {
  return twoChoruses(guideToneChorus(JAZZ_BLUES_F_BARS));
}
// 枯葉（Gm）32小節 AABC。3度・7度のガイドトーン（C=Gmは便宜上Gm7）。2コーラス目は1オクターブ上。
const AL_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const AL_F7: BluesChord = [PC.F, "7", "A", "Eb"];
const AL_BBM7: BluesChord = [PC.Bb, "maj7", "D", "A"];
const AL_EBM7: BluesChord = [PC.Eb, "maj7", "G", "D"];
const AL_AM7B5: BluesChord = [PC.A, "m7b5", "C", "G"];
const AL_D7: BluesChord = [PC.D, "7", "F#", "C"];
const AL_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const AL_EB7: BluesChord = [PC.Eb, "7", "G", "Db"];
const AL_A: [BluesChord, BluesChord][] = [
  [AL_CM7, AL_CM7], [AL_F7, AL_F7], [AL_BBM7, AL_BBM7], [AL_EBM7, AL_EBM7],
  [AL_AM7B5, AL_AM7B5], [AL_D7, AL_D7], [AL_GM7, AL_GM7], [AL_GM7, AL_GM7],
];
const AL_B: [BluesChord, BluesChord][] = [
  [AL_AM7B5, AL_AM7B5], [AL_D7, AL_D7], [AL_GM7, AL_GM7], [AL_GM7, AL_GM7],
  [AL_CM7, AL_CM7], [AL_F7, AL_F7], [AL_BBM7, AL_BBM7], [AL_EBM7, AL_EBM7],
];
const AL_C: [BluesChord, BluesChord][] = [
  [AL_AM7B5, AL_AM7B5], [AL_D7, AL_D7], [AL_GM7, AL_GM7], [AL_GM7, AL_GM7],
  [AL_EB7, AL_EB7], [AL_AM7B5, AL_D7], [AL_GM7, AL_GM7], [AL_GM7, AL_GM7],
];
function autumnLeavesG(): Measure[] {
  // 音域は C4〜C5（2コーラス目の1オクターブ上が五線内に収まるように）
  return twoChoruses(guideToneChorus([...AL_A, ...AL_A, ...AL_B, ...AL_C], 60, 72));
}

// Days of Wine and Roses（F）32小節 AABA'。AL_と同じくガイドトーン・ライン、2コーラス目は1オクターブ上。
const WR_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const WR_EM7B5: BluesChord = [PC.E, "m7b5", "G", "D"];
const WR_A7: BluesChord = [PC.A, "7", "C#", "G"];
const WR_DM7: BluesChord = [PC.D, "m7", "F", "C"];
const WR_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const WR_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const WR_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const WR_F7: BluesChord = [PC.F, "7", "A", "Eb"];
const WR_BBM7: BluesChord = [PC.Bb, "maj7", "D", "A"];
const WR_AM7B5: BluesChord = [PC.A, "m7b5", "C", "G"];
const WR_D7: BluesChord = [PC.D, "7", "F#", "C"];
const WR_A1: [BluesChord, BluesChord][] = [
  [WR_FM7, WR_FM7], [WR_EM7B5, WR_A7], [WR_DM7, WR_DM7], [WR_DM7, WR_DM7],
  [WR_GM7, WR_GM7], [WR_C7, WR_C7], [WR_FM7, WR_FM7], [WR_GM7, WR_C7],
];
const WR_A2: [BluesChord, BluesChord][] = [
  [WR_FM7, WR_FM7], [WR_EM7B5, WR_A7], [WR_DM7, WR_DM7], [WR_DM7, WR_DM7],
  [WR_GM7, WR_GM7], [WR_C7, WR_C7], [WR_FM7, WR_FM7], [WR_FM7, WR_FM7],
];
const WR_B: [BluesChord, BluesChord][] = [
  [WR_CM7, WR_CM7], [WR_F7, WR_F7], [WR_BBM7, WR_BBM7], [WR_BBM7, WR_BBM7],
  [WR_AM7B5, WR_AM7B5], [WR_D7, WR_D7], [WR_GM7, WR_GM7], [WR_GM7, WR_C7],
];
function daysOfWineAndRosesF(): Measure[] {
  return twoChoruses(guideToneChorus([...WR_A1, ...WR_A2, ...WR_B, ...WR_A1], 60, 72));
}

// There Will Never Be Another You（Eb）32小節 AABA'。ガイドトーン・ライン、2コーラス目は1オクターブ上。
const TW_EBM7: BluesChord = [PC.Eb, "maj7", "G", "D"];
const TW_FM7: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const TW_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const TW_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const TW_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const TW_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const TW_ABM7: BluesChord = [PC.Ab, "maj7", "C", "G"];
const TW_ABMIN7: BluesChord = [PC.Ab, "m7", "Cb", "Gb"];
const TW_DB7: BluesChord = [PC.Db, "7", "F", "Cb"];
const TW_A1: [BluesChord, BluesChord][] = [
  [TW_EBM7, TW_EBM7], [TW_FM7, TW_BB7], [TW_EBM7, TW_EBM7], [TW_EBM7, TW_EBM7],
  [TW_FM7, TW_FM7], [TW_BB7, TW_BB7], [TW_GM7, TW_C7], [TW_FM7, TW_BB7],
];
const TW_A2: [BluesChord, BluesChord][] = [
  [TW_EBM7, TW_EBM7], [TW_FM7, TW_BB7], [TW_EBM7, TW_EBM7], [TW_EBM7, TW_EBM7],
  [TW_FM7, TW_FM7], [TW_BB7, TW_BB7], [TW_EBM7, TW_EBM7], [TW_EBM7, TW_EBM7],
];
const TW_B: [BluesChord, BluesChord][] = [
  [TW_ABM7, TW_ABM7], [TW_ABMIN7, TW_DB7], [TW_GM7, TW_GM7], [TW_C7, TW_C7],
  [TW_FM7, TW_FM7], [TW_BB7, TW_BB7], [TW_EBM7, TW_EBM7], [TW_EBM7, TW_EBM7],
];
const TW_A3: [BluesChord, BluesChord][] = [...TW_A2.slice(0, 6), [TW_EBM7, TW_CM7], [TW_FM7, TW_BB7]];
function neverAnotherYouEb(): Measure[] {
  return twoChoruses(guideToneChorus([...TW_A1, ...TW_A2, ...TW_B, ...TW_A3], 60, 72));
}

// All of Me（C）32小節 ABAC。ガイドトーン・ライン、2コーラス目は1オクターブ上。C6の「7度」は6度(A)。
const AM_C6: BluesChord = [PC.C, "6", "E", "A"];
const AM_E7: BluesChord = [PC.E, "7", "G#", "D"];
const AM_A7: BluesChord = [PC.A, "7", "C#", "G"];
const AM_DM7: BluesChord = [PC.D, "m7", "F", "C"];
const AM_AM7: BluesChord = [PC.A, "m7", "C", "G"];
const AM_D7: BluesChord = [PC.D, "7", "F#", "C"];
const AM_G7: BluesChord = [PC.G, "7", "B", "F"];
const AM_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const AM_FM6: BluesChord = [PC.F, "m6", "Ab", "D"];
const AM_EM7: BluesChord = [PC.E, "m7", "G", "D"];
const AM_A: [BluesChord, BluesChord][] = [
  [AM_C6, AM_C6], [AM_C6, AM_C6], [AM_E7, AM_E7], [AM_E7, AM_E7],
  [AM_A7, AM_A7], [AM_A7, AM_A7], [AM_DM7, AM_DM7], [AM_DM7, AM_DM7],
];
const AM_B: [BluesChord, BluesChord][] = [
  [AM_E7, AM_E7], [AM_E7, AM_E7], [AM_AM7, AM_AM7], [AM_AM7, AM_AM7],
  [AM_D7, AM_D7], [AM_D7, AM_D7], [AM_DM7, AM_DM7], [AM_G7, AM_G7],
];
const AM_C: [BluesChord, BluesChord][] = [
  [AM_FM7, AM_FM7], [AM_FM6, AM_FM6], [AM_C6, AM_C6], [AM_EM7, AM_A7],
  [AM_DM7, AM_DM7], [AM_G7, AM_G7], [AM_C6, AM_C6], [AM_DM7, AM_G7],
];
function allOfMeC(): Measure[] {
  return twoChoruses(guideToneChorus([...AM_A, ...AM_B, ...AM_A, ...AM_C], 60, 72));
}

// Joy Spring（F）32小節 ABCA。Web上のコード表（guitarcomposerstoolbox）の並びを小節に割り当てたもの。
const JS_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const JS_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const JS_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const JS_BBM7: BluesChord = [PC.Bb, "m7", "Db", "Ab"];
const JS_EB7: BluesChord = [PC.Eb, "7", "G", "Db"];
const JS_AM7: BluesChord = [PC.A, "m7", "C", "G"];
const JS_AB7: BluesChord = [PC.Ab, "7", "C", "Gb"];
const JS_ABM7: BluesChord = [PC.Ab, "m7", "Cb", "Gb"];
const JS_DB7: BluesChord = [PC.Db, "7", "F", "Cb"];
const JS_GBM7: BluesChord = [PC.Gb, "maj7", "Bb", "F"];
const JS_BM7: BluesChord = [PC.B, "m7", "D", "A"];
const JS_E7: BluesChord = [PC.E, "7", "G#", "D"];
const JS_A7: BluesChord = [PC.A, "7", "C#", "G"];
const JS_D7: BluesChord = [PC.D, "7", "F#", "C"];
const JS_GMAJ7: BluesChord = [PC.G, "maj7", "B", "F#"];
const JS_FM7MIN: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const JS_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const JS_EBM7: BluesChord = [PC.Eb, "maj7", "G", "D"];
const JS_A1: [BluesChord, BluesChord][] = [
  [JS_FM7, JS_FM7], [JS_GM7, JS_C7], [JS_FM7, JS_FM7], [JS_BBM7, JS_EB7],
  [JS_AM7, JS_AB7], [JS_GM7, JS_C7], [JS_FM7, JS_FM7], [JS_ABM7, JS_DB7],
];
const JS_A2: [BluesChord, BluesChord][] = [...JS_A1.slice(0, 7), [JS_GM7, JS_C7]];
const JS_B: [BluesChord, BluesChord][] = [
  [JS_GBM7, JS_GBM7], [JS_ABM7, JS_DB7], [JS_GBM7, JS_GBM7], [JS_BM7, JS_E7],
  [JS_BBM7, JS_A7], [JS_ABM7, JS_DB7], [JS_GBM7, JS_GBM7], [JS_AM7, JS_D7],
];
const JS_C: [BluesChord, BluesChord][] = [
  [JS_GMAJ7, JS_GMAJ7], [JS_GM7, JS_C7], [JS_FM7, JS_FM7], [JS_FM7MIN, JS_BB7],
  [JS_EBM7, JS_EBM7], [JS_ABM7, JS_DB7], [JS_GBM7, JS_GBM7], [JS_GM7, JS_C7],
];
function joySpringF(): Measure[] {
  return twoChoruses(guideToneChorus([...JS_A1, ...JS_B, ...JS_C, ...JS_A2], 60, 72));
}

// Softly, as in a Morning Sunrise（Cm）32小節 AABA。ガイドトーン・ライン、2コーラス目は1オクターブ上。
const SF_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const SF_DM7B5: BluesChord = [PC.D, "m7b5", "F", "C"];
const SF_G7: BluesChord = [PC.G, "7", "B", "F"];
const SF_FM7: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const SF_AB7: BluesChord = [PC.Ab, "7", "C", "Gb"];
const SF_A: [BluesChord, BluesChord][] = [
  [SF_CM7, SF_CM7], [SF_CM7, SF_CM7], [SF_DM7B5, SF_DM7B5], [SF_G7, SF_G7],
  [SF_CM7, SF_CM7], [SF_CM7, SF_CM7], [SF_DM7B5, SF_DM7B5], [SF_G7, SF_G7],
];
const SF_B: [BluesChord, BluesChord][] = [
  [SF_FM7, SF_FM7], [SF_FM7, SF_FM7], [SF_DM7B5, SF_DM7B5], [SF_G7, SF_G7],
  [SF_CM7, SF_CM7], [SF_AB7, SF_AB7], [SF_DM7B5, SF_DM7B5], [SF_G7, SF_G7],
];
function softlyCm(): Measure[] {
  return twoChoruses(guideToneChorus([...SF_A, ...SF_A, ...SF_B, ...SF_A], 60, 72));
}

// Fly Me to the Moon（C）32小節 ABAC。メロディは含まない（著作権存続中のため）。
// コード進行にガイドトーン・ラインを当てた練習用。2コーラス目は1オクターブ上。
const FM_AM7: BluesChord = [PC.A, "m7", "C", "G"];
const FM_DM7: BluesChord = [PC.D, "m7", "F", "C"];
const FM_G7: BluesChord = [PC.G, "7", "B", "F"];
const FM_CM7: BluesChord = [PC.C, "maj7", "E", "B"];
const FM_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const FM_BM7B5: BluesChord = [PC.B, "m7b5", "D", "A"];
const FM_E7: BluesChord = [PC.E, "7", "G#", "D"];
const FM_A7: BluesChord = [PC.A, "7", "C#", "G"];
const FM_EM7: BluesChord = [PC.E, "m7", "G", "D"];
const FM_A: [BluesChord, BluesChord][] = [
  [FM_AM7, FM_AM7], [FM_DM7, FM_DM7], [FM_G7, FM_G7], [FM_CM7, FM_CM7],
  [FM_FM7, FM_FM7], [FM_BM7B5, FM_BM7B5], [FM_E7, FM_E7], [FM_AM7, FM_A7],
];
const FM_B: [BluesChord, BluesChord][] = [
  [FM_DM7, FM_DM7], [FM_G7, FM_G7], [FM_CM7, FM_CM7], [FM_EM7, FM_A7],
  [FM_DM7, FM_DM7], [FM_G7, FM_G7], [FM_CM7, FM_CM7], [FM_BM7B5, FM_E7],
];
const FM_C: [BluesChord, BluesChord][] = [
  [FM_DM7, FM_DM7], [FM_G7, FM_G7], [FM_EM7, FM_EM7], [FM_A7, FM_A7],
  [FM_DM7, FM_DM7], [FM_G7, FM_G7], [FM_CM7, FM_CM7], [FM_BM7B5, FM_E7],
];
function flyMeToTheMoonC(): Measure[] {
  return twoChoruses(guideToneChorus([...FM_A, ...FM_B, ...FM_A, ...FM_C], 60, 72));
}

// The Girl from Ipanema（F）32小節 AABA。メロディは含まない（著作権存続中のため）。
// コード進行にガイドトーン・ラインを当てた練習用。2コーラス目は1オクターブ上。
const GI_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const GI_G7: BluesChord = [PC.G, "7", "B", "F"];
const GI_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const GI_GB7: BluesChord = [PC.Gb, "7", "Bb", "Fb"];
const GI_GBM7: BluesChord = [PC.Gb, "maj7", "Bb", "F"];
const GI_B7: BluesChord = [PC.B, "7", "D#", "A"];
const GI_GBMIN7: BluesChord = [PC.Gb, "m7", "A", "E"];
const GI_D7: BluesChord = [PC.D, "7", "F#", "C"];
const GI_EB7: BluesChord = [PC.Eb, "7", "G", "Db"];
const GI_AM7: BluesChord = [PC.A, "m7", "C", "G"];
const GI_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const GI_A1: [BluesChord, BluesChord][] = [
  [GI_FM7, GI_FM7], [GI_FM7, GI_FM7], [GI_G7, GI_G7], [GI_G7, GI_G7],
  [GI_GM7, GI_GM7], [GI_GB7, GI_GB7], [GI_FM7, GI_FM7], [GI_GB7, GI_GB7],
];
const GI_A2: [BluesChord, BluesChord][] = [...GI_A1.slice(0, 7), [GI_FM7, GI_FM7]];
const GI_B: [BluesChord, BluesChord][] = [
  [GI_GBM7, GI_GBM7], [GI_B7, GI_B7], [GI_GBMIN7, GI_GBMIN7], [GI_D7, GI_D7],
  [GI_GM7, GI_GM7], [GI_EB7, GI_EB7], [GI_AM7, GI_D7], [GI_GM7, GI_C7],
];
function girlFromIpanemaF(): Measure[] {
  return twoChoruses(guideToneChorus([...GI_A1, ...GI_A2, ...GI_B, ...GI_A2], 60, 72));
}

// Just Friends（F）32小節 ABAC（1番括弧=B / 2番括弧=C）。メロディは含まない。
// 黒本のコード記号に沿ったガイドトーン練習用。2コーラス目は1オクターブ上。
const JF_BBM7: BluesChord = [PC.Bb, "maj7", "D", "A"];
const JF_BBMIN7: BluesChord = [PC.Bb, "m7", "Db", "Ab"];
const JF_EB7: BluesChord = [PC.Eb, "7", "G", "Db"];
const JF_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const JF_ABM7: BluesChord = [PC.Ab, "m7", "Cb", "Gb"];
const JF_DB7: BluesChord = [PC.Db, "7", "F", "Cb"];
const JF_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const JF_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const JF_AM7: BluesChord = [PC.A, "m7", "C", "G"];
const JF_DM7: BluesChord = [PC.D, "m7", "F", "C"];
const JF_G7: BluesChord = [PC.G, "7", "B", "F"];
const JF_B7: BluesChord = [PC.B, "7", "D#", "A"];
const JF_F6: BluesChord = [PC.F, "6", "A", "D"];
const JF_A: [BluesChord, BluesChord][] = [
  [JF_BBM7, JF_BBM7], [JF_BBM7, JF_BBM7], [JF_BBMIN7, JF_BBMIN7], [JF_EB7, JF_EB7],
  [JF_FM7, JF_FM7], [JF_FM7, JF_FM7], [JF_ABM7, JF_ABM7], [JF_DB7, JF_DB7],
];
const JF_B: [BluesChord, BluesChord][] = [
  [JF_GM7, JF_GM7], [JF_C7, JF_C7], [JF_AM7, JF_AM7], [JF_DM7, JF_DM7],
  [JF_G7, JF_G7], [JF_G7, JF_G7], [JF_GM7, JF_GM7], [JF_C7, JF_B7],
];
const JF_C: [BluesChord, BluesChord][] = [
  [JF_GM7, JF_GM7], [JF_C7, JF_C7], [JF_AM7, JF_AM7], [JF_DM7, JF_DM7],
  [JF_G7, JF_G7], [JF_GM7, JF_C7], [JF_F6, JF_F6], [JF_GM7, JF_C7],
];
function justFriendsF(): Measure[] {
  return twoChoruses(guideToneChorus([...JF_A, ...JF_B, ...JF_A, ...JF_C], 60, 72));
}

// On Green Dolphin Street（Eb）32小節 ABAC（1番括弧=B / 2番括弧=C、Cはソロ中の8小節版）。
// メロディは含まない。黒本のコード記号に沿ったガイドトーン練習用（スラッシュコードは
// 分子側のコードで作成。ベース音の指定はしない）。2コーラス目は1オクターブ上。
const GD_EB: BluesChord = [PC.Eb, "maj7", "G", "D"];
const GD_GBM7: BluesChord = [PC.Gb, "maj7", "Bb", "F"];
const GD_F7: BluesChord = [PC.F, "7", "A", "Eb"];
const GD_EM7: BluesChord = [PC.E, "maj7", "G#", "D#"];
const GD_GM7B5: BluesChord = [PC.G, "m7b5", "Bb", "F"];
const GD_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const GD_FM7: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const GD_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const GD_ABM7: BluesChord = [PC.Ab, "m7", "Cb", "Gb"];
const GD_DB7: BluesChord = [PC.Db, "7", "F", "Cb"];
const GD_DM7B5: BluesChord = [PC.D, "m7b5", "F", "C"];
const GD_G7: BluesChord = [PC.G, "7", "B", "F"];
const GD_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const GD_AM7B5: BluesChord = [PC.A, "m7b5", "C", "G"];
const GD_D7: BluesChord = [PC.D, "7", "F#", "C"];
const GD_GM7: BluesChord = [PC.G, "m7", "Bb", "F"];
const GD_EB6: BluesChord = [PC.Eb, "6", "G", "C"];
const GD_A: [BluesChord, BluesChord][] = [
  [GD_EB, GD_EB], [GD_EB, GD_EB], [GD_GBM7, GD_GBM7], [GD_GBM7, GD_GBM7],
  [GD_F7, GD_F7], [GD_EM7, GD_EM7], [GD_EB, GD_EB], [GD_GM7B5, GD_C7],
];
const GD_B: [BluesChord, BluesChord][] = [
  [GD_FM7, GD_FM7], [GD_BB7, GD_BB7], [GD_EB, GD_EB], [GD_EB, GD_EB],
  [GD_ABM7, GD_ABM7], [GD_DB7, GD_DB7], [GD_GBM7, GD_GBM7], [GD_FM7, GD_BB7],
];
const GD_C: [BluesChord, BluesChord][] = [
  [GD_FM7, GD_FM7], [GD_DM7B5, GD_G7], [GD_CM7, GD_CM7], [GD_AM7B5, GD_D7],
  [GD_GM7, GD_C7], [GD_FM7, GD_BB7], [GD_EB6, GD_EB6], [GD_EB6, GD_EB6],
];
function greenDolphinEb(): Measure[] {
  return twoChoruses(guideToneChorus([...GD_A, ...GD_B, ...GD_A, ...GD_C], 60, 72));
}

// Wave（D）A(12)・A(12, 1番括弧で戻る)・B(8)・A(12) = 44小節。メロディは含まない。
// 黒本のコード記号に沿ったガイドトーン練習用（イントロは含まない）。2コーラス目は1オクターブ上。
const WV_DM7: BluesChord = [PC.D, "maj7", "F#", "C#"];
const WV_BBDIM7: BluesChord = [PC.Bb, "dim", "Db", "G"];
const WV_AM7: BluesChord = [PC.A, "m7", "C", "G"];
const WV_D7: BluesChord = [PC.D, "7", "F#", "C"];
const WV_GM7: BluesChord = [PC.G, "maj7", "B", "F#"];
const WV_C7: BluesChord = [PC.C, "7", "E", "Bb"];
const WV_FS7: BluesChord = [PC.Gb, "7", "A#", "E"];
const WV_B7: BluesChord = [PC.B, "7", "D#", "A"];
const WV_E7: BluesChord = [PC.E, "7", "G#", "D"];
const WV_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const WV_A7: BluesChord = [PC.A, "7", "C#", "G"];
const WV_DMIN7: BluesChord = [PC.D, "m7", "F", "C"];
const WV_G7: BluesChord = [PC.G, "7", "B", "F"];
const WV_GMIN7: BluesChord = [PC.G, "m7", "Bb", "F"];
const WV_FM7: BluesChord = [PC.F, "maj7", "A", "E"];
const WV_FMIN7: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const WV_EBM7: BluesChord = [PC.Eb, "maj7", "G", "D"];
const WV_A: [BluesChord, BluesChord][] = [
  [WV_DM7, WV_DM7], [WV_BBDIM7, WV_BBDIM7], [WV_AM7, WV_AM7], [WV_D7, WV_D7],
  [WV_GM7, WV_GM7], [WV_C7, WV_C7], [WV_FS7, WV_FS7], [WV_B7, WV_B7],
  [WV_E7, WV_E7], [WV_BB7, WV_A7], [WV_DMIN7, WV_G7], [WV_DMIN7, WV_G7],
];
const WV_B: [BluesChord, BluesChord][] = [
  [WV_GMIN7, WV_GMIN7], [WV_C7, WV_C7], [WV_FM7, WV_FM7], [WV_FM7, WV_FM7],
  [WV_FMIN7, WV_FMIN7], [WV_BB7, WV_BB7], [WV_EBM7, WV_EBM7], [WV_A7, WV_A7],
];
function waveD(): Measure[] {
  return twoChoruses(guideToneChorus([...WV_A, ...WV_A, ...WV_B, ...WV_A], 60, 72));
}

// Água de Beber（Cm）32小節 = テーマ(8) + A(8) + B(16)。メロディは含まない。
// 黒本のコード記号に沿ったガイドトーン練習用（スラッシュコードは分子側のコードで作成）。
// 2コーラス目は1オクターブ上。
const AB_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const AB_D7: BluesChord = [PC.D, "7", "F#", "C"];
const AB_G7: BluesChord = [PC.G, "7", "B", "F"];
const AB_ABM7: BluesChord = [PC.Ab, "maj7", "C", "G"];
const AB_F7: BluesChord = [PC.F, "7", "A", "Eb"];
const AB_FM7: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const AB_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const AB_EBM7: BluesChord = [PC.Eb, "maj7", "G", "D"];
const AB_DBM7: BluesChord = [PC.Db, "maj7", "F", "C"];
const AB_DB7: BluesChord = [PC.Db, "7", "F", "Cb"];
const AB_B7: BluesChord = [PC.B, "7", "D#", "A"];
const AB_BBMIN7: BluesChord = [PC.Bb, "m7", "Db", "Ab"];
const AB_DMIN7: BluesChord = [PC.D, "m7", "F", "C"];
const AB_HEAD: [BluesChord, BluesChord][] = [
  [AB_CM7, AB_CM7], [AB_D7, AB_G7], [AB_CM7, AB_CM7], [AB_D7, AB_G7],
  [AB_CM7, AB_CM7], [AB_ABM7, AB_ABM7], [AB_CM7, AB_CM7], [AB_G7, AB_G7],
];
const AB_A: [BluesChord, BluesChord][] = [
  [AB_D7, AB_D7], [AB_G7, AB_G7], [AB_CM7, AB_CM7], [AB_F7, AB_F7],
  [AB_FM7, AB_FM7], [AB_BB7, AB_BB7], [AB_EBM7, AB_EBM7], [AB_DBM7, AB_DBM7],
];
const AB_B: [BluesChord, BluesChord][] = [
  [AB_D7, AB_DB7], [AB_CM7, AB_B7], [AB_BBMIN7, AB_BBMIN7], [AB_F7, AB_F7],
  [AB_D7, AB_D7], [AB_DMIN7, AB_DMIN7], [AB_CM7, AB_CM7], [AB_CM7, AB_CM7],
  [AB_F7, AB_F7], [AB_FM7, AB_FM7], [AB_CM7, AB_CM7], [AB_CM7, AB_CM7],
  [AB_F7, AB_F7], [AB_FM7, AB_FM7], [AB_CM7, AB_CM7], [AB_G7, AB_G7],
];
function aguaDeBeberCm(): Measure[] {
  return twoChoruses(guideToneChorus([...AB_HEAD, ...AB_A, ...AB_B], 60, 72));
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

// いつか王子様が（Bb, 3/4）24小節 A8 B8 C8。ジャズ・スタンダード・バイブルのコード進行。
// 3/4(12grid): 1小節1コード。3度を2分音符（拍1-2）、7度を4分音符（拍3）に置いたガイドトーン・ライン。
// 小節数はA(8)+B(8,1番カッコ)+C(8,2番カッコ)。素の「B♭」はBbmaj7、F7sus4は4度(Bb)を3度枠に置いたF7として扱う。
const SP_BBM7: BluesChord = [PC.Bb, "maj7", "D", "A"];
const SP_D7: BluesChord = [PC.D, "7", "F#", "C"];
const SP_EBM7: BluesChord = [PC.Eb, "maj7", "G", "D"];
const SP_G7: BluesChord = [PC.G, "7", "B", "F"];
const SP_CM7: BluesChord = [PC.C, "m7", "Eb", "Bb"];
const SP_F7: BluesChord = [PC.F, "7", "A", "Eb"];
const SP_DM7: BluesChord = [PC.D, "m7", "F", "C"];
const SP_DBDIM: BluesChord = [PC.Db, "dim", "E", "A"];
const SP_FM7: BluesChord = [PC.F, "m7", "Ab", "Eb"];
const SP_BB7: BluesChord = [PC.Bb, "7", "D", "Ab"];
const SP_EDIM: BluesChord = [PC.E, "dim", "G", "Db"];
const SP_FDIM: BluesChord = [PC.F, "dim", "Ab", "D"];
const SP_F7SUS: BluesChord = [PC.F, "7", "Bb", "Eb"];
const SOMEDAY_BARS: BluesChord[] = [
  SP_BBM7, SP_D7, SP_EBM7, SP_G7, SP_CM7, SP_G7, SP_CM7, SP_F7,
  SP_DM7, SP_DBDIM, SP_CM7, SP_F7, SP_DM7, SP_DBDIM, SP_CM7, SP_F7,
  SP_FM7, SP_BB7, SP_EBM7, SP_EDIM, SP_BBM7, SP_FDIM, SP_F7SUS, SP_F7,
];
function someday(): Measure[] {
  let prev = 69;
  const chorus1: Measure[] = SOMEDAY_BARS.map((c) => {
    const third = guideToneNote(c[2], 0, prev, 8, 60, 72);
    const seventh = guideToneNote(c[3], 8, third.midi, 4, 60, 72);
    prev = seventh.midi;
    return {
      notes: [third.note, seventh.note],
      harmonies: [{ offsetGrid: 0, root: c[0], kind: c[1], inversion: 0 }],
    };
  });
  return twoChoruses(chorus1);
}

export const TEMPLATES: Template[] = [
  {
    id: "someday-my-prince-bb",
    category: "practice",
    label: "Someday My Prince Will Come (いつか王子様が) in Bb — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.Bb,
    useFlats: true,
    timeSig: { numerator: 3, denominator: 4 },
    measures: someday(),
  },
  {
    id: "wave-d",
    category: "practice",
    label: "Wave in D — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.D,
    useFlats: false,
    timeSig: FOUR_FOUR,
    measures: waveD(),
  },
  {
    id: "agua-de-beber-cm",
    category: "practice",
    label: "Água de Beber (おいしい水) in Cm — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: aguaDeBeberCm(),
  },
  {
    id: "just-friends-f",
    category: "practice",
    label: "Just Friends in F — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: justFriendsF(),
  },
  {
    id: "green-dolphin-eb",
    category: "practice",
    label: "On Green Dolphin Street in Eb — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: greenDolphinEb(),
  },
  {
    id: "girl-from-ipanema-f",
    category: "practice",
    label: "The Girl from Ipanema in F — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: girlFromIpanemaF(),
  },
  {
    id: "fly-me-to-the-moon-c",
    category: "practice",
    label: "Fly Me to the Moon in C — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.C,
    useFlats: false,
    timeSig: FOUR_FOUR,
    measures: flyMeToTheMoonC(),
  },
  {
    id: "all-of-me-c",
    category: "practice",
    label: "All of Me in C — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.C,
    useFlats: false,
    timeSig: FOUR_FOUR,
    measures: allOfMeC(),
  },
  {
    id: "joy-spring-f",
    category: "practice",
    label: "Joy Spring in F — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: joySpringF(),
  },
  {
    id: "softly-cm",
    category: "practice",
    label: "Softly, as in a Morning Sunrise in Cm — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: softlyCm(),
  },
  {
    id: "never-another-you-eb",
    category: "practice",
    label: "There Will Never Be Another You in Eb — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: neverAnotherYouEb(),
  },
  {
    id: "days-of-wine-and-roses-f",
    category: "practice",
    label: "The Days of Wine and Roses in F — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: daysOfWineAndRosesF(),
  },
  {
    id: "autumn-leaves-g",
    category: "practice",
    label: "Autumn Leaves in Gm — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.Bb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: autumnLeavesG(),
  },
  {
    id: "jazz-blues-f",
    category: "practice",
    label: "Jazz blues in F — guide-tone melody (3rd / 7th, 2 choruses)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: jazzBluesF(),
  },
  {
    id: "bebop-251-c",
    category: "practice",
    label: "Bebop ii–V–I lick in C (original)",
    root: PC.C,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: bebop251(PC.C, 0),
  },
  {
    id: "bebop-251-f",
    category: "practice",
    label: "Bebop ii–V–I lick in F (original)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: bebop251(PC.F, -7),
  },
  {
    id: "bebop-251-bb",
    category: "practice",
    label: "Bebop ii–V–I lick in Bb (original)",
    root: PC.Bb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: bebop251(PC.Bb, -2),
  },
  {
    id: "yesterdays",
    category: "melody",
    label: "Yesterdays — full chorus (Dm, Kern)",
    root: PC.F,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: YESTERDAYS_FULL,
  },
  {
    id: "all-the-things",
    category: "melody",
    label: "All the Things You Are — full chorus (Ab, Kern)",
    root: PC.Ab,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: ALL_THE_THINGS_FULL,
  },
  {
    id: "smoke-gets",
    category: "melody",
    label: "Smoke Gets in Your Eyes — full chorus (Eb, Kern)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: SMOKE_GETS_FULL,
  },
  {
    id: "danny-boy",
    category: "melody",
    label: "Danny Boy — full chorus (Eb, Londonderry Air)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: DANNY_BOY_FULL,
  },
  {
    id: "summertime",
    category: "melody",
    label: "Summertime — full chorus (Am, Gershwin)",
    root: PC.C,
    useFlats: false,
    timeSig: FOUR_FOUR,
    measures: SUMMERTIME_FULL,
  },
  {
    id: "swonderful",
    category: "melody",
    label: "'S Wonderful — full chorus (Eb, Gershwin)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: S_WONDERFUL_FULL,
  },
  {
    id: "rhythm",
    category: "melody",
    label: "I Got Rhythm — full chorus (Bb, Gershwin)",
    root: PC.Bb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: I_GOT_RHYTHM_FULL,
  },
  {
    id: "but-not-for-me",
    category: "melody",
    label: "But Not for Me — full chorus (Eb, Gershwin)",
    root: PC.Eb,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: BUT_NOT_FOR_ME_FULL,
  },
  {
    id: "tea-for-two",
    category: "melody",
    label: "Tea for Two — full chorus (Ab, Youmans)",
    root: PC.Ab,
    useFlats: true,
    timeSig: FOUR_FOUR,
    measures: TEA_FOR_TWO_FULL,
  },
];
