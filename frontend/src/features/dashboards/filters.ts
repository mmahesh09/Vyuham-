import { format, isValid, parse } from "date-fns";
import { createParser, parseAsJson, useQueryStates } from "nuqs";
import { z } from "zod";

import type { ViewQuery } from "./api";

/**
 * A calendar day as "yyyy-MM-dd" in the viewer's own time zone.
 * (nuqs' parseAsIsoDate goes through UTC, which shifts the day for anyone east of UTC.)
 */
const parseAsCalendarDate = createParser({
  parse: (v) => {
    const d = parse(v, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : null;
  },
  serialize: (d: Date) => format(d, "yyyy-MM-dd"),
  eq: (a, b) => format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd"),
});

const columnFilters = z.record(z.string(), z.string());

/** Dashboard filters live in the URL, so a shared link or a refresh keeps them. */
export const filterParsers = {
  from: parseAsCalendarDate,
  to: parseAsCalendarDate,
  f: parseAsJson(columnFilters).withDefault({}),
};

/** No dates means "all time". */
export type DashboardFilters = { from: Date | null; to: Date | null; f: Record<string, string> };

export function useDashboardFilters() {
  const [raw, setFilters] = useQueryStates(filterParsers, { history: "replace", scroll: false });
  const filters: DashboardFilters = { from: raw.from && raw.to ? raw.from : null, to: raw.from && raw.to ? raw.to : null, f: raw.f };
  return [filters, setFilters] as const;
}

export function toViewQuery(f: DashboardFilters): ViewQuery {
  return {
    from: f.from ? format(f.from, "yyyy-MM-dd") : null,
    to: f.to ? format(f.to, "yyyy-MM-dd") : null,
    f: f.f,
  };
}
