import { AnimatePresence, motion } from "framer-motion";
import { Plus, FolderSync, ArrowLeftRight } from "lucide-react";
import { useEffect, useState } from "react";
import { usePairs } from "../stores/usePairs";
import { PairCard } from "./PairCard";
import { AddPairDialog } from "./AddPairDialog";
import { Button } from "./ui/Button";
import { PageHeader } from "./ui/PageHeader";
import { SkeletonPairCard } from "./Skeleton";

export function PairList() {
  const { pairs, loading } = usePairs();
  const [showAdd, setShowAdd] = useState(false);
  const live = pairs.filter((p) => p.status === "syncing").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowAdd(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Sync Pairs"
        icon={<ArrowLeftRight size={18} />}
        subtitle={
          pairs.length === 0 ? (
            "Nothing linked yet."
          ) : (
            <>
              <span className="text-text font-medium tabular-nums">{pairs.length}</span> pair
              {pairs.length === 1 ? "" : "s"} ·{" "}
              <span className="text-accent font-medium tabular-nums">{live}</span> live
            </>
          )
        }
        actions={
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} strokeWidth={2.5} /> New pair
            <span className="ml-1 text-[10px] font-mono opacity-60">^N</span>
          </Button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7 pt-1">
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
          {loading && (
            <>
              <SkeletonPairCard />
              <SkeletonPairCard />
              <SkeletonPairCard />
            </>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            {pairs.map((pair, i) => (
              <PairCard key={pair.id} pair={pair} index={i} />
            ))}
          </AnimatePresence>
        </div>

        {!loading && pairs.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="relative flex flex-col items-center justify-center py-24 text-center gap-5"
          >
            <div className="relative">
              <div className="absolute -inset-6 rounded-full bg-accent/10 blur-2xl" />
              <div className="relative grid place-items-center w-16 h-16 rounded-2xl bg-surface-2 ring-gradient">
                <FolderSync size={28} className="text-accent" />
              </div>
            </div>
            <div>
              <p className="text-base font-semibold text-text tracking-tight">No sync pairs yet</p>
              <p className="text-[13px] text-muted mt-1.5 max-w-xs leading-relaxed">
                Link a file or folder to a destination and every change mirrors over instantly.
              </p>
            </div>
            <Button variant="primary" onClick={() => setShowAdd(true)}>
              <Plus size={15} strokeWidth={2.5} /> Create your first pair
            </Button>
          </motion.div>
        )}
      </div>

      <AddPairDialog open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}
