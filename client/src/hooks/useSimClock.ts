import { createContext, useContext, useEffect, useRef, useState } from "react";

// ── Wall-clock formatter ──────────────────────────────────────────────────────

/**
 * Converts a sim-time second offset into a wall-clock string.
 * clockAnchorMs: Unix ms that corresponds to simTime=0.
 * Output: "19:07:42" (24h, local timezone).
 */
export function formatWallClock(
  simTime: number,
  clockAnchorMs: number,
): string {
  if (
    typeof clockAnchorMs !== "number" ||
    isNaN(clockAnchorMs) ||
    clockAnchorMs === 0
  ) {
    // Anchor not yet set — return empty string to avoid NaN display
    return "--:--:--";
  }
  const wallMs = clockAnchorMs + simTime * 1000;
  const d = new Date(wallMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ── SimClockInput ─────────────────────────────────────────────────────────────
// The context that feeds raw engine values into useSimClock.
// In production, SessionContext provides this. In tests, a wrapper provides it directly.

export interface SimClockInput {
  simTime: number;
  speed: 1 | 2 | 5 | 10;
  paused: boolean;
  clockAnchorMs: number; // Unix ms for simTime=0
}

export const SimClockContext = createContext<SimClockInput>({
  simTime: 0,
  speed: 1,
  paused: false,
  clockAnchorMs: 0,
});

// ── useSimClock ───────────────────────────────────────────────────────────────

export interface UseSimClockResult {
  simTime: number; // interpolated sim seconds (floating point)
  display: string; // wall-clock string e.g. "19:07:42"
  speed: 1 | 2 | 5 | 10;
  paused: boolean;
  clockAnchorMs: number;
  /** Convert any simTime to wall-clock string using this session's anchor */
  wallClock: (simTime: number) => string;
}

export function useSimClock(): UseSimClockResult {
  const {
    simTime: serverSimTime,
    speed,
    paused,
    clockAnchorMs,
  } = useContext(SimClockContext);

  // Sync anchor: the engine sim time and the real wall time when we last received it
  const anchorRef = useRef<{ serverSimTime: number; realMs: number } | null>(
    null,
  );

  // Update anchor whenever the engine emits a new simTime
  useEffect(() => {
    anchorRef.current = { serverSimTime, realMs: Date.now() };
  }, [serverSimTime]);

  const rafRef = useRef<number>(0);
  const [interpolated, setInterpolated] = useState(serverSimTime);

  useEffect(() => {
    function tick() {
      if (anchorRef.current === null) {
        setInterpolated(serverSimTime);
      } else if (paused) {
        setInterpolated(anchorRef.current.serverSimTime);
      } else {
        const elapsed = (Date.now() - anchorRef.current.realMs) / 1000;
        setInterpolated(anchorRef.current.serverSimTime + elapsed * speed);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [serverSimTime, speed, paused]);

  const wallClock = (t: number) => formatWallClock(t, clockAnchorMs);

  return {
    simTime: interpolated,
    display: formatWallClock(Math.floor(interpolated), clockAnchorMs),
    speed,
    paused,
    clockAnchorMs,
    wallClock,
  };
}
