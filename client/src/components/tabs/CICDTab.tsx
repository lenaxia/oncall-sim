import React, { useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom";
import { useSession } from "../../context/SessionContext";
import { useScenario } from "../../context/ScenarioContext";
import { useSimClock } from "../../hooks/useSimClock";
import { EmptyState } from "../EmptyState";
import { WallTimestamp } from "../Timestamp";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { RemediationsPanel } from "./RemediationsPanel";
import type {
  Pipeline,
  PipelineStage,
  StageStatus,
  StageBlocker,
} from "@shared/types/events";

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_CARD_W = 230; // px, fixed width for each stage card

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelSim(simTime: number, now: number): string {
  const diff = now - simTime;
  if (diff < 0) return "in future";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = Math.floor(diff % 60);
  if (h > 0) return `${h}h ${m}m ago`;
  if (m > 0) return `${m}m ago`;
  return `${s}s ago`;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function pipelineOverallStatus(
  p: Pipeline,
): "healthy" | "blocked" | "failed" | "in_progress" {
  const statuses = p.stages.map((s) => s.status);
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "blocked")) return "blocked";
  if (statuses.some((s) => s === "in_progress")) return "in_progress";
  return "healthy";
}

function prodStage(p: Pipeline): PipelineStage | null {
  return [...p.stages].reverse().find((s) => s.type === "deploy") ?? null;
}

// ── Status colours ────────────────────────────────────────────────────────────

const STATUS_DOT: Record<StageStatus, string> = {
  succeeded: "bg-sim-green",
  in_progress: "bg-sim-accent animate-pulse",
  blocked: "bg-sim-green",
  failed: "bg-sim-red",
  not_started: "bg-sim-text-faint",
};

const STATUS_LABEL: Record<StageStatus, string> = {
  succeeded: "SUCCEEDED",
  in_progress: "DEPLOYING",
  blocked: "SUCCEEDED",
  failed: "FAILED",
  not_started: "NOT STARTED",
};

const STATUS_TEXT: Record<StageStatus, string> = {
  succeeded: "text-sim-green",
  in_progress: "text-sim-accent",
  blocked: "text-sim-green",
  failed: "text-sim-red",
  not_started: "text-sim-text-muted",
};

const OVERALL_STYLES = {
  healthy: { dot: "bg-sim-green", label: "HEALTHY", text: "text-sim-green" },
  blocked: { dot: "bg-sim-red", label: "BLOCKED", text: "text-sim-red" },
  failed: { dot: "bg-sim-red", label: "FAILED", text: "text-sim-red" },
  in_progress: {
    dot: "bg-sim-accent",
    label: "DEPLOYING",
    text: "text-sim-accent",
  },
};

// ── PortalPopup — reusable hover/tap popup anchored to an element ─────────────

function PortalPopup({
  anchor,
  children,
  width = 240,
  onMouseEnter,
  onMouseLeave,
}: {
  anchor: DOMRect | null;
  children: React.ReactNode;
  width?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (!anchor) return null;
  const top = anchor.bottom + 6;
  const left = Math.max(8, anchor.left + anchor.width / 2 - width / 2);

  return ReactDOM.createPortal(
    <div
      style={{ top, left, width }}
      className="fixed z-[9999] bg-sim-surface border border-sim-border rounded shadow-xl text-xs"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-sim-border" />
      {children}
    </div>,
    document.body,
  );
}

function useHoverAnchor() {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setRect(ref.current?.getBoundingClientRect() ?? null);
  }, []);

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => setRect(null), 80);
  }, []);

  // Called when the cursor enters the portal popup itself — cancels hide
  const keepOpen = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  return { ref, rect, show, hide, keepOpen };
}

// ── DeploymentHistoryPopup ────────────────────────────────────────────────────

function DeploymentHistoryPopup({
  stage,
  simTime,
}: {
  stage: PipelineStage;
  simTime: number;
}) {
  const { ref, rect, show, hide, keepOpen } = useHoverAnchor();

  if (stage.promotionEvents.length === 0) {
    return (
      <span className="text-sim-text-muted text-xs">
        {formatRelSim(stage.deployedAtSec, simTime)}
      </span>
    );
  }

  return (
    <>
      <div
        ref={ref}
        className="text-xs text-sim-text-muted underline decoration-dotted cursor-pointer"
        onMouseEnter={show}
        onMouseLeave={hide}
        onTouchStart={show}
        onTouchEnd={hide}
      >
        {formatRelSim(stage.deployedAtSec, simTime)}
      </div>
      <PortalPopup
        anchor={rect}
        width={260}
        onMouseEnter={keepOpen}
        onMouseLeave={hide}
      >
        <div className="px-3 py-2 border-b border-sim-border font-semibold text-sim-text-muted uppercase tracking-wide text-xs">
          Promotion History
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          {stage.promotionEvents.slice(0, 5).map((ev, i) => {
            const color =
              ev.status === "succeeded"
                ? "text-sim-green"
                : ev.status === "failed"
                  ? "text-sim-red"
                  : "text-sim-yellow";
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`font-medium flex-shrink-0 ${color}`}>
                  {ev.status === "succeeded"
                    ? "✓"
                    : ev.status === "failed"
                      ? "✗"
                      : "⚠"}
                </span>
                <div className="min-w-0">
                  <span className="font-mono text-sim-text-muted">
                    {ev.version}
                  </span>
                  <span className="text-sim-text-muted ml-1">
                    · <WallTimestamp simTime={ev.simTime} />
                  </span>
                  {ev.note && (
                    <div className="text-sim-text-muted truncate">
                      {ev.note}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PortalPopup>
    </>
  );
}

// ── ApprovalWorkflow ─────────────────────────────────────────────────────────

function ProgressBar({
  pct,
  color = "bg-sim-accent",
}: {
  pct: number;
  color?: string;
}) {
  return (
    <div className="h-1.5 w-full bg-sim-surface-2 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }}
      />
    </div>
  );
}

// ── ApprovalWorkflow phase constants (single source of truth) ────────────────
// Phase proportions are a UI concern — game-loop only sets stageStartedAtSim +
// stageDurationSecs; the UI derives phases from stage.type and stage.tests using
// live interpolated simTime at 60fps via requestAnimationFrame in useSimClock.

// Fraction of total stage duration spent in the first phase (build/deploy).
const PHASE_1_END = 0.1; // 0–10%
// Fraction spent in phases 1+2 when a test phase exists.
const PHASE_2_END = 0.5; // 10–50%

export function ApprovalWorkflow({
  stage,
  simTime,
}: {
  stage: PipelineStage;
  simTime: number;
}) {
  // Capture the interpolated simTime on the first RAF frame that sees this
  // stage as in_progress. This is the correct clock anchor for elapsed time —
  // using stage.stageStartedAtSim directly causes jumps because the game loop
  // tick fires every 60 sim-seconds and useSimClock may already be well ahead
  // of stageStartedAtSim by the time React renders.
  // key={stage.status} on the parent resets this ref on every status change.
  const startRef = useRef<number | null>(null);
  if (stage.status === "in_progress" && startRef.current === null) {
    startRef.current = simTime;
  }

  const isBuild = stage.type === "build";
  const hasTests = stage.tests.length > 0;
  const hasBake = !isBuild;
  const phase1Label = isBuild ? "Building" : "Deploying";

  const testCount = stage.tests.length;
  const testsPassed = stage.tests.filter((t) => t.status === "passed").length;
  const testsFailed = stage.tests.filter((t) => t.status === "failed").length;

  if (
    stage.status === "in_progress" &&
    startRef.current !== null &&
    stage.stageDurationSecs !== undefined
  ) {
    const duration = stage.stageDurationSecs;
    const elapsed = Math.max(0, simTime - startRef.current);
    const pctDone = Math.min(1, elapsed / duration);

    // Phase boundary calculations depend on which phases exist.
    // Layout: [phase1] [tests?] [bake?]
    // With tests + bake:    0–10% / 10–50% / 50–100%
    // With tests, no bake:  0–10% / 10–100%
    // With bake, no tests:  0–10% / 10–100%
    // Phase1 only:          0–100%
    const phase1End = hasTests || hasBake ? PHASE_1_END : 1;
    const phase2End = hasTests && hasBake ? PHASE_2_END : 1;

    const phase1Duration = duration * phase1End;
    const phase2Duration = hasTests ? duration * (phase2End - phase1End) : 0;
    const phase3Duration = hasBake ? duration * (1 - phase2End) : 0;

    // — Phase 1 active —
    if (pctDone < phase1End) {
      const pct = pctDone / phase1End;
      const remaining = phase1Duration - elapsed;
      return (
        <div className="flex flex-col gap-2">
          <PhaseRow
            label={phase1Label}
            active
            pct={pct}
            detail={`${formatDuration(remaining)} remaining`}
          />
          {hasTests && (
            <PhaseRow label={`Tests (0/${testCount})`} active={false} pct={0} />
          )}
          {hasBake && <PhaseRow label="Bake time" active={false} pct={0} />}
        </div>
      );
    }

    // — Phase 2 (tests) active —
    if (hasTests && pctDone < phase2End) {
      const testElapsed = elapsed - phase1Duration;
      const testPct = Math.min(1, testElapsed / phase2Duration);
      const estimatedPassed = Math.min(
        testCount,
        Math.floor(testPct * testCount),
      );
      const remaining = duration * phase2End - elapsed;
      return (
        <div className="flex flex-col gap-2">
          <PhaseRow label={phase1Label} active={false} pct={1} complete />
          <PhaseRow
            label={`Tests (${estimatedPassed}/${testCount})`}
            active
            pct={testPct}
            detail={
              testsFailed > 0
                ? `${testsFailed} failing`
                : `${formatDuration(remaining)} remaining`
            }
            color={testsFailed > 0 ? "bg-sim-red" : "bg-sim-accent"}
          />
          {hasBake && <PhaseRow label="Bake time" active={false} pct={0} />}
        </div>
      );
    }

    // — Phase 3 (bake) active —
    if (hasBake) {
      const bakeElapsed = elapsed - duration * phase2End;
      const bakePct = Math.min(1, bakeElapsed / phase3Duration);
      const remaining = Math.max(0, phase3Duration - bakeElapsed);
      return (
        <div className="flex flex-col gap-2">
          <PhaseRow label={phase1Label} active={false} pct={1} complete />
          {hasTests && (
            <PhaseRow
              label={`Tests (${testCount}/${testCount})`}
              active={false}
              pct={1}
              complete
            />
          )}
          <PhaseRow
            label="Bake time"
            active
            pct={bakePct}
            detail={`${formatDuration(remaining)} remaining`}
          />
        </div>
      );
    }
  }

  // not_started
  if (stage.status === "not_started") {
    return <div className="text-xs text-sim-text-muted">Not yet started</div>;
  }

  // succeeded / blocked / failed — labels only, no bars
  const anyTestsFailed = testsFailed > 0;
  return (
    <div className="flex flex-col gap-2">
      <PhaseRow label={phase1Label} active={false} pct={1} complete />
      {hasTests && (
        <PhaseRow
          label={`Tests (${testsPassed}/${testCount})`}
          active={false}
          pct={1}
          complete={!anyTestsFailed}
          color={anyTestsFailed ? "bg-sim-red" : "bg-sim-green"}
        />
      )}
      {hasBake && (
        <PhaseRow label="Bake time" active={false} pct={1} complete />
      )}
    </div>
  );
}

function PhaseRow({
  label,
  active,
  pct,
  complete = false,
  detail,
  color = "bg-sim-accent",
}: {
  label: string;
  active: boolean;
  pct: number;
  complete?: boolean;
  detail?: string;
  color?: string;
}) {
  const barColor = complete ? "bg-sim-green" : color;
  const textColor = active
    ? "text-sim-text"
    : complete
      ? "text-sim-green"
      : "text-sim-text-muted";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-medium ${textColor}`}>
          {complete ? "✓ " : active ? "▶ " : "○ "}
          {label}
        </span>
        {detail && active && (
          <span className="text-xs text-sim-text-muted shrink-0">{detail}</span>
        )}
      </div>
      {active && <ProgressBar pct={pct} color={barColor} />}
    </div>
  );
}

function TestList({ tests }: { tests: PipelineStage["tests"] }) {
  if (tests.length === 0)
    return <div className="text-xs text-sim-text-muted">No tests</div>;
  return (
    <div className="flex flex-col gap-1">
      {tests.map((t, i) => {
        const color =
          t.status === "passed"
            ? "text-sim-green"
            : t.status === "failed"
              ? "text-sim-red"
              : t.status === "running"
                ? "text-sim-accent"
                : "text-sim-text-muted";
        const icon =
          t.status === "passed"
            ? "✓"
            : t.status === "failed"
              ? "✗"
              : t.status === "running"
                ? "…"
                : "○";
        return (
          <div key={i} className={`text-xs flex items-center gap-1 ${color}`}>
            <span className="w-3 flex-shrink-0">{icon}</span>
            <span>{t.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── PromotionConnector ────────────────────────────────────────────────────────

function PromotionConnector({
  nextStage,
  inactive,
  onBlock,
  onApprove,
  onOverride,
}: {
  nextStage: PipelineStage;
  inactive: boolean;
  onBlock: () => void;
  onApprove: () => void;
  onOverride: () => void;
}) {
  const { ref, rect, show, hide, keepOpen } = useHoverAnchor();

  const hasManualBlocker = nextStage.blockers.some(
    (b) => b.type === "manual_approval",
  );
  const hasHardBlocker = nextStage.blockers.some(
    (b) => b.type === "alarm" || b.type === "time_window",
  );
  const hasBlocker = hasManualBlocker || hasHardBlocker;

  return (
    <div className="flex items-center flex-shrink-0">
      {/* left stem */}
      <div className="w-5 h-px bg-sim-text-faint" />

      {/* indicator */}
      <div
        ref={ref}
        className="relative"
        onMouseEnter={show}
        onMouseLeave={hide}
        onTouchStart={show}
        onTouchEnd={hide}
      >
        {hasHardBlocker ? (
          <span className="text-sim-red text-base leading-none px-0.5 cursor-default">
            ⊘
          </span>
        ) : hasManualBlocker ? (
          <span
            data-testid={`connector-approve-${nextStage.id}`}
            className="text-sim-yellow text-base leading-none px-0.5 cursor-pointer"
            onClick={() => {
              hide();
              onApprove();
            }}
          >
            ⊘
          </span>
        ) : (
          <div
            data-testid={`connector-block-${nextStage.id}`}
            className="w-4 h-4 rounded-full bg-sim-green hover:bg-sim-yellow transition-colors cursor-pointer"
            onClick={() => {
              hide();
              onBlock();
            }}
          />
        )}
      </div>

      {/* right stem + arrowhead */}
      <div className="w-5 h-px bg-sim-text-faint" />
      <div className="-ml-1 border-y-4 border-y-transparent border-l-4 border-l-sim-text-faint" />

      {/* Popup */}
      <PortalPopup
        anchor={rect}
        width={260}
        onMouseEnter={keepOpen}
        onMouseLeave={hide}
      >
        {hasHardBlocker ? (
          <BlockerPopupContent
            blockers={nextStage.blockers.filter(
              (b) => b.type === "alarm" || b.type === "time_window",
            )}
            stageName={nextStage.name}
            inactive={inactive}
            onOverride={() => {
              hide();
              onOverride();
            }}
          />
        ) : hasManualBlocker ? (
          <ManualGatePopupContent
            stageName={nextStage.name}
            inactive={inactive}
            onApprove={() => {
              hide();
              onApprove();
            }}
          />
        ) : (
          <OpenGatePopupContent
            stageName={nextStage.name}
            inactive={inactive}
            onBlock={() => {
              hide();
              onBlock();
            }}
          />
        )}
      </PortalPopup>
    </div>
  );
}

function BlockerPopupContent({
  blockers,
  stageName,
  inactive,
  onOverride,
}: {
  blockers: StageBlocker[];
  stageName: string;
  inactive: boolean;
  onOverride: () => void;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-sim-border">
        <div className="font-semibold text-sim-red">Promotion Blocked</div>
        <div className="text-sim-text-muted mt-0.5">into {stageName}</div>
      </div>
      <div className="px-3 py-2 flex flex-col gap-2">
        {blockers.map((b, i) => (
          <div key={i}>
            <div className="font-medium text-sim-text capitalize">
              {b.type.replace("_", " ")}
            </div>
            {b.message && (
              <div className="text-sim-text-muted mt-0.5">{b.message}</div>
            )}
          </div>
        ))}
      </div>
      <div className="px-3 pb-3">
        <Button
          variant="danger"
          size="sm"
          disabled={inactive}
          onClick={onOverride}
          className="w-full"
        >
          Override Blocker
        </Button>
        <div className="text-xs text-sim-text-muted mt-1.5">
          ⚠ Override expires after 30 sim-minutes if alarm still firing.
        </div>
      </div>
    </>
  );
}

function ManualGatePopupContent({
  stageName,
  inactive,
  onApprove,
}: {
  stageName: string;
  inactive: boolean;
  onApprove: () => void;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-sim-border">
        <div className="font-semibold text-sim-yellow">
          Manual Promotion Block
        </div>
        <div className="text-sim-text-muted mt-0.5">
          Promotion into {stageName} is held.
        </div>
      </div>
      <div className="px-3 py-3">
        <Button
          variant="primary"
          size="sm"
          disabled={inactive}
          onClick={onApprove}
          className="w-full"
        >
          Remove Manual Promotion Block
        </Button>
      </div>
    </>
  );
}

function OpenGatePopupContent({
  stageName,
  inactive,
  onBlock,
}: {
  stageName: string;
  inactive: boolean;
  onBlock: () => void;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-sim-border">
        <div className="font-semibold text-sim-green">Promotion Open</div>
        <div className="text-sim-text-muted mt-0.5">into {stageName}</div>
      </div>
      <div className="px-3 py-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={inactive}
          onClick={onBlock}
          className="w-full"
        >
          Add Manual Promotion Block
        </Button>
      </div>
    </>
  );
}

// ── StageCard ─────────────────────────────────────────────────────────────────

function StageCard({
  stage,
  simTime,
  inactive,
  onRollback,
  onOverride,
}: {
  stage: PipelineStage;
  simTime: number;
  inactive: boolean;
  onRollback: () => void;
  onOverride: () => void;
}) {
  const hasAlarmBlocker = stage.blockers.some(
    (b) => b.type !== "manual_approval",
  );
  const isBuildStage = stage.type === "build";

  return (
    <div
      data-testid={`stage-card-${stage.id}`}
      className="flex flex-col bg-sim-surface border border-sim-border rounded overflow-hidden"
      style={{ width: STAGE_CARD_W, minWidth: STAGE_CARD_W }}
    >
      {/* ── Header ── */}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-1 border-b border-sim-border">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-sim-text uppercase tracking-wide">
            {stage.name}
          </span>
          <span
            className={`flex items-center gap-1 text-xs font-medium ${STATUS_TEXT[stage.status]}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[stage.status]}`}
            />
            {STATUS_LABEL[stage.status]}
          </span>
        </div>

        <div className="font-mono text-sm text-sim-text-muted">
          {stage.currentVersion}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-sim-text-muted">
          <DeploymentHistoryPopup stage={stage} simTime={simTime} />
        </div>

        {stage.commitMessage && (
          <div
            className="text-xs text-sim-text-muted truncate"
            title={stage.commitMessage}
          >
            {stage.commitMessage}
          </div>
        )}
      </div>

      {/* ── Approval workflow ── */}
      <div className="px-3 py-2.5 flex-1 border-b border-sim-border">
        <div className="text-xs font-semibold text-sim-text-muted uppercase tracking-wider mb-2">
          {isBuildStage ? "Build & Test" : "Approval Workflow"}
        </div>
        {/* key resets on status change so CSS transitions never animate backwards
            when switching from static (completed, pct=1) to active (pct=0) */}
        <div key={stage.status}>
          <ApprovalWorkflow stage={stage} simTime={simTime} />
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {stage.previousVersion && (
          <Button
            variant="danger"
            size="sm"
            disabled={inactive || stage.status === "in_progress"}
            onClick={onRollback}
            className="w-full text-xs"
          >
            Rollback → {stage.previousVersion}
          </Button>
        )}
        {hasAlarmBlocker && (
          <Button
            variant="secondary"
            size="sm"
            disabled={inactive}
            onClick={onOverride}
            className="w-full text-xs"
          >
            Override Blocker
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main CICDTab ──────────────────────────────────────────────────────────────

export function CICDTab() {
  const { state, dispatchAction } = useSession();
  const { scenario } = useScenario();
  const { simTime } = useSimClock();

  const pipelines = state.pipelines;

  const focalPipelineId =
    pipelines.find((p) => p.service === scenario?.topology.focalService.name)
      ?.id ??
    pipelines[0]?.id ??
    null;

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(
    focalPipelineId,
  );

  // Re-sync when pipelines first load (e.g. snapshot arrives after mount)
  useEffect(() => {
    if (selectedPipelineId === null && focalPipelineId !== null) {
      setSelectedPipelineId(focalPipelineId);
    }
  }, [focalPipelineId, selectedPipelineId]);

  const [confirmRollback, setConfirmRollback] = useState<{
    pipelineId: string;
    stageId: string;
    version: string;
  } | null>(null);
  const [confirmOverride, setConfirmOverride] = useState<{
    pipelineId: string;
    stageId: string;
  } | null>(null);

  const selectedPipeline =
    pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  const inactive = state.status !== "active";

  function handleSelectPipeline(p: Pipeline) {
    setSelectedPipelineId(p.id);
    dispatchAction("view_pipeline", { pipelineId: p.id, pipelineName: p.name });
  }

  function handleRollback() {
    if (!confirmRollback) return;
    dispatchAction("trigger_rollback", {
      pipelineId: confirmRollback.pipelineId,
      stageId: confirmRollback.stageId,
    });
    setConfirmRollback(null);
  }

  function handleOverride() {
    if (!confirmOverride) return;
    dispatchAction("override_blocker", {
      pipelineId: confirmOverride.pipelineId,
      stageId: confirmOverride.stageId,
    });
    setConfirmOverride(null);
  }

  if (pipelines.length === 0) {
    return (
      <EmptyState
        title="No pipelines"
        message="Pipeline data will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Pipeline list */}
      <div className="flex-shrink-0 border-b border-sim-border bg-sim-surface">
        <div className="text-xs font-semibold text-sim-text-muted uppercase tracking-wide px-4 pt-3 pb-2">
          Pipelines
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-sim-text-muted uppercase tracking-wide border-b border-sim-border">
              <th className="px-4 py-1.5 text-left">Pipeline</th>
              <th className="px-4 py-1.5 text-left">Status</th>
              <th className="px-4 py-1.5 text-left">Last Prod Deploy</th>
              <th className="px-4 py-1.5 text-left">Versions Pending Prod</th>
            </tr>
          </thead>
          <tbody>
            {pipelines.map((p) => {
              const overall = pipelineOverallStatus(p);
              const style = OVERALL_STYLES[overall];
              const prod = prodStage(p);
              const pending = p.stages.filter(
                (s) => s.currentVersion !== prod?.currentVersion,
              ).length;
              const isActive = p.id === selectedPipelineId;
              return (
                <tr
                  key={p.id}
                  className={[
                    "border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2 transition-colors duration-75",
                    isActive
                      ? "bg-sim-surface-2 border-l-2 border-l-sim-accent"
                      : "",
                  ].join(" ")}
                  onClick={() => handleSelectPipeline(p)}
                >
                  <td className="px-4 py-2 font-medium text-sim-text">
                    {p.name}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`}
                      />
                      <span className={`font-mono ${style.text}`}>
                        {style.label}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sim-text-muted">
                    {prod ? formatRelSim(prod.deployedAtSec, simTime) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {pending > 0 ? (
                      <span className="text-sim-yellow">
                        {pending} stage{pending > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-sim-text-muted">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stage cards + remediation — scrollable */}
      <div className="flex-1 overflow-auto">
        {selectedPipeline ? (
          <div className="p-4 flex flex-col gap-4">
            {/* Stage flow */}
            <div data-testid="stage-flow" className="overflow-x-auto pb-2">
              <div className="flex items-start w-fit">
                {selectedPipeline.stages.map((stage, idx) => (
                  <React.Fragment key={stage.id}>
                    {idx > 0 && (
                      <div
                        className="flex items-center"
                        style={{ marginTop: 48 }}
                      >
                        <PromotionConnector
                          nextStage={stage}
                          inactive={inactive}
                          onBlock={() =>
                            dispatchAction("block_promotion", {
                              pipelineId: selectedPipeline.id,
                              stageId: stage.id,
                            })
                          }
                          onApprove={() =>
                            dispatchAction("approve_gate", {
                              pipelineId: selectedPipeline.id,
                              stageId: stage.id,
                            })
                          }
                          onOverride={() =>
                            setConfirmOverride({
                              pipelineId: selectedPipeline.id,
                              stageId: stage.id,
                            })
                          }
                        />
                      </div>
                    )}
                    <StageCard
                      stage={stage}
                      simTime={simTime}
                      inactive={inactive}
                      onRollback={() =>
                        setConfirmRollback({
                          pipelineId: selectedPipeline.id,
                          stageId: stage.id,
                          version: stage.previousVersion ?? "",
                        })
                      }
                      onOverride={() =>
                        setConfirmOverride({
                          pipelineId: selectedPipeline.id,
                          stageId: stage.id,
                        })
                      }
                    />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32">
            <EmptyState
              title="Select a pipeline"
              message="Click a pipeline above to view its stages."
            />
          </div>
        )}

        {/* Remediation controls */}
        <div className="border-t border-sim-border">
          <details open className="group">
            <summary
              className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none
                                 hover:bg-sim-surface-2 text-xs font-semibold text-sim-text-muted
                                 uppercase tracking-wide list-none"
            >
              <span className="group-open:rotate-90 transition-transform duration-100 text-sim-text-muted">
                ▶
              </span>
              Remediation Controls
            </summary>
            <div className="px-4 py-3 flex flex-col gap-4">
              <RemediationsPanel inactive={inactive} />
            </div>
          </details>
        </div>
      </div>

      {/* Rollback confirmation */}
      <Modal
        open={confirmRollback !== null}
        onClose={() => setConfirmRollback(null)}
        title="Confirm Rollback"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRollback(null)}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleRollback}>
              Rollback →
            </Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted">
          Roll back <strong>{confirmRollback?.stageId}</strong> to{" "}
          <strong>{confirmRollback?.version}</strong>?
        </p>
      </Modal>

      {/* Override confirmation */}
      <Modal
        open={confirmOverride !== null}
        onClose={() => setConfirmOverride(null)}
        title="Override Blocker"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOverride(null)}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleOverride}>
              Override →
            </Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted mb-2">
          Force-promote through the blocking condition on{" "}
          <strong>{confirmOverride?.stageId}</strong>.
        </p>
        <p className="text-xs text-sim-yellow">
          ⚠ Alarm blockers will reinstate in 30 sim-minutes if the alarm is
          still firing.
        </p>
      </Modal>
    </div>
  );
}
