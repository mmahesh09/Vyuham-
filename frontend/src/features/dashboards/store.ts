import { create } from "zustand";

/** Whether the KPI tiles are being arranged. Order and layout themselves are saved on the server. */
export const useDashboardLayout = create<{ editing: boolean; setEditing: (editing: boolean) => void }>()((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));
