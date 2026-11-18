import type { ReactNode } from "react";

/** Sample numbers shared by the plain chart styles, which ship without any data of their own. */
export const MONTHS = [
  { month: "Jan", revenue: 24, orders: 18 },
  { month: "Feb", revenue: 25, orders: 21 },
  { month: "Mar", revenue: 28, orders: 20 },
  { month: "Apr", revenue: 27, orders: 24 },
  { month: "May", revenue: 31, orders: 26 },
  { month: "Jun", revenue: 32, orders: 25 },
  { month: "Jul", revenue: 35, orders: 29 },
  { month: "Aug", revenue: 37, orders: 31 },
];

export const REVENUE_COLORS = { light: ["#e8691c"], dark: ["#f59a58"] };
export const ORDER_COLORS = { light: ["#c2303c"], dark: ["#f2545b"] };

export function DemoFrame({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-primary text-base font-medium tracking-tight">{title}</span>
        <span className="text-muted-foreground text-xs">{note}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
