/// <reference lib="webworker" />
import type { ParseRequest, ParseResponse } from "../types";
import { parseFile } from "./parse-file";

// Runs off the main thread so a 10 MB file never freezes the page.
self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, file, sheet } = event.data;
  let response: ParseResponse;
  try {
    response = { id, ok: true, result: await parseFile(file, sheet) };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : "We couldn’t read this file." };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
};
