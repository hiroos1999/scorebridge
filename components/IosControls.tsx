// iOS風の共通コントロール(スイッチ・ステッパー)。見た目は各画面のCSS(.sb-switch/.sb-stepper)で定義。
// iOS風のスイッチ(オン/オフ)
export function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="sb-switch" data-on={on ? "1" : "0"} onClick={onClick}>
      <span />
    </button>
  );
}

// 値の左右に − / + (または ‹ / ›) を置いたステッパー
export function Stepper({ value, downLabel, upLabel, downDisabled, upDisabled, onDown, onUp, minus }: {
  value: string; downLabel: string; upLabel: string; downDisabled?: boolean; upDisabled?: boolean; onDown: () => void; onUp: () => void; minus?: boolean;
}) {
  return (
    <span className="sb-stepper">
      <button type="button" aria-label={downLabel} disabled={downDisabled} onClick={onDown}>{minus ? "−" : "‹"}</button>
      <span className="sb-stepper-val">{value}</span>
      <button type="button" aria-label={upLabel} disabled={upDisabled} onClick={onUp}>{minus ? "+" : "›"}</button>
    </span>
  );
}

