/**
 * Performance benchmarks for claims made about OpsDashboard bottlenecks.
 *
 * Each bench group measures the raw cost of the computation in question —
 * NOT React rendering time (jsdom render overhead would swamp the signal).
 *
 * Claims under test:
 *   1. series.filter(p => p.t <= simTime) is expensive per tick (MetricChart.tsx:28)
 *   2. allAlarms map + hasFiringAlarm scan is expensive (OpsDashboardTab.tsx:56-66)
 *   3. findIndex O(n) for brush window start (MetricChart.tsx:33)
 *   4. personas.find inside pages.map loop (OpsDashboardTab.tsx:155)
 *
 * Scenario sizes used are realistic worst-cases based on the LLD:
 *   - Pre-incident window: up to 72 hours at 30s resolution = 8640 points
 *   - Scenario duration: up to 60 minutes at 30s resolution = 120 points
 *   - Total series length per metric: up to 8760 points
 *   - Services: up to 5, metrics per service: up to 8 (= 40 charts)
 *   - Alarms: up to 20 (realistic burst during a bad incident)
 *   - Pages: up to 50 (stress-test personas.find)
 *   - Personas: up to 20
 */

import { bench, describe } from "vitest";
import type { TimeSeriesPoint, Alarm } from "@shared/types/events";

// ── Data factories ────────────────────────────────────────────────────────────

function makeSeries(
  fromSec: number,
  toSec: number,
  resolutionSec: number,
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  for (let t = fromSec; t <= toSec; t += resolutionSec) {
    points.push({ t, v: Math.random() * 100 });
  }
  return points;
}

function makeAlarms(count: number, firingFraction = 0.5): Alarm[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `alarm-${i}`,
    service: `svc-${i % 5}`,
    metricId: "error_rate",
    condition: `error_rate > ${i}%`,
    value: i * 2,
    severity: "SEV2" as const,
    status:
      i < count * firingFraction
        ? ("firing" as const)
        : ("acknowledged" as const),
    simTime: i * 10,
  }));
}

interface Persona {
  id: string;
  displayName: string;
  jobTitle: string;
  team: string;
}

function makePersonas(count: number): Persona[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `persona-${i}`,
    displayName: `Person ${i}`,
    jobTitle: "SRE",
    team: "Platform",
  }));
}

function makePages(
  count: number,
  personaCount: number,
): Array<{ id: string; personaId: string; message: string; simTime: number }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `page-${i}`,
    personaId: `persona-${i % personaCount}`,
    message: `Urgent: ${i}`,
    simTime: i * 5,
  }));
}

// ── Claim 1: series.filter per tick ──────────────────────────────────────────
// MetricChart.tsx:28: const visible = series.filter(p => p.t <= simTime)
// This runs once per MetricChart per sim_time SSE tick.
// Worst case: 5 services × 8 metrics = 40 charts, each filtering up to ~8760 points.

describe("Claim 1 — series.filter per tick", () => {
  // Realistic: 72h pre-incident at 30s = 8640 points + 60min scenario = 120 = 8760 total
  const LARGE_SERIES = makeSeries(-72 * 3600, 60 * 60, 30);
  // simTime near end of incident window — filter returns almost all points
  const simTimeNearEnd = 55 * 60;
  // simTime at 10min — filter returns ~8760 * 0.96 points
  const simTimeEarly = 10 * 60;

  bench("filter 8760-point series at simTime=55min (near-full scan)", () => {
    LARGE_SERIES.filter((p) => p.t <= simTimeNearEnd);
  });

  bench("filter 8760-point series at simTime=10min (early tick)", () => {
    LARGE_SERIES.filter((p) => p.t <= simTimeEarly);
  });

  // 40 charts firing simultaneously (5 services × 8 metrics) — what a full dashboard tick costs
  const ALL_SERIES = Array.from({ length: 40 }, () =>
    makeSeries(-72 * 3600, 60 * 60, 30),
  );

  bench("filter 40× 8760-point series (full dashboard tick)", () => {
    for (const series of ALL_SERIES) {
      series.filter((p) => p.t <= simTimeNearEnd);
    }
  });

  // Compare: memoised result (simulating useMemo hit — just return cached array)
  const cachedResult = LARGE_SERIES.filter((p) => p.t <= simTimeNearEnd);
  bench("memoised hit — no filter (baseline for comparison)", () => {
    // Simulates what useMemo does on cache hit: identity check + return
    void cachedResult;
  });
});

// ── Claim 2: allAlarms map + hasFiringAlarm per-service scan ─────────────────
// OpsDashboardTab.tsx:56-59: allAlarms = state.alarms.map(...)
// OpsDashboardTab.tsx:66:   hasFiringAlarm = allAlarms.some(...)   (called per service tab)

describe("Claim 2 — allAlarms map + hasFiringAlarm scan", () => {
  const SERVICES = ["svc-a", "svc-b", "svc-c", "svc-d", "svc-e"];

  bench("allAlarms map (20 alarms)", () => {
    const alarms = makeAlarms(20);
    const localStatus: Record<string, "acknowledged" | "suppressed"> = {
      "alarm-3": "acknowledged",
    };
    alarms.map((a) => ({
      ...a,
      status: (localStatus[a.id] ?? a.status) as Alarm["status"],
    }));
  });

  bench("hasFiringAlarm scan (20 alarms × 5 services)", () => {
    const allAlarms = makeAlarms(20);
    for (const svc of SERVICES) {
      allAlarms.some((a) => a.service === svc && a.status === "firing");
    }
  });

  bench(
    "allAlarms map + hasFiringAlarm scan combined (20 alarms, 5 services)",
    () => {
      const alarms = makeAlarms(20);
      const localStatus: Record<string, "acknowledged" | "suppressed"> = {};
      const allAlarms = alarms.map((a) => ({
        ...a,
        status: (localStatus[a.id] ?? a.status) as Alarm["status"],
      }));
      for (const svc of SERVICES) {
        allAlarms.some((a) => a.service === svc && a.status === "firing");
      }
    },
  );

  // Memoised equivalent: build a Set of firing services once
  bench("memoised firingServices Set (build once from 20 alarms)", () => {
    const alarms = makeAlarms(20);
    const firingServices = new Set(
      alarms.filter((a) => a.status === "firing").map((a) => a.service),
    );
    for (const svc of SERVICES) {
      firingServices.has(svc);
    }
  });
});

// ── Claim 3: findIndex O(n) for brush window ──────────────────────────────────
// MetricChart.tsx:33-36: visible.findIndex(p => p.t >= windowStart)
// DEFAULT_WINDOW_SECONDS = 4 * 3600. visible array = points up to simTime.
// windowStart = simTime - 4h. At simTime=55min, windowStart is negative (in pre-incident history).
// The findIndex scans from [0] through the pre-incident history until it hits windowStart.

describe("Claim 3 — findIndex for brush window start", () => {
  // At simTime=55min with a 4h window, windowStart = 55*60 - 4*3600 = -10500s
  // In a 72h pre-incident window at 30s res, that's index (72*3600 - 10500) / 30 = 8295
  // So findIndex walks 8295 elements before finding it — nearly full scan.
  const LARGE_SERIES = makeSeries(-72 * 3600, 60 * 60, 30);
  const simTime = 55 * 60;
  const visible = LARGE_SERIES.filter((p) => p.t <= simTime); // ~8760 points
  const windowStart = simTime - 4 * 3600; // -10500

  bench("findIndex on 8760-point visible array (scan ~8295 elements)", () => {
    Math.max(
      0,
      visible.findIndex((p) => p.t >= windowStart),
    );
  });

  // Binary search equivalent
  function binarySearchGte(arr: TimeSeriesPoint[], target: number): number {
    let lo = 0;
    let hi = arr.length - 1;
    let result = arr.length;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].t >= target) {
        result = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return result === arr.length ? arr.length - 1 : result;
  }

  bench("binary search on 8760-point visible array", () => {
    Math.max(0, binarySearchGte(visible, windowStart));
  });

  // Also test the case where windowStart is deep in pre-incident (worst case)
  const windowStartDeep = simTime - 72 * 3600; // before any point — returns 0
  bench(
    "findIndex returning 0 (no match in first scan direction, full traversal)",
    () => {
      // When windowStart is before the start of the array, findIndex goes to -1 (not found)
      // and Math.max(0, -1) = 0. This scans the ENTIRE array.
      Math.max(
        0,
        visible.findIndex((p) => p.t >= windowStartDeep),
      );
    },
  );

  bench("binary search returning 0 (deep windowStart)", () => {
    Math.max(0, binarySearchGte(visible, windowStartDeep));
  });
});

// ── Claim 4: personas.find inside pages.map ───────────────────────────────────
// OpsDashboardTab.tsx:155: scenario?.personas.find(p => p.id === page.personaId)
// Called inside .map() over state.pages — O(pages × personas) per render.

describe("Claim 4 — personas.find inside pages.map loop", () => {
  const PERSONAS = makePersonas(20);
  const PAGES_50 = makePages(50, 20);
  const PAGES_10 = makePages(10, 20);

  bench("personas.find inside map — 50 pages × 20 personas (O(n²))", () => {
    PAGES_50.map((page) => {
      const persona = PERSONAS.find((p) => p.id === page.personaId);
      return { page, persona };
    });
  });

  bench("personas.find inside map — 10 pages × 20 personas", () => {
    PAGES_10.map((page) => {
      const persona = PERSONAS.find((p) => p.id === page.personaId);
      return { page, persona };
    });
  });

  // Memoised lookup map equivalent
  const personaById = new Map(PERSONAS.map((p) => [p.id, p]));

  bench(
    "Map lookup inside map — 50 pages × 20 personas (O(n) amortized)",
    () => {
      PAGES_50.map((page) => {
        const persona = personaById.get(page.personaId);
        return { page, persona };
      });
    },
  );

  bench("Map lookup inside map — 10 pages × 20 personas", () => {
    PAGES_10.map((page) => {
      const persona = personaById.get(page.personaId);
      return { page, persona };
    });
  });
});

// ── Claim 5 (server): getPointsInWindow without fast-path ────────────────────
// LLD 10 §8.2 says the game loop calls getPointsInWindow for every metric on every tick.
// Without the reactiveWindowEnd fast-path, this iterates all pre-generated points per tick.
// Test: cost of iterating 8760 points to find nothing (no reactive overlay active)

describe("Claim 5 — getPointsInWindow without vs with fast-path guard", () => {
  const SERIES = makeSeries(-72 * 3600, 60 * 60, 30);
  // Simulate: 5 services × 8 metrics = 40 metric series
  const ALL_SERIES = Array.from({ length: 40 }, () =>
    makeSeries(-72 * 3600, 60 * 60, 30),
  );

  const fromSimTime = 500;
  const toSimTime = 530;

  // Without fast-path: full filter on every series
  bench(
    "getPointsInWindow without fast-path — single 8760-point series",
    () => {
      SERIES.filter((p) => p.t > fromSimTime && p.t <= toSimTime);
    },
  );

  bench(
    "getPointsInWindow without fast-path — 40 series (full dashboard tick)",
    () => {
      for (const series of ALL_SERIES) {
        series.filter((p) => p.t > fromSimTime && p.t <= toSimTime);
      }
    },
  );

  // With fast-path: reactiveWindowEnd is undefined, return [] immediately
  const reactiveWindowEnd: number | undefined = undefined;

  bench("getPointsInWindow with fast-path guard — single series", () => {
    if (reactiveWindowEnd === undefined || fromSimTime >= reactiveWindowEnd) {
      // return [] immediately
    }
  });

  bench("getPointsInWindow with fast-path guard — 40 series", () => {
    const windowEnd: number | undefined = reactiveWindowEnd;
    for (let i = 0; i < 40; i++) {
      if (windowEnd === undefined || fromSimTime >= windowEnd) {
        // return [] immediately
      }
    }
  });
});
