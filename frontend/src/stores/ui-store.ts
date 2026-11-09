import { create } from "zustand";

type UiState = {
  commandOpen: boolean;
  /** Text to prefill in the command menu, e.g. a question typed on Home. */
  commandQuery: string;
  openCommand: (query?: string) => void;
  setCommandOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>()((set) => ({
  commandOpen: false,
  commandQuery: "",
  openCommand: (query = "") => set({ commandOpen: true, commandQuery: query }),
  setCommandOpen: (open) => set(open ? { commandOpen: true } : { commandOpen: false, commandQuery: "" }),
}));
