"use client";

import { useRef, useState, type ReactNode } from "react";

const LONG_PRESS_MS = 450;

// アイコンのみのツールバーボタン。意味が一目で伝わらないアイコンを補うため、
// ホバー（デスクトップ）とlong press（タッチ）の両方で簡易ツールチップを出す。
// aria-labelは常にlabelを使うので、ツールチップが出ない環境でもスクリーン
// リーダー等ではボタンの意味が読み上げられる。
export default function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  id,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleTouchStart() {
    longPressFired.current = false;
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setShowTip(true);
    }, LONG_PRESS_MS);
  }

  function handleTouchEnd() {
    clearLongPressTimer();
    // long pressでツールチップを出した場合は、そのタップ自体はツールチップの
    // 確認とみなしクリック(onClick)を発火させない。通常のタップは
    // ブラウザ標準のクリックイベントとしてそのまま素通しする。
    if (longPressFired.current) {
      setShowTip(false);
      longPressFired.current = false;
    }
  }

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        id={id}
        type="button"
        aria-label={label}
        disabled={disabled}
        className={`icon-btn${active ? " icon-btn-active" : ""}`}
        onClick={(e) => {
          if (longPressFired.current) {
            // long press直後に発火する合成クリックは無視する。
            e.preventDefault();
            return;
          }
          onClick?.();
        }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          clearLongPressTimer();
          longPressFired.current = false;
        }}
      >
        {icon}
      </button>
      {showTip && <span className="icon-btn-tip">{label}</span>}
    </span>
  );
}
