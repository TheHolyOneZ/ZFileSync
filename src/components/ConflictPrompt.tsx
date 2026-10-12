import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { usePairs } from "../stores/usePairs";
import { ipc } from "../lib/ipc";
import { Button } from "./ui/Button";

export function ConflictPrompts() {
  const { conflicts, clearConflict, pairs } = usePairs();

  if (conflicts.length === 0) return null;

  const pairName = (id: string | undefined | null) => {
    if (!id) return "?";
    return pairs.find((p) => p.id === id)?.name ?? String(id).slice(0, 8);
  };

  const resolve = async (pairId: string, relPath: string, choice: "keepSource" | "keepDest" | "keepBoth") => {
    await ipc.resolveConflict(pairId, relPath, choice);
    clearConflict(pairId, relPath);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col gap-2.5 max-w-sm w-full">
      <AnimatePresence>
        {conflicts.map((c) => (
          <motion.div
            key={`${c.pairId}:${c.relPath}`}
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative glass rounded-2xl p-4 border border-warning/30 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.9),0_0_30px_-10px_rgb(255_200_87/0.35)]"
          >
            <div className="flex items-start gap-3 mb-3.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-warning/15 text-warning flex-shrink-0"><AlertTriangle size={15} /></span>
              <div>
                <p className="text-sm font-semibold text-text">Sync conflict</p>
                <p className="text-xs text-muted mt-0.5">{pairName(c.pairId)}</p>
                <p className="text-xs font-mono text-muted/70 mt-1 break-all">{c.relPath}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => resolve(c.pairId, c.relPath, "keepSource")}>
                Keep source
              </Button>
              <Button size="sm" variant="secondary" onClick={() => resolve(c.pairId, c.relPath, "keepDest")}>
                Keep dest
              </Button>
              <Button size="sm" variant="primary" onClick={() => resolve(c.pairId, c.relPath, "keepBoth")}>
                Keep both
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
