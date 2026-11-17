"use client";

import { Input } from "@/components/ui/input";

import type { Param, ParamType } from "./params";

/** One `{{name}}` parameter: its type and value, bound (never pasted) when the query runs. */
export function ParamField({ param, onChange, onEnter }: { param: Param; onChange: (p: Partial<Param>) => void; onEnter: () => void }) {
  const id = `param-${param.name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[12px] text-accent">
        {`{{${param.name}}}`}
      </label>
      <div className="flex">
        <select
          aria-label={`Type of ${param.name}`}
          value={param.type}
          onChange={(e) => onChange({ type: e.target.value as ParamType })}
          className="h-8 rounded-l-md border border-r-0 border-input bg-transparent px-1.5 text-xs text-muted"
        >
          <option value="text" className="bg-surface">text</option>
          <option value="number" className="bg-surface">number</option>
          <option value="date" className="bg-surface">date</option>
        </select>
        <Input
          id={id}
          type={param.type === "date" ? "date" : "text"}
          inputMode={param.type === "number" ? "decimal" : undefined}
          value={param.value}
          placeholder={param.type === "number" ? "0" : param.type === "date" ? "" : "value"}
          onChange={(e) => onChange({ value: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onEnter())}
          className="h-8 w-40 rounded-l-none"
        />
      </div>
    </div>
  );
}
