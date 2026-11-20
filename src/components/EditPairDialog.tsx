import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, ArrowLeftRight, Loader2, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SyncPair } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { usePairs } from "../stores/usePairs";
import { Button, IconButton } from "./ui/Button";

interface Props {
  pair: SyncPair;
  open: boolean;
  onClose: () => void;
}

const DIRS = [
  { value: "oneWay" as const, icon: <ArrowRight size={16} />, label: "One-way", desc: "Source → Destination only." },
  { value: "twoWay" as const, icon: <ArrowLeftRight size={16} />, label: "Two-way", desc: "Both sides stay in sync." },
];

export function EditPairDialog({ pair, open, onClose }: Props) {
  const refresh = usePairs((s) => s.refresh);
  const [name, setName] = useState(pair.name);
  const [direction, setDirection] = useState(pair.direction);
  const [keepDeleted, setKeepDeleted] = useState(!pair.mirrorDeletes);
  const [ignoreRaw, setIgnoreRaw] = useState(pair.ignore.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(pair.name);
    setDirection(pair.direction);
    setKeepDeleted(!pair.mirrorDeletes);
    setIgnoreRaw(pair.ignore.join(", "));
    setError(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pair, onClose]);

  const isFolder = pair.kind === "folder";
  const changedDirection = direction !== pair.direction;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await ipc.updatePair(pair.id, {
        name,
        direction,
        ignore: isFolder ? ignoreRaw.split(",").map((s) => s.trim()).filter(Boolean) : pair.ignore,
        mirrorDeletes: direction === "oneWay" && isFolder ? !keepDeleted : true,
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-[6px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-lg max-h-full bg-surface ring-gradient rounded-2xl shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] overflow-hidden flex flex-col"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 520, damping: 38 }}
          >
            <div className="flex items-start justify-between px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
                  <Settings2 size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.02em] text-text leading-none">Edit pair</h2>
                  <p className="text-[13px] text-muted mt-1.5">Paths can't change. Remove and re-create the pair for that.</p>
                </div>
              </div>
              <IconButton onClick={onClose} title="Close (Esc)">
                <X size={16} />
              </IconButton>
            </div>

            <div className="px-6 pb-5 flex flex-col gap-5 overflow-y-auto">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text/90">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="field h-10 px-3 text-sm" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text/90">Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  {DIRS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDirection(d.value)}
                      className={`flex items-start gap-3 p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                        direction === d.value
                          ? "border-accent/40 bg-accent/[0.07] text-text"
                          : "border-border bg-surface-2/60 text-muted hover:text-text"
                      }`}
                    >
                      <span className="mt-0.5">{d.icon}</span>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold">{d.label}</span>
                        <span className="text-xs text-muted leading-snug">{d.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {changedDirection && (
                  <p className="text-[11px] text-warning">
                    The pair restarts and both sides are compared again. Nothing is deleted by the switch itself.
                  </p>
                )}
              </div>

              {direction === "oneWay" && isFolder && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-bg/50 border border-border cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={keepDeleted} onChange={(e) => setKeepDeleted(e.target.checked)} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-text/90">Keep files deleted from the source</span>
                    <span className="text-[11px] text-muted">Files removed from the source stay in the destination.</span>
                  </span>
                </label>
              )}

              {isFolder && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text/90">Ignore patterns</label>
                  <input
                    value={ignoreRaw}
                    onChange={(e) => setIgnoreRaw(e.target.value)}
                    placeholder="build/, *.cache, dist/"
                    spellCheck={false}
                    className="field h-10 px-3 text-xs font-mono"
                  />
                </div>
              )}

              {error && (
                <p className="selectable text-xs text-danger bg-danger/[0.08] border border-danger/20 rounded-xl px-3 py-2.5">{error}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-bg/40">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={saving || !name.trim()} onClick={save}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
