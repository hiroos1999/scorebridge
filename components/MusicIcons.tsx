// ツールバー用のミニ音楽記号アイコン。五線譜本体と同じBravuraフォントの
// グリフをそのまま流用することで、記譜と同じ見た目の記号でボタンの意味を
// 伝える（汎用アイコンセットには無い、四分休符・♯・♭・和音のための自作）。
// 五線譜本体の座標系（STAFF_TOP等）には依存せず、単体のボタンアイコンとして
// 独立して使えるよう、常に24x24のviewBox中央に配置する。

const GLYPH = {
  restQuarter: String.fromCodePoint(0xe4e5),
  accidentalSharp: String.fromCodePoint(0xe262),
  accidentalFlat: String.fromCodePoint(0xe260),
  noteheadBlack: String.fromCodePoint(0xe0a4),
};

function GlyphIcon({ char, fontSize = 20, dy = 0 }: { char: string; fontSize?: number; dy?: number }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <text
        x={12}
        y={12 + dy}
        fontFamily="Bravura"
        fontSize={fontSize}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
      >
        {char}
      </text>
    </svg>
  );
}

export function RestIcon() {
  return <GlyphIcon char={GLYPH.restQuarter} fontSize={22} dy={1} />;
}

export function SharpIcon() {
  return <GlyphIcon char={GLYPH.accidentalSharp} fontSize={19} />;
}

export function FlatIcon() {
  return <GlyphIcon char={GLYPH.accidentalFlat} fontSize={19} dy={1} />;
}

// 「和音を配置」は単体のBravuraグリフが無いため、符頭を縦に3つ重ねて
// 和音（コード）を表現する自作アイコン。
export function ChordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <text x={15} y={6} fontFamily="Bravura" fontSize={13} textAnchor="middle" dominantBaseline="central" fill="currentColor">
        {GLYPH.noteheadBlack}
      </text>
      <text x={11} y={13} fontFamily="Bravura" fontSize={13} textAnchor="middle" dominantBaseline="central" fill="currentColor">
        {GLYPH.noteheadBlack}
      </text>
      <text x={15} y={20} fontFamily="Bravura" fontSize={13} textAnchor="middle" dominantBaseline="central" fill="currentColor">
        {GLYPH.noteheadBlack}
      </text>
    </svg>
  );
}

// 「3連符で配置」は、連桁でつながった8分音符2つの上に数字「3」を載せた
// 3連符らしい見た目の自作アイコン（符頭のみBravura、符幹・連桁は直線で描く）。
export function TripletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <text x={12} y={5} fontFamily="'Times New Roman', serif" fontStyle="italic" fontWeight="bold" fontSize={9} textAnchor="middle" dominantBaseline="central" fill="currentColor">
        3
      </text>
      <text x={6} y={20} fontFamily="Bravura" fontSize={13} textAnchor="middle" dominantBaseline="central" fill="currentColor">
        {GLYPH.noteheadBlack}
      </text>
      <text x={16} y={20} fontFamily="Bravura" fontSize={13} textAnchor="middle" dominantBaseline="central" fill="currentColor">
        {GLYPH.noteheadBlack}
      </text>
      <line x1={9.3} y1={19.5} x2={9.3} y2={10} stroke="currentColor" strokeWidth={1.2} />
      <line x1={19.3} y1={19.5} x2={19.3} y2={10} stroke="currentColor" strokeWidth={1.2} />
      <line x1={9.3} y1={10.5} x2={19.3} y2={10.5} stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
