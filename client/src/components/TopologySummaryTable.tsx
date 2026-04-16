/**
 * TopologySummaryTable — shared table component rendering a service topology
 * as a flat list of rows (Primary / Upstream / Downstream).
 *
 * Accepts the raw snake_case shape directly so it works in both:
 *   - TopologyDiagram (wiki tab, live sim) — adapts camelCase TopologyConfig
 *   - ScenarioCanvas (builder) — passes raw YAML topology directly
 */

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
