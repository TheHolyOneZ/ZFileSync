import { AnimatePresence, motion } from "framer-motion";
import {
  Beaker,
  Check,
  CircleDashed,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  X,
  ArrowRight,
  ArrowLeftRight,
  File as FileIcon,
  Folder as FolderIcon,
} from "lucide-react";
import { useState } from "react";
import { ipc, qa } from "../lib/ipc";
import { usePairs } from "../stores/usePairs";
import { Button } from "./ui/Button";
import { PageHeader } from "./ui/PageHeader";


type StepStatus = "pending" | "running" | "ok" | "fail";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

type ScenarioStatus = "idle" | "running" | "passed" | "failed";

interface ScenarioState {
  id: string;
  title: string;
  description: string;
  kind: "file" | "folder";
  direction: "oneWay" | "twoWay";
  steps: Step[];
  status: ScenarioStatus;
  workspace?: string;
  pairId?: string;
  durationMs?: number;
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


class AssertionError extends Error {}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}


const join = (...parts: string[]) =>
  parts.filter(Boolean).join("/").replace(/\/+/g, "/");


const BASE_SCENARIOS: Omit<ScenarioState, "steps" | "status">[] = [
  {
    id: "folder-oneway",
    title: "Folder · one-way",
    description: "Mirror source/ → dest/ on initial reconcile, on add, on edit, and on delete.",
    kind: "folder",
    direction: "oneWay",
  },
  {
    id: "folder-twoway",
    title: "Folder · two-way",
    description: "Sync both directions: source→dest, dest→source, and nested writes.",
    kind: "folder",
    direction: "twoWay",
  },
  {
    id: "file-oneway",
    title: "File · one-way",
    description: "Watch a single file. Initial copy + appended writes propagate to mirror.",
    kind: "file",
    direction: "oneWay",
  },
  {
    id: "file-twoway",
    title: "File · two-way",
    description: "Single-file two-way: writes on either side propagate to the other.",
    kind: "file",
    direction: "twoWay",
  },
];


function buildSteps(kind: "file" | "folder", direction: "oneWay" | "twoWay"): Step[] {
  const common: Step[] = [
    { id: "ws", label: "Create temp workspace", status: "pending" },
    { id: "seed", label: "Seed source with initial content", status: "pending" },
    { id: "add", label: "Add sync pair via IPC", status: "pending" },
    { id: "reconcile", label: "Verify initial reconcile mirrored content", status: "pending" },
  ];
  if (kind === "folder") {
    common.push(
      { id: "edit", label: "Edit existing file on source", status: "pending" },
      { id: "verify-edit", label: "Verify edit propagated", status: "pending" },
      { id: "create", label: "Create new nested file on source", status: "pending" },
      { id: "verify-create", label: "Verify new file appeared on dest", status: "pending" },
    );
    if (direction === "twoWay") {
      common.push(
        { id: "reverse", label: "Write file on dest side", status: "pending" },
        { id: "verify-reverse", label: "Verify dest write reached source", status: "pending" },
      );
    }
    common.push(
      { id: "delete", label: "Delete a file on source", status: "pending" },
      { id: "verify-delete", label: "Verify deletion propagated", status: "pending" },
    );
  } else {
    common.push(
      { id: "edit", label: "Append to source file", status: "pending" },
      { id: "verify-edit", label: "Verify append reached destination", status: "pending" },
    );
    if (direction === "twoWay") {
      common.push(
        { id: "reverse", label: "Rewrite destination file", status: "pending" },
        { id: "verify-reverse", label: "Verify destination write reached source", status: "pending" },
      );
    }
  }
  common.push({ id: "cleanup", label: "Remove pair and workspace", status: "pending" });
  return common;
}


async function waitFor<T>(
  pred: () => Promise<T | null>,
  timeoutMs = 8000,
  intervalMs = 200,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await pred();
    if (r !== null && r !== false && r !== undefined) return r;
    await sleep(intervalMs);
  }
  throw new AssertionError(`Timed out after ${timeoutMs}ms`);
}


async function waitForWatching(pairId: string, timeoutMs = 15000) {
  return waitFor(async () => {
    const p = (await ipc.listPairs()).find((x) => x.id === pairId);
    return p && p.status !== "scanning" ? p : null;
  }, timeoutMs);
}

async function waitForFileContent(path: string, expected: string, timeoutMs = 8000) {
  return waitFor(async () => {
    const c = await qa.readFile(path);
    return c === expected ? true : null;
  }, timeoutMs);
}

async function waitForFileGone(path: string, timeoutMs = 8000) {
  return waitFor(async () => {
    const exists = await qa.pathExists(path);
    return !exists ? true : null;
  }, timeoutMs);
}

async function waitForFileExists(path: string, timeoutMs = 8000) {
  return waitFor(async () => {
    const exists = await qa.pathExists(path);
    return exists ? true : null;
  }, timeoutMs);
}


type Updater = (id: string, patch: Partial<Step>) => void;

async function runFolderScenario(
  s: ScenarioState,
  update: Updater,
): Promise<{ workspace: string; pairId: string }> {

  update("ws", { status: "running" });
  const ws = await qa.createWorkspace();
  const source = join(ws, "source");
  const dest = join(ws, "dest");
  update("ws", { status: "ok", detail: ws });


  update("seed", { status: "running" });
  await qa.writeFile(join(source, "a.txt"), "alpha\n");
  await qa.writeFile(join(source, "b.txt"), "bravo\n");
  await qa.writeFile(join(source, "nested/c.txt"), "charlie\n");
  update("seed", { status: "ok", detail: "3 files seeded" });


  update("add", { status: "running" });
  const pair = await ipc.addPair({
    name: `QA · ${s.title}`,
    source,
    destination: dest,
    kind: "folder",
    direction: s.direction,
    ignore: [],
  });
  update("add", { status: "ok", detail: `pair ${pair.id.slice(0, 6)}` });


  update("reconcile", { status: "running" });
  await waitForFileContent(join(dest, "a.txt"), "alpha\n");
  await waitForFileContent(join(dest, "b.txt"), "bravo\n");
  await waitForFileContent(join(dest, "nested/c.txt"), "charlie\n");
  await waitForWatching(pair.id);
  update("reconcile", { status: "ok", detail: "dest mirrors source" });


  update("edit", { status: "running" });
  await qa.writeFile(join(source, "a.txt"), "alpha-edited\n");
  update("edit", { status: "ok" });
  update("verify-edit", { status: "running" });
  await waitForFileContent(join(dest, "a.txt"), "alpha-edited\n");
  update("verify-edit", { status: "ok" });


  update("create", { status: "running" });
  await qa.writeFile(join(source, "nested/deep/d.txt"), "delta\n");
  update("create", { status: "ok" });
  update("verify-create", { status: "running" });
  await waitForFileContent(join(dest, "nested/deep/d.txt"), "delta\n");
  update("verify-create", { status: "ok" });


  if (s.direction === "twoWay") {
    update("reverse", { status: "running" });
    await qa.writeFile(join(dest, "from-dest.txt"), "reverse\n");
    update("reverse", { status: "ok" });
    update("verify-reverse", { status: "running" });
    await waitForFileContent(join(source, "from-dest.txt"), "reverse\n");
    update("verify-reverse", { status: "ok" });
  }


  update("delete", { status: "running" });
  await qa.deletePath(join(source, "b.txt"));
  update("delete", { status: "ok" });
  update("verify-delete", { status: "running" });
  await waitForFileGone(join(dest, "b.txt"));
  update("verify-delete", { status: "ok" });

  return { workspace: ws, pairId: pair.id };
}

async function runFileScenario(
  s: ScenarioState,
  update: Updater,
): Promise<{ workspace: string; pairId: string }> {

  update("ws", { status: "running" });
  const ws = await qa.createWorkspace();
  const source = join(ws, "source.log");
  const dest = join(ws, "mirror.log");
  update("ws", { status: "ok", detail: ws });


  update("seed", { status: "running" });
  await qa.writeFile(source, "line-1\n");
  update("seed", { status: "ok", detail: "source.log written" });


  update("add", { status: "running" });
  const pair = await ipc.addPair({
    name: `QA · ${s.title}`,
    source,
    destination: dest,
    kind: "file",
    direction: s.direction,
    ignore: [],
  });
  update("add", { status: "ok", detail: `pair ${pair.id.slice(0, 6)}` });


  update("reconcile", { status: "running" });
  await waitForFileContent(dest, "line-1\n");
  await waitForWatching(pair.id);
  update("reconcile", { status: "ok", detail: "dest received initial copy" });


  update("edit", { status: "running" });
  await qa.writeFile(source, "line-1\nline-2\n");
  update("edit", { status: "ok" });
  update("verify-edit", { status: "running" });
  await waitForFileContent(dest, "line-1\nline-2\n");
  update("verify-edit", { status: "ok" });


  if (s.direction === "twoWay") {
    update("reverse", { status: "running" });
    await qa.writeFile(dest, "from-dest-side\n");
    update("reverse", { status: "ok" });
    update("verify-reverse", { status: "running" });
    await waitForFileContent(source, "from-dest-side\n");
    update("verify-reverse", { status: "ok" });
  }

  return { workspace: ws, pairId: pair.id };
}


export function QAPanel() {
  const [scenarios, setScenarios] = useState<ScenarioState[]>(() =>
    BASE_SCENARIOS.map((b) => ({
      ...b,
      steps: buildSteps(b.kind, b.direction),
      status: "idle",
    })),
  );
  const [busy, setBusy] = useState(false);
  const removePairFromStore = usePairs((s) => s.removePair);

  const updateScenario = (id: string, patch: Partial<ScenarioState>) =>
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );

  const updateStep = (scenarioId: string, stepId: string, patch: Partial<Step>) =>
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === scenarioId
          ? { ...s, steps: s.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
          : s,
      ),
    );

  const resetScenario = (id: string) => {
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              steps: buildSteps(s.kind, s.direction),
              status: "idle",
              workspace: undefined,
              pairId: undefined,
              durationMs: undefined,
            }
          : s,
      ),
    );
  };

  const cleanup = async (s: ScenarioState) => {
    updateStep(s.id, "cleanup", { status: "running" });
    try {
      if (s.pairId) {
        try {
          await ipc.removePair(s.pairId);
        } catch {}
        removePairFromStore(s.pairId);
      }
      if (s.workspace) {
        await qa.deletePath(s.workspace);
      }
      updateStep(s.id, "cleanup", { status: "ok" });
    } catch (e: any) {
      updateStep(s.id, "cleanup", { status: "fail", detail: String(e) });
    }
  };

  const runScenario = async (s: ScenarioState) => {
    if (busy) return;
    setBusy(true);
    resetScenario(s.id);

    const fresh: ScenarioState = {
      ...s,
      steps: buildSteps(s.kind, s.direction),
      status: "running",
      workspace: undefined,
      pairId: undefined,
    };
    updateScenario(s.id, fresh);

    const t0 = performance.now();
    const update: Updater = (stepId, patch) => updateStep(s.id, stepId, patch);

    try {
      const result =
        s.kind === "folder"
          ? await runFolderScenario(fresh, update)
          : await runFileScenario(fresh, update);

      updateScenario(s.id, { workspace: result.workspace, pairId: result.pairId });
      await cleanup({ ...fresh, ...result });
      updateScenario(s.id, {
        status: "passed",
        durationMs: Math.round(performance.now() - t0),
      });
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);

      setScenarios((prev) =>
        prev.map((sc) => {
          if (sc.id !== s.id) return sc;
          const steps = sc.steps.map((st) =>
            st.status === "running" ? { ...st, status: "fail" as StepStatus, detail: msg } : st,
          );
          return { ...sc, steps };
        }),
      );

      const latest = await new Promise<ScenarioState>((resolve) =>
        setScenarios((prev) => {
          const sc = prev.find((x) => x.id === s.id)!;
          resolve(sc);
          return prev;
        }),
      );
      await cleanup(latest);
      updateScenario(s.id, {
        status: "failed",
        durationMs: Math.round(performance.now() - t0),
      });
    } finally {
      setBusy(false);
    }
  };

  const runAll = async () => {
    for (const s of scenarios) {


      await runScenario(s);
    }
  };

  const allPassed = scenarios.every((s) => s.status === "passed");
  const anyFailed = scenarios.some((s) => s.status === "failed");

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="QA Tester"
        icon={<Beaker size={18} />}
        subtitle="End-to-end tests against the live backend. Pairs appear in the Pairs tab while running."
        actions={
          <>
            {anyFailed && <span className="text-xs text-danger font-mono">some failed</span>}
            {allPassed && <span className="text-xs text-accent font-mono">all passed</span>}
            <Button variant="primary" onClick={runAll} disabled={busy}>
              <Play size={14} /> Run all
            </Button>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7 pt-1 grid grid-cols-1 xl:grid-cols-2 gap-3 auto-rows-min">
        {scenarios.map((s) => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            busy={busy}
            onRun={() => runScenario(s)}
            onReset={() => resetScenario(s.id)}
          />
        ))}
      </div>
    </div>
  );
}


function ScenarioCard({
  scenario,
  busy,
  onRun,
  onReset,
}: {
  scenario: ScenarioState;
  busy: boolean;
  onRun: () => void;
  onReset: () => void;
}) {
  const KindIcon = scenario.kind === "file" ? FileIcon : FolderIcon;
  const DirIcon = scenario.direction === "twoWay" ? ArrowLeftRight : ArrowRight;

  const statusBadge =
    scenario.status === "running"
      ? <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-info/12 text-info border-info/20">running</span>
      : scenario.status === "passed"
      ? <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-accent/12 text-accent border-accent/20">passed</span>
      : scenario.status === "failed"
      ? <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-danger/12 text-danger border-danger/20">failed</span>
      : <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-surface-2 text-muted border-border">idle</span>;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl ring-gradient bg-surface/70 overflow-hidden flex flex-col"
    >
      <div className="p-3.5 flex items-start justify-between gap-3 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <KindIcon size={13} className="text-muted" />
            <DirIcon size={12} className="text-muted" />
            {scenario.title}
          </div>
          <p className="text-xs text-muted mt-1 leading-snug">{scenario.description}</p>
          {scenario.durationMs !== undefined && (
            <p className="text-xs text-muted/60 mt-1 font-mono">
              {(scenario.durationMs / 1000).toFixed(2)}s
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {statusBadge}
          {scenario.status !== "running" && scenario.status !== "idle" && (
            <button
              onClick={onReset}
              title="Reset"
              className="p-1.5 text-muted hover:text-text rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
            </button>
          )}
          <Button variant="primary" size="sm" onClick={onRun} disabled={busy}>
            <Play size={11} /> Run
          </Button>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {scenario.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </AnimatePresence>
      </div>

      {scenario.workspace && (
        <div className="px-3.5 py-2 border-t border-border bg-bg/30">
          <p className="text-xs text-muted/70 font-mono truncate" title={scenario.workspace}>
            <Trash2 size={9} className="inline mr-1" />
            {scenario.workspace}
          </p>
        </div>
      )}
    </motion.div>
  );
}

function StepRow({ step }: { step: Step }) {
  const icon =
    step.status === "ok" ? (
      <Check size={12} className="text-accent" />
    ) : step.status === "fail" ? (
      <X size={12} className="text-danger" />
    ) : step.status === "running" ? (
      <Loader2 size={12} className="text-info animate-spin" />
    ) : (
      <CircleDashed size={12} className="text-muted/40" />
    );

  const textColor =
    step.status === "ok"
      ? "text-text"
      : step.status === "fail"
      ? "text-danger"
      : step.status === "running"
      ? "text-text"
      : "text-muted/60";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-start gap-2 px-2 py-1 rounded-md"
    >
      <span className="flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs leading-snug ${textColor}`}>{step.label}</p>
        {step.detail && (
          <p className="text-xs text-muted/60 font-mono truncate mt-0.5" title={step.detail}>
            {step.detail}
          </p>
        )}
      </div>
    </motion.div>
  );
}
