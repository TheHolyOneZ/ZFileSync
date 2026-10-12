import { useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Sidebar, NAV, type Tab } from "./components/Sidebar";
import { PairList } from "./components/PairList";
import { ActivityFeed } from "./components/ActivityFeed";
import { QAPanel } from "./components/QAPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { AboutPanel } from "./components/AboutPanel";
import { ConflictPrompts } from "./components/ConflictPrompt";
import { RespawnPrompts } from "./components/RespawnPrompt";
import { ErrorToasts } from "./components/ErrorToasts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { usePairs } from "./stores/usePairs";
import { useActivity } from "./stores/useActivity";
import { useErrors } from "./stores/useErrors";
import {
  onActivity,
  onPairStatus,
  onConflictPrompt,
  onRespawnPrompt,
  onTombstoneAdded,
  onTombstoneCleared,
  onSyncError,
  onPairProgress,
} from "./lib/ipc";
import type { SyncPair } from "./lib/ipc";

export default function App() {
  const [tab, setTab] = useState<Tab>("pairs");
  const { pairs, load: loadPairs, updateStatus, addConflict, addRespawn, clearRespawn, setProgress } = usePairs();
  const { load: loadActivity, prependEvent, addTombstone, clearTombstone } = useActivity();
  const pushError = useErrors((s) => s.push);

  useEffect(() => {
    loadPairs();
    loadActivity();

    const cleanups: Promise<() => void>[] = [
      onActivity((e) => {
        prependEvent({
          id: Date.now() + Math.random(),
          pairId: e.pairId,
          kind: e.kind,
          path: e.path,
          detail: e.detail,
          ts: e.ts,
        });
      }),
      onPairStatus((e) => {
        updateStatus(e.pairId, e.status as SyncPair["status"]);
      }),
      onConflictPrompt((e) => {
        addConflict(e);
      }),
      onRespawnPrompt((e) => {
        addRespawn(e);
      }),
      onTombstoneAdded((t) => {
        addTombstone(t);
      }),
      onTombstoneCleared((e) => {
        clearTombstone(e.pairId, e.relPath);
        clearRespawn(e.pairId, e.relPath);
      }),
      onSyncError((e) => {
        pushError(e);
      }),
      onPairProgress((p) => {
        setProgress(p);
      }),
    ];


    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < NAV.length) {
        e.preventDefault();
        setTab(NAV[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      cleanups.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  const panels: Record<Tab, React.ReactNode> = {
    pairs: <PairList />,
    activity: <ActivityFeed />,
    qa: <QAPanel />,
    settings: <SettingsPanel />,
    about: <AboutPanel />,
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen overflow-hidden bg-bg text-text app-bg">
        <Sidebar active={tab} onChange={setTab} pairs={pairs} />
        <main className="relative flex-1 overflow-hidden min-w-0">
          <div className="absolute inset-x-0 top-0 h-72 dot-grid pointer-events-none" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="relative h-full"
              initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
              transition={{ duration: 0.14, ease: [0.2, 0.9, 0.25, 1] }}
            >
              <ErrorBoundary label={tab}>{panels[tab]}</ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
        <ConflictPrompts />
        <RespawnPrompts />
        <ErrorToasts />
      </div>
    </MotionConfig>
  );
}
