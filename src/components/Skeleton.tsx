import { motion } from "framer-motion";

const shimmer = {
  animate: { opacity: [0.35, 0.7, 0.35] },
  transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" as const },
};

export function SkeletonPairCard() {
  return (
    <div className="rounded-2xl ring-gradient bg-surface/60 p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <motion.span {...shimmer} className="w-9 h-9 rounded-xl bg-muted/15" />
          <div className="flex-1 min-w-0">
            <motion.div {...shimmer} className="h-3.5 w-32 rounded bg-muted/20" />
            <motion.div {...shimmer} className="h-2.5 w-24 rounded bg-muted/15 mt-1.5" />
          </div>
        </div>
        <motion.div {...shimmer} className="h-5 w-12 rounded bg-muted/15" />
      </div>
      <motion.div {...shimmer} className="h-[58px] rounded-xl bg-bg/60 border border-border/60" />
    </div>
  );
}

export function SkeletonActivityRow() {
  return (
    <motion.div {...shimmer} className="flex items-center gap-2.5 px-3 py-1.5">
      <span className="w-3 h-3 rounded bg-muted/25" />
      <span className="h-3 w-14 rounded bg-muted/20" />
      <span className="h-3 flex-1 rounded bg-muted/15" />
      <span className="h-3 w-12 rounded bg-muted/15" />
    </motion.div>
  );
}
