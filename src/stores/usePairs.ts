import { create } from "zustand";
import {
  ipc,
  type SyncPair,
  type ConflictPrompt,
  type RespawnPrompt,
  type PairProgress,
} from "../lib/ipc";

interface PairsState {
  pairs: SyncPair[];
  conflicts: ConflictPrompt[];
  respawns: RespawnPrompt[];
  progress: Record<string, PairProgress>;
  loading: boolean;
  setProgress: (p: PairProgress) => void;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  addPair: (pair: SyncPair) => void;
  removePair: (id: string) => void;
  updateStatus: (id: string, status: SyncPair["status"]) => void;
  addConflict: (c: ConflictPrompt) => void;
  clearConflict: (pairId: string, relPath: string) => void;
  addRespawn: (r: RespawnPrompt) => void;
  clearRespawn: (pairId: string, relPath: string) => void;
}

export const usePairs = create<PairsState>((set) => ({
  pairs: [],
  conflicts: [],
  respawns: [],
  progress: {},
  loading: false,

  setProgress: (p) => set((s) => ({ progress: { ...s.progress, [p.pairId]: p } })),

  load: async () => {
    set({ loading: true });
    try {
      const pairs = await ipc.listPairs();
      set({ pairs });
    } finally {
      set({ loading: false });
    }
  },


  refresh: async () => {
    const pairs = await ipc.listPairs();
    set({ pairs });
  },

  addPair: (pair) =>
    set((s) =>
      s.pairs.some((p) => p.id === pair.id)
        ? {}
        : { pairs: [...s.pairs, pair] }
    ),

  removePair: (id) =>
    set((s) => ({ pairs: s.pairs.filter((p) => p.id !== id) })),

  updateStatus: (id, status) =>
    set((s) => {
      const progress = { ...s.progress };
      if (status !== "scanning") delete progress[id];
      return {
        pairs: s.pairs.map((p) => (p.id === id ? { ...p, status } : p)),
        progress,
      };
    }),

  addConflict: (c) =>
    set((s) => {
      const exists = s.conflicts.some(
        (x) => x.pairId === c.pairId && x.relPath === c.relPath
      );
      return exists ? {} : { conflicts: [...s.conflicts, c] };
    }),

  clearConflict: (pairId, relPath) =>
    set((s) => ({
      conflicts: s.conflicts.filter(
        (c) => !(c.pairId === pairId && c.relPath === relPath)
      ),
    })),

  addRespawn: (r) =>
    set((s) => {
      const exists = s.respawns.some(
        (x) => x.pairId === r.pairId && x.relPath === r.relPath
      );
      return exists ? {} : { respawns: [...s.respawns, r] };
    }),

  clearRespawn: (pairId, relPath) =>
    set((s) => ({
      respawns: s.respawns.filter(
        (r) => !(r.pairId === pairId && r.relPath === relPath)
      ),
    })),
}));
