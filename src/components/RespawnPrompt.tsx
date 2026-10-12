import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { usePairs } from "../stores/usePairs";
import { useActivity } from "../stores/useActivity";
import { ipc } from "../lib/ipc";
import { Button } from "./ui/Button";

export function RespawnPrompts() {
  const { respawns, clearRespawn, pairs } = usePairs();
  const { clearTombstone } = useActivity();

  if (respawns.length === 0) return null;

  const pairName = (id: string | undefined | null) => {
    if (!id) return "?";
    return pairs.find((p) => p.id === id)?.name ?? String(id).slice(0, 8);
  };

  const respond = async (
    pairId: string,
    relPath: string,
    decision: "resumeOnce" | "alwaysResume" | "ignore"
  ) => {
    await ipc.respondRespawn(pairId, relPath, decision);
    clearRespawn(pairId, relPath);
    if (decision !== "ignore") {
      clearTombstone(pairId, relPath);
    }
  };

  return (
    <div className="fixed bottom-5 left-[264px] z-40 flex flex-col gap-2.5 max-w-sm w-full">
      <AnimatePresence>
        {respawns.map((r) => (
          <motion.div
            key={`${r.pairId}:${r.relPath}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative glass rounded-2xl p-4 border border-info/30 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.9),0_0_30px_-10px_rgb(116_199_255/0.35)]"
          >
            <div className="flex items-start gap-3 mb-3">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-info/15 text-info flex-shrink-0"><RefreshCw size={15} /></span>
              <div>
                <p className="text-sm font-semibold text-text">File reappeared</p>
                <p className="text-xs text-muted mt-0.5">{pairName(r.pairId)}</p>
                <p className="text-xs font-mono text-muted/70 mt-1 break-all">{r.relPath}</p>
              </div>
            </div>
            <p className="text-xs text-muted mb-3">Resume syncing this file?</p>
            <div className="flex gap-1.5 flex-wrap">
              <Button size="sm" variant="ghost" onClick={() => respond(r.pairId, r.relPath, "ignore")}>
                Ignore
              </Button>
              <Button size="sm" variant="secondary" onClick={() => respond(r.pairId, r.relPath, "resumeOnce")}>
                Resume once
              </Button>
              <Button size="sm" variant="primary" onClick={() => respond(r.pairId, r.relPath, "alwaysResume")}>
                Always resume
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
