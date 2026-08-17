// MusicXML（.musicxml/.xml、または圧縮形式の.mxl）を、StaffToFretboardの
// Note型・Harmony型・TimeSignatureに変換する、完全クライアントサイドのインポーター。
//
// scripts/musicxml_to_notes.py の移植版（アルゴリズムは同一。ロジックを変更した
// 場合は両方に反映すること）。サーバーには一切送信しない前提のため、ここでの
// 処理は全てブラウザ標準API（DOMParser・DecompressionStream）のみで完結させて
// おり、追加npm依存は無い。
//
// 対応範囲はPython版と同じ:
//   - divisions基準のdurationをグリッド単位（4分音符=4）に変換
//   - <tie>/<slur>による同一小節内タイの統合、小節をまたぐタイは警告付きで別音符のまま
//   - <time-modification>(連符)は警告のみ（グリッド系が2の冪乗細分のみのため丸められる）
//   - <harmony>をHarmony型に変換（<kind>はlib/chords.tsのCHORD_TYPESキーにマッピング、
//     未対応の種類は警告してスキップ）
//   - 曲頭のアウフタクト（弱起）は先頭に休符を足して1小節分に揃える
//   - <repeat>/<ending>（繰り返し記号・番括弧）を実際の演奏順に展開

import type { Harmony, Measure, Note, TimeSignature } from "@/components/StaffToFretboard";

export type MusicXmlImportResult = {
  root: number;
  useFlats: boolean;
  timeSig: TimeSignature;
  measures: Measure[];
  warnings: string[];
};

// ---- rows配列（StaffToFretboard.tsx）と同じ並び。(音名, オクターブ) -> rowIdx ----
const ROW_INDEX: Record<string, number> = {
  "C,6": 0, "B,5": 1, "A,5": 2, "G,5": 3, "F,5": 4,
  "E,5": 5, "D,5": 6, "C,5": 7, "B,4": 8, "A,4": 9,
  "G,4": 10, "F,4": 11, "E,4": 12, "D,4": 13, "C,4": 14,
  "B,3": 15, "A,3": 16, "G,3": 17, "F,3": 18, "E,3": 19,
};
function rowKey(step: string, octave: number): string {
  return `${step},${octave}`;
}

// <root-step>（自然音名）-> ピッチクラス。
const STEP_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// MusicXMLの<kind>テキスト -> lib/chords.ts CHORD_TYPESのキー。
// ここに無い<kind>は変換できない（アプリ側にその和音タイプの定義が無いため）。
const KIND_TO_APP_CHORD: Record<string, string> = {
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  dominant: "7",
  "dominant-seventh": "7",
  "diminished-seventh": "dim",
  diminished: "dim",
  "half-diminished": "m7b5",
  "major-sixth": "6",
  "minor-sixth": "m6",
};

// fifths(五度圏上の位置) -> ルートのピッチクラス。負の値=フラット系。
const FIFTHS_TO_ROOT_PC: Record<number, number> = {
  0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1,
  [-1]: 5, [-2]: 10, [-3]: 3, [-4]: 8, [-5]: 1, [-6]: 6,
};

// ---- .mxl(zip)展開: 最小限のZIP中央ディレクトリリーダー ----
// zipライブラリを使わず、必要な範囲（中央ディレクトリの列挙・STOREDまたは
// DEFLATEエントリの取り出し）だけを実装する。DEFLATE展開はブラウザ標準の
// DecompressionStream('deflate-raw')を使う（追加依存なし）。
type ZipEntry = { name: string; method: number; compSize: number; localHeaderOffset: number };

function findEndOfCentralDirectory(view: DataView): number {
  const SIG = 0x06054b50;
  const minOffset = Math.max(0, view.byteLength - 22 - 65557); // コメント最大長(65535)+固定部
  for (let i = view.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === SIG) return i;
  }
  throw new Error("ZIP: End of Central Directoryが見つかりません（不正な.mxlファイル）");
}

function readCentralDirectory(view: DataView): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(view);
  const cdOffset = view.getUint32(eocd + 16, true);
  const cdEntryCount = view.getUint16(eocd + 10, true);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntryCount; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) {
      throw new Error("ZIP: 中央ディレクトリのシグネチャが不正です");
    }
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLen);
    entries.push({ name: decoder.decode(nameBytes), method, compSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractZipEntry(view: DataView, entry: ZipEntry): Promise<Uint8Array> {
  const p = entry.localHeaderOffset;
  if (view.getUint32(p, true) !== 0x04034b50) {
    throw new Error("ZIP: ローカルファイルヘッダのシグネチャが不正です");
  }
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const dataStart = p + 30 + nameLen + extraLen;
  const compressed = new Uint8Array(view.buffer, view.byteOffset + dataStart, entry.compSize);
  if (entry.method === 0) return compressed.slice();
  if (entry.method === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    // compressed.slice()で独立したArrayBuffer裏付けのUint8Arrayにしてから渡す
    // （view.bufferはDataViewの型上ArrayBufferLikeになり、write()の型と合わないため）。
    void writer.write(compressed.slice());
    void writer.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  throw new Error(`ZIP: 未対応の圧縮方式です(method=${entry.method})`);
}

// .musicxml/.xmlはそのまま、.mxl(zip、マジックバイト"PK"で判定)は
// META-INF/container.xmlからルートファイルを解決して展開する。
async function loadRootDocument(bytes: ArrayBuffer): Promise<Document> {
  const decoder = new TextDecoder("utf-8");
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"

  let xmlText: string;
  if (isZip) {
    const view = new DataView(bytes);
    const entries = readCentralDirectory(view);
    const containerEntry = entries.find((e) => e.name === "META-INF/container.xml");
    if (!containerEntry) throw new Error(".mxl: META-INF/container.xmlが見つかりません");
    const containerDoc = new DOMParser().parseFromString(
      decoder.decode(await extractZipEntry(view, containerEntry)),
      "application/xml"
    );
    const rootfilePath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
    if (!rootfilePath) throw new Error(".mxl: container.xmlにrootfileが見つかりません");
    const rootEntry = entries.find((e) => e.name === rootfilePath);
    if (!rootEntry) throw new Error(`.mxl: ルートファイル"${rootfilePath}"がzip内に見つかりません`);
    xmlText = decoder.decode(await extractZipEntry(view, rootEntry));
  } else {
    xmlText = decoder.decode(bytes);
  }

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error(`MusicXMLのパースに失敗しました: ${parserError.textContent ?? ""}`);
  return doc;
}

// ---- DOM操作ヘルパー（ElementTreeのfind/findallの「直接の子」セマンティクスに合わせる） ----
function directChild(el: Element | null, tag: string): Element | null {
  if (!el) return null;
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].tagName === tag) return el.children[i];
  }
  return null;
}
function directChildren(el: Element | null, tag: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].tagName === tag) out.push(el.children[i]);
  }
  return out;
}
function path(el: Element | null, ...tags: string[]): Element | null {
  let cur = el;
  for (const t of tags) cur = directChild(cur, t);
  return cur;
}
function textOf(el: Element | null): string | null {
  return el?.textContent ?? null;
}
function requireText(el: Element | null, context: string): string {
  const t = textOf(el);
  if (t === null) throw new Error(`MusicXML: ${context}が見つかりません（想定外の構造）`);
  return t;
}

// ---- 繰り返し記号・番括弧の展開 ----
type RepeatMeta = {
  repeatForward: boolean;
  repeatBackward: boolean;
  repeatBackwardTimes: number;
  endingNumbers: Set<number> | null;
};

function expandRepeatOrder(repeatMeta: RepeatMeta[]): number[] {
  const order: number[] = [];
  const n = repeatMeta.length;
  let i = 0;
  let repeatStart = 0;
  let passNum = 1;
  const backwardJumpCount = new Map<number, number>();
  let guard = 0;
  while (i < n) {
    guard++;
    if (guard > (n + 1) * 8) break; // 矛盾したrepeat/ending指定での無限ループ防止
    const m = repeatMeta[i];
    if (m.repeatForward) repeatStart = i;
    const endings = m.endingNumbers;
    if (endings === null || endings.has(passNum)) order.push(i);
    if (m.repeatBackward) {
      const done = backwardJumpCount.get(i) ?? 0;
      if (done < m.repeatBackwardTimes - 1) {
        backwardJumpCount.set(i, done + 1);
        passNum++;
        i = repeatStart;
        continue;
      }
    }
    i++;
  }
  return order;
}

type RawNote = {
  startGrid: number;
  duration: number;
  isRest: boolean;
  rowIdx: number | null;
  accidental: number | null;
  tieStart: boolean;
  tieStop: boolean;
};
type RawHarmony = { offsetGrid: number; root: number; kind: string; inversion: number };

function parseScoreDocument(doc: Document, gridsPerQuarter = 4): MusicXmlImportResult {
  const part = doc.querySelector("part");
  if (!part) throw new Error("<part>要素が見つかりません（想定外のMusicXML構造）");

  let divisions = 1;
  let fifths: number | null = null;
  let timeBeats: number | null = null;
  let timeBeatType: number | null = null;
  const warnings: string[] = [];

  const rawMeasures: RawNote[][] = [];
  const rawHarmonies: RawHarmony[][] = [];
  const rawRepeatMeta: RepeatMeta[] = [];

  const measureEls = directChildren(part, "measure");
  measureEls.forEach((measureEl, mIdx) => {
    for (const attrs of directChildren(measureEl, "attributes")) {
      const divEl = directChild(attrs, "divisions");
      if (divEl) divisions = Number(textOf(divEl));
      const fifthsEl = path(attrs, "key", "fifths");
      if (fifthsEl && fifths === null) fifths = Number(textOf(fifthsEl));
      const beatsEl = path(attrs, "time", "beats");
      const beatTypeEl = path(attrs, "time", "beat-type");
      if (beatsEl && beatTypeEl && timeBeats === null) {
        timeBeats = Number(textOf(beatsEl));
        timeBeatType = Number(textOf(beatTypeEl));
      }
    }

    const rawNotes: RawNote[] = [];
    const harmonies: RawHarmony[] = [];
    let grid = 0;
    let repeatForward = false;
    let repeatBackward = false;
    let repeatBackwardTimes = 2; // <repeat backward>のtimes属性省略時は2回=1回だけ折り返す
    let endingNumbers: Set<number> | null = null;

    const xmlDurToGrids = (xmlDuration: number) => Math.max(Math.round((xmlDuration / divisions) * gridsPerQuarter), 1);

    for (const child of Array.from(measureEl.children)) {
      if (child.tagName === "backup") {
        grid -= xmlDurToGrids(Number(requireText(directChild(child, "duration"), `小節${mIdx + 1}: backupのduration`)));
      } else if (child.tagName === "forward") {
        grid += xmlDurToGrids(Number(requireText(directChild(child, "duration"), `小節${mIdx + 1}: forwardのduration`)));
      } else if (child.tagName === "barline") {
        const repeatEl = directChild(child, "repeat");
        if (repeatEl) {
          const direction = repeatEl.getAttribute("direction");
          if (direction === "forward") {
            repeatForward = true;
          } else if (direction === "backward") {
            repeatBackward = true;
            const timesAttr = repeatEl.getAttribute("times");
            if (timesAttr !== null) repeatBackwardTimes = Number(timesAttr);
          }
        }
        for (const endingEl of directChildren(child, "ending")) {
          const numbersAttr = (endingEl.getAttribute("number") ?? "").replace(/\s+/g, "");
          const numbers = numbersAttr
            .split(",")
            .filter((n) => /^\d+$/.test(n))
            .map(Number);
          if (numbers.length > 0) {
            endingNumbers = new Set([...(endingNumbers ?? []), ...numbers]);
          }
        }
      } else if (child.tagName === "harmony") {
        const rootStepEl = path(child, "root", "root-step");
        if (!rootStepEl) {
          warnings.push(`小節${mIdx + 1}: <harmony>にroot-stepが無いためスキップしました`);
          continue;
        }
        const rootAlterEl = path(child, "root", "root-alter");
        const rootAlter = rootAlterEl ? Math.trunc(Number(textOf(rootAlterEl))) : 0;
        const rootPc = (((STEP_TO_PC[requireText(rootStepEl, "root-step")] + rootAlter) % 12) + 12) % 12;

        const kindEl = directChild(child, "kind");
        const kindText = textOf(kindEl);
        const appKind = kindText ? KIND_TO_APP_CHORD[kindText] : undefined;
        if (!appKind) {
          warnings.push(
            `小節${mIdx + 1}: コード種別 "${kindText}" はアプリ未対応のためこのharmonyをスキップしました` +
              "（lib/chords.tsのCHORD_TYPESに追加すれば対応可能）"
          );
          continue;
        }
        harmonies.push({ offsetGrid: grid, root: rootPc, kind: appKind, inversion: 0 });
      } else if (child.tagName === "note") {
        const durEl = directChild(child, "duration");
        if (!durEl) {
          warnings.push(`小節${mIdx + 1}: duration無しのnote要素をスキップ（装飾音符の可能性）`);
          continue;
        }
        const duration = xmlDurToGrids(Number(textOf(durEl)));

        if (directChild(child, "chord")) {
          warnings.push(`小節${mIdx + 1}: <chord/>（和音）は単旋律採譜スクリプトでは未対応のため無視しました`);
          continue;
        }

        if (directChild(child, "rest")) {
          rawNotes.push({ startGrid: grid, duration, isRest: true, rowIdx: null, accidental: null, tieStart: false, tieStop: false });
          grid += duration;
          continue;
        }

        const pitchEl = directChild(child, "pitch");
        if (!pitchEl) {
          warnings.push(`小節${mIdx + 1}: pitchもrestも無いnote要素をスキップ`);
          continue;
        }
        const step = requireText(directChild(pitchEl, "step"), `小節${mIdx + 1}: pitchのstep`);
        const octave = Number(requireText(directChild(pitchEl, "octave"), `小節${mIdx + 1}: pitchのoctave`));
        const alterEl = directChild(pitchEl, "alter");
        const accidental = alterEl ? Math.trunc(Number(textOf(alterEl))) : 0;

        const key = rowKey(step, octave);
        if (!(key in ROW_INDEX)) {
          warnings.push(
            `小節${mIdx + 1}: ${step}${octave}はrows配列の範囲外(C6〜E3)のため変換できませんでした` +
              "（最も近い音に手動で置き換えてください）"
          );
          grid += duration;
          continue;
        }

        // <tie>だけでなく<notations><slur></notations>もタイ候補として拾う
        // （OMRツールがタイをslurとして出力することがあるため）。
        const notationsEl = directChild(child, "notations");
        const slurEls = directChildren(notationsEl, "slur");
        const tupletEls = directChildren(notationsEl, "tuplet");
        if (tupletEls.length > 0) {
          warnings.push(
            `小節${mIdx + 1}: 連符（tuplet）を検出しました。グリッド系は2の冪乗細分のみのため、` +
              "丸められたタイミングで取り込まれます（既知の制約）"
          );
        }
        const tieEls = directChildren(child, "tie");
        const tieStart = tieEls.some((t) => t.getAttribute("type") === "start") || slurEls.some((s) => s.getAttribute("type") === "start");
        const tieStop = tieEls.some((t) => t.getAttribute("type") === "stop") || slurEls.some((s) => s.getAttribute("type") === "stop");

        rawNotes.push({ startGrid: grid, duration, isRest: false, rowIdx: ROW_INDEX[key], accidental, tieStart, tieStop });
        grid += duration;
      }
    }

    // ---- アウフタクト（弱起）対応 ----
    // 曲頭の小節だけを対象に、実際の中身が1小節分に満たない場合は先頭に休符を
    // 足して1小節分の長さに揃える（Measure型は全小節が同じグリッド数である前提の
    // ため、可変長の小節そのものは表現できない。再生タイミングは正しく、見た目
    // だけ本来の記譜と異なる、既知のトレードオフ）。
    if (mIdx === 0) {
      const isImplicit = measureEl.getAttribute("implicit") === "yes";
      const gridsPerMeasureForPickup = gridsPerQuarter * Math.floor(((timeBeats ?? 4) * 4) / (timeBeatType ?? 4));
      const contentGrids = grid;
      if (contentGrids > 0 && contentGrids < gridsPerMeasureForPickup && (isImplicit || contentGrids > 0)) {
        const padding = gridsPerMeasureForPickup - contentGrids;
        rawNotes.forEach((n) => (n.startGrid += padding));
        harmonies.forEach((h) => (h.offsetGrid += padding));
        rawNotes.unshift({ startGrid: 0, duration: padding, isRest: true, rowIdx: null, accidental: null, tieStart: false, tieStop: false });
        warnings.push(
          `小節1: アウフタクト（弱起）を検出しました。${contentGrids}グリッド分の実音の前に${padding}グリッドの休符を挿入し、` +
            "1小節分の長さに揃えました（可変長の小節はデータモデル上表現できないため。再生タイミングは正しく、見た目だけ本来の記譜と異なります）"
        );
      }
    }

    rawMeasures.push(rawNotes);
    rawHarmonies.push(harmonies);
    rawRepeatMeta.push({ repeatForward, repeatBackward, repeatBackwardTimes, endingNumbers });
  });

  // ---- 繰り返し記号・番括弧の展開 ----
  const playOrder = expandRepeatOrder(rawRepeatMeta);
  if (playOrder.length !== rawRepeatMeta.length) {
    const diff = playOrder.length - rawRepeatMeta.length;
    warnings.push(
      `繰り返し記号・番括弧を展開し、元${rawRepeatMeta.length}小節 → 演奏順${playOrder.length}小節` +
        `（差分${diff >= 0 ? "+" : ""}${diff}）に並べ替えました。`
    );
  }
  const orderedRawMeasures = playOrder.map((i) => rawMeasures[i]);
  const orderedRawHarmonies = playOrder.map((i) => rawHarmonies[i]);

  // ---- 2nd pass: 同じ小節内で閉じているタイだけをマージする ----
  const measuresOut: Measure[] = [];
  orderedRawMeasures.forEach((rawNotes, mIdx) => {
    const merged: Note[] = [];
    let i = 0;
    while (i < rawNotes.length) {
      const n = rawNotes[i];
      const nxt = rawNotes[i + 1];
      if (!n.isRest && n.tieStart && nxt && !nxt.isRest && nxt.rowIdx === n.rowIdx && nxt.accidental === n.accidental) {
        merged.push({
          startGrid: n.startGrid,
          duration: n.duration + nxt.duration,
          isRest: false,
          rowIdxList: [n.rowIdx as number],
          accidentals: { [n.rowIdx as number]: n.accidental as number },
        });
        i += 2;
        continue;
      }
      if (!n.isRest && n.tieStart && !(nxt && nxt.tieStop)) {
        warnings.push(
          `小節${playOrder[mIdx] + 1}(演奏順${mIdx + 1}小節目): 小節をまたぐタイ（または対応するtie stopが同じ小節内に無いタイ）を検出しました。` +
            "Note型では1音に結合できないため2つの別音符のまま出力します。再生時に本来無いはずの再アタックが入ります。"
        );
      }
      if (n.isRest) {
        merged.push({ startGrid: n.startGrid, duration: n.duration, isRest: true, rowIdxList: [], accidentals: {} });
      } else {
        merged.push({
          startGrid: n.startGrid,
          duration: n.duration,
          isRest: false,
          rowIdxList: [n.rowIdx as number],
          accidentals: { [n.rowIdx as number]: n.accidental as number },
        });
      }
      i += 1;
    }
    const harmonies: Harmony[] = orderedRawHarmonies[mIdx].map((h) => ({ ...h }));
    measuresOut.push({ notes: merged, harmonies });
  });

  const keyRoot = fifths !== null ? (FIFTHS_TO_ROOT_PC[fifths] ?? 0) : 0;
  const useFlats = fifths !== null && fifths < 0;
  const timeSig: TimeSignature = { numerator: timeBeats ?? 4, denominator: timeBeatType ?? 4 };

  return { root: keyRoot, useFlats, timeSig, measures: measuresOut, warnings };
}

// 呼び出し側（UI）から使うエントリーポイント。ファイルの中身(ArrayBuffer)を
// 受け取り、パース結果を返す。サーバーには一切送信しない（fetch等は使わない）。
export async function parseMusicXmlFile(bytes: ArrayBuffer, gridsPerQuarter = 4): Promise<MusicXmlImportResult> {
  const doc = await loadRootDocument(bytes);
  return parseScoreDocument(doc, gridsPerQuarter);
}
