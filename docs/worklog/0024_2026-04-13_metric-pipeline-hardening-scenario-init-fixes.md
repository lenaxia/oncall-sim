# 0024 — Metric Reaction Pipeline Hardening, Scenario Initialization Fixes

**Date:** 2026-04-13
**Releases:** v1.0.31 → v1.0.33
**Tests:** 1336 passing (74 test files)
**Status:** ✅ Complete

---

## What Was Done

### Stacked incident overlays causing metrics to start above red lines (v1.0.31)

**Root cause:** With `propagation_direction: upstream/both`, multiple components in the blast radius each contributed a `spike_and_sustain` overlay for the same metric archetype. `_computeScriptedValue` applied all overlays additively — so `p50_latency_ms` was pushed from `15ms → +30ms (alb) → +60ms (ecs) = 105ms`, starting the session already past the 45ms critical threshold.

**Fix:**

- Added `incidentId: string` field to `OverlayApplication`
- `buildOverlayApplication` in loader now populates `incidentId`
- Loader deduplicates overlays per `(incidentId, archetype)` keeping only the highest-impact one (furthest from baseline distance)
- For `p50_latency_ms`: ecs overlay (peak=75ms, distance=60) wins over alb overlay (peak=45ms, distance=30)
- One incident → one overlay per metric, no additive stacking

**Tests:** `payment-scenario.test.ts` updated to assert exactly 1 overlay per incident after dedup (highest-impact wins)

### Worsening reactions going wrong direction when past scripted peak (v1.0.31)

**Root cause:** `computeTargetValue("worsening")` used `peakValue` as the effective target ceiling. When a metric's `currentValue` had already exceeded `peakValue` (from prior worsening reactions), the target `peakValue < currentValue` — driving the metric downward instead of further up. `error_rate` at 1.51 with `peak=1.00` was targeting 1.00 (a recovery, not a worsening).

**Fix:** Added `alreadyBeyondPeak` check in both `computeTargetValue` (engine) and `applyActiveOverlay` (metric-store):

- `worseningGoesUp && currentValue >= peakValue` → extend effective peak to `current * 1.3`
- `worseningGoesDown && currentValue <= peakValue` → extend effective peak to `current * 0.7`
- Applied in both the initial target calculation and the re-anchor path

### All scenarios now start healthy then degrade visibly (v1.0.32)

**Root cause:** All scenarios had `onset_second: 0` with `pre_incident_seconds` ranging from 21600–43200. The incident was fully saturated hours before the 4-hour chart window started — trainees always opened to metrics already well past their thresholds with no visible transition.

**Fix:** Set `onset_second = pre_incident_seconds - 10800` (incident starts 3 hours before session open = 1 hour into the 4-hour chart window):

| Scenario                            | Old onset | New onset         | Effect                           |
| ----------------------------------- | --------- | ----------------- | -------------------------------- |
| `payment-db-pool-exhaustion`        | 0         | 32400             | 1h healthy + 3h degraded visible |
| `cache-stampede` (both incidents)   | 90        | 18000             | 1h healthy + 3h degraded visible |
| `fraud-api-quota-exhaustion`        | 0         | 10800             | 1h healthy + 3h degraded visible |
| `lambda-cold-start-cascade` (all 3) | 60/60/180 | 18000/18000/18120 | 1h healthy + 3h degraded visible |
| `tls-cert-expiry` (both)            | 0/0       | 32400/32400       | cert shows healthy then drops    |
| `memory-leak-jvm`                   | 0         | unchanged         | intentional — starts mid-leak    |

Also set `health: healthy` on all scenarios that were previously `degraded` but now start healthy before onset (reduces noise multiplier during healthy period).

### `connection_pool_used` baseline fix (v1.0.33)

**Root cause:** `connection_utilization: 1.0` in the postgres component made `baseline = maxConnections * connectionUtilization = 5 * 1.0 = 5`. Since `ceiling = 5` and `crit = ceiling * 0.85 = 4.25`, `baseline (5) > crit (4.25)` — the metric started above its red line from the very first chart point, before the incident onset.

**Diagnosed via:** temporary test printing actual generated values at `t=28800` (chart window start) — confirmed `v=4.986` before the fix, `v=1.994` after.

**Fix:** `connection_utilization: 0.40` — baseline now `2.0` (40% healthy pool utilization). The `saturation` incident overlay drives it from `2.0` to `5.0` at `onset_second=32400`, crossing the `4.25` threshold visibly as the incident progresses.

---

## Test Pass Rate

- **1336 / 1336** tests passing across 74 test files
- `tsc --noEmit -p tsconfig.build.json` clean

## Known Issues

None introduced in this session.

## What Comes Next

- Metric realism: `error_rate` and latency metrics need more noise to look realistic; `cert_expiry` needs a low threshold (alarm at low days remaining, not when it drops to 0); `memory_jvm` sawtooth shape review
- Debrief narrative generation (Phase 9 stub → full implementation)
