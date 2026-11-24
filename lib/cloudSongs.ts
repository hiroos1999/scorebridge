// ログインした人の「保存した曲」を Supabase に保存する。
// 環境変数(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)が無い環境
// (NAS版など)では cloud = null になり、アプリは今まで通り端末の中だけに保存する。
//
// 表 public.songs は行レベルセキュリティで「本人の行だけ読み書きできる」設定にしてある
// (SQLは Supabase の SQL Editor で作成。user_id は auth.uid() が自動で入る)。

import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import type { ImportedSong } from "@/lib/importStorage";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const cloud: SupabaseClient | null =
  typeof window !== "undefined" && URL && KEY
    ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

export type { Session };

type SongRow = { id: string; name: string; data: Omit<ImportedSong, "id" | "name">; updated_at: string };

export async function sendLoginLink(email: string): Promise<void> {
  if (!cloud) throw new Error("ログインの準備ができていません");
  const { error } = await cloud.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await cloud?.auth.signOut();
}

export async function listCloudSongs(): Promise<ImportedSong[]> {
  if (!cloud) return [];
  const { data, error } = await cloud.from("songs").select("id, name, data, updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as SongRow[]).map((r) => ({ ...r.data, id: r.id, name: r.name }));
}

export async function saveCloudSong(song: ImportedSong): Promise<void> {
  if (!cloud) throw new Error("ログインしていません");
  const { id, name, ...rest } = song;
  const { error } = await cloud.from("songs").upsert({ id, name, data: rest, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteCloudSong(id: string): Promise<void> {
  if (!cloud) return;
  const { error } = await cloud.from("songs").delete().eq("id", id);
  if (error) throw error;
}

// 退会: 自分の曲をすべて消す(アカウント自体の削除は管理画面から行う)
export async function deleteAllCloudSongs(): Promise<void> {
  if (!cloud) return;
  const { data } = await cloud.auth.getUser();
  if (!data.user) return;
  const { error } = await cloud.from("songs").delete().eq("user_id", data.user.id);
  if (error) throw error;
}
