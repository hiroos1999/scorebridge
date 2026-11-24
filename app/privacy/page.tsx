import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー — ScoreBridge",
};

// 下書き。[ ] の部分は公開前に埋める。
export default function PrivacyPage() {
  const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, margin: "32px 0 8px" };
  const p: React.CSSProperties = { lineHeight: 1.8, margin: "0 0 12px" };
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px", color: "var(--text-primary)" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>プライバシーポリシー</h1>
      <p style={{ ...p, color: "var(--text-secondary)" }}>制定日: [2026年◯月◯日]</p>

      <p style={p}>
        ScoreBridge(以下「本サービス」)の運営者 [運営者名](以下「運営者」)は、利用者の情報を次のとおり取り扱います。
      </p>

      <h2 style={h2}>1. 集める情報</h2>
      <p style={p}>ログインした場合に限り、次の情報を保存します。ログインせずに使う場合、作った譜面はお使いの端末の中だけに保存され、運営者には送られません。</p>
      <ul style={{ ...p, paddingLeft: 24 }}>
        <li>メールアドレス(ログインに使います)</li>
        <li>登録日時、最後にログインした日時</li>
        <li>保存した曲(曲名、メロディ、コード、キー、拍子、指板で入力した押さえ方)</li>
      </ul>

      <h2 style={h2}>2. 使い道</h2>
      <ul style={{ ...p, paddingLeft: 24 }}>
        <li>ログインと、どの端末からでも保存した曲を見られるようにするため</li>
        <li>不具合の調査と、本サービスの改善のため</li>
        <li>本サービスに関する大切なお知らせを送るため</li>
      </ul>
      <p style={p}>これ以外の目的には使いません。広告のために使うことや、第三者に売ることはありません。</p>

      <h2 style={h2}>3. 運営者による閲覧</h2>
      <p style={p}>
        運営者は管理のために保存されたデータを見ることができます。見るのは、不具合の調査や問い合わせへの対応など、必要な場合に限ります。
      </p>

      <h2 style={h2}>4. 保存先(外部サービス)</h2>
      <p style={p}>
        ログインとデータの保存には Supabase(Supabase, Inc.)を、サイトの配信には Vercel(Vercel, Inc.)を使っています。データはこれらの事業者のサーバー(日本または海外)に保存されます。
      </p>

      <h2 style={h2}>5. 第三者への提供</h2>
      <p style={p}>法令に基づく場合を除き、本人の同意なく第三者に提供しません。</p>

      <h2 style={h2}>6. 削除と退会</h2>
      <p style={p}>
        ログイン中に「退会(曲を全部削除)」を押すと、保存した曲をすべて削除できます。メールアドレスなどアカウントの情報の削除を希望する場合は、下の連絡先までご連絡ください。
      </p>

      <h2 style={h2}>7. お問い合わせ</h2>
      <p style={p}>[連絡先メールアドレス]</p>

      <h2 style={h2}>8. 変更</h2>
      <p style={p}>このポリシーを変更するときは、このページでお知らせします。</p>
    </main>
  );
}
