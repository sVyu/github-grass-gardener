import { create } from 'zustand';

interface PlanState {
  counts: Record<string, number>;
  selectedDates: string[];
  setSelectedDates: (dates: string[]) => void;
  setCountForSelected: (count: number) => void;
  applyDates: (dates: string[], count: number) => void;
  moveSelected: (targetDate: string) => void;
  removePublished: (dates: string[]) => void;
  clear: () => void;
}

export const usePlanStore = create<PlanState>((set) => ({
  counts: {},
  selectedDates: [],
  setSelectedDates: (dates) => set({ selectedDates: [...new Set(dates)].sort() }),
  setCountForSelected: (count) =>
    set((state) => {
      const counts = { ...state.counts };
      for (const date of state.selectedDates) {
        if (count <= 0) delete counts[date];
        else counts[date] = count;
      }
      return { counts };
    }),
  applyDates: (dates, count) =>
    set((state) => ({
      counts: { ...state.counts, ...Object.fromEntries(dates.map((date) => [date, count])) },
      selectedDates: dates,
    })),
  moveSelected: (targetDate) =>
    set((state) => {
      const counts = { ...state.counts };
      let total = counts[targetDate] ?? 0;
      for (const date of state.selectedDates) {
        if (date === targetDate) continue;
        total += counts[date] ?? 0;
        delete counts[date];
      }
      if (total > 0) counts[targetDate] = total;
      return { counts, selectedDates: [targetDate] };
    }),
  removePublished: (dates) =>
    set((state) => {
      const counts = { ...state.counts };
      for (const date of dates) {
        const next = (counts[date] ?? 0) - 1;
        if (next <= 0) delete counts[date];
        else counts[date] = next;
      }
      return { counts };
    }),
  clear: () => set({ counts: {}, selectedDates: [] }),
}));
