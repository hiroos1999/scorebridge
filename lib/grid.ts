// components/StaffToFretboard.tsx と lib/musicxmlImport.ts の両方から参照する、
// 3連符対応のためのグリッド計算ヘルパー（lib/chords.tsと同じく、循環importを
// 避けるため独立ファイルに切り出している）。
//
// Note.durationは常に「記譜上の音価」（8分3連符なら8分音符=2）のまま持ち、
// 3連符(triplet)の場合だけ、実際に占める長さがその2/3になる。そのため3連符を
// 含む小節ではstartGridが1/3グリッド刻みの小数になる。浮動小数点の誤差で
// startGrid同士の等値比較（選択中の音符の特定・連桁の連続判定等）が狂わないよう、
// グリッド位置を足し引きした結果は必ずsnapGridで1/3刻みに正規化してから使う。

export function snapGrid(grid: number): number {
  return Math.round(grid * 3) / 3;
}

// 音符・休符が実際に占めるグリッド数（3連符なら記譜上の音価の2/3）。
export function noteSpan(note: { duration: number; triplet?: boolean }): number {
  return note.triplet ? snapGrid((note.duration * 2) / 3) : note.duration;
}
