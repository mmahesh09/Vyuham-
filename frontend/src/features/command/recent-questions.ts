"use client";

import { useSyncExternalStore } from "react";

/** The last few questions asked from this browser. A per-viewer convenience: it's fine for it to be empty. */
const KEY = "vyuham:recent-questions";
const MAX = 5;
const EVENT = "vyuham:recent-questions";
const EMPTY: string[] = [];

let cache: { raw: string | null; list: string[] } = { raw: null, list: EMPTY };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.list;
  let list = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((q): q is string => typeof q === "string").slice(0, MAX);
  } catch {
    list = EMPTY;
  }
  cache = { raw, list };
  return list;
}

function write(list: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: nothing to remember */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function rememberQuestion(question: string) {
  const q = question.trim();
  if (q.length < 2) return;
  write([q, ...read().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX));
}

export function clearQuestions() {
  write([]);
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRecentQuestions() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
