import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ITEMS, type Group, type Tier } from "./bom";

export type KitTab = "list" | "fit" | "build";

type KitState = {
  hydrated: boolean;
  owned: string[];
  qty: Record<string, number>;
  query: string;
  group: Group | "all";
  tier: Tier | "all";
  hideOwned: boolean;
  tab: KitTab;
  buildDone: string[];
  markHydrated: () => void;
  toggleOwned: (id: string) => void;
  setQty: (id: string, n: number) => void;
  setQuery: (q: string) => void;
  setGroup: (g: Group | "all") => void;
  setTier: (t: Tier | "all") => void;
  setHideOwned: (v: boolean) => void;
  setTab: (tab: KitTab) => void;
  toggleBuild: (id: string) => void;
  reset: () => void;
};

const defaultQty = Object.fromEntries(ITEMS.map((i) => [i.id, i.qty]));

export const useKit = create<KitState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      owned: [],
      qty: defaultQty,
      query: "",
      group: "all",
      tier: "all",
      hideOwned: false,
      tab: "list",
      buildDone: [],
      markHydrated: () => set({ hydrated: true }),
      toggleOwned: (id) => {
        const owned = get().owned;
        set({
          owned: owned.includes(id) ? owned.filter((x) => x !== id) : [...owned, id],
        });
      },
      setQty: (id, n) =>
        set({ qty: { ...get().qty, [id]: Math.max(0, Math.min(8, Math.round(n))) } }),
      setQuery: (query) => set({ query }),
      setGroup: (group) => set({ group }),
      setTier: (tier) => set({ tier }),
      setHideOwned: (hideOwned) => set({ hideOwned }),
      setTab: (tab) => set({ tab }),
      toggleBuild: (id) => {
        const done = get().buildDone;
        set({
          buildDone: done.includes(id) ? done.filter((x) => x !== id) : [...done, id],
        });
      },
      reset: () => set({ owned: [], qty: defaultQty, buildDone: [] }),
    }),
    {
      name: "hv1-kit",
      skipHydration: true,
      partialize: (s) => ({ owned: s.owned, qty: s.qty, buildDone: s.buildDone }),
    },
  ),
);