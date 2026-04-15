// lint.ts — scenario authoring quality rules.
// These rules catch things that are structurally valid per the Zod schema
// but would produce a broken or unplayable simulation.
//
// Separate from validator.ts (cross-reference integrity) and schema.ts (structure).

import type { RawScenarioConfig } from "./schema";

// Defined here (not imported from validator.ts) to avoid a circular dependency.
// validator.ts re-exports this type.
export interface ScenarioValidationError {
  source: "schema" | "cross_ref" | "lint";
  rule?: string;
  path: string;
  message: string;
}

export interface LintOptions {
  // When true, rules that require a complete scenario are skipped unless
  // the relevant fields are already present in the draft.
  partial: boolean;
  // When true, all rules including optional ones are enforced.
  // Use only for builder mark_complete where the scenario must be production-ready.
  strict?: boolean;
}

type Draft = Partial<RawScenarioConfig>;

// ── Rule helpers ──────────────────────────────────────────────────────────────

function err(
  rule: string,
  path: string,
  message: string,
): ScenarioValidationError {
  return { source: "lint", rule, path, message };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function lintScenario(
  draft: Draft,
  options: LintOptions,
): ScenarioValidationError[] {
  const errors: ScenarioValidationError[] = [];
  const { partial } = options;

  // ── at_least_one_persona ──────────────────────────────────────────────────
  // Run when personas field is present (even if partial).
  if (draft.personas !== undefined) {
    if (draft.personas.length === 0) {
      errors.push(
        err(
          "at_least_one_persona",
          "personas",
          "At least one persona is required",
        ),
      );
    }
  } else if (!partial) {
    errors.push(
      err(
        "at_least_one_persona",
        "personas",
        "At least one persona is required",
      ),
    );
  }

  // ── at_least_one_remediation + correct_fix_exists ─────────────────────────
  if (draft.remediation_actions !== undefined) {
    if (draft.remediation_actions.length === 0) {
      errors.push(
        err(
          "at_least_one_remediation",
          "remediation_actions",
          "At least one remediation action is required",
        ),
      );
      errors.push(
        err(
          "correct_fix_exists",
          "remediation_actions",
          "At least one remediation action must have is_correct_fix: true",
        ),
      );
    } else {
      const hasCorrect = draft.remediation_actions.some(
        (r) => r.is_correct_fix === true,
      );
      if (!hasCorrect) {
        errors.push(
          err(
            "correct_fix_exists",
            "remediation_actions",
            "At least one remediation action must have is_correct_fix: true",
          ),
        );
      }
      // no_duplicate_action_ids — run whenever the array is present
      const dups = findDuplicates(draft.remediation_actions.map((r) => r.id));
      for (const dup of dups) {
        errors.push(
          err(
            "no_duplicate_action_ids",
            "remediation_actions",
            `Duplicate remediation_action id: '${dup}'`,
          ),
        );
      }
    }
  } else if (!partial) {
    errors.push(
      err(
        "at_least_one_remediation",
        "remediation_actions",
        "At least one remediation action is required",
      ),
    );
    errors.push(
      err(
        "correct_fix_exists",
        "remediation_actions",
        "At least one remediation action must have is_correct_fix: true",
      ),
    );
  }

  // ── duration_positive ─────────────────────────────────────────────────────
  if (draft.timeline !== undefined) {
    if (draft.timeline.duration_minutes <= 0) {
      errors.push(
        err(
          "duration_positive",
          "timeline.duration_minutes",
          `duration_minutes must be greater than 0 (got ${draft.timeline.duration_minutes})`,
        ),
      );
    }
  }

  // ── topology-based rules ──────────────────────────────────────────────────
  if (draft.topology !== undefined) {
    const focal = draft.topology.focal_service;

    const componentIds = new Set(focal.components.map((c) => c.id));

    // incident_has_affected_component — run whenever incidents and components both present
    for (let i = 0; i < focal.incidents.length; i++) {
      const incident = focal.incidents[i];
      if (!componentIds.has(incident.affected_component)) {
        errors.push(
          err(
            "incident_has_affected_component",
            `topology.focal_service.incidents[${i}].affected_component`,
            `incident '${incident.id}' references affected_component '${incident.affected_component}' which does not exist in focal_service.components`,
          ),
        );
      }
    }

    // focal_service_has_components — only enforced in strict (builder) mode.
    // The loader supports focal services with no components (they get empty metrics).
    if (options.strict === true && focal.components.length === 0) {
      errors.push(
        err(
          "focal_service_has_components",
          "topology.focal_service.components",
          "focal_service must have at least one component for metric generation",
        ),
      );
    }

    // incident_onset_in_range — only when timeline also present
    if (draft.timeline !== undefined) {
      const maxSecond = draft.timeline.duration_minutes * 60;
      // onset_second may be negative (before the session opens, within the
      // pre-incident window). The valid range is [-pre_incident_seconds, maxSecond].
      const minSecond = -(draft.timeline.pre_incident_seconds ?? 43200);
      for (let i = 0; i < focal.incidents.length; i++) {
        const incident = focal.incidents[i];
        if (
          incident.onset_second > maxSecond ||
          incident.onset_second < minSecond
        ) {
          errors.push(
            err(
              "incident_onset_in_range",
              `topology.focal_service.incidents[${i}].onset_second`,
              `incident '${incident.id}' onset_second ${incident.onset_second} is outside valid range [${minSecond}, ${maxSecond}]`,
            ),
          );
        }
      }
    }
  }

  // ── evaluation_root_cause_non_empty ───────────────────────────────────────
  if (draft.evaluation !== undefined) {
    if (draft.evaluation.root_cause.trim().length === 0) {
      errors.push(
        err(
          "evaluation_root_cause_non_empty",
          "evaluation.root_cause",
          "evaluation.root_cause must not be empty",
        ),
      );
    }
  } else if (!partial) {
    errors.push(
      err(
        "evaluation_root_cause_non_empty",
        "evaluation.root_cause",
        "evaluation.root_cause must not be empty",
      ),
    );
  }

  // ── no_duplicate_persona_ids ──────────────────────────────────────────────
  if (draft.personas !== undefined && draft.personas.length >= 2) {
    const dups = findDuplicates(draft.personas.map((p) => p.id));
    for (const dup of dups) {
      errors.push(
        err(
          "no_duplicate_persona_ids",
          "personas",
          `Duplicate persona id: '${dup}'`,
        ),
      );
    }
  }

  // ── persona_refs_valid ────────────────────────────────────────────────────
  // Run when at least one of the referencing sections is present.
  const personaIds = new Set((draft.personas ?? []).map((p) => p.id));
  const hasPersonas = draft.personas !== undefined;

  if (hasPersonas && draft.chat !== undefined) {
    for (let i = 0; i < (draft.chat.messages ?? []).length; i++) {
      const msg = draft.chat.messages[i];
      if (!personaIds.has(msg.persona)) {
        errors.push(
          err(
            "persona_refs_valid",
            `chat.messages[${i}].persona`,
            `chat message '${msg.id}' references persona '${msg.persona}' which does not exist in personas[]`,
          ),
        );
      }
    }
  }

  if (hasPersonas && draft.email !== undefined) {
    for (let i = 0; i < draft.email.length; i++) {
      const email = draft.email[i];
      if (email.from !== "trainee" && !personaIds.has(email.from)) {
        errors.push(
          err(
            "persona_refs_valid",
            `email[${i}].from`,
            `email '${email.id}' from '${email.from}' is not a valid persona ID or 'trainee'`,
          ),
        );
      }
      if (email.to !== "trainee" && !personaIds.has(email.to)) {
        errors.push(
          err(
            "persona_refs_valid",
            `email[${i}].to`,
            `email '${email.id}' to '${email.to}' is not a valid persona ID or 'trainee'`,
          ),
        );
      }
    }
  }

  return errors;
}
