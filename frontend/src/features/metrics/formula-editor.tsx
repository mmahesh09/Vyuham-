"use client";

import { autocompletion, closeBrackets, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

import type { FormulaFunction } from "./api";

const WORDS = new Set(["and", "or", "not", "is", "null", "in", "true", "false", "case", "when", "then", "else", "end"]);

/** Colours the formula language; the server's parser stays the only judge of what's valid. */
const formulaLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^'(?:[^']|'')*'?/)) return "string";
    if (stream.match(/^\[(?:[^\]\n]|\]\])*\]?/)) return "propertyName";
    if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (word) {
      if (WORDS.has(word[0].toLowerCase())) return "keyword";
      return stream.peek() === "(" ? "function" : "propertyName";
    }
    stream.next();
    return "operator";
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--highlight)", fontWeight: "600" },
  { tag: t.string, color: "#9fe3c0" },
  { tag: t.number, color: "#f5b97a" },
  { tag: t.propertyName, color: "var(--text)" },
  { tag: t.function(t.variableName), color: "#8fb8ff" },
  { tag: t.operator, color: "var(--muted)" },
]);

const theme = EditorView.theme({
  "&": { fontSize: "13.5px", backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "10px 12px", caretColor: "var(--text)", fontFamily: "var(--font-mono, ui-monospace, monospace)", minHeight: "76px" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-formula-error": { textDecoration: "underline wavy var(--destructive)", textUnderlineOffset: "3px" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--surface-2)", color: "var(--text)" },
});

const setError = StateEffect.define<{ start: number; end: number } | null>();
const errorMark = Decoration.mark({ class: "cm-formula-error" });
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = tr.docChanged ? Decoration.none : marks;
    for (const e of tr.effects) {
      if (!e.is(setError)) continue;
      const size = tr.newDoc.length;
      const from = e.value ? Math.min(e.value.start, size) : 0;
      const to = e.value ? Math.min(Math.max(e.value.end, from + 1), size) : 0;
      next = e.value && to > from ? Decoration.set([errorMark.range(from, to)]) : Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export type FormulaNames = { columns: { name: string; type: string }[]; metrics: string[]; functions: FormulaFunction[] };

function completions(names: FormulaNames) {
  return (ctx: CompletionContext) => {
    const bracket = ctx.matchBefore(/\[[^\]\n]*/);
    const word = bracket ?? ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const refs: Completion[] = [
      ...names.columns.map((c) => ({ label: `[${c.name}]`, detail: c.type, type: "property" })),
      ...names.metrics.map((m) => ({ label: `[${m}]`, detail: "metric", type: "variable", boost: 2 })),
    ];
    const functions: Completion[] = names.functions.map((f) => ({
      label: f.name, detail: f.signature, info: f.help, type: "function", apply: `${f.name}(`,
    }));
    return { from: word.from, options: bracket ? refs : [...functions, ...refs], validFor: bracket ? /^\[[^\]\n]*$/ : /^\w*$/ };
  };
}

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  names: FormulaNames;
  error: { start: number; end: number } | null;
  placeholderText: string;
  readOnly?: boolean;
  label: string;
};

/** CodeMirror for formulas: colours, autocomplete for columns, metrics and functions, and a marked error. */
export function FormulaEditor({ id, value, onChange, names, error, placeholderText, readOnly, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const complete = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          bracketMatching(),
          formulaLanguage,
          syntaxHighlighting(highlight),
          errorField,
          theme,
          EditorView.lineWrapping,
          placeholder(placeholderText),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          complete.current.of(autocompletion({ override: [completions(names)], icons: false, activateOnTyping: true })),
          editable.current.of(EditorView.editable.of(!readOnly)),
          EditorView.contentAttributes.of({ "aria-label": label, ...(id ? { id } : {}) }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) change.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor is created once; props sync below
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: complete.current.reconfigure(autocompletion({ override: [completions(names)], icons: false, activateOnTyping: true })) });
  }, [names]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: setError.of(error) });
  }, [error]);

  return <div ref={host} className="rounded-lg border border-line bg-bg/60 focus-within:border-primary" />;
}
