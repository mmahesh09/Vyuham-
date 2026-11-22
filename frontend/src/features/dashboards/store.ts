import { create } from "zustand";

/** Whether the tiles are being arranged. Order and layout themselves are saved on the server. */
export const useDashboardLayout = create<{ editing: boolean; setEditing: (editing: boolean) => void }>()((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));

/** The visual picked on the report canvas: the Visualizations, Fields and Filters panes act on it. */
export const useSelectedVisual = create<{ id: string | null; select: (id: string | null) => void }>()((set) => ({
  id: null,
  select: (id) => set({ id }),
}));
