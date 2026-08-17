// インポートしたMusicXMLの変換結果を、ブラウザのIndexedDBにのみ保存する。
// サーバーには一切送信しない（fetch等は使わない）。ネイティブのindexedDB APIを
// 薄くPromise化した自前ラッパーで、追加npm依存は無い。

import type { Measure, TimeSignature } from "@/components/StaffToFretboard";

export type ImportedSong = {
  id: string;
  name: string; // ユーザーが分かりやすいよう付ける曲名（デフォルトはファイル名から拡張子を除いたもの）
  fileName: string; // 元のファイル名（参考表示用）
  importedAt: number; // Date.now()
  root: number;
  useFlats: boolean;
  timeSig: TimeSignature;
  measures: Measure[];
  warnings: string[]; // パーサーの警告（インポート精度の目視確認用）
};

const DB_NAME = "staff-to-fretboard-imports";
const DB_VERSION = 1;
const STORE_NAME = "imports";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("importedAt", "importedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDBを開けませんでした"));
  });
}

export async function saveImportedSong(song: ImportedSong): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(song);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("保存に失敗しました"));
  });
  db.close();
}

export async function listImportedSongs(): Promise<ImportedSong[]> {
  const db = await openDb();
  const songs = await new Promise<ImportedSong[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as ImportedSong[]);
    req.onerror = () => reject(req.error ?? new Error("一覧の取得に失敗しました"));
  });
  db.close();
  // 新しくインポートしたものが上に来るよう降順にする。
  return songs.sort((a, b) => b.importedAt - a.importedAt);
}

export async function deleteImportedSong(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("削除に失敗しました"));
  });
  db.close();
}
