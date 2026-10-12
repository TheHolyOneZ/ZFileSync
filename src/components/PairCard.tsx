import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeftRight,
  Pause,
  Play,
  Trash2,
  MoreHorizontal,
  File as FileIcon,
  Folder as FolderIcon,
  AlertOctagon,
  Copy,
} from "lucide-react";
import { useState } from "react";
import type { SyncPair } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { usePairs } from "../stores/usePairs";
import { useErrors } from "../stores/useErrors";
import { IconButton } from "./ui/Button";

type Tone = "accent" | "info" | "warning" | "danger" | "muted";

const statusConfig: Record<SyncPair["status"], { label: string; tone: Tone; pulse: boolean }> = {
  idle:     { label: "idle",     tone: "muted",   pulse: false },
  scanning: { label: "scanning", tone: "info",    pulse: true  },
  syncing:  { label: "live",     tone: "accent",  pulse: true  },
  paused:   { label: "paused",   tone: "muted",   pulse: false },
  conflict: { label: "conflict", tone: "warning", pulse: true  },
  missing:  { label: "missing",  tone: "danger",  pulse: false },
  error:    { label: "error",    tone: "danger",  pulse: false },
};

const tones: Record<Tone, { dot: string; chip: string; glow: string; line: string }> = {
  accent: {
    dot: "bg-accent shadow-[0_0_10px_rgb(124_255_178/0.9)]",
    chip: "bg-accent/10 text-accent ring-accent/25",
    glow: "from-accent/[0.07]",
    line: "via-accent",
  },
  info: {
    dot: "bg-info shadow-[0_0_10px_rgb(116_199_255/0.9)]",
    chip: "bg-info/10 text-info ring-info/25",
    glow: "from-info/[0.07]",
    line: "via-info",
  },
  warning: {
    dot: "bg-warning shadow-[0_0_10px_rgb(255_200_87/0.9)]",
    chip: "bg-warning/10 text-warning ring-warning/25",
    glow: "from-warning/[0.07]",
    line: "via-warning",
  },
  danger: {
    dot: "bg-danger shadow-[0_0_10px_rgb(255_107_122/0.9)]",
    chip: "bg-danger/10 text-danger ring-danger/25",
    glow: "from-danger/[0.07]",
    line: "via-danger",
  },
  muted: {
    dot: "bg-faint",
    chip: "bg-white/[0.04] text-muted ring-border-2",
    glow: "from-transparent",
    line: "via-transparent",
  },
};

function splitPath(p: string) {
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return { dir: idx > 0 ? norm.slice(0, idx + 1) : "", base: idx >= 0 ? norm.slice(idx + 1) : norm };
}

const nf = new Intl.NumberFormat();

interface Props {
  pair: SyncPair;
  index?: number;
}

export function PairCard({ pair, index = 0 }: Props) {
  const { removePair, updateStatus } = usePairs();
  const progress = usePairs((s) => s.progress[pair.id]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cfg = statusConfig[pair.status] ?? statusConfig.idle;
  const tone = tones[cfg.tone];

  const lastError = useErrors((s) => s.log.find((e) => e.pairId === pair.id));

  const handlePause = async () => {
    updateStatus(pair.id, "paused");
    await ipc.pausePair(pair.id);
  };

  const handleResume = async () => {
    updateStatus(pair.id, "scanning");
    await ipc.resumePair(pair.id);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setMenuOpen(false);
    removePair(pair.id);
    await ipc.removePair(pair.id);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const DirIcon = pair.direction === "twoWay" ? ArrowLeftRight : ArrowRight;
  const src = splitPath(pair.source);
  const dst = splitPath(pair.destination);
  const live = pair.status === "syncing";
  const scanning = pair.status === "scanning";
  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
      transition={{ type: "spring", stiffness: 500, damping: 36, delay: Math.min(index, 8) * 0.025 }}
      className={`group relative rounded-2xl bg-surface/80 ring-gradient transition-[background-color,box-shadow] duration-200 hover:bg-surface-2/80 hover:shadow-[0_12px_40px_-16px_rgb(0_0_0/0.8)] ${
        menuOpen ? "z-20" : ""
      }`}
    >
      <div
        className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${tone.glow} to-transparent to-60% pointer-events-none`}
      />

      <div className="relative p-4 flex flex-col gap-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative grid place-items-center w-9 h-9 rounded-xl bg-bg/60 border border-border flex-shrink-0 text-muted">
              {pair.kind === "file" ? <FileIcon size={16} /> : <FolderIcon size={16} />}
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5">
                <span className={`absolute inset-0 rounded-full ring-2 ring-surface ${tone.dot}`} />
                {cfg.pulse && (
                  <span className={`absolute inset-0 rounded-full ${tone.dot} animate-ping opacity-60`} />
                )}
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-text truncate leading-tight tracking-[-0.01em]">
                {pair.name}
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                <span>{pair.kind === "file" ? "File" : "Folder"}</span>
                <span className="text-faint">/</span>
                <span className="flex items-center gap-1">
                  <DirIcon size={11} />
                  {pair.direction === "twoWay" ? "Two-way" : "One-way"}
                </span>
                {pair.ignore.length > 0 && (
                  <>
                    <span className="text-faint">/</span>
                    <span>{pair.ignore.length} ignored</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <span
              className={`inline-flex items-center h-6 px-2 rounded-md text-[11px] font-mono font-medium uppercase tracking-wider ring-1 ring-inset ${tone.chip}`}
            >
              {cfg.label}
            </span>
            {pair.status === "paused" ? (
              <IconButton onClick={handleResume} title="Resume" tone="accent">
                <Play size={15} />
              </IconButton>
            ) : (
              <IconButton onClick={handlePause} title="Pause">
                <Pause size={15} />
              </IconButton>
            )}
            <div className="relative">
              <IconButton onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))} title="More">
                <MoreHorizontal size={16} />
              </IconButton>
              <AnimatePresence>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={closeMenu} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.94, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.94, y: -6 }}
                      transition={{ type: "spring", stiffness: 700, damping: 40 }}
                      style={{ transformOrigin: "top right" }}
                      className="absolute right-0 top-10 z-20 glass ring-gradient rounded-xl shadow-[0_20px_50px_-12px_rgb(0_0_0/0.9)] min-w-48 p-1"
                    >
                      <MenuItem
                        icon={<Copy size={13} />}
                        onClick={() => {
                          navigator.clipboard?.writeText(`${pair.source} → ${pair.destination}`);
                          closeMenu();
                        }}
                      >
                        Copy paths
                      </MenuItem>
                      <MenuItem icon={<Trash2 size={13} />} danger onClick={handleDelete}>
                        {confirmDelete ? "Click again to remove" : "Remove pair"}
                      </MenuItem>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3.5 py-3 rounded-xl bg-bg/70 border border-border/80">
          <PathCell label="Source" dir={src.dir} base={src.base} full={pair.source} />
          <div className="relative w-16 h-6 flex items-center justify-center">
            <div className="absolute inset-x-0 top-1/2 h-px bg-border-2" />
            {(live || scanning) && (
              <div className="absolute inset-x-0 top-1/2 h-px overflow-hidden">
                <div className={`w-1/3 h-px bg-gradient-to-r from-transparent ${tone.line} to-transparent animate-flow`} />
              </div>
            )}
            <span
              className={`relative grid place-items-center w-6 h-6 rounded-full bg-surface-2 border border-border-2 ${
                live ? "text-accent" : scanning ? "text-info" : "text-muted"
              }`}
            >
              <DirIcon size={12} strokeWidth={2.25} />
            </span>
          </div>
          <PathCell label="Destination" dir={dst.dir} base={dst.base} full={pair.destination} />
        </div>

        <AnimatePresence initial={false}>
          {scanning && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-info font-medium">
                  {progress?.phase === "copying"
                    ? "Copying files"
                    : progress?.phase === "comparing"
                    ? "Comparing"
                    : "Scanning"}
                  <span className="text-muted font-normal"> · initial sync</span>
                </span>
                <span className="font-mono tabular-nums text-muted">
                  {progress
                    ? progress.total > 0
                      ? `${nf.format(progress.done)} / ${nf.format(progress.total)}`
                      : `${nf.format(progress.done)} found`
                    : "starting…"}
                </span>
              </div>
              <div className="relative h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                {pct !== null ? (
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-info to-accent shadow-[0_0_12px_rgb(124_255_178/0.6)]"
                    animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", stiffness: 200, damping: 30 }}
                  />
                ) : (
                  <div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-info to-transparent animate-flow" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {(pair.status === "error" || pair.status === "missing") && lastError && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-danger/[0.07] border border-danger/20">
            <AlertOctagon size={14} className="text-danger flex-shrink-0 mt-px" />
            <p className="selectable text-xs text-danger/90 leading-relaxed break-words min-w-0">
              {lastError.message}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function PathCell({ label, dir, base, full }: { label: string; dir: string; base: string; full: string }) {
  return (
    <div className="min-w-0" title={full}>
      <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-faint mb-1">{label}</div>

      <div className="flex min-w-0 font-mono text-xs">
        <span className="truncate text-faint">{dir}</span>
        <span className="truncate flex-shrink-0 max-w-full text-text">{base}</span>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full h-8 px-2.5 rounded-lg text-[13px] transition-colors cursor-pointer ${
        danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-white/[0.06]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
