"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_FILE_BYTES, type ParseRequest, type ParseResponse, type ParseResult } from "./types";

type State =
  | { status: "idle" }
  | { status: "parsing"; fileName: string }
  | { status: "done"; result: ParseResult; file: File }
  | { status: "error"; error: string };

/** Parse a CSV/XLSX in a Web Worker. Later requests win; stale replies are ignored. */
export function useParsedFile() {
  const [state, setState] = useState<State>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const fileRef = useRef<File | null>(null);
  const requestId = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const run = useCallback((file: File, sheet?: string) => {
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setState({ status: "error", error: "Use a .csv or .xlsx file." });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setState({ status: "error", error: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The beta limit is 10 MB.` });
      return;
    }
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./parse/parse.worker.ts", import.meta.url), { type: "module" });
      workerRef.current.onmessage = (e: MessageEvent<ParseResponse>) => {
        if (e.data.id !== requestId.current) return;
        const file = fileRef.current;
        if (e.data.ok && file) setState({ status: "done", result: e.data.result, file });
        else setState({ status: "error", error: e.data.ok ? "We couldn’t read this file." : e.data.error });
      };
      workerRef.current.onerror = () => setState({ status: "error", error: "We couldn’t read this file." });
    }
    fileRef.current = file;
    requestId.current += 1;
    setState({ status: "parsing", fileName: file.name });
    workerRef.current.postMessage({ id: requestId.current, file, sheet } satisfies ParseRequest);
  }, []);

  const selectSheet = useCallback((sheet: string) => fileRef.current && run(fileRef.current, sheet), [run]);
  const reset = useCallback(() => {
    requestId.current += 1;
    fileRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, parse: run, selectSheet, reset };
}
