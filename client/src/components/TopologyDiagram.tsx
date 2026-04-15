/**
 * TopologyDiagram — renders the scenario service topology as a left-to-right
 * architecture diagram using React + inline SVG with pan/zoom.
 *
 * Layout: upstream column → focal service (with internal components) → downstream column
 *
 * No external dependencies — styled to match the sim's dark theme.
 * Text wraps naturally via foreignObject HTML divs — no truncation.
 */

import { useRef, useState, useCallback } from "react";
import type {
  TopologyConfig,
  ServiceComponent,
  ServiceNode,
} from "../scenario/types";

// ── Component type metadata ───────────────────────────────────────────────────

const COMPONENT_META: Record<
  ServiceComponent["type"],
  { icon: string; label: string; color: string }
> = {
  load_balancer: { icon: "⚖", label: "ALB", color: "#4ade80" },
  api_gateway: { icon: "⇌", label: "API GW", color: "#60a5fa" },
  ecs_cluster: { icon: "▣", label: "ECS", color: "#818cf8" },
  ec2_fleet: { icon: "□", label: "EC2", color: "#a78bfa" },
  lambda: { icon: "λ", label: "Lambda", color: "#f472b6" },
  kinesis_stream: { icon: "≋", label: "Kinesis", color: "#fb923c" },
  sqs_queue: { icon: "▭", label: "SQS", color: "#fbbf24" },
  dynamodb: { icon: "◈", label: "DynamoDB", color: "#34d399" },
  rds: { icon: "▤", label: "RDS", color: "#f87171" },
  elasticache: { icon: "⚡", label: "ElastiCache", color: "#fb923c" },
  s3: { icon: "▦", label: "S3", color: "#60a5fa" },
  scheduler: { icon: "◷", label: "Scheduler", color: "#94a3b8" },
};

// ── Layout constants ──────────────────────────────────────────────────────────

const COL_W = 260; // card width
const COL_GAP = 90; // horizontal gap between columns
const NODE_GAP = 16; // vertical gap between service cards

// Estimated row heights for SVG geometry (arrows, centering).
// Actual rendered heights may vary with text length — these are used only
// for computing arrow attachment points and vertical centering.
const SERVICE_H_EST = 110; // upstream/downstream card estimate
const COMP_H_EST = 62; // component box estimate
const COMP_GAP = 10;
const FOCAL_PAD = 14;
const HEADER_H = 90;

function focalHeightEst(compCount: number) {
  return (
    HEADER_H +
    FOCAL_PAD +
    compCount * (COMP_H_EST + COMP_GAP) -
    COMP_GAP +
    FOCAL_PAD +
    24
  );
}

// ── ServiceCard ───────────────────────────────────────────────────────────────

function ServiceCard({
  node,
  x,
  y,
  role,
}: {
  node: ServiceNode;
  x: number;
  y: number;
  role: "upstream" | "downstream";
}) {
  const border = role === "upstream" ? "#38bdf8" : "#818cf8";
  const bg = role === "upstream" ? "#0f2233" : "#17172a";

  return (
    <foreignObject x={x} y={y} width={COL_W} height={SERVICE_H_EST + 40}>
      <div
        style={{
          background: bg,
          border: `1.5px solid ${border}`,
          borderRadius: 8,
          padding: "10px 12px",
          boxSizing: "border-box",
          width: COL_W,
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: border,
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          {role.toUpperCase()}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e2e8f0",
            marginBottom: 4,
          }}
        >
          {node.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.4,
          }}
        >
          {node.description}
        </div>
        {node.typicalRps !== undefined && (
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
            ~{node.typicalRps} rps
          </div>
        )}
      </div>
    </foreignObject>
  );
}

// ── ComponentBox ──────────────────────────────────────────────────────────────

function ComponentBox({
  component,
  x,
  y,
}: {
  component: ServiceComponent;
  x: number;
  y: number;
}) {
  const meta = COMPONENT_META[component.type];

  return (
    <foreignObject x={x} y={y} width={COL_W - 20} height={COMP_H_EST + 20}>
      <div
        style={{
          background: "#111c2d",
          border: "1px solid #2d3f55",
          borderRadius: 5,
          padding: "8px 10px",
          boxSizing: "border-box",
          width: COL_W - 20,
          fontFamily: "monospace",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>
          {meta.icon} {meta.label}
        </span>
        <div
          style={{
            fontSize: 12,
            color: "#64748b",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.35,
          }}
        >
          {component.label}
        </div>
      </div>
    </foreignObject>
  );
}

// ── Arrow markers ─────────────────────────────────────────────────────────────

function ArrowDefs() {
  return (
    <defs>
      {(["38bdf8", "818cf8"] as const).map((c) => (
        <marker
          key={c}
          id={`ah-${c}`}
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill={`#${c}`} />
        </marker>
      ))}
      <marker
        id="ah-comp"
        markerWidth="6"
        markerHeight="5"
        refX="5"
        refY="2.5"
        orient="auto"
      >
        <polygon points="0 0, 6 2.5, 0 5" fill="#2d3f55" />
      </marker>
    </defs>
  );
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  colorHex,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colorHex: string;
}) {
  const mx = (x1 + x2) / 2;
  const key = colorHex.replace("#", "");
  return (
    <path
      d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke={colorHex}
      strokeWidth={1.5}
      markerEnd={`url(#ah-${key})`}
    />
  );
}

// ── FocalServiceBox ───────────────────────────────────────────────────────────

function FocalServiceBox({
  node,
  x,
  y,
  focalH,
}: {
  node: ServiceNode;
  x: number;
  y: number;
  focalH: number;
}) {
  const compX = x + 10;

  return (
    <g>
      {/* Outer border */}
      <rect
        x={x}
        y={y}
        width={COL_W}
        height={focalH}
        rx={8}
        fill="#0d1929"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      {/* Header band */}
      <rect
        x={x}
        y={y}
        width={COL_W}
        height={HEADER_H}
        rx={8}
        fill="#0b1e30"
        stroke="none"
      />
      <rect
        x={x}
        y={y + HEADER_H - 8}
        width={COL_W}
        height={8}
        fill="#0b1e30"
      />

      {/* Header text via foreignObject so it wraps too */}
      <foreignObject x={x} y={y} width={COL_W} height={HEADER_H}>
        <div
          style={{
            padding: "10px 12px",
            fontFamily: "monospace",
            height: HEADER_H,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#38bdf8",
              letterSpacing: "0.08em",
            }}
          >
            PRIMARY SERVICE
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: "#f1f5f9",
              marginTop: 2,
            }}
          >
            {node.name}
          </div>
          {node.description && (
            <div
              style={{
                fontSize: 12,
                color: "#94a3b8",
                fontFamily: "system-ui, sans-serif",
                lineHeight: 1.4,
                marginTop: 3,
              }}
            >
              {node.description}
            </div>
          )}
        </div>
      </foreignObject>

      {/* Component stack */}
      {node.components.map((comp, i) => {
        const cy = y + HEADER_H + FOCAL_PAD + i * (COMP_H_EST + COMP_GAP);
        const midX = compX + (COL_W - 20) / 2;
        return (
          <g key={comp.id}>
            {i > 0 && (
              <line
                x1={midX}
                y1={cy - COMP_GAP}
                x2={midX}
                y2={cy}
                stroke="#2d3f55"
                strokeWidth={1.5}
                markerEnd="url(#ah-comp)"
              />
            )}
            <ComponentBox component={comp} x={compX} y={cy} />
          </g>
        );
      })}

      {/* Footer */}
      {(node.owner || node.typicalRps) && (
        <text
          x={x + 12}
          y={y + focalH - 8}
          fontSize={11}
          fill="#94a3b8"
          fontFamily="monospace"
        >
          {[
            node.owner && `owner: ${node.owner}`,
            node.typicalRps && `~${node.typicalRps} rps`,
          ]
            .filter(Boolean)
            .join("  ")}
        </text>
      )}
    </g>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function TopologyDiagram({ topology }: { topology: TopologyConfig }) {
  const { focalService, upstream, downstream } = topology;

  const focalH = focalHeightEst(focalService.components.length);
  const upstreamH = upstream.length * (SERVICE_H_EST + NODE_GAP) - NODE_GAP;
  const downH = downstream.length * (SERVICE_H_EST + NODE_GAP) - NODE_GAP;
  const svgH = Math.max(focalH, upstreamH, downH) + 60;

  const upstreamX = 20;
  const focalX = upstreamX + COL_W + COL_GAP;
  const downstreamX = focalX + COL_W + COL_GAP;
  const svgW = downstreamX + COL_W + 20;

  const focalY = Math.round((svgH - focalH) / 2);
  const focalMidY = focalY + focalH / 2;

  // ── Pan ────────────────────────────────────────────────────────────────────

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    startX: number;
    startY: number;
    tx: number;
    ty: number;
  } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      drag.current = {
        startX: e.clientX,
        startY: e.clientY,
        tx: pos.x,
        ty: pos.y,
      };
    },
    [pos],
  );

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    setPos({
      x: drag.current.tx + (e.clientX - drag.current.startX),
      y: drag.current.ty + (e.clientY - drag.current.startY),
    });
  }, []);

  const onMouseUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onReset = () => setPos({ x: 0, y: 0 });

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-sim-text-muted">Drag to pan</span>
        <button
          onClick={onReset}
          className="text-xs text-sim-text-faint hover:text-sim-text border border-sim-border px-2 py-0.5 rounded transition-colors"
        >
          Reset view
        </button>
      </div>

      {/* Canvas */}
      <div
        className="overflow-hidden rounded border border-sim-border bg-sim-bg select-none"
        style={{
          cursor: drag.current ? "grabbing" : "grab",
          height: svgH + 20,
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px)`,
            transformOrigin: "0 0",
          }}
        >
          <ArrowDefs />

          {upstream.map((node, i) => {
            const nodeY = Math.round(
              (svgH - upstreamH) / 2 + i * (SERVICE_H_EST + NODE_GAP),
            );
            const nodeMidY = nodeY + SERVICE_H_EST / 2;
            return (
              <g key={node.name}>
                <ServiceCard
                  node={node}
                  x={upstreamX}
                  y={nodeY}
                  role="upstream"
                />
                <Arrow
                  x1={upstreamX + COL_W}
                  y1={nodeMidY}
                  x2={focalX}
                  y2={focalMidY}
                  colorHex="#38bdf8"
                />
              </g>
            );
          })}

          <FocalServiceBox
            node={focalService}
            x={focalX}
            y={focalY}
            focalH={focalH}
          />

          {downstream.map((node, i) => {
            const nodeY = Math.round(
              (svgH - downH) / 2 + i * (SERVICE_H_EST + NODE_GAP),
            );
            const nodeMidY = nodeY + SERVICE_H_EST / 2;
            return (
              <g key={node.name}>
                <ServiceCard
                  node={node}
                  x={downstreamX}
                  y={nodeY}
                  role="downstream"
                />
                <Arrow
                  x1={focalX + COL_W}
                  y1={focalMidY}
                  x2={downstreamX}
                  y2={nodeMidY}
                  colorHex="#818cf8"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Summary table */}
      <div className="mt-6 border border-sim-border rounded overflow-hidden text-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-sim-surface border-b border-sim-border">
              <th className="text-left px-3 py-2 text-sim-text-faint font-medium w-36">
                Service
              </th>
              <th className="text-left px-3 py-2 text-sim-text-faint font-medium w-24">
                Role
              </th>
              <th className="text-left px-3 py-2 text-sim-text-faint font-medium">
                Description
              </th>
              <th className="text-left px-3 py-2 text-sim-text-faint font-medium w-28">
                Owner
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-sim-border bg-sim-surface-2">
              <td className="px-3 py-2 font-mono text-sim-accent font-semibold">
                {focalService.name}
              </td>
              <td className="px-3 py-2 text-sim-accent">Primary</td>
              <td className="px-3 py-2 text-sim-text-muted">
                {focalService.description}
              </td>
              <td className="px-3 py-2 font-mono text-sim-text-muted">
                {focalService.owner ?? "—"}
              </td>
            </tr>
            {upstream.map((node) => (
              <tr key={node.name} className="border-b border-sim-border">
                <td className="px-3 py-2 font-mono text-sim-text">
                  {node.name}
                </td>
                <td className="px-3 py-2 text-[#38bdf8]">Upstream</td>
                <td className="px-3 py-2 text-sim-text-muted">
                  {node.description}
                </td>
                <td className="px-3 py-2 font-mono text-sim-text-muted">
                  {node.owner ?? "—"}
                </td>
              </tr>
            ))}
            {downstream.map((node) => (
              <tr
                key={node.name}
                className="border-b border-sim-border last:border-0"
              >
                <td className="px-3 py-2 font-mono text-sim-text">
                  {node.name}
                </td>
                <td className="px-3 py-2">
                  <span className="text-[#818cf8]">Downstream</span>
                </td>
                <td className="px-3 py-2 text-sim-text-muted">
                  {node.description}
                </td>
                <td className="px-3 py-2 font-mono text-sim-text-muted">
                  {node.owner ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
