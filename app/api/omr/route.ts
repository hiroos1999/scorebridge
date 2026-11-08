// 楽譜画像/PDF → Audiveris(OMR) → MusicXML 変換API。localhost(自分のMac)での利用が前提。
// Audiveris本体は別途インストールが必要。実行ファイルは環境変数 AUDIVERIS_CMD で指定する。
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_CMD = "/Applications/Audiveris.app/Contents/MacOS/Audiveris";
const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 280_000;
// Audiveris は 2,000万画素超の画像を拒否する（"Too large image"）。余裕を見て1,800万画素以下に縮小する。
const MAX_PIXELS = 18_000_000;
const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".pdf"]);

function fail(status: number, error: string, detail?: string) {
  return Response.json({ error, detail: detail ?? "" }, { status });
}

// macOS標準の sips で大きい画像を縮小する（JPEG/PNGのみ。sipsが無い環境では何もしない）。
async function shrinkIfTooLarge(imgPath: string): Promise<string> {
  try {
    const info = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", imgPath]);
    const w = Number(/pixelWidth:\s*(\d+)/.exec(info.log)?.[1]);
    const h = Number(/pixelHeight:\s*(\d+)/.exec(info.log)?.[1]);
    if (!w || !h || w * h <= MAX_PIXELS) return "";
    const scale = Math.sqrt(MAX_PIXELS / (w * h));
    const longSide = Math.floor(Math.max(w, h) * scale);
    const r = await run("/usr/bin/sips", ["-Z", String(longSide), imgPath]);
    return r.code === 0 ? `画像を ${w}x${h} から縮小しました（長辺 ${longSide}px）。\n` : "";
  } catch {
    return "";
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function run(cmd: string, args: string[]): Promise<{ code: number | null; log: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let head = "";
    let tail = "";
    let timedOut = false;
    const cap = (d: Buffer) => {
      const t = d.toString();
      if (head.length < 3000) head += t;
      tail = (tail + t).slice(-5000);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const log = head.length >= 3000 && tail.length >= 5000 ? `${head.slice(0, 3000)}\n…（中略）…\n${tail}` : head.length < 3000 ? head : tail;
      resolve({ code, log, timedOut });
    });
  });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "アップロードを読み取れませんでした。");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "file が指定されていません。");
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) return fail(400, `未対応の形式です（${ext || "拡張子なし"}）。JPEG / PNG / PDF を選んでください。`);
  if (file.size === 0) return fail(400, "ファイルが空です。");
  if (file.size > MAX_BYTES) return fail(413, "ファイルが大きすぎます（上限50MB）。");

  const cmd = process.env.AUDIVERIS_CMD || DEFAULT_CMD;
  try {
    await stat(cmd);
  } catch {
    return fail(
      500,
      "Audiveris が見つかりません。",
      `探した場所: ${cmd}\nインストール後、環境変数 AUDIVERIS_CMD に実行ファイルのパスを設定して dev サーバーを再起動してください。`,
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), "omr-"));
  try {
    const inPath = path.join(dir, `input${ext}`);
    const outDir = path.join(dir, "out");
    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));

    let note = "";
    if (ext !== ".pdf") note = await shrinkIfTooLarge(inPath);

    let result;
    try {
      // 画像は1枚=1シート。iPhone写真などに含まれる副画像を別シートとして数えて失敗するのを避けるため、
      // 画像では1枚目だけを処理する（PDFは全ページ）。
      const sheetArgs = ext === ".pdf" ? [] : ["-sheets", "1"];
      result = await run(cmd, ["-batch", "-export", ...sheetArgs, "-output", outDir, "--", inPath]);
    } catch (e) {
      return fail(500, "Audiveris を起動できませんでした。", e instanceof Error ? e.message : String(e));
    }
    if (result.timedOut) return fail(504, "変換がタイムアウトしました。ページ数を減らして試してください。", result.log);

    let files: string[] = [];
    try {
      files = (await walk(outDir)).filter((p) => /\.(mxl|musicxml|xml)$/i.test(p));
    } catch {
      /* 出力なし */
    }
    if (files.length === 0) {
      return fail(
        422,
        result.code === 0 ? "楽譜を認識できませんでした（MusicXMLが出力されませんでした）。" : `Audiveris が失敗しました（終了コード ${result.code}）。`,
        note + result.log,
      );
    }
    files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const payload = await Promise.all(
      files.map(async (p) => ({ name: path.basename(p), data: (await readFile(p)).toString("base64") })),
    );
    return Response.json({ files: payload, log: note + result.log });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
