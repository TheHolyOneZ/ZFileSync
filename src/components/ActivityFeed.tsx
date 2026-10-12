import { motion, AnimatePresence } from "framer-motion";
import { Copy, Trash2, AlertTriangle, RefreshCw, AlertOctagon, Check, History, Radio } from "lucide-react";
import { PageHeader } from "./ui/PageHeader";
import { useActivity } from "../stores/useActivity";
import { usePairs } from "../stores/usePairs";
import { useErrors } from "../stores/useErrors";
import { SkeletonActivityRow } from "./Skeleton";

function relTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "now";
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(ts).toLocaleDateString();
}

const kindConfig: Record<string, { icon: React.ReactNode; color: string; chip: string; label: string }> = {
  copied:   { icon: <Copy size={12} />,          color: "text-accent",  chip: "bg-accent/10",  label: "copied"   },
  deleted:  { icon: <Trash2 size={12} />,        color: "text-danger",  chip: "bg-danger/10",  label: "deleted"  },
  conflict: { icon: <AlertTriangle size={12} />, color: "text-warning", chip: "bg-warning/10", label: "conflict" },
  respawn:  { icon: <RefreshCw size={12} />,     color: "text-info",    chip: "bg-info/10",    label: "respawn"  },
  resolved: { icon: <Check size={12} />,         color: "text-muted",   chip: "bg-white/5",    label: "resolved" },
  error:    { icon: <AlertOctagon size={12} />,  color: "text-danger",  chip: "bg-danger/10",  label: "error"    },
};

export function ActivityFeed() {
  const { events, tombstones, loading } = useActivity();
  const { pairs } = usePairs();
  const errorLog = useErrors((s) => s.log);
  const clearLog = useErrors((s) => s.clearLog);

  const pairName = (id: string | undefined | null) => {
    if (!id) return "?";
    return pairs.find((p) => p.id === id)?.name ?? String(id).slice(0, 8);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Activity"
        icon={<History size={18} />}
        subtitle={
          <>
            {events.length} event{events.length === 1 ? "" : "s"} · {tombstones.length} tombstone
            {tombstones.length === 1 ? "" : "s"}
            {errorLog.length > 0 ? ` · ${errorLog.length} error${errorLog.length === 1 ? "" : "s"}` : ""}
          </>
        }
        actions={
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent/10 text-accent text-xs font-medium ring-1 ring-inset ring-accent/25">
            <Radio size={12} className="animate-pulse" /> Live
          </span>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7 pt-1 flex flex-col gap-6">

        {tombstones.length > 0 && (
          <Section title="Deleted files">
            <AnimatePresence>
              {tombstones.map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2.5 h-9 px-3 rounded-xl bg-danger/[0.06] border border-danger/15"
                >
                  <Trash2 size={11} className="text-danger flex-shrink-0" />
                  <span className="font-mono text-xs text-text truncate flex-1">
                    {t.relPath || "(file)"}
                  </span>
                  <span className="text-xs text-muted font-mono">{pairName(t.pairId)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </Section>
        )}


        {errorLog.length > 0 && (
          <Section
            title="Errors"
            action={
              <button
                onClick={clearLog}
                className="text-xs text-muted hover:text-text transition-colors cursor-pointer"
              >
                Clear
              </button>
            }
          >
            {errorLog.slice(0, 20).map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-danger/[0.06] border border-danger/15"
              >
                <AlertOctagon size={11} className="text-danger flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-danger">{e.op}</span>
                    <span className="text-xs text-muted font-mono">{pairName(e.pairId)}</span>
                  </div>
                  <p className="selectable text-xs text-text/90 mt-1 break-words leading-relaxed">{e.message}</p>
                  <p className="text-xs text-muted/70 mt-0.5 font-mono truncate" title={e.path}>
                    {e.path}
                  </p>
                </div>
              </div>
            ))}
          </Section>
        )}


        <Section title="Recent activity">
          {loading ? (
            <>
              <SkeletonActivityRow />
              <SkeletonActivityRow />
              <SkeletonActivityRow />
              <SkeletonActivityRow />
            </>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <History size={22} className="text-faint" />
              <p className="text-[13px] text-muted">Quiet so far. Sync events will show up here.</p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {events.map((ev) => {
                const cfg = kindConfig[ev.kind] ?? {
                  icon: <Copy size={11} />,
                  color: "text-muted",
                  label: ev.kind,
                };
                return (
                  <motion.div
                    key={ev.id}
                    initial={{ opacity: 0, y: -4, backgroundColor: "rgba(124,255,178,0.08)" }}
                    animate={{ opacity: 1, y: 0, backgroundColor: "rgba(124,255,178,0)" }}
                    transition={{ duration: 0.5, ease: [0.2, 0.9, 0.25, 1] }}
                    className="flex items-center gap-3 h-10 px-2.5 rounded-xl hover:!bg-white/[0.03] transition-colors"
                  >
                    <span className={`grid place-items-center w-6 h-6 rounded-md flex-shrink-0 ${cfg.chip} ${cfg.color}`}>
                      {cfg.icon}
                    </span>
                    <span className={`text-xs font-medium w-14 flex-shrink-0 ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    <span
                      className="font-mono text-xs text-text/85 truncate flex-1"
                      title={ev.path}
                    >
                      {ev.path || "(root)"}
                    </span>
                    <span className="text-[11px] text-muted px-1.5 py-0.5 rounded-md bg-white/[0.04] flex-shrink-0 max-w-40 truncate">
                      {pairName(ev.pairId)}
                    </span>
                    <span className="text-[11px] text-faint flex-shrink-0 font-mono tabular-nums w-9 text-right">
                      {relTime(ev.ts)}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-faint">{title}</p>
        {action}
      </div>
      <div className="flex flex-col gap-1 p-1.5 rounded-2xl bg-surface/60 ring-gradient">{children}</div>
    </section>
  );
}
