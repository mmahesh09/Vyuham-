"use client";

import { useCallback, useEffect, useState } from "react";

import type { Param } from "./params";

/**
 * SQL Lab's open tabs and recent runs. Kept in this browser (localStorage, per workspace):
 * they're one person's scratch work, so a reload or a new day picks up where they left off.
 * Everything still works when storage is blocked; it just isn't remembered.
 */

export type Tab = {
  id: string;
  title: string;
  sql: string;
  params: Param[];
  /** The saved query this tab edits, and its SQL and params as last saved (to show unsaved changes). */
  savedId: string | null;
  savedSql: string | null;
  savedParams: Param[] | null;
};

export type HistoryEntry = {
  id: string;
  sql: string;
  params: Param[];
  at: number;
  ok: boolean;
  rows?: number;
  ms?: number;
  error?: string;
};

type Stored = { tabs: Tab[]; activeId: string | null; history: HistoryEntry[] };

const MAX_TABS = 12;
const MAX_HISTORY = 50;
const newId = () => Math.random().toString(36).slice(2, 10);

function load(key: string): Stored | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return Array.isArray(s.tabs) && Array.isArray(s.history) ? s : null;
  } catch {
    return null;
  }
}

function save(key: string, s: Stored) {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* storage full or blocked: keep working without remembering */
  }
}

export const isDirty = (t: Tab) =>
  t.savedId !== null && (t.sql !== t.savedSql || JSON.stringify(t.params) !== JSON.stringify(t.savedParams ?? []));

export function useLabState(workspaceId: string | undefined) {
  const key = workspaceId ? `sql-lab:v1:${workspaceId}` : null;
  const [state, setState] = useState<Stored>({ tabs: [], activeId: null, history: [] });
  const [ready, setReady] = useState(false);

  // Read storage after mount (not during render) so the server and first client render match.
  useEffect(() => {
    if (!key) return;
    const s = load(key);
    if (s) setState(s);
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (key && ready) save(key, state);
  }, [key, ready, state]);

  const openTab = useCallback((init: Partial<Tab> & { sql: string }) => {
    const tab: Tab = { id: newId(), title: "", params: [], savedId: null, savedSql: null, savedParams: null, ...init };
    setState((s) => {
      const numbered = tab.title || `Query ${s.tabs.length + 1}`;
      const tabs = [...s.tabs, { ...tab, title: numbered }].slice(-MAX_TABS);
      return { ...s, tabs, activeId: tab.id };
    });
    return tab.id;
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId = s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.activeId;
      return { ...s, tabs, activeId };
    });
  }, []);

  const setActive = useCallback((id: string) => setState((s) => ({ ...s, activeId: id })), []);

  const addHistory = useCallback((e: Omit<HistoryEntry, "id" | "at">) => {
    setState((s) => {
      // Re-running the same SQL moves it to the top instead of adding a duplicate.
      const rest = s.history.filter((h) => h.sql !== e.sql);
      return { ...s, history: [{ ...e, id: newId(), at: Date.now() }, ...rest].slice(0, MAX_HISTORY) };
    });
  }, []);

  const clearHistory = useCallback(() => setState((s) => ({ ...s, history: [] })), []);

  const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0] ?? null;
  return { ready, tabs: state.tabs, active, history: state.history, openTab, updateTab, closeTab, setActive, addHistory, clearHistory };
}
