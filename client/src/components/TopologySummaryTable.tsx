/**
 * TopologySummaryTable — shared table component rendering a service topology
 * as a flat list of rows (Primary / Upstream / Downstream).
 *
 * Also exports COMPONENT_META for consistent component type icons/colours
 * across TopologyDiagram and ScenarioCanvas.
 */

// ── Component type metadata ───────────────────────────────────────────────────

export const COMPONENT_META: Record<
  string,
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

export interface TopologySummaryRow {
  name: string;
  role: "primary" | "upstream" | "downstream";
  description?: string;
  owner?: string;
}

export function TopologySummaryTable({ rows }: { rows: TopologySummaryRow[] }) {
  const roleStyle: Record<TopologySummaryRow["role"], string> = {
    primary: "text-sim-accent",
    upstream: "text-[#38bdf8]",
    downstream: "text-[#818cf8]",
  };

  const roleLabel: Record<TopologySummaryRow["role"], string> = {
    primary: "Primary",
    upstream: "Upstream",
    downstream: "Downstream",
  };

  return (
    <div className="border border-sim-border rounded overflow-hidden text-sm">
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
          {rows.map((row, i) => (
            <tr
              key={row.name}
              className={[
                "border-b border-sim-border last:border-0",
                row.role === "primary" ? "bg-sim-surface-2" : "",
              ].join(" ")}
            >
              <td
                className={`px-3 py-2 font-mono font-semibold ${roleStyle[row.role]}`}
              >
                {row.name}
              </td>
              <td className={`px-3 py-2 ${roleStyle[row.role]}`}>
                {roleLabel[row.role]}
              </td>
              <td className="px-3 py-2 text-sim-text-muted">
                {row.description}
              </td>
              <td className="px-3 py-2 font-mono text-sim-text-muted">
                {row.owner ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
