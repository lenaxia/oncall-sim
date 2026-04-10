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

// ── Emergency deploy section ──────────────────────────────────────────────────

function EmergencyDeploySection({
  actions,
  inactive,
  onConfirm,
}: {
  actions: RemediationAction[];
  inactive: boolean;
  onConfirm: (s: ConfirmState) => void;
}) {
  const { dispatchAction } = useSession();

  return (
    <Section title="Emergency Deploy">
      {actions.map((ra) => (
        <div key={ra.id} className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-medium text-sim-text">
              {ra.label ?? ra.targetVersion ?? "Deploy"}
            </span>
            <span className="text-xs font-mono text-sim-text-muted">
              {ra.targetVersion}
            </span>
          </div>
          <Button
            variant="danger"
            size="sm"
            disabled={inactive}
            onClick={() =>
              onConfirm({
                title: `Emergency Deploy: ${ra.targetVersion ?? ra.label}`,
                body: `Deploy ${ra.targetVersion} to ${ra.service} immediately, bypassing normal pipeline gates.`,
                action: () =>
                  dispatchAction("emergency_deploy", {
                    remediationActionId: ra.id,
                    service: ra.service,
                  }),
              })
            }
          >
            Deploy now
          </Button>
        </div>
      ))}
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
  // Track active throttle state per action id
  const [throttled, setThrottled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(actions.map((a) => [a.id, false])),
  );

  function handleToggle(ra: RemediationAction) {
    const isCurrentlyThrottled = throttled[ra.id] ?? false;
    const next = !isCurrentlyThrottled;
    onConfirm({
      title: next
        ? `Apply throttle: ${ra.label ?? ra.service}`
        : `Remove throttle: ${ra.label ?? ra.service}`,
      body: next
        ? `Apply traffic throttling to ${ra.service}. ${ra.sideEffect ?? "Load will be shed."}`
        : `Remove traffic throttling from ${ra.service}. Full traffic will resume.`,
      action: () => {
        setThrottled((prev) => ({ ...prev, [ra.id]: next }));
        dispatchAction("throttle_traffic", {
          remediationActionId: ra.id,
          service: ra.service,
          throttle: next,
        });
      },
    });
  }

  return (
    <Section title="Traffic Throttling">
      {actions.map((ra) => {
        const isActive = throttled[ra.id] ?? false;
        return (
          <div key={ra.id} className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-sim-text truncate">
                  {ra.label ?? ra.service}
                </span>
                {isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 bg-sim-yellow/20 text-sim-yellow">
                    ACTIVE
                  </span>
                )}
              </div>
            </div>
            <Button
              variant={isActive ? "danger" : "secondary"}
              size="sm"
              disabled={inactive}
              onClick={() => handleToggle(ra)}
            >
              {isActive ? "Remove throttle" : "Apply throttle"}
            </Button>
          </div>
        );
      })}
    </Section>
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

// ── Main panel ────────────────────────────────────────────────────────────────

export function RemediationsPanel({ inactive }: { inactive: boolean }) {
  const { scenario } = useScenario();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  if (!scenario) return null;

  const { remediationActions, featureFlags, hostGroups } = scenario;
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
    featureFlags.length > 0;

  if (!hasAnything) return null;

  return (
    <>
      <div className="flex flex-col gap-4">
        {emergencyDeploys.length > 0 && (
          <EmergencyDeploySection
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
