import { useStore } from "../store/useStore";

/**
 * Sliding pill toggle — DAY MODE / NIGHT MODE.
 * Adapted from GraphForge's ThemeToggle.jsx.
 */
export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const isLight = theme === "light";

  return (
    <button
      onClick={toggleTheme}
      title={isLight ? "Switch to night mode" : "Switch to day mode"}
      aria-label={isLight ? "Switch to night mode" : "Switch to day mode"}
      style={{
        display: "flex",
        alignItems: "center",
        width: 130,
        height: 36,
        borderRadius: 999,
        border: isLight ? "1.5px solid #d0d3dc" : "1.5px solid #444",
        background: isLight ? "#f0f1f5" : "#111",
        padding: "3px 4px",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        transition: "background 0.3s, border-color 0.3s",
      }}
    >
      {/* Sliding knob */}
      <span
        style={{
          position: "absolute",
          top: 3,
          left: isLight ? "calc(100% - 32px - 4px)" : 4,
          width: 30,
          height: 28,
          borderRadius: "50%",
          background: isLight ? "#fff" : "#222",
          border: isLight ? "1.5px solid #ccc" : "1.5px solid #555",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "left 0.3s cubic-bezier(.4,0,.2,1)",
          zIndex: 2,
          boxShadow: isLight
            ? "0 1px 4px rgba(0,0,0,0.12)"
            : "0 1px 4px rgba(0,0,0,0.5)",
        }}
      >
        {isLight ? <SunIcon /> : <MoonIcon />}
      </span>

      {/* Text label */}
      <span
        style={{
          position: "absolute",
          left: isLight ? 10 : 38,
          right: isLight ? 38 : 10,
          textAlign: "center",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: isLight ? "#333" : "#ccc",
          userSelect: "none",
          transition: "left 0.3s, right 0.3s, color 0.3s",
          whiteSpace: "nowrap",
          zIndex: 1,
        }}
      >
        {isLight ? "DAY MODE" : "NIGHT MODE"}
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="1.8" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
