// 指板で押さえた音から、コード名(型+テンション)を判別する。
//
// 方針: 押さえた音をピッチクラスの集まりにし、その中の各音を「ルート」と仮定して
// 度数に直す。度数の組み合わせを型(三和音・四和音)とテンションに分け、
// 「どれだけすっきり説明できるか」で点数を付けて上位を返す。
// 外部のAIは使わず、端末の中だけで瞬時に計算する。

export type Tension = { degree: 9 | 11 | 13; alter: -1 | 0 | 1 };

export type ChordCandidate = {
  root: number; // ルートのピッチクラス
  quality: string; // "", "m", "7", "maj7", "m7", "m7b5", "dim", "dim7", "6", "m6", "mMaj7", "sus4", "7sus4", "aug"
  tensions: Tension[];
  bass: number | null; // ルートと違う最低音(分数コード)。同じならnull
  intervals: number[]; // ルートからの半音間隔(テンション込み、重複なし、昇順)
  appKind: string; // アプリの既存の型(lib/chords.tsのCHORD_TYPES)のうち一番近いもの
  suffix: string; // 表示用の名前(ルート名を除く)。例 "7(♭9)" "m7(♭5)" "△7"
  score: number;
};

const QUALITY_LABEL: Record<string, string> = {
  "": "",
  m: "m",
  "7": "7",
  maj7: "△7",
  m7: "m7",
  m7b5: "m7(♭5)",
  dim: "dim",
  dim7: "dim7",
  "6": "6",
  m6: "m6",
  mMaj7: "m△7",
  mMaj7b5: "m△7(♭5)",
  sus4: "sus4",
  "7sus4": "7sus4",
  aug: "aug",
};

// 既存の8種類(CHORD_TYPES)への寄せ方。再生の伴奏とCAGED表示に使う。
const APP_KIND: Record<string, string> = {
  "": "6",
  m: "m7",
  "7": "7",
  maj7: "maj7",
  m7: "m7",
  m7b5: "m7b5",
  dim: "dim",
  dim7: "dim",
  "6": "6",
  m6: "m6",
  mMaj7: "mMaj7",
  mMaj7b5: "mMaj7",
  sus4: "7",
  "7sus4": "7",
  aug: "7",
};

const ALTER_MARK: Record<number, string> = { [-1]: "♭", 0: "", 1: "♯" };

function tensionText(t: Tension): string {
  return `${ALTER_MARK[t.alter]}${t.degree}`;
}

// ジャズの譜面でよく見る書き方に寄せる。
// 7+9 → 9、7+9+13 → 13、m7+9 → m9 のように、自然なテンションだけなら数字で書き、
// 変化したテンション(♭9 ♯11 ♭13など)が入るときはカッコで添える。
export function chordSuffix(quality: string, tensions: Tension[]): string {
  const sorted = [...tensions].sort((a, b) => a.degree - b.degree);
  const allNatural = sorted.every((t) => t.alter === 0);
  const degs = sorted.map((t) => t.degree).join(",");
  if (allNatural && sorted.length > 0) {
    const top: Record<string, string> = { "9": "9", "9,11": "11", "9,13": "13", "9,11,13": "13", "13": "13" };
    const up = top[degs];
    if (up && quality === "7") return up;
    if (up && quality === "m7") return `m${up}`;
    if (up && quality === "maj7") return `△${up}`;
    if (degs === "9" && quality === "6") return "6(9)";
    if (degs === "9" && quality === "m6") return "m6(9)";
  }
  const base = QUALITY_LABEL[quality] ?? quality;
  if (sorted.length === 0) return base;
  // m7(♭5)にテンションが付くときは (♭5) と一緒に並べる
  if (quality === "m7b5") return `m7(♭5 ${sorted.map(tensionText).join(" ")})`;
  return `${base}(${sorted.map(tensionText).join(" ")})`;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

// キーのダイアトニックコード(長調)。度数(キーの主音からの半音数) → その度数の上で自然な型
const DIATONIC: Record<number, string[]> = {
  0: ["", "maj7", "6"],
  2: ["m", "m7", "m6"],
  4: ["m", "m7"],
  5: ["", "maj7", "6"],
  7: ["", "7", "sus4", "7sus4"],
  9: ["m", "m7"],
  11: ["dim", "m7b5"],
};

// ダイアトニックコードそのもの(ルートも型も合う)を一番優先し、
// ルートだけがキーの音のもの(セカンダリー・ドミナントなど)をその次にする
function keyBonus(root: number, quality: string, keyRoot: number | null): number {
  if (keyRoot === null) return 0;
  const deg = (root - keyRoot + 12) % 12;
  if (DIATONIC[deg]?.includes(quality)) return 1.8;
  if (MAJOR_SCALE.includes(deg)) return 0.5;
  return 0;
}

function analyzeRoot(intervals: Set<number>): { quality: string; tensions: Tension[]; leftover: number; score: number } | null {
  const has = (i: number) => intervals.has(i);
  const used = new Set<number>([0]);
  let score = 0;
  let quality = "";
  const tensions: Tension[] = [];

  // 3度
  let third: "M" | "m" | "sus4" | null = null;
  if (has(4)) {
    third = "M";
    used.add(4);
  } else if (has(3)) {
    third = "m";
    used.add(3);
  } else if (has(5)) {
    third = "sus4";
    used.add(5);
  }
  if (third === "M" || third === "m") score += 3;
  else if (third === "sus4") score += 1;
  else score -= 2;

  // 5度
  let fifth: "P" | "b5" | "#5" | null = null;
  if (has(7)) {
    fifth = "P";
    used.add(7);
    score += 0.5;
  } else if (third === "m" && has(6)) {
    fifth = "b5";
    used.add(6);
  } else if (third === "M" && has(8) && !has(10) && !has(11)) {
    fifth = "#5";
    used.add(8);
  }

  // 7度(または6度)
  let seventh: "b7" | "M7" | "6" | "bb7" | null = null;
  if (has(10)) {
    seventh = "b7";
    used.add(10);
  } else if (has(11)) {
    seventh = "M7";
    used.add(11);
  } else if (has(9) && third === "m" && fifth === "b5") {
    seventh = "bb7";
    used.add(9);
  } else if (has(9) && (third === "M" || third === "m")) {
    seventh = "6";
    used.add(9);
  }
  if (seventh) score += 1.5;

  // 型を決める
  if (third === "M") {
    if (fifth === "#5" && !seventh) quality = "aug";
    else if (seventh === "b7") quality = "7";
    else if (seventh === "M7") quality = "maj7";
    else if (seventh === "6") quality = "6";
    else quality = "";
  } else if (third === "m") {
    if (fifth === "b5") {
      if (seventh === "b7") quality = "m7b5";
      else if (seventh === "bb7") quality = "dim7";
      else if (seventh === "M7") quality = "mMaj7b5"; // めったに使わない型なので下で減点
      else quality = "dim";
    } else if (seventh === "b7") quality = "m7";
    else if (seventh === "M7") quality = "mMaj7";
    else if (seventh === "6") quality = "m6";
    else quality = "m";
  } else if (third === "sus4") {
    quality = seventh === "b7" ? "7sus4" : "sus4";
  } else {
    return null; // 3度もsus4も無いものは判別しない(パワーコード等)
  }

  // 残りの音をテンションとして読む
  const addT = (i: number, t: Tension) => {
    if (has(i) && !used.has(i)) {
      tensions.push(t);
      used.add(i);
      score -= 0.6;
    }
  };
  addT(1, { degree: 9, alter: -1 });
  addT(2, { degree: 9, alter: 0 });
  if (third === "M") addT(3, { degree: 9, alter: 1 });
  if (third !== "sus4") addT(5, { degree: 11, alter: 0 });
  addT(6, { degree: 11, alter: 1 });
  addT(8, { degree: 13, alter: -1 });
  if (seventh === "b7" || seventh === "M7") addT(9, { degree: 13, alter: 0 });

  // 説明できない音が残ったら大きく減点
  let leftover = 0;
  intervals.forEach((i) => {
    if (!used.has(i)) leftover++;
  });
  score -= leftover * 3;
  // 三和音で♭9や♭13のような変化テンションだけが付くのは不自然
  if (!seventh && tensions.some((t) => t.alter !== 0)) score -= 1.2;
  // 三和音にテンションを足した読み方より、素直な転回形(分数コード)を優先する
  if (!seventh && tensions.length > 0 && !(tensions.length === 1 && tensions[0].degree === 9 && tensions[0].alter === 0)) score -= 2;
  if (tensions.length === 0) score += 0.5;
  if (quality === "mMaj7b5") score -= 1;
  return { quality, tensions, leftover, score };
}

/**
 * pitches: 押さえた音の絶対ピッチ(どの高さでもよい。最低音を分数コードの判定に使う)
 * keyRoot: 曲のキー(長調の主音のピッチクラス)。候補の順位付けに使う
 */
/**
 * opts.lowBass: 最低音が5弦か6弦のときだけtrue。分数コード(/B など)はこのときだけ名前に付け、
 *   最低音がルートかどうかも順位に使う(4弦より上だけで押さえた形は、最低音にこだわらない)
 */
export function detectChords(pitches: number[], keyRoot: number | null, limit = 3, opts: { lowBass?: boolean } = {}): ChordCandidate[] {
  const lowBass = opts.lowBass ?? true;
  if (pitches.length < 2) return [];
  const pcs = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
  if (pcs.size < 2) return [];
  const bassPc = ((Math.min(...pitches) % 12) + 12) % 12;
  const out: ChordCandidate[] = [];
  pcs.forEach((root) => {
    const intervals = new Set<number>();
    pcs.forEach((p) => intervals.add((p - root + 12) % 12));
    const a = analyzeRoot(intervals);
    if (!a || a.leftover > 0) return;
    let score = a.score;
    if (lowBass && root === bassPc) score += 3; // 最低音(5弦・6弦)がルート
    score += keyBonus(root, a.quality, keyRoot);
    // 2音だけなら3度が無いと決められないので、確信度を下げる
    if (pcs.size === 2) score -= 2;
    out.push({
      root,
      quality: a.quality,
      tensions: a.tensions,
      bass: !lowBass || root === bassPc ? null : bassPc,
      intervals: [...intervals].sort((x, y) => x - y),
      appKind: APP_KIND[a.quality] ?? "7",
      suffix: chordSuffix(a.quality, a.tensions),
      score,
    });
  });
  // ルートを弾かない7th(ルートレス・ボイシング)。3度と♭7(ガイドトーン)がそろい、
  // 残りがテンションで説明できるときだけ候補にする。例: B・F・A♭・E → G7(♭9 13)
  if (pcs.size >= 3) {
    for (let root = 0; root < 12; root++) {
      if (pcs.has(root)) continue;
      const intervals = new Set<number>([0]);
      pcs.forEach((p) => intervals.add((p - root + 12) % 12));
      if (!intervals.has(4) || !intervals.has(10)) continue;
      const a = analyzeRoot(intervals);
      if (!a || a.leftover > 0 || a.quality !== "7") continue;
      let score = a.score - 1 + 1.5; // ルートが無い分を減点、ガイドトーンがそろう分を加点
      score += keyBonus(root, a.quality, keyRoot);
      // ルート抜きの読み方は、ルートを弾いた読み方と比べて最低音の加点が無いぶん不利なので、少し戻す
      if (!lowBass) score += 0.5;
      out.push({
        root,
        quality: a.quality,
        tensions: a.tensions,
        bass: null,
        intervals: [...intervals].sort((x, y) => x - y),
        appKind: "7",
        suffix: chordSuffix(a.quality, a.tensions),
        score,
      });
    }
  }
  out.sort((x, y) => y.score - x.score);

  // ディミニッシュ7th(4音)は、ルートを省いた7(♭9)としても読める。
  // 例: A♭dim7 = G7(♭9)のルート抜き。各音の半音下をルートとする4つの7(♭9)を候補に足し、
  // 曲のキーのV(ドミナント)に当たるものを一番上に、キーの音の上のものをその次に置く。
  // 同じディミニッシュの転回形(Bdim7/A♭など)は名前が増えるだけなので外す。
  const top = out[0];
  if (top && top.quality === "dim7" && pcs.size === 4) {
    const doms: ChordCandidate[] = [];
    pcs.forEach((p) => {
      const r = (p + 11) % 12;
      let score = top.score - 0.5;
      if (keyRoot !== null) {
        const deg = (r - keyRoot + 12) % 12;
        if (deg === 7) score += 2.2;
        else if (MAJOR_SCALE.includes(deg)) score += 0.3;
      }
      const tensions: Tension[] = [{ degree: 9, alter: -1 }];
      doms.push({
        root: r,
        quality: "7",
        tensions,
        bass: null,
        intervals: [0, 1, 4, 7, 10],
        appKind: "7",
        suffix: chordSuffix("7", tensions),
        score,
      });
    });
    const domRoots = new Set(doms.map((d) => d.root));
    const rest = out.filter((c) => (c.quality !== "dim7" || c === top) && !(c.quality === "7" && domRoots.has(c.root)));
    rest.push(...doms);
    rest.sort((x, y) => y.score - x.score);
    return rest.slice(0, Math.max(limit, 4));
  }
  // 1位と比べて明らかに不自然な読み方は候補に出さない
  const best = out[0]?.score ?? 0;
  // ルートレスの読み方は、素直な読み方より明らかに下なら出さない(裏コードの言い換えが増えすぎるため)
  return out
    .filter((c, i) => i === 0 || (c.score >= best - (pcs.has(c.root) ? 4 : 2) && c.score > 2))
    .slice(0, limit);
}
