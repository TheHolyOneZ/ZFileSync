import { motion } from "framer-motion";
import { ArrowLeftRight, History, Settings, Beaker, Info } from "lucide-react";
import type { SyncPair } from "../lib/ipc";

export type Tab = "pairs" | "activity" | "qa" | "settings" | "about";

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
  pairs: SyncPair[];
}

export const NAV: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: "pairs", icon: <ArrowLeftRight size={16} />, label: "Pairs" },
  { id: "activity", icon: <History size={16} />, label: "Activity" },
  { id: "qa", icon: <Beaker size={16} />, label: "QA Tester" },
  { id: "settings", icon: <Settings size={16} />, label: "Settings" },
  { id: "about", icon: <Info size={16} />, label: "About" },
];

export function Sidebar({ active, onChange, pairs }: Props) {
  const live = pairs.filter((p) => p.status === "syncing").length;
  const scanning = pairs.filter((p) => p.status === "scanning").length;
  const errored = pairs.filter((p) => p.status === "error" || p.status === "conflict").length;
  const paused = pairs.filter((p) => p.status === "paused").length;

  return (
    <aside className="relative flex flex-col w-60 flex-shrink-0 p-3 pr-0">
      <div className="flex flex-col h-full rounded-2xl bg-surface/70 ring-gradient overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-5">
          <div className="relative">
            <img src="/icon.png" alt="" className="w-8 h-8 rounded-[9px] relative z-10" />
            <div className="absolute inset-0 rounded-[9px] bg-accent/40 blur-md" />
          </div>
          <div className="leading-none">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-text">ZFileSync</h1>
            <p className="text-[11px] text-muted mt-1 font-mono">real-time mirror</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {NAV.map((item, i) => {
            const isActive = active === item.id;
            const badge = item.id === "pairs" ? pairs.length : undefined;
            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={`group relative flex items-center gap-3 h-9 px-3 rounded-[10px] text-[13px] text-left w-full cursor-pointer transition-colors duration-150 ${
                  isActive ? "text-text" : "text-muted hover:text-text hover:bg-white/[0.03]"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-[10px] bg-white/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_0_0_1px_rgb(255_255_255/0.04)]"
                    transition={{ type: "spring", stiffness: 600, damping: 42 }}
                  >
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent shadow-[0_0_12px_rgb(124_255_178/0.9)]" />
                  </motion.span>
                )}
                <span className={`relative z-10 transition-colors ${isActive ? "text-accent" : ""}`}>{item.icon}</span>
                <span className="relative z-10 flex-1 font-medium">{item.label}</span>
                {badge !== undefined && badge > 0 ? (
                  <span
                    className={`relative z-10 text-[11px] font-mono tabular-nums px-1.5 py-px rounded-md ${
                      isActive ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-muted"
                    }`}
                  >
                    {badge}
                  </span>
                ) : (
                  <span className="relative z-10 kbd opacity-0 group-hover:opacity-100 transition-opacity">
                    ^{i + 1}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="m-2 p-3 rounded-xl bg-bg/50 border border-border">
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-faint mb-2.5">Status</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <StatusStat label="Live" count={live} dot="bg-accent shadow-[0_0_8px_rgb(124_255_178/0.9)]" />
            <StatusStat label="Scanning" count={scanning} dot="bg-info shadow-[0_0_8px_rgb(116_199_255/0.9)]" />
            <StatusStat label="Paused" count={paused} dot="bg-faint" />
            <StatusStat label="Issues" count={errored} dot="bg-danger shadow-[0_0_8px_rgb(255_107_122/0.9)]" />
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusStat({ label, count, dot }: { label: string; count: number; dot: string }) {
  const on = count > 0;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-muted">
        <span className={`w-1.5 h-1.5 rounded-full ${on ? dot : "bg-border-2"}`} />
        {label}
      </span>
      <span className={`font-mono tabular-nums ${on ? "text-text" : "text-faint"}`}>{count}</span>
    </div>
  );
}
