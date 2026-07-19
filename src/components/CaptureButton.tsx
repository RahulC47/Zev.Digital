import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";

const COUNTDOWN_FROM = 3;

export function CaptureButton() {
  const capture = useStore((s) => s.capture);
  const capturing = useStore((s) => s.capturing);
  const [count, setCount] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const start = () => {
    if (count !== null || capturing) return;
    setCount(COUNTDOWN_FROM);
    timer.current = window.setInterval(() => {
      setCount((c) => {
        if (c === null) return null;
        if (c <= 1) {
          if (timer.current) window.clearInterval(timer.current);
          timer.current = null;
          capture();
          return null;
        }
        return c - 1;
      });
    }, 1000);
  };

  const counting = count !== null;

  return (
    <>
      <button
        onClick={start}
        disabled={capturing || counting}
        className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
      >
        {capturing
          ? "Capturing…"
          : counting
            ? `Switch to your window… ${count}`
            : "＋ Capture current window"}
      </button>

      {counting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-7xl font-bold text-white tabular-nums">
            {count}
          </div>
          <p className="mt-4 max-w-sm text-center text-sm" style={{ color: "#cdd3e0" }}>
            Switch to the window you want Zev to read (Alt-Tab). It will be
            captured when the countdown ends.
          </p>
        </div>
      )}
    </>
  );
}
