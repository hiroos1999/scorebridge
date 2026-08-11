// components/StaffToFretboard.tsx と lib/templates.ts の両方から参照する共通データ。
// どちらか一方の中に置くと、StaffToFretboard→lib/templates(TEMPLATES)と
// lib/templates→StaffToFretboard(CHORD_TYPES)の循環importになり、モジュール
// 初期化順序次第でCHORD_TYPESがundefinedのまま参照されてしまうため、
// 依存の向きが片方向で済むよう独立ファイルに切り出している。

// 基本的な7thコード（ルートからの半音間隔）。
export const CHORD_TYPES: Record<string, number[]> = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "7": [0, 4, 7, 10],
  dim: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
};
