# 0019 — 2026-04-11 — Mainline Merge, Docker Release, README Updates

**Date:** 2026-04-11
**Status:** ✅ Complete

---

## What Was Done

### Merge to main

`feature/phase-client-migration` merged into `main` via `--no-ff`. The branch
carried all work from worklogs 0013–0018: client-side engine migration, component
topology (LLD 11), reaction menu, metric reaction engine, per-minute ticking,
six new scenarios, and UI hardening.

Commit: `7d63c97`

### GitHub Actions — Docker release workflow

Created `.github/workflows/docker-release.yml`. Triggers on `release: published`.
Builds and pushes two images to GHCR on every release:

| Image                               | Tags                          |
| ----------------------------------- | ----------------------------- |
| `ghcr.io/lenaxia/oncall-sim/client` | `1.0.0`, `1.0`, `1`, `latest` |
| `ghcr.io/lenaxia/oncall-sim/proxy`  | `1.0.0`, `1.0`, `1`, `latest` |

Uses `docker/build-push-action@v5` with GHA layer cache. No secrets required
beyond the built-in `GITHUB_TOKEN` for GHCR auth.

### README updates

Both READMEs updated to reflect the current state of the project:

**README.md**

- Test file count corrected (69 → 70)
- Docker Images section added with pull instructions and GHCR image references

**README-LLM.md** (bumped v1.2 → v1.3)

- Project status updated
- Repository structure rewritten — server directory removed, proxy/k8s/all new
  client source modules (component-topology, metric-reaction-engine,
  sim-state-store, reaction-menu, etc.) added
- Architecture diagram replaced with client-side engine diagram + proxy sidecar
- Technology stack rewritten — server section removed, Client and Proxy Sidecar
  sections added
- Common commands updated — server workspace commands removed, proxy/Docker
  commands added, `MOCK_LLM=true` prefix removed (auto-enabled in tests)
- Branch management table updated — `feature/phase-client-migration` recorded
  as merged
- Testing requirements and quick-reference checklists de-server-ified

### v1.0.0 release

GitHub release `v1.0.0` created at tag pointing to HEAD of main after all fixes.

### Build fixes (three iterations)

The Docker build for the client image failed twice before passing:

**Iteration 1 — E401 npm install**
`package-lock.json` had every package resolved through a private AWS CodeArtifact
registry (`amazon-149122183214.d.codeartifact.us-west-2.amazonaws.com`). 839
occurrences across 11877 lines. Fixed by deleting the lockfile and regenerating
against public npm (`--registry https://registry.npmjs.org`). Lockfile shrank
from 11877 to 3431 lines.

**Iteration 2 — `tsc --noEmit` failing on `__tests__/`**
After the clean lockfile install, `@types/node` was no longer present — it had
only been pulled in transitively through CodeArtifact, never declared as an
explicit dependency. Test files use `require()` which needs `@types/node`. Two
fixes applied:

1. Added `"@types/node": "^20.0.0"` to `client/package.json` devDependencies.
2. Created `client/tsconfig.build.json` (extends `tsconfig.json`, excludes
   `__tests__/`) so the production build type-check only covers `src/`. The build
   script updated to `tsc --noEmit -p tsconfig.build.json && vite build`.

**Iteration 3 — both jobs green**
Workflow run `24292396330` passed. Both images confirmed pushed to GHCR.

---

## Test Results

- Test files: 70 passed (70)
- Tests: 1180 passed (1180)
- TypeScript: clean
- Lint: clean

---

## Known Issues

Packages are private by default on first publish to GHCR. Must be made public
manually at `https://github.com/lenaxia?tab=packages` if unauthenticated pulls
are required.

The Node.js 20 deprecation warning in the workflow is cosmetic — actions still
run correctly. Will need to bump action versions to `@v5`/`@v6` before
September 2026.

---

## What Comes Next

Implement LLD 11 per the TDD order in worklog 0018:

1. `component-topology.test.ts` — `findEntrypoint`, `propagationPath`, `propagationLag`
2. `component-metrics.test.ts` — `COMPONENT_METRICS` registry for all 12 component types
3. `scenario/loader.test.ts` — `deriveOpsDashboard()` + schema/type changes
4. `metrics/series.test.ts` + `metric-store.test.ts` — `overlayApplications[]`
5. `reaction-menu.test.ts` — `buildReactionMenu()`
6. `metric-reaction-engine.test.ts` — `select_metric_reaction` + `_applySelectedReaction()`
7. `RemediationsPanel.test.tsx` — `ScaleConcurrencySection`, `ScaleCapacitySection`
8. Migrate all scenarios to new YAML format, run full suite
