"use client";

import { Check, ClipboardCopy, Loader2, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askSqlAi, errorText, setAiOutcome, useAiStatus, type SqlAiAction, type SqlAiResult } from "@/features/platform/api";
import { cn } from "@/lib/utils";

import type { Param } from "./params";

const ACTIONS: { id: SqlAiAction; label: string; needsSql: boolean }[] = [
  { id: "write", label: "Write SQL", needsSql: false },
  { id: "explain", label: "Explain", needsSql: true },
  { id: "fix", label: "Fix error", needsSql: true },
  { id: "optimize", label: "Optimize", needsSql: true },
  { id: "python", label: "To Python", needsSql: true },
];

/**
 * AI help for the open query. The AI sees table and column names and types (never masked or sensitive
 * values); any SQL it writes is checked against the real tables before it's offered, and nothing runs
 * until you choose to.
 */
export function AiAssist({ sql, params, error, onReplace, onNewTab, onClose }: {
  sql: string; params: Param[]; error?: string | null; onReplace: (sql: string) => void; onNewTab: (sql: string) => void; onClose: () => void;
}) {
  const status = useAiStatus();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<SqlAiAction | null>(null);
  const [result, setResult] = useState<(SqlAiResult & { action: SqlAiAction }) | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ask = async (action: SqlAiAction) => {
    setPending(action);
    setProblem(null);
    setResult(null);
    try {
      const r = await askSqlAi({ action, question: action === "write" ? question : undefined, sql: action === "write" ? undefined : sql, error: action === "fix" ? error ?? "" : undefined, params });
      setResult({ ...r, action });
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setPending(null);
    }
  };
  const apply = (how: "replace" | "tab") => {
    if (!result?.sql) return;
    void setAiOutcome(result.action_id, "applied");
    if (how === "replace") onReplace(result.sql);
    else onNewTab(result.sql);
    setResult(null);
  };
  const discard = () => {
    if (result?.sql || result?.python) void setAiOutcome(result.action_id, "rejected");
    setResult(null);
  };
  const disabled = status.data?.enabled === false;

  return (
    <section className="flex max-h-[50%] flex-col gap-2 overflow-y-auto border-t border-line bg-surface-2/40 px-3 py-2.5" aria-label="AI assistant" data-lenis-prevent>
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-highlight" aria-hidden />
        <span className="text-[13px] font-medium text-text">AI assistant</span>
        <span className="text-[11px] text-faint">Sees table and column names only · SQL is checked before it&apos;s offered</span>
        <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Close AI assistant" onClick={onClose}><X /></Button>
      </div>
      {disabled ? (
        <p className="text-[13px] text-faint">AI isn&apos;t set up on this server. An administrator needs to set ANTHROPIC_API_KEY.</p>
      ) : (
        <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) void ask("write"); }}>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask in plain English: revenue by region last quarter" className="h-8 text-[13px]" maxLength={2000} aria-label="Question for the AI" />
            <Button type="submit" size="sm" disabled={!question.trim() || !!pending}>{pending === "write" ? <Loader2 className="animate-spin" /> : null} Write SQL</Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS.filter((a) => a.id !== "write").map((a) => (
              <Button key={a.id} variant="outline" size="xs" disabled={!!pending || (a.needsSql && !sql.trim()) || (a.id === "fix" && !error)} onClick={() => void ask(a.id)}
                title={a.id === "fix" && !error ? "Run the query first; this fixes the error it gives" : undefined}>
                {pending === a.id && <Loader2 className="animate-spin" />} {a.label}
              </Button>
            ))}
          </div>
        </>
      )}
      {problem && <p role="alert" className="text-[13px] text-destructive">{problem}</p>}
      {result && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg/70 p-3 text-[13px]">
          <p className="whitespace-pre-wrap text-muted">{result.explanation}</p>
          {result.changes.length > 0 && <ul className="list-disc pl-5 text-[12px] text-muted">{result.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
          {result.sql && (
            <>
              <pre className="max-h-48 overflow-auto rounded border border-line p-2 font-mono text-[12px] text-text">{result.sql}</pre>
              <p className={cn("text-[12px]", result.valid ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                {result.valid ? "✓ Checked against your tables: every table and column exists." : `✗ It still doesn't check out: ${result.check_error}`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="xs" onClick={() => apply("replace")}>Replace my query</Button>
                <Button variant="outline" size="xs" onClick={() => apply("tab")}>Open in a new tab</Button>
                <Button variant="ghost" size="xs" onClick={discard}>Discard</Button>
              </div>
            </>
          )}
          {result.python && (
            <>
              <pre className="max-h-60 overflow-auto rounded border border-line p-2 font-mono text-[12px] text-text">{result.python}</pre>
              <div className="flex gap-2">
                <Button variant="outline" size="xs" onClick={async () => {
                  try { await navigator.clipboard.writeText(result.python!); setCopied(true); void setAiOutcome(result.action_id, "applied"); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
                }}>{copied ? <Check /> : <ClipboardCopy />} Copy Python</Button>
                <Button variant="ghost" size="xs" onClick={discard}>Discard</Button>
              </div>
            </>
          )}
          {!result.sql && !result.python && <div><Button variant="ghost" size="xs" onClick={() => setResult(null)}>Close</Button></div>}
        </div>
      )}
    </section>
  );
}
