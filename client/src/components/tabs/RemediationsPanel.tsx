// RemediationsPanel.tsx — grouped controls for all non-pipeline remediation actions.
//
// Groups remediation_actions from the scenario by type and renders each as a
// distinct control surface:
//
//  emergency_deploy    — one button per action (each has a specific target_version)
//  restart_service     — one "Bounce hosts" button per service, shows host_groups if defined
//  scale_cluster       — up/down with user-entered count per host_group or service
//  throttle_traffic    — toggle-style button per service
//  toggle_feature_flag — toggle row per flag
//
// sideEffect is NOT shown to the trainee — it is the consequence of the action
// and is only used by the game loop after execution (appears in logs).

import { useState } from "react";
import { useSession } from "../../context/SessionContext";
import { useScenario } from "../../context/ScenarioContext";
import { Button } from "../Button";
import { Modal } from "../Modal";
import type {
  RemediationAction,
  FeatureFlag,
  HostGroup,
} from "../../context/ScenarioContext";
import type {
  ThrottleTargetConfig,
  ThrottleUnit,
  ServiceComponent,
  DynamoDbComponent,
  LambdaComponent,
  KinesisStreamComponent,
} from "../../scenario/types";

// ── ServiceCapabilities ───────────────────────────────────────────────────────

export interface ServiceCapabilities {
  canRestart: boolean; // ecs_cluster | ec2_fleet | rds | elasticache
  canScaleHosts: boolean; // ecs_cluster | ec2_fleet
  canScaleConcurrency: boolean; // lambda
  canScaleCapacity: boolean; // dynamodb | kinesis_stream
  canSwitchBillingMode: boolean; // dynamodb where billingMode !== "on_demand"
  canThrottle: boolean; // load_balancer | api_gateway
}

/**
 * Derives which control surfaces to show based on the component graph.
 * Uses Array.some() with type narrowing — no switch needed.
 */
export function getComponentCapabilities(
  components: ServiceComponent[],
): ServiceCapabilities {
  return {
    canRestart: components.some(
      (c) =>
        c.type === "ecs_cluster" ||
        c.type === "ec2_fleet" ||
        c.type === "rds" ||
        c.type === "elasticache",
    ),
    canScaleHosts: components.some(
      (c) => c.type === "ecs_cluster" || c.type === "ec2_fleet",
    ),
    canScaleConcurrency: components.some((c) => c.type === "lambda"),
    canScaleCapacity: components.some(
      (c) => c.type === "dynamodb" || c.type === "kinesis_stream",
    ),
    canSwitchBillingMode: components.some(
      (c) =>
        c.type === "dynamodb" &&
        (c as DynamoDbComponent).billingMode !== "on_demand",
    ),
    canThrottle: components.some(
      (c) => c.type === "load_balancer" || c.type === "api_gateway",
    ),
  };
}

// ── Confirm modal state ───────────────────────────────────────────────────────

interface ConfirmState {
  title: string;
  body: string;
  action: () => void;
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-sim-border rounded overflow-hidden">
      <div className="px-4 py-2 border-b border-sim-border bg-sim-surface-2">
        <span className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide">
          {title}
        </span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

// ── Deploy section ────────────────────────────────────────────────────────────
// Lets the trainee choose between a normal pipeline deploy and an emergency
// deploy (build → target stage only, skipping intermediates).
//
// For emergency deploys the trainee picks the target stage. If they pick
// pre-prod, we pre-check "Block promotion to prod" as a best-practice hint.

type DeployMode = "normal" | "emergency";

function DeploySection({
  actions,
  inactive,
  onConfirm,
}: {
  actions: RemediationAction[];
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction, state } = useSession();
  const [mode, setMode] = useState<DeployMode>("normal");
  const [targetStages, setTargetStages] = useState<Record<string, string>>({});

  return (
    <Section title="Deploy">
      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 bg-sim-surface rounded w-fit">
        {(["normal", "emergency"] as DeployMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={[
              "px-3 py-1 rounded text-xs font-medium transition-colors",
              mode === m
                ? "bg-sim-surface-2 text-sim-text"
                : "text-sim-text-faint hover:text-sim-text",
            ].join(" ")}
          >
            {m === "normal" ? "Normal" : "Emergency"}
          </button>
        ))}
      </div>

      {mode === "normal" && (
        <p className="text-xs text-sim-text-muted">
          Deploys through all pipeline stages in order, respecting promotion
          gates.
        </p>
      )}

      {mode === "emergency" && (
        <p className="text-xs text-sim-yellow">
          Build then deploys directly to the selected stage, skipping
          intermediates. Continues through remaining stages unless a promotion
          gate is in place.
        </p>
      )}

      {actions.map((ra) => {
        const pipeline = state.pipelines.find((p) => p.service === ra.service);
        const deployStages =
          pipeline?.stages.filter((s) => s.type === "deploy") ?? [];
        const prodStage = deployStages[deployStages.length - 1];

        const selectedTarget = targetStages[ra.id] ?? prodStage?.id ?? "";

        function handleDeploy() {
          if (mode === "normal") {
            onConfirm({
              title: `Deploy ${ra.targetVersion ?? ra.label}`,
              body: `Deploy ${ra.targetVersion} to ${ra.service} through all pipeline stages.`,
              action: () =>
                dispatchAction("trigger_rollback", {
                  pipelineId: pipeline?.id ?? "",
                  stageId: pipeline?.stages[0]?.id ?? "",
                  targetVersion: ra.targetVersion,
                }),
            });
          } else {
            const targetStageId = selectedTarget || prodStage?.id || "";
            const targetStageName =
              pipeline?.stages.find((s) => s.id === targetStageId)?.name ??
              targetStageId;
            onConfirm({
              title: `Emergency Deploy: ${ra.targetVersion ?? ra.label} → ${targetStageName}`,
              body: `Build then deploy ${ra.targetVersion} directly to ${targetStageName}, skipping intermediate stages.`,
              action: () =>
                dispatchAction("emergency_deploy", {
                  remediationActionId: ra.id,
                  service: ra.service,
                  targetStage: targetStageId,
                }),
            });
          }
        }

        return (
          <div key={ra.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-medium text-sim-text">
                  {ra.label ?? ra.targetVersion ?? "Deploy"}
                </span>
                <span className="text-xs font-mono text-sim-text-muted">
                  {ra.targetVersion}
                </span>
              </div>
              <Button
                variant={mode === "emergency" ? "danger" : "secondary"}
                size="sm"
                disabled={
                  inactive ||
                  (mode === "emergency" && deployStages.length === 0)
                }
                onClick={handleDeploy}
              >
                {mode === "emergency" ? "Emergency deploy" : "Deploy"}
              </Button>
            </div>

            {/* Emergency stage selector — only shown when there are multiple deploy stages */}
            {mode === "emergency" && deployStages.length > 1 && (
              <div className="flex flex-col gap-1.5 pl-1">
                <div className="text-xs text-sim-text-faint">Target stage:</div>
                <div className="flex gap-1">
                  {deployStages.map((s) => (
                    <button
                      key={s.id}
                      onClick={() =>
                        setTargetStages((prev) => ({ ...prev, [ra.id]: s.id }))
                      }
                      className={[
                        "px-2 py-1 rounded text-xs font-medium border transition-colors",
                        selectedTarget === s.id
                          ? "border-sim-accent bg-sim-accent/10 text-sim-accent"
                          : "border-sim-border text-sim-text-faint hover:text-sim-text hover:border-sim-text-faint",
                      ].join(" ")}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ── Restart / bounce hosts section ────────────────────────────────────────────

function RestartSection({
  actions,
  hostGroups,
  inactive,
  onConfirm,
}: {
  actions: RemediationAction[];
  hostGroups: HostGroup[];
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction } = useSession();
  const services = [...new Set(actions.map((a) => a.service))];

  return (
    <Section title="Bounce Hosts">
      {services.map((service) => {
        const groups = hostGroups.filter((g) => g.service === service);
        const ra = actions.find((a) => a.service === service)!;

        if (groups.length > 0) {
          return (
            <div key={service} className="flex flex-col gap-2">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-sim-text">
                      {g.label}
                    </span>
                    <span className="text-xs text-sim-text-faint">
                      {g.instanceCount} instances
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={inactive}
                    onClick={() =>
                      onConfirm({
                        title: `Bounce: ${g.label}`,
                        body: `Restart all ${g.instanceCount} instances in ${g.label}. In-flight requests will fail during restart.`,
                        action: () =>
                          dispatchAction("restart_service", {
                            remediationActionId: ra.id,
                            service,
                            hostGroupId: g.id,
                          }),
                      })
                    }
                  >
                    Bounce
                  </Button>
                </div>
              ))}
            </div>
          );
        }

        return (
          <div
            key={service}
            className="flex items-center justify-between gap-4"
          >
            <span className="text-xs font-medium text-sim-text">{service}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={inactive}
              onClick={() =>
                onConfirm({
                  title: `Restart: ${service}`,
                  body: `Restart all instances of ${service}. In-flight requests will fail during restart.`,
                  action: () =>
                    dispatchAction("restart_service", {
                      remediationActionId: ra.id,
                      service,
                    }),
                })
              }
            >
              Restart
            </Button>
          </div>
        );
      })}
    </Section>
  );
}

function ScaleSection({
  actions,
  hostGroups,
  inactive,
  onConfirm,
}: {
  actions: RemediationAction[];
  hostGroups: HostGroup[];
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction } = useSession();
  const { hostGroupCounts, adjustHostGroup } = useScenario();
  const services = [...new Set(actions.map((a) => a.service))];

  // Desired count input per service — initialised to current host count
  const [desired, setDesired] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      services.map((s) => {
        const group = hostGroups.find((g) => g.service === s);
        return [s, group?.instanceCount ?? 1];
      }),
    ),
  );

  function handleApply(
    ra: RemediationAction,
    service: string,
    desiredCount: number,
  ) {
    const groups = hostGroups.filter((g) => g.service === service);
    const current =
      groups.length > 0
        ? (hostGroupCounts[groups[0].id] ?? groups[0].instanceCount)
        : desiredCount;
    const delta = desiredCount - current;
    const direction = delta >= 0 ? "up" : "down";
    const count = Math.abs(delta);
    dispatchAction("scale_cluster", {
      remediationActionId: ra.id,
      service,
      direction,
      count,
      desiredCount,
    });
    for (const g of groups) {
      adjustHostGroup(g.id, delta);
    }
  }

  return (
    <Section title="Scale Cluster">
      {services.map((service) => {
        const groups = hostGroups.filter((g) => g.service === service);
        const ra = actions.find((a) => a.service === service)!;
        const current =
          groups.length > 0
            ? (hostGroupCounts[groups[0].id] ?? groups[0].instanceCount)
            : (desired[service] ?? 1);
        const desiredCount = desired[service] ?? current;
        const delta = desiredCount - current;
        const unchanged = delta === 0;

        return (
          <div key={service} className="flex flex-col gap-2">
            {/* Current count label */}
            {groups.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {groups.map((g) => (
                  <span key={g.id} className="text-xs text-sim-text-faint">
                    {g.label} — {hostGroupCounts[g.id] ?? g.instanceCount}{" "}
                    instances
                  </span>
                ))}
              </div>
            )}

            {/* Desired hosts input */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-sim-text-faint">
                Desired hosts:
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={desiredCount}
                disabled={inactive}
                onChange={(e) =>
                  setDesired((prev) => ({
                    ...prev,
                    [service]: Math.max(
                      1,
                      Math.min(100, parseInt(e.target.value) || 1),
                    ),
                  }))
                }
                className="w-16 text-xs text-center bg-sim-surface border border-sim-border rounded px-1 py-0.5
                           text-sim-text focus:outline-none focus:border-sim-accent disabled:opacity-50"
              />

              <Button
                variant="secondary"
                size="sm"
                disabled={inactive || unchanged}
                onClick={() => {
                  if (unchanged) return;
                  onConfirm({
                    title: `Scale ${service}`,
                    body: `Change ${service} from ${current} to ${desiredCount} instance${desiredCount !== 1 ? "s" : ""}.`,
                    action: () => handleApply(ra, service, desiredCount),
                  });
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// ── Throttle section ──────────────────────────────────────────────────────────
// Each throttle_traffic action with throttle_targets renders a table of levers.
// Each row = one ThrottleTargetConfig.
//   - endpoint/consumer/concurrent/global: "Set limit" → inline form → active state
//   - customer: always-visible freeform Customer ID + limit input

interface ActiveThrottleState {
  limitRate: number;
  customerId?: string;
}

function scopeBadgeClass(scope: ThrottleTargetConfig["scope"]): string {
  switch (scope) {
    case "global":
      return "bg-sim-red/20 text-sim-red";
    case "endpoint":
      return "bg-sim-blue/20 text-sim-blue";
    case "customer":
      return "bg-sim-purple/20 text-sim-purple";
    case "consumer":
      return "bg-sim-yellow/20 text-sim-yellow";
    case "concurrent":
      return "bg-sim-green/20 text-sim-green";
  }
}

function unitLabel(unit: ThrottleUnit): string {
  switch (unit) {
    case "rps":
      return "rps";
    case "msg_per_sec":
      return "msg/s";
    case "concurrent":
      return "concurrent";
  }
}

// A single throttle target row.
function ThrottleTargetRow({
  target,
  inactive,
  onApply,
  onRemove,
}: {
  target: ThrottleTargetConfig;
  inactive: boolean;
  onApply: (limitRate: number, customerId?: string) => void;
  onRemove: (customerId?: string) => void;
}) {
  const [activeThrottle, setActiveThrottle] =
    useState<ActiveThrottleState | null>(null);
  const [editing, setEditing] = useState(false);
  const [limitInput, setLimitInput] = useState("");
  const [customerInput, setCustomerInput] = useState("");

  const isCustomer = target.scope === "customer";
  const uLabel = unitLabel(target.unit);

  function handleApply(limitRate: number, customerId?: string) {
    setActiveThrottle({ limitRate, customerId });
    setEditing(false);
    setLimitInput("");
    onApply(limitRate, customerId);
  }

  function handleRemove(customerId?: string) {
    setActiveThrottle(null);
    setCustomerInput("");
    onRemove(customerId);
  }

  return (
    <div
      data-throttle-target={target.id}
      className="flex flex-col gap-1.5 py-2.5 border-b border-sim-border last:border-0"
    >
      {/* Header row: scope badge + label + baseline + active badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[9px] px-1 py-0.5 rounded font-mono uppercase font-semibold flex-shrink-0 ${scopeBadgeClass(target.scope)}`}
            >
              {target.scope.toUpperCase()}
            </span>
            <span className="text-xs font-medium text-sim-text">
              {target.label}
            </span>
            {activeThrottle && (
              <span className="text-[9px] px-1 py-0.5 rounded font-mono bg-sim-yellow/20 text-sim-yellow flex-shrink-0">
                ACTIVE
              </span>
            )}
          </div>
          <span className="text-xs text-sim-text-muted">
            {target.description}
          </span>
          <span className="text-xs text-sim-text-faint">
            Baseline: {target.baselineRate} {uLabel}
            {activeThrottle && (
              <>
                {" "}
                &nbsp;·&nbsp;{" "}
                <strong className="text-sim-yellow">
                  Limit: {activeThrottle.limitRate} {uLabel}
                  {activeThrottle.customerId
                    ? ` (${activeThrottle.customerId})`
                    : ""}
                </strong>
              </>
            )}
          </span>
        </div>

        {/* Right-side controls for non-customer, non-editing state */}
        {!isCustomer && !editing && !activeThrottle && (
          <Button
            variant="secondary"
            size="sm"
            disabled={inactive}
            onClick={() => {
              setEditing(true);
              setLimitInput("");
            }}
          >
            Set limit
          </Button>
        )}
        {!isCustomer && !editing && activeThrottle && (
          <div className="flex gap-1.5 flex-shrink-0">
            <Button
              variant="secondary"
              size="sm"
              disabled={inactive}
              onClick={() => {
                setEditing(true);
                setLimitInput(String(activeThrottle.limitRate));
              }}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={inactive}
              onClick={() => handleRemove(undefined)}
            >
              Remove
            </Button>
          </div>
        )}
      </div>

      {/* Inline limit form — for endpoint/consumer/concurrent/global after clicking Set limit */}
      {!isCustomer && editing && (
        <div className="flex items-center gap-2 mt-0.5">
          <input
            type="number"
            min={1}
            placeholder="Limit"
            value={limitInput}
            disabled={inactive}
            onChange={(e) => setLimitInput(e.target.value)}
            className="w-20 text-xs text-center bg-sim-surface border border-sim-border rounded px-1 py-0.5
                       text-sim-text focus:outline-none focus:border-sim-accent disabled:opacity-50"
          />
          <span className="text-xs text-sim-text-faint">{uLabel}</span>
          <Button
            variant="primary"
            size="sm"
            disabled={inactive || !limitInput || parseInt(limitInput) < 1}
            onClick={() => handleApply(parseInt(limitInput))}
          >
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Customer scope — always-visible freeform inputs */}
      {isCustomer && (
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <input
            type="text"
            placeholder="Customer ID"
            value={customerInput}
            disabled={inactive}
            onChange={(e) => setCustomerInput(e.target.value)}
            className="w-32 text-xs bg-sim-surface border border-sim-border rounded px-2 py-0.5
                       text-sim-text focus:outline-none focus:border-sim-accent disabled:opacity-50"
          />
          <input
            type="number"
            min={1}
            placeholder={`Limit (${uLabel})`}
            value={limitInput}
            disabled={inactive}
            onChange={(e) => setLimitInput(e.target.value)}
            className="w-24 text-xs text-center bg-sim-surface border border-sim-border rounded px-1 py-0.5
                       text-sim-text focus:outline-none focus:border-sim-accent disabled:opacity-50"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={
              inactive ||
              !customerInput.trim() ||
              !limitInput ||
              parseInt(limitInput) < 1
            }
            onClick={() =>
              handleApply(parseInt(limitInput), customerInput.trim())
            }
          >
            Apply
          </Button>
          {activeThrottle && (
            <Button
              variant="danger"
              size="sm"
              disabled={inactive}
              onClick={() => handleRemove(activeThrottle.customerId)}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ThrottleSection({
  actions,
  inactive,
  onConfirm,
}: {
  actions: RemediationAction[];
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction } = useSession();

  function dispatchThrottle(
    ra: RemediationAction,
    target: ThrottleTargetConfig,
    throttle: boolean,
    limitRate: number,
    customerId?: string,
  ) {
    dispatchAction("throttle_traffic", {
      remediationActionId: ra.id,
      service: ra.service,
      throttle,
      targetId: target.id,
      scope: target.scope,
      label: target.label,
      unit: target.unit,
      limitRate,
      customerId,
    });
  }

  return (
    <Section title="Traffic Throttling">
      {actions.map((ra) => {
        // If the action has throttle_targets use the rich table, else the simple toggle
        if (!ra.throttleTargets || ra.throttleTargets.length === 0) {
          // Simple toggle (backwards compat for actions without targets)
          return (
            <SimpleLegacyThrottle
              key={ra.id}
              ra={ra}
              inactive={inactive}
              onConfirm={onConfirm}
            />
          );
        }
        return (
          <div key={ra.id} className="flex flex-col">
            {ra.throttleTargets.map((target) => (
              <ThrottleTargetRow
                key={target.id}
                target={target}
                inactive={inactive}
                onApply={(limitRate, customerId) =>
                  onConfirm({
                    title: `Apply throttle: ${target.label}${customerId ? ` (${customerId})` : ""}`,
                    body: `Limit ${target.label}${customerId ? ` for ${customerId}` : ""} to ${limitRate} ${unitLabel(target.unit)}.`,
                    action: () =>
                      dispatchThrottle(ra, target, true, limitRate, customerId),
                  })
                }
                onRemove={(customerId) =>
                  onConfirm({
                    title: `Remove throttle: ${target.label}${customerId ? ` (${customerId})` : ""}`,
                    body: `Remove rate limit on ${target.label}${customerId ? ` for ${customerId}` : ""}. Full traffic resumes.`,
                    action: () =>
                      dispatchThrottle(ra, target, false, 0, customerId),
                  })
                }
              />
            ))}
          </div>
        );
      })}
    </Section>
  );
}

// Simple legacy toggle used when throttle_targets is absent
function SimpleLegacyThrottle({
  ra,
  inactive,
  onConfirm,
}: {
  ra: RemediationAction;
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction } = useSession();
  const [throttled, setThrottled] = useState(false);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-sim-text truncate">
            {ra.label ?? ra.service}
          </span>
          {throttled && (
            <span className="text-[9px] px-1 py-0.5 rounded font-mono bg-sim-yellow/20 text-sim-yellow">
              ACTIVE
            </span>
          )}
        </div>
      </div>
      <Button
        variant={throttled ? "danger" : "secondary"}
        size="sm"
        disabled={inactive}
        onClick={() =>
          onConfirm({
            title: throttled
              ? `Remove throttle: ${ra.label ?? ra.service}`
              : `Apply throttle: ${ra.label ?? ra.service}`,
            body: throttled
              ? `Remove throttle from ${ra.service}. Full traffic will resume.`
              : `Apply throttle to ${ra.service}. ${ra.sideEffect ?? "Load will be shed."}`,
            action: () => {
              const next = !throttled;
              setThrottled(next);
              dispatchAction("throttle_traffic", {
                remediationActionId: ra.id,
                service: ra.service,
                throttle: next,
              });
            },
          })
        }
      >
        {throttled ? "Remove throttle" : "Apply throttle"}
      </Button>
    </div>
  );
}

// ── Feature flags section ─────────────────────────────────────────────────────

function FeatureFlagsSection({
  actions,
  flags,
  inactive,
  onConfirm,
}: {
  actions: RemediationAction[];
  flags: FeatureFlag[];
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction } = useSession();
  const [toggled, setToggled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(flags.map((f) => [f.id, f.defaultOn])),
  );

  return (
    <Section title="Feature Flags">
      {flags.map((flag) => {
        const ra = actions.find((a) => a.flagId === flag.id);
        const isOn = toggled[flag.id] ?? flag.defaultOn;

        return (
          <div
            key={flag.id}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${
                  isOn
                    ? "bg-sim-green/20 text-sim-green"
                    : "bg-sim-surface-2 text-sim-text-faint"
                }`}
              >
                {isOn ? "ON" : "OFF"}
              </span>
              <span className="text-xs font-medium text-sim-text truncate">
                {flag.label}
              </span>
            </div>
            <Button
              variant={isOn ? "danger" : "primary"}
              size="sm"
              disabled={inactive || !ra}
              onClick={() => {
                if (!ra) return;
                const next = !isOn;
                onConfirm({
                  title: `${next ? "Enable" : "Disable"}: ${flag.label}`,
                  body: `Set '${flag.label}' to ${next ? "enabled" : "disabled"}.`,
                  action: () => {
                    setToggled((prev) => ({ ...prev, [flag.id]: next }));
                    dispatchAction("toggle_feature_flag", {
                      remediationActionId: ra.id,
                      flagId: flag.id,
                      enabled: next,
                    });
                  },
                });
              }}
            >
              {isOn ? "Disable" : "Enable"}
            </Button>
          </div>
        );
      })}
    </Section>
  );
}

// ── ScaleConcurrencySection ───────────────────────────────────────────────────

function ScaleConcurrencySection({
  components,
  inactive,
}: {
  components: ServiceComponent[];
  inactive: boolean;
}) {
  const { dispatchAction } = useSession();
  const lambdaComponents = components.filter(
    (c): c is LambdaComponent => c.type === "lambda",
  );

  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(
      lambdaComponents.map((c) => [c.id, c.reservedConcurrency]),
    ),
  );

  if (lambdaComponents.length === 0) return null;

  return (
    <Section title="Concurrency">
      {lambdaComponents.map((c) => (
        <div key={c.id} className="flex flex-col gap-2">
          <span className="text-xs text-sim-text-muted">{c.label}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={values[c.id] ?? c.reservedConcurrency}
              disabled={inactive}
              className="w-24 px-2 py-1 text-xs border border-sim-border rounded bg-sim-surface text-sim-text"
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [c.id]: parseInt(e.target.value, 10) || 0,
                }))
              }
            />
            <span className="text-xs text-sim-text-faint">
              reserved executions
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={inactive}
              onClick={() =>
                dispatchAction("scale_capacity", {
                  componentId: c.id,
                  reservedConcurrency: values[c.id] ?? c.reservedConcurrency,
                })
              }
            >
              Apply
            </Button>
          </div>
        </div>
      ))}
    </Section>
  );
}

// ── ScaleCapacitySection ──────────────────────────────────────────────────────

function ScaleCapacitySection({
  components,
  inactive,
}: {
  components: ServiceComponent[];
  inactive: boolean;
}) {
  const { dispatchAction } = useSession();

  const dynamoComponents = components.filter(
    (c): c is DynamoDbComponent => c.type === "dynamodb",
  );
  const kinesisComponents = components.filter(
    (c): c is KinesisStreamComponent => c.type === "kinesis_stream",
  );

  const [ddbValues, setDdbValues] = useState<
    Record<
      string,
      {
        writeCapacity: number;
        readCapacity: number;
        billingMode: "provisioned" | "on_demand";
      }
    >
  >(
    Object.fromEntries(
      dynamoComponents.map((c) => [
        c.id,
        {
          writeCapacity: c.writeCapacity,
          readCapacity: c.readCapacity,
          billingMode: c.billingMode,
        },
      ]),
    ),
  );

  const [kinesisValues, setKinesisValues] = useState<Record<string, number>>(
    Object.fromEntries(kinesisComponents.map((c) => [c.id, c.shardCount])),
  );

  if (dynamoComponents.length === 0 && kinesisComponents.length === 0)
    return null;

  return (
    <Section title="Capacity">
      {dynamoComponents.map((c) => {
        const vals = ddbValues[c.id] ?? {
          writeCapacity: c.writeCapacity,
          readCapacity: c.readCapacity,
          billingMode: c.billingMode,
        };
        return (
          <div key={c.id} className="flex flex-col gap-2">
            <span className="text-xs text-sim-text-muted">{c.label}</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-sim-text-faint">Write (WCU)</span>
                <input
                  type="number"
                  min={1}
                  value={vals.writeCapacity}
                  disabled={inactive || vals.billingMode === "on_demand"}
                  className="w-full px-2 py-1 text-xs border border-sim-border rounded bg-sim-surface text-sim-text disabled:opacity-50"
                  onChange={(e) =>
                    setDdbValues((prev) => ({
                      ...prev,
                      [c.id]: {
                        ...vals,
                        writeCapacity: parseInt(e.target.value, 10) || 1,
                      },
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-sim-text-faint">Read (RCU)</span>
                <input
                  type="number"
                  min={1}
                  value={vals.readCapacity}
                  disabled={inactive || vals.billingMode === "on_demand"}
                  className="w-full px-2 py-1 text-xs border border-sim-border rounded bg-sim-surface text-sim-text disabled:opacity-50"
                  onChange={(e) =>
                    setDdbValues((prev) => ({
                      ...prev,
                      [c.id]: {
                        ...vals,
                        readCapacity: parseInt(e.target.value, 10) || 1,
                      },
                    }))
                  }
                />
              </div>
            </div>
            {c.billingMode === "provisioned" && (
              <label className="flex items-center gap-2 text-xs text-sim-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={vals.billingMode === "on_demand"}
                  disabled={inactive}
                  onChange={(e) =>
                    setDdbValues((prev) => ({
                      ...prev,
                      [c.id]: {
                        ...vals,
                        billingMode: e.target.checked
                          ? "on_demand"
                          : "provisioned",
                      },
                    }))
                  }
                />
                Switch to on-demand
              </label>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={inactive}
              onClick={() =>
                dispatchAction("scale_capacity", {
                  componentId: c.id,
                  ...(vals.billingMode === "provisioned"
                    ? {
                        writeCapacity: vals.writeCapacity,
                        readCapacity: vals.readCapacity,
                      }
                    : {}),
                  billingMode: vals.billingMode,
                })
              }
            >
              Apply
            </Button>
          </div>
        );
      })}
      {kinesisComponents.map((c) => (
        <div key={c.id} className="flex flex-col gap-2">
          <span className="text-xs text-sim-text-muted">{c.label}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={kinesisValues[c.id] ?? c.shardCount}
              disabled={inactive}
              className="w-24 px-2 py-1 text-xs border border-sim-border rounded bg-sim-surface text-sim-text"
              onChange={(e) =>
                setKinesisValues((prev) => ({
                  ...prev,
                  [c.id]: parseInt(e.target.value, 10) || 1,
                }))
              }
            />
            <span className="text-xs text-sim-text-faint">shards</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={inactive}
              onClick={() =>
                dispatchAction("scale_capacity", {
                  componentId: c.id,
                  shardCount: kinesisValues[c.id] ?? c.shardCount,
                })
              }
            >
              Apply
            </Button>
          </div>
        </div>
      ))}
    </Section>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function RemediationsPanel({ inactive }: { inactive: boolean }) {
  const { scenario } = useScenario();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  if (!scenario) return null;

  const { remediationActions, featureFlags, hostGroups, topology } = scenario;
  const components = topology.focalService.components;
  const capabilities = getComponentCapabilities(components);

  const byType = (type: RemediationAction["type"]) =>
    remediationActions.filter((a) => a.type === type);

  const emergencyDeploys = byType("emergency_deploy");
  const restarts = byType("restart_service");
  const scales = byType("scale_cluster");
  const throttles = byType("throttle_traffic");
  const flagActions = byType("toggle_feature_flag");

  const hasAnything =
    emergencyDeploys.length > 0 ||
    restarts.length > 0 ||
    scales.length > 0 ||
    throttles.length > 0 ||
    flagActions.length > 0 ||
    featureFlags.length > 0 ||
    capabilities.canScaleConcurrency ||
    capabilities.canScaleCapacity;

  if (!hasAnything) return null;

  return (
    <>
      <div className="flex flex-col gap-4">
        {emergencyDeploys.length > 0 && (
          <DeploySection
            actions={emergencyDeploys}
            inactive={inactive}
            onConfirm={setConfirm}
          />
        )}
        {restarts.length > 0 && (
          <RestartSection
            actions={restarts}
            hostGroups={hostGroups}
            inactive={inactive}
            onConfirm={setConfirm}
          />
        )}
        {scales.length > 0 && (
          <ScaleSection
            actions={scales}
            hostGroups={hostGroups}
            inactive={inactive}
            onConfirm={setConfirm}
          />
        )}
        {throttles.length > 0 && (
          <ThrottleSection
            actions={throttles}
            inactive={inactive}
            onConfirm={setConfirm}
          />
        )}
        {capabilities.canScaleConcurrency && (
          <ScaleConcurrencySection
            components={components}
            inactive={inactive}
          />
        )}
        {capabilities.canScaleCapacity && (
          <ScaleCapacitySection components={components} inactive={inactive} />
        )}
        {(flagActions.length > 0 || featureFlags.length > 0) && (
          <FeatureFlagsSection
            actions={flagActions}
            flags={featureFlags}
            inactive={inactive}
            onConfirm={setConfirm}
          />
        )}
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                confirm?.action();
                setConfirm(null);
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted">{confirm?.body}</p>
      </Modal>
    </>
  );
}
