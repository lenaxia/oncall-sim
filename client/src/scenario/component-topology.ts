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
 * Returns component ids in BFS order starting from startId,
 * following the DOWNSTREAM direction in traffic flow:
 * i.e. which components list startId in their inputs[].
 *
 * "Downstream" = further from the user, deeper into the stack.
 * e.g. alb → ecs → postgres: downstream from alb is [alb, ecs, postgres].
 *
 * Use for incidents that flood backends (DDoS on ALB, traffic spike).
 */
export function propagationPath(
  startId: string,
  components: ServiceComponent[],
): string[] {
  const exists = components.some((c) => c.id === startId);
  if (!exists) return [];

  // Build adjacency list: id → list of downstream ids
  // c has inputId in its inputs[] → c is downstream of inputId
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
 * Returns component ids in BFS order starting from startId,
 * following the UPSTREAM direction in traffic flow —
 * i.e. walking each component's own inputs[] toward the entrypoint.
 *
 * "Upstream" = closer to the user.
 * Topology: alb (inputs:[]) → ecs (inputs:[alb]) → postgres (inputs:[ecs])
 * upstream from postgres = [postgres, ecs, alb]
 *
 * Use for incidents that degrade callers: DB pool exhaustion,
 * cache miss, downstream API timeout.
 */
export function propagationPathUpstream(
  startId: string,
  components: ServiceComponent[],
): string[] {
  const exists = components.some((c) => c.id === startId);
  if (!exists) return [];

  // Index components by id for O(1) lookup
  const byId = new Map(components.map((c) => [c.id, c]));

  // BFS: at each step, follow the current component's own inputs[]
  // (those are the components it receives traffic from — upstream)
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const comp = byId.get(current);
    if (!comp) continue;
    for (const inputId of comp.inputs) {
      if (!visited.has(inputId)) {
        visited.add(inputId);
        queue.push(inputId);
      }
    }
  }

  return result;
}

/**
 * Returns all component ids reachable from startId in the given direction(s).
 * Always includes startId itself.
 *   upstream   — callers of startId (toward the user)
 *   downstream — dependencies of startId (away from the user)
 *   both       — union of upstream and downstream
 */
export function propagationPathForDirection(
  startId: string,
  components: ServiceComponent[],
  direction: "upstream" | "downstream" | "both",
): string[] {
  if (direction === "downstream") {
    return propagationPath(startId, components);
  }
  if (direction === "upstream") {
    return propagationPathUpstream(startId, components);
  }
  // both: union, startId first
  const up = propagationPathUpstream(startId, components);
  const down = propagationPath(startId, components);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...up, ...down]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Returns the accumulated propagation lag (seconds) from startId to targetId.
 * Searches both upstream and downstream paths to find the route.
 *
 * Each component on the path (excluding startId) contributes
 * max(lagSeconds) across all its metric specs.
 * Returns 0 when startId === targetId or targetId is not reachable.
 */
export function propagationLag(
  startId: string,
  targetId: string,
  components: ServiceComponent[],
): number {
  if (startId === targetId) return 0;

  // Try downstream first, then upstream
  const downPath = propagationPath(startId, components);
  const upPath = propagationPathUpstream(startId, components);
  const path = downPath.includes(targetId) ? downPath : upPath;

  const targetIdx = path.indexOf(targetId);
  if (targetIdx === -1) return 0;

  let totalLag = 0;
  const componentById = new Map(components.map((c) => [c.id, c]));

  for (let i = 1; i <= targetIdx; i++) {
    const id = path[i];
    const component = componentById.get(id);
    if (!component) continue;
    const specs = COMPONENT_METRICS[component.type];
    if (specs.length === 0) continue;
    const maxLag = Math.max(...specs.map((s) => s.lagSeconds));
    totalLag += maxLag;
  }

  return totalLag;
}
