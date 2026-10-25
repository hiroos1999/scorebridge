// CAGEDシェイプ: 5つのオープンコードの形(C・A・G・E・D)を、指板上で動かせる形として扱う。
// 各シェイプは「メジャーコード(ルート・3度・5度)だけ」で定義する。7度などの
// 追加音は含めない(コードの種類で位置が変わるため)。マイナー系は3度を半音下げる。

export type ShapeName = "E" | "D" | "C" | "A" | "G";
export type ShapeRole = "R" | "3" | "5";
export type ShapeNote = { s: number; f: number; role: ShapeRole }; // s: 0=1弦 … 5=6弦

// key: そのシェイプが「開放位置」でつくるコードのルート(ピッチクラス)
// form: 弦ごとの [開放位置を0としたフレット, 役割]
const SHAPES: Record<ShapeName, { key: number; form: Record<number, [number, ShapeRole]> }> = {
  C: { key: 0, form: { 4: [3, "R"], 3: [2, "3"], 2: [0, "5"], 1: [1, "R"], 0: [0, "3"] } },
  A: { key: 9, form: { 4: [0, "R"], 3: [2, "5"], 2: [2, "R"], 1: [2, "3"], 0: [0, "5"] } },
  G: { key: 7, form: { 5: [3, "R"], 4: [2, "3"], 3: [0, "5"], 2: [0, "R"], 1: [0, "3"], 0: [3, "R"] } },
  E: { key: 4, form: { 5: [0, "R"], 4: [2, "5"], 3: [2, "R"], 2: [1, "3"], 1: [0, "5"], 0: [0, "R"] } },
  D: { key: 2, form: { 3: [0, "R"], 2: [2, "5"], 1: [3, "R"], 0: [2, "3"] } },
};

// 低い方から高い方へ(Fの場合 E → D → C → A → G の順に並ぶ)
export const SHAPE_ORDER: ShapeName[] = ["E", "D", "C", "A", "G"];

const MAJOR_FORM_KINDS = new Set(["maj7", "7", "6"]);
const MINOR_FORM_KINDS = new Set(["m7", "m6", "mMaj7"]);
// 減三和音系(dim, m7b5)はマイナーの形の5度を半音下げる
const DIM_FORM_KINDS = new Set(["dim", "m7b5"]);

export type ShapeQuality = "major" | "minor" | "dim";

export function shapeQualityFor(kind: string): ShapeQuality | null {
  if (MAJOR_FORM_KINDS.has(kind)) return "major";
  if (MINOR_FORM_KINDS.has(kind)) return "minor";
  if (DIM_FORM_KINDS.has(kind)) return "dim";
  return null;
}

// 指板(0〜maxFret)に収まる範囲で、シェイプの音の位置を返す。
export function shapeNotes(name: ShapeName, root: number, quality: ShapeQuality, maxFret = 12): { start: number; notes: ShapeNote[] } {
  const { key, form } = SHAPES[name];
  const start = (((root - key) % 12) + 12) % 12;
  const rel = Object.entries(form).map(([s, [r, role]]) => ({
    s: Number(s),
    r: (quality !== "major" && role === "3" ? r - 1 : r) - (quality === "dim" && role === "5" ? 1 : 0),
    role,
  }));
  // マイナーで開放位置より下に出る場合は、1オクターブ上の位置を使う
  const base = start + Math.min(...rel.map((n) => n.r)) < 0 ? start + 12 : start;
  return {
    start: base,
    notes: rel.map((n) => ({ s: n.s, f: base + n.r, role: n.role })).filter((n) => n.f <= maxFret),
  };
}
