import type { OrbState } from "../store/useStore";

interface OrbConfig {
  core: string;
  plasmaA: string;
  plasmaB: string;
  plasmaC: string;
  glowNear: string;
  glowFar: string;
  ring: string;
  dot: string;
  breathe: number;
  ringScale: number;
  breatheDur: number;
  spinDur: number;
  label: string;
}

const CFG: Record<OrbState, OrbConfig> = {
  idle: {
    core: "radial-gradient(circle at 33% 28%, rgba(91,140,255,0.42) 0%, rgba(60,90,200,0.22) 52%, transparent 100%)",
    plasmaA: "rgba(91,140,255,0.20)",
    plasmaB: "rgba(60,100,255,0.30)",
    plasmaC: "rgba(120,160,255,0.16)",
    glowNear: "rgba(91,140,255,0.35)",
    glowFar: "rgba(91,140,255,0.10)",
    ring: "rgba(91,140,255,0.22)",
    dot: "#5b8cff",
    breathe: 1.04,
    ringScale: 1.08,
    breatheDur: 3.4,
    spinDur: 16,
    label: "Ready",
  },
  thinking: {
    core: "radial-gradient(circle at 38% 28%, rgba(124,92,255,0.5) 0%, rgba(90,60,200,0.26) 52%, transparent 100%)",
    plasmaA: "rgba(124,92,255,0.30)",
    plasmaB: "rgba(150,90,255,0.40)",
    plasmaC: "rgba(180,140,255,0.22)",
    glowNear: "rgba(124,92,255,0.52)",
    glowFar: "rgba(124,92,255,0.16)",
    ring: "rgba(124,92,255,0.32)",
    dot: "#7c5cff",
    breathe: 1.06,
    ringScale: 1.1,
    breatheDur: 1.2,
    spinDur: 2.4,
    label: "Thinking…",
  },
};

interface OrbProps {
  state: OrbState;
  size?: "sm" | "lg";
  hideLabel?: boolean;
}

export function Orb({ state, size = "lg", hideLabel }: OrbProps) {
  const cfg = CFG[state];
  const isLg = size === "lg";

  const orbPx = isLg ? 156 : 64;
  const ringBase = isLg ? 188 : 80;
  const ringStep = isLg ? 28 : 12;
  const dotSize = isLg ? 10 : 5;
  const blurStrong = isLg ? 11 : 5;
  const blurLight = isLg ? 8 : 4;
  const wrapPx = orbPx + (isLg ? 96 : 36);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: wrapPx, height: wrapPx }}
    >
      {/* Outer pulse rings */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: ringBase + i * ringStep,
            height: ringBase + i * ringStep,
            borderRadius: "9999px",
            border: `1px solid ${cfg.ring}`,
            // @ts-expect-error - custom prop consumed by the keyframe
            "--orb-ring": cfg.ringScale,
            animation: `zev-orb-ring ${cfg.breatheDur + i * 0.45}s ease-in-out ${i * 0.28}s infinite`,
          }}
        />
      ))}

      {/* Breathing orb */}
      <div
        style={{
          width: orbPx,
          height: orbPx,
          borderRadius: "50%",
          position: "relative",
          // @ts-expect-error - custom prop consumed by the keyframe
          "--orb-breathe": cfg.breathe,
          animation: `zev-orb-breathe ${cfg.breatheDur}s ease-in-out infinite`,
          boxShadow: [
            `0 0 ${isLg ? 55 : 22}px ${cfg.glowNear}`,
            `0 0 ${isLg ? 110 : 44}px ${cfg.glowFar}`,
            `inset 0 0 ${isLg ? 28 : 12}px rgba(0,0,0,0.35)`,
          ].join(", "),
        }}
      >
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: cfg.core }} />
        <div
          style={{
            position: "absolute",
            inset: "16%",
            borderRadius: "50%",
            background: `conic-gradient(from 0deg, ${cfg.plasmaA}, ${cfg.plasmaB}, ${cfg.plasmaC}, ${cfg.plasmaA})`,
            filter: `blur(${blurStrong}px)`,
            animation: `zev-orb-spin ${cfg.spinDur}s linear infinite`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "26%",
            borderRadius: "50%",
            background: `conic-gradient(from 120deg, ${cfg.plasmaC}, ${cfg.plasmaA}, ${cfg.plasmaB}, ${cfg.plasmaC})`,
            filter: `blur(${blurLight}px)`,
            opacity: 0.75,
            animation: `zev-orb-spin-rev ${cfg.spinDur * 1.8}s linear infinite`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 27% 24%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 38%, transparent 65%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "radial-gradient(circle at 72% 75%, rgba(0,0,0,0.3) 0%, transparent 60%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `1px solid ${cfg.ring}`,
            boxShadow: `inset 0 0 ${isLg ? 18 : 8}px rgba(0,0,0,0.22)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: "50%",
              background: cfg.dot,
              filter: "blur(0.5px)",
              boxShadow: `0 0 ${dotSize * 3}px ${cfg.dot}, 0 0 ${dotSize}px ${cfg.dot}`,
              animation: "zev-orb-dot 2s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      {!hideLabel && (
        <div
          style={{
            position: "absolute",
            bottom: isLg ? 6 : 0,
            fontSize: isLg ? 11 : 9,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: cfg.dot,
            opacity: 0.75,
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          {cfg.label}
        </div>
      )}
    </div>
  );
}
