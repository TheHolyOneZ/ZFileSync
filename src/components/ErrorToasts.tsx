import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, X } from "lucide-react";
import { useEffect } from "react";
import { useErrors } from "../stores/useErrors";
import { usePairs } from "../stores/usePairs";

export function ErrorToasts() {
  const { toasts, dismiss } = useErrors();
  const { pairs } = usePairs();

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.ts), 6000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  const pairName = (id: string | undefined | null) => {
    if (!id) return "?";
    return pairs.find((p) => p.id === id)?.name ?? String(id).slice(0, 6);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.ts}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            layout
            className="pointer-events-auto w-84 max-w-[calc(100vw-2.5rem)] rounded-2xl bg-surface/95 backdrop-blur-xl border border-danger/30 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.9),0_0_30px_-12px_rgb(255_107_122/0.4)] overflow-hidden"
          >
            <div className="flex items-start gap-3 p-3.5">
              <div className="grid place-items-center w-7 h-7 rounded-lg bg-danger/15 text-danger flex-shrink-0">
                <AlertOctagon size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-danger">
                    {t.op} failed
                  </span>
                  <span className="text-xs text-muted/60 font-mono truncate max-w-[60%]">
                    {pairName(t.pairId)}
                  </span>
                </div>
                <p className="selectable text-xs text-text/90 mt-1 leading-relaxed break-words">
                  {t.message}
                </p>
                <p className="text-xs text-muted/60 mt-1 font-mono truncate" title={t.path}>
                  {t.path}
                </p>
              </div>
              <button
                onClick={() => dismiss(t.ts)}
                className="text-muted/60 hover:text-text rounded p-0.5 transition-colors cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
