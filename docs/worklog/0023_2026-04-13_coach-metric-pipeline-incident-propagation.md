# 0023 — Coach System, Metric Reaction Pipeline Overhaul, and Incident Propagation

**Date:** 2026-04-13
**Releases:** v1.0.21 → v1.0.30
**Tests:** 1336 passing (74 test files)
**Status:** ✅ Complete

---

## What Was Done

### Coach System (v1.0.21 – v1.0.22)

Implemented the full LLM-powered coach as specified in `docs/design/lld/09-coach-debrief.md`.

**`CoachEngine` (`client/src/engine/coach-engine.ts`)**

- Tool-call driven: LLM must invoke `send_coach_message` to deliver a message; falls back to `response.text` when model writes prose instead of using the tool
- Three helpfulness levels with distinct system prompts: novice (proactive, warm, broad hints), intermediate (leading questions, nudges when stuck), expert (silent unless asked)
- `proactiveTick()` — returns `CoachMessage | null`; expert level skips LLM entirely
- `respondToTrainee()` — always responds; retries on `LLMError` (up to 2 retries, exponential backoff); throws on unrecoverable failure rather than returning a fake message
- Passive actions (`open_tab`, `view_metric`) filtered from audit log context sent to LLM

**Structured trigger system (`client/src/engine/game-loop.ts`)**

- `CoachTriggerReason` discriminated union: `inactivity`, `passive_browse_stall`, `sev1_unacknowledged`, `red_herring`, `resolve_with_alarms_firing`
- Each trigger fires once then waits for condition to reset (one-shot rate limiting per trigger type)
- Wall-clock thresholds (not sim-time): novice inactivity ≥2 min, intermediate ≥4 min; passive browse: novice 3 tabs/2 min, intermediate 5 tabs/5 min
- `open_tab` never triggers coach or metric reactions
- 1-minute wall-time cooldown between any two proactive messages
- `computeCoachTrigger()` pre-computes reason before calling LLM; priority order: resolve mistake → red herring → SEV1 → passive browse → inactivity

**`CoachPanelShell.tsx`**

- Single cycling pill (Novice → Intermediate → Expert → Novice) — click to cycle
- Welcome message per level shown above LLM messages
- Chat-style layout: trainee messages right-aligned, coach messages left-aligned
- Three staggered bouncing dots (typing indicator) while awaiting LLM response
- Unread badge clears when panel opens; auto-scroll to latest message
- Input disabled while sending; Enter to send

**`SessionContext.tsx`**

- `coachLevel: CoachLevel` in session state; `setCoachLevel()` / `sendCoachMessage()` exposed on context
- Trainee messages tagged `trainee:<uuid>` for UI disambiguation
- `_testSendCoachMessage` escape hatch for component tests

---

### UX Polish (v1.0.23 – v1.0.25)

- **GitHub mark icon** in topbar (SVG, 16px), linking to repo; `text-sim-text-muted` color (brightened from `faint` in v1.0.25)
- **Version identifier** in debug panel header (`v{version}` monospace label)
- **Auto-versioning**: `vite.config.ts` runs `git describe --tags --always --dirty` at build time; Docker build passes `APP_VERSION=${{ github.ref_name }}` build arg from CI so the bundle always shows the deployed tag (fixed `vdev` display bug in v1.0.28)

---

### Metric Reaction Pipeline Overhaul (v1.0.24 – v1.0.26)

**Root problem:** LLM calls taking 55–80 seconds meant overlays were anchored to stale metric values, producing invisible or wrong-direction changes.

**`applyActiveOverlay` re-anchoring (`client/src/metrics/metric-store.ts`)**

- Always anchors `startValue` and `startSimTime` to the most recent generated point
- `_intent` (outcome, magnitude, resolvedValue, peakValue) stored on every overlay so `targetValue` is recomputed from the fresh anchor at apply time
- `_intent.magnitude` defaults aligned between `computeTargetValue` and `applyActiveOverlay` (was causing half-recoveries on late responses)

**Near-peak worsening extension**

- When headroom to scripted peak < 20% of scale, effective peak extended 30% further in worsening direction
- Direction-aware: upward metrics (`p99_latency_ms`) use `current * 1.3`; downward metrics (`cache_hit_rate`) use `current * 0.7`

**`blip_then_decay` direction fix**

- Previously always blipped upward; now checks `T >= C` to determine direction

**Prompt worsening hint fix**

- `worsening → >peak` → `worsening → <peak` for downward metrics

**`reaction-menu` peak selection fix**

- `Math.max` replaced with direction-aware `Math.min`/`Math.max` based on whether metric degrades upward or downward

**`queue_burndown` decay fix**

- Hold-window check used `e` (clamped to `speedSeconds`) — decay branch was unreachable dead code; fixed to use raw `elapsed`

**18 e2e tests** (`client/__tests__/engine/metric-reactions-e2e.test.ts`):

- All 7 overlay patterns verified through full `generatePoint` pipeline
- All 4 outcomes, downward metrics, near-peak worsening, late LLM responses, overlay supersession, magnitude=0, `gradual_degradation` stacking
- Cursor rollback on LLM failure (actions not silently dropped)

---

### Incident Propagation Direction (v1.0.29 – v1.0.30)

**Root problem:** All incidents defaulted to downstream propagation. For backend incidents (DB pool exhaustion, cache miss), the affected metrics were on the _calling_ service — but the old code only applied overlays to components downstream of the incident origin, which is empty for backend components.

**Schema and types**

- `propagation_direction: upstream | downstream | both` added to incident schema (default `upstream`)
- `PropagationDirection` type, `IncidentConfig.propagationDirection` field

**`component-topology.ts`**

- `propagationPathUpstream(startId, components)`: BFS following each component's own `inputs[]` toward the entrypoint. `inputs[]` means "I receive traffic from these" — so following `inputs[]` walks toward the user.
- `propagationPathForDirection(startId, components, direction)`: dispatches to correct traversal; `both` returns deduped union
- `propagationLag`: searches both downstream and upstream paths; accumulates `max(lagSeconds)` per hop

**Loader** uses `propagationPathForDirection` for blast radius computation

**All 12 incidents across 6 scenarios annotated with correct direction:**

- `payment-db-pool-exhaustion`: `upstream` — DB exhaustion felt by ecs callers
- `cache-stampede/cache_miss_spike`: `both` — slows ecs upstream, floods recs_db downstream
- `cache-stampede/db_saturation`: `upstream` — DB saturation felt by ecs callers
- `fraud-api-quota-exhaustion`: `both` — fault_rate (alb upstream) + rds downstream
- `lambda-cold-start-cascade/lambda_saturation`: `upstream` — throttled lambda felt by apigw
- `lambda-cold-start-cascade/queue_backlog`: `downstream` — backlog floods dlq
- `lambda-cold-start-cascade/dlq_accumulation`: `downstream` — terminal component
- `memory-leak-jvm` (both incidents): `both` — alb upstream + rds downstream
- `tls-cert-expiry` (both incidents): `downstream` — cert failure on apigw floods backends
- `_fixture`: `downstream` — ecs is the affected service

**Dashboard coverage gaps fixed:**

- `fraud-api-quota-exhaustion`: `fault_rate` (headline SEV1) was registered from `alb` but excluded from blast radius with `downstream` direction — now correctly included via `both`
- `exonerated`/`independent` correlated services were inheriting focal service `incidentResponses` via `correlation.ts` spread — cleared to `[]` for non-`upstream_impact` services
- `cert_expiry.overlayForIncident` returned `sudden_drop` unconditionally — now returns `none` unless the incident's `onset_overlay` is `sudden_drop`
- `tls-cert-expiry` and `memory-leak-jvm` propagation direction corrections

**Engine cleanup:**

- Prompt: added valid speed tier list (`1m|5m|15m|30m|60m`), strengthened instruction to cover all affected metrics
- Unknown speed tier now logs a warning instead of silent fallback
- `_reactionHistory`: `no_effect` entries filtered out, capped at 10 entries
- Removed `console.log` from `triggerMetricReact`
- Fixed `tsconfig.build.json` typecheck failures: 18 missing type imports in `loader.ts`, `criticalThreshold` field added to `ResolvedMetricParams`

---

## Test Pass Rate

- **1336 / 1336** tests passing across 74 test files
- `tsc --noEmit -p tsconfig.build.json` clean (Docker build typecheck)

## Known Issues

- `oscillating` damping mode oscillates ±amplitude around target `T`; for large `|C - T|` the "good" half of each cycle can exceed metric `maxValue` and be silently clamped. Cosmetically wrong for metrics with hard ceilings but functionally harmless.
- `sustained=false` + `queue_burndown`: the overlay expires at exactly the moment burndown starts, causing an abrupt revert to scripted. Low-severity edge case.
- `_reactionHistory` still records all decisions per call (including those that fired correctly); very long sessions could approach the 10-entry cap quickly if many actions are taken in succession.

## What Comes Next

- Debrief narrative generation (Phase 9 stub → full implementation)
- Coach-level persistence across sessions
- Additional scenario authoring (new incident types)
- GitHub Actions Node.js 24 migration (deprecation warning currently present on all CI runs — deadline September 2026)
