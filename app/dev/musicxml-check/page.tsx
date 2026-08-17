import { notFound } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import StaffToFretboard, { type StaffToFretboardInitialData } from "@/components/StaffToFretboard";

// MusicXMLインポート機能の技術検証専用ページ。
//
// - 本番ビルド(NODE_ENV=production、Vercelのデプロイを含む)では常に404にする
//   ため、このページ自体が公開URLとして到達可能になることはない。
// - 表示するデータ(dev-fixtures/*.json)は、importではなくfs.readFileSyncで
//   リクエスト時にサーバー側だけで読む。static importにするとクライアントJSの
//   バンドルに埋め込まれてしまうため、あえてこの方式にしている。
// - dev-fixtures/ は.gitignoreされているため、ここで読むデータがコミット
//   されたりGitHub上に残ったりすることはない。
export default function MusicXmlCheckPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const fixtureName = "misty";
  const dataPath = path.join(process.cwd(), "dev-fixtures", `${fixtureName}.json`);
  const warningsPath = path.join(process.cwd(), "dev-fixtures", `${fixtureName}.warnings.txt`);

  if (!fs.existsSync(dataPath)) {
    return (
      <div style={{ padding: 24, fontFamily: "monospace" }}>
        <p>{dataPath} が見つかりません。</p>
        <p>
          先に <code>python3 scripts/musicxml_to_notes.py dev-fixtures/{fixtureName}.musicxml &gt; {dataPath}</code>{" "}
          を実行してください。
        </p>
      </div>
    );
  }

  const data: StaffToFretboardInitialData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  const warnings = fs.existsSync(warningsPath) ? fs.readFileSync(warningsPath, "utf-8") : "(warnings file not found)";

  const totalNotes = data.measures.reduce((sum, m) => sum + m.notes.length, 0);
  const totalHarmonies = data.measures.reduce((sum, m) => sum + m.harmonies.length, 0);

  return (
    <div>
      <div
        style={{
          padding: "12px 24px",
          background: "#fff3cd",
          borderBottom: "2px solid #e0a800",
          fontFamily: "monospace",
          fontSize: 13,
        }}
      >
        <p style={{ fontWeight: "bold", margin: "0 0 8px" }}>
          ⚠️ MusicXMLインポート検証ページ（dev限定・本番では404）
        </p>
        <p style={{ margin: "0 0 4px" }}>
          fixture: dev-fixtures/{fixtureName}.musicxml → measures={data.measures.length} notes={totalNotes}{" "}
          harmonies={totalHarmonies} root(pc)={data.root} useFlats={String(data.useFlats)} timeSig=
          {data.timeSig.numerator}/{data.timeSig.denominator}
        </p>
        <details>
          <summary style={{ cursor: "pointer" }}>パーサー診断・警告（クリックで展開）</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{warnings}</pre>
        </details>
      </div>
      <StaffToFretboard initialTemplate={data} />
    </div>
  );
}
