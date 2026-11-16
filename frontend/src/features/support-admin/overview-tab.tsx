"use client";

import { EChart } from "@/features/charts/echart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useOverview, type Overview } from "./api";
import { ChartWithTable, MODULE_LABEL, Panel, Stat, StatusBadge, num, pct, when } from "./ui";

// Single-series charts: one brand hue each (validated against the dark surface), so no legend is needed.
const BAR = "#705cbb"; // --primary: the app's bar colour
const LINE = "#cea3f5"; // --highlight: the app's line colour

function bars(data: { label: string; value: number }[]) {
  return {
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: { type: "category", data: data.map((d) => d.label).reverse(), axisTick: { show: false } },
    series: [{ type: "bar", name: "Error events", data: data.map((d) => d.value).reverse(), barMaxWidth: 18, itemStyle: { color: BAR, borderRadius: [0, 4, 4, 0] } }],
  };
}

// A marker per day only on short ranges; on longer ones the hover tooltip shows each day.
function trend(o: Overview) {
  return {
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: o.trend.map((d) => d.date.slice(5)), boundaryGap: false },
    yAxis: { type: "value", minInterval: 1 },
    series: [{ type: "line", name: "Error events", data: o.trend.map((d) => d.events), smooth: false, showSymbol: o.trend.length <= 15, symbolSize: 8, lineStyle: { width: 2, color: LINE }, itemStyle: { color: LINE }, areaStyle: { color: LINE, opacity: 0.08 } }],
  };
}

export function OverviewTab({ days, onOpenFingerprint }: { days: number; onOpenFingerprint: (fp: string) => void }) {
  const { data: o, isPending, isError, error } = useOverview(days);
  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (isError) return <p className="text-sm text-accent">{error.message}</p>;

  const resolution = o.error_resolution_rate;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Error events" value={num(o.total_events)} hint={`last ${days} days`} />
        <Stat label="Unique fingerprints" value={num(o.unique_fingerprints)} hint="distinct problems" />
        <Stat label="Unresolved errors" value={num(o.unresolved_errors)} hint="open error groups" tone={o.unresolved_errors ? { label: "Needs triage", variant: "warning-light" } : undefined} />
        <Stat label="Error resolution rate" value={pct(resolution)} hint={`of ${num(o.errors_seen)} seen`} />
        <Stat label="AI answers solved it" value={pct(o.ai.resolution_rate)} hint={`${num(o.ai.resolved)} yes · ${num(o.ai.unresolved)} no`} />
        <Stat label="Open support tickets" value={o.open_tickets === null ? "–" : num(o.open_tickets)} hint={o.open_tickets === null ? "Chatwoot not connected" : `${num(o.ai.escalated)} from the assistant`} />
        <Stat label="Knowledge to review" value={num(o.knowledge.pending)} hint={`${num(o.knowledge.approved)} verified · ${num(o.knowledge.rejected)} rejected`} />
      </div>

      <Panel title="Error trend" description={`Error events per day, last ${days} days`}>
        <ChartWithTable
          chart={<EChart option={trend(o)} label={`Line chart of error events per day over the last ${days} days`} height={240} />}
          columns={["Date", "Events"]}
          rows={o.trend.map((d) => [d.date, d.events])}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Errors by module" description="Error events in the period">
          {o.by_module.length ? (
            <ChartWithTable
              chart={<EChart option={bars(o.by_module.map((m) => ({ label: MODULE_LABEL[m.module] ?? m.module, value: m.events })))} label="Bar chart of error events by module" height={Math.max(140, o.by_module.length * 36)} />}
              columns={["Module", "Events"]}
              rows={o.by_module.map((m) => [MODULE_LABEL[m.module] ?? m.module, m.events])}
            />
          ) : (
            <p className="text-sm text-muted">No errors in this period.</p>
          )}
        </Panel>
        <Panel title="Errors by app version" description="Top 10 versions by error events">
          {o.by_version.length ? (
            <ChartWithTable
              chart={<EChart option={bars(o.by_version.map((v) => ({ label: v.version.length > 14 ? v.version.slice(0, 12) + "…" : v.version, value: v.events })))} label="Bar chart of error events by app version" height={Math.max(140, o.by_version.length * 36)} />}
              columns={["Version", "Events"]}
              rows={o.by_version.map((v) => [v.version, v.events])}
            />
          ) : (
            <p className="text-sm text-muted">No errors in this period.</p>
          )}
        </Panel>
      </div>

      <Panel title="Most frequent errors" description="Grouped by fingerprint across workspaces. Select one to see each workspace's occurrences.">
        {o.top_errors.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Error</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Workspaces</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.top_errors.map((e) => (
                  <TableRow key={e.fingerprint} className="cursor-pointer" onClick={() => onOpenFingerprint(e.fingerprint)}>
                    <TableCell className="max-w-[420px]">
                      <span className="block truncate font-mono text-[12px]" title={e.message}>{e.message}</span>
                      <span className="text-[12px] text-faint">{e.category} · {e.error_type}</span>
                    </TableCell>
                    <TableCell>{MODULE_LABEL[e.module] ?? e.module}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(e.events)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(e.workspaces)}</TableCell>
                    <TableCell><StatusBadge status={e.open_groups ? "open" : "resolved"} /></TableCell>
                    <TableCell className="whitespace-nowrap text-[13px] text-muted">{when(e.last_seen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted">No errors in this period.</p>
        )}
      </Panel>
    </div>
  );
}
