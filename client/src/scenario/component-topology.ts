// Graph utilities for the component topology within a ServiceNode.
// These are pure functions — no side effects, no imports from engine.
// Imports COMPONENT_METRICS to compute lagSeconds per component type.

import type { ServiceComponent } from "./types";
import { COMPONENT_METRICS } from "../metrics/component-metrics";

/**
 * Returns the single component whose inputs[] is empty — the service entrypoint.
 * Throws if zero or multiple entrypoints are found.
 */
export function findEntrypoint(
  components: ServiceComponent[],
): ServiceComponent {
  const entrypoints = components.filter((c) => c.inputs.length === 0);
  if (entrypoints.length === 0) {
    throw new Error(
      `No entrypoint found in component graph (no component with inputs: []). ` +
        `Component ids: ${components.map((c) => c.id).join(", ")}`,
    );
  }
  if (entrypoints.length > 1) {
    throw new Error(
      `Multiple entrypoints found: ${entrypoints.map((c) => c.id).join(", ")}. Exactly one is required.`,
    );
  }
  return entrypoints[0];
}

/**
 * Returns component ids in topological order starting from startId,
 * following the downstream direction (which components list startId in their inputs[]).
 * Uses BFS to handle diamond topologies without duplicates.
 * Returns [] when startId is not found in components.
 */
export function propagationPath(
  startId: string,
  components: ServiceComponent[],
): string[] {
  const exists = components.some((c) => c.id === startId);
  if (!exists) return [];

  // Build adjacency list: id → list of downstream ids
  const downstream: Map<string, string[]> = new Map();
  for (const c of components) {
    if (!downstream.has(c.id)) downstream.set(c.id, []);
    for (const inputId of c.inputs) {
      const list = downstream.get(inputId) ?? [];
      list.push(c.id);
      downstream.set(inputId, list);
    }
  }

  // BFS from startId
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const next of downstream.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return result;
}

/**
 * Returns the accumulated propagation lag (seconds) from startId to targetId
 * along the propagation path.
 *
 * Each component on the path contributes max(lagSeconds) across all its metric specs.
 * Components with no specs (s3, scheduler) contribute 0.
 * Returns 0 when startId === targetId, when targetId is not downstream of startId,
 * or when either id does not exist in components.
 */
export function propagationLag(
  startId: string,
  targetId: string,
  components: ServiceComponent[],
): number {
  if (startId === targetId) return 0;

  const path = propagationPath(startId, components);
  const targetIdx = path.indexOf(targetId);

  // targetId not downstream of startId
  if (targetIdx === -1) return 0;

  // Accumulate lag from the component AFTER startId through targetId (inclusive).
  // The startId (index 0) is the incident origin — its lag is its own metric's
  // internal delay, not propagation cost. Downstream components contribute their
  // max(lagSeconds) across all specs: this is how long after receiving the
  // upstream signal the component's own metrics start showing the effect.
  let totalLag = 0;
  const componentById = new Map(components.map((c) => [c.id, c]));

  for (let i = 1; i <= targetIdx; i++) {
    const id = path[i];
    const component = componentById.get(id);
    if (!component) continue;

    const specs = COMPONENT_METRICS[component.type];
    if (specs.length === 0) continue; // s3, scheduler → 0

    const maxLag = Math.max(...specs.map((s) => s.lagSeconds));
    totalLag += maxLag;
  }

  return totalLag;
}
