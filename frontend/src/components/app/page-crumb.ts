import { create } from "zustand";

/** The current detail page's name (a dashboard or dataset), shown as the last breadcrumb in the top bar. */
export const usePageCrumb = create<{ crumb: string | null; setCrumb: (c: string | null) => void }>()((set) => ({
  crumb: null,
  setCrumb: (crumb) => set({ crumb }),
}));
