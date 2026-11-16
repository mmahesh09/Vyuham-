import { create } from "zustand";

type AssistantState = {
  open: boolean;
  /** A question to put in the box when the panel opens, e.g. from a "Ask the assistant" button. */
  draft: string;
  openAssistant: (draft?: string) => void;
  setOpen: (open: boolean) => void;
};

export const useAssistantStore = create<AssistantState>()((set) => ({
  open: false,
  draft: "",
  openAssistant: (draft = "") => set({ open: true, draft }),
  setOpen: (open) => set(open ? { open } : { open, draft: "" }),
}));
