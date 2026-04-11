# docs/design/lld

Low-level design documents, one per development phase.

## Rules

- Read the relevant LLD before starting any phase implementation
- LLDs are written before code — they are the contract for the implementation
- If implementation diverges from the LLD, update the LLD first and confirm with the user
- Do not modify `hld.md` without explicit user instruction

## Structure

- `hld.md` — ⭐ authoritative high-level design
- `lld/01-shared-types.md` — Phase 1: shared TypeScript types and Zod schema
- `lld/02-metric-generator.md` — Phase 2: metric generation engine
- `lld/03-scenario-loader.md` — Phase 3: scenario YAML loading and validation
- `lld/04-game-engine.md` — Phase 4: core game loop, event scheduler, audit log
- `lld/05-llm-client.md` — Phase 5: LLM provider abstraction and stakeholder engine
- `lld/06-api.md` — Phase 6: REST API, SSE broker, session management
- `lld/07-ui-components.md` — Phase 7: shared UI component library
- `lld/08-sim-tabs.md` — Phase 8: sim shell and all tab implementations
- `lld/09-coach-debrief.md` — Phase 9: coach LLM and debrief screen
- `lld/10-reactive-metrics.md` — Phase 10: reactive metrics, MetricStore, apply_metric_response
- `lld/11-component-topology-and-reaction-menu.md` — Phase 11: component topology,
  auto-generated metrics, multi-incident composition, select_metric_reaction tool
