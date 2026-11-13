"use client";

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { format, type FormatOptionsWithLanguage } from "sql-formatter";

import { PARAM_PATTERN } from "./params";

export type SqlEditorHandle = {
  /** Replace the selection (or insert at the cursor) and focus the editor. */
  insert: (text: string) => void;
  /** Reformat the whole query. Throws if the formatter can't parse it. */
  format: () => void;
  /** The selected text, or the whole query when nothing is selected, plus the line it starts on. */
  runnable: () => { sql: string; firstLine: number; isSelection: boolean };
  focusLine: (line: number) => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  schema: SQLNamespace;
  onRun: () => void;
  onSave: () => void;
  onSelectionChange?: (hasSelection: boolean) => void;
  /** 1-based line to mark as the error, or null. */
  errorLine: number | null;
};

/* ---------- look ---------- */

const theme = EditorView.theme(
  {
    "&": { color: "var(--text)", backgroundColor: "transparent", fontSize: "13px", height: "100%" },
    ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", lineHeight: "1.65", overflow: "auto" },
    ".cm-content": { padding: "12px 0", caretColor: "var(--highlight)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--highlight)", borderLeftWidth: "2px" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklab, var(--highlight) 28%, transparent) !important",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--line) 45%, transparent)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "none", paddingLeft: "6px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.2em", paddingRight: "10px" },
    ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--highlight) 22%, transparent)", outline: "none" },
    ".cm-placeholder": { color: "var(--faint)" },
    ".cm-param": {
      color: "var(--accent)",
      backgroundColor: "color-mix(in oklab, var(--accent) 14%, transparent)",
      borderRadius: "4px",
      padding: "0 2px",
    },
    ".cm-errorLine": { backgroundColor: "color-mix(in oklab, var(--accent) 16%, transparent)", boxShadow: "inset 3px 0 0 var(--accent)" },
    ".cm-tooltip": { backgroundColor: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "18em" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--line)", color: "var(--text)" },
    ".cm-completionDetail": { color: "var(--faint)", fontStyle: "normal", marginLeft: "0.8em" },
    ".cm-completionMatchedText": { color: "var(--highlight)", textDecoration: "none", fontWeight: "600" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--highlight)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#9fe3c0" },
  { tag: [t.number, t.bool, t.null], color: "#f5b97a" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--faint)", fontStyle: "italic" },
  { tag: [t.typeName, t.standard(t.name)], color: "#8fb8ff" },
  { tag: [t.function(t.variableName), t.function(t.name)], color: "#8fb8ff" },
  { tag: [t.special(t.name), t.quote], color: "var(--text)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted)" },
]);

/* ---------- {{param}} chips ---------- */

const paramMatcher = new MatchDecorator({ regexp: new RegExp(PARAM_PATTERN, "g"), decoration: Decoration.mark({ class: "cm-param" }) });
const paramChips = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = paramMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = paramMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/* ---------- error line ---------- */

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(e.value);
      return Decoration.set([Decoration.line({ class: "cm-errorLine" }).range(line.from)]);
    }
    // Any edit clears the mark: the error was for the old text.
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const FORMAT_OPTIONS: FormatOptionsWithLanguage = {
  language: "duckdb",
  keywordCase: "upper",
  tabWidth: 2,
  paramTypes: { custom: [{ regex: PARAM_PATTERN }] },
};

/** CodeMirror 6 SQL editor: highlighting, schema autocomplete, {{param}} chips, run selection, format. */
export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, schema, onRun, onSave, onSelectionChange, errorLine },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  // Latest callbacks without rebuilding the editor.
  const cb = useRef({ onChange, onRun, onSave, onSelectionChange });
  useEffect(() => {
    cb.current = { onChange, onRun, onSave, onSelectionChange };
  });

  const doFormat = () => {
    const v = view.current;
    if (!v) return;
    const next = format(v.state.doc.toString(), FORMAT_OPTIONS);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
  };

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          autocompletion({ icons: false, activateOnTyping: true }),
          language.current.of(sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true })),
          syntaxHighlighting(highlight),
          theme,
          paramChips,
          errorLineField,
          placeholder("SELECT * FROM your_table LIMIT 100"),
          EditorView.contentAttributes.of({ "aria-label": "SQL query", spellcheck: "false" }),
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run: () => (cb.current.onRun(), true) },
              { key: "Mod-s", run: () => (cb.current.onSave(), true), preventDefault: true },
              {
                key: "Shift-Alt-f",
                run: () => {
                  try {
                    doFormat();
                  } catch {
                    /* unparsable: leave the text alone */
                  }
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
            if (u.selectionSet) cb.current.onSelectionChange?.(!u.state.selection.main.empty);
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is built once; value/schema changes are pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching tabs (or loading a saved query) replaces the text.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true })) });
  }, [schema]);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorLine) });
  }, [errorLine]);

  useImperativeHandle(ref, () => ({
    insert(text) {
      const v = view.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
    },
    format: doFormat,
    runnable() {
      const v = view.current;
      if (!v) return { sql: value, firstLine: 1, isSelection: false };
      const { from, to, empty } = v.state.selection.main;
      if (empty || !v.state.sliceDoc(from, to).trim()) return { sql: v.state.doc.toString(), firstLine: 1, isSelection: false };
      return { sql: v.state.sliceDoc(from, to), firstLine: v.state.doc.lineAt(from).number, isSelection: true };
    },
    focusLine(line) {
      const v = view.current;
      if (!v || line < 1 || line > v.state.doc.lines) return;
      const l = v.state.doc.line(line);
      v.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
      v.focus();
    },
  }));

  return <div ref={host} className="h-full min-h-[220px]" />;
});
