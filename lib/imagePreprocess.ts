// 楽譜写真をOMR向けに整える（ブラウザ内で完結）。
// 向き補正 → 長辺4000px以下に縮小 → グレースケール → コントラスト自動補正 → JPEG化。
// 失敗した場合は元のファイルをそのまま返す。
const MAX_LONG_SIDE = 4000;

export type PreprocessResult = { file: File; note: string };

export async function preprocessScoreImage(file: File): Promise<PreprocessResult> {
  if (!/^image\/(jpeg|png|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|heic|heif)$/i.test(file.name)) {
    return { file, note: "" };
  }
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { file, note: "" };
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    // 下位1%を黒、上位30%付近を白とみなして伸長（紙の地色を白に寄せる）
    const total = w * h;
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.7) { hi = v; break; } }
    if (hi - lo < 32) hi = Math.min(255, lo + 32);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = ((v - lo) / (hi - lo)) * 255;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
    ctx.putImageData(img, 0, 0);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return { file, note: "" };
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return {
      file: new File([blob], name, { type: "image/jpeg" }),
      note: `写真を補正しました（${w}x${h}、グレースケール＋コントラスト調整）。`,
    };
  } catch {
    return { file, note: "" };
  }
}
