import { motion, AnimatePresence } from "framer-motion";
import { X, FolderOpen, FileText, Folder, ArrowRight, ArrowLeftRight, Loader2, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, IconButton } from "./ui/Button";
import { ipc, pickPath } from "../lib/ipc";
import { usePairs } from "../stores/usePairs";

const schema = z.object({
  name: z.string().min(1, "Required"),
  source: z.string().min(1, "Required"),
  destination: z.string().min(1, "Required"),
  kind: z.enum(["file", "folder"]),
  direction: z.enum(["oneWay", "twoWay"]),
  ignoreRaw: z.string(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

const KIND_OPTIONS = [
  {
    value: "file" as const,
    icon: <FileText size={17} />,
    label: "Single File",
    desc: "Watch one specific file — perfect for logs.",
  },
  {
    value: "folder" as const,
    icon: <Folder size={17} />,
    label: "Folder",
    desc: "Mirror an entire directory tree.",
  },
];

const DIR_OPTIONS = [
  {
    value: "oneWay" as const,
    icon: <ArrowRight size={17} />,
    label: "One-way",
    desc: "Source → Destination only. Changes to destination are ignored.",
  },
  {
    value: "twoWay" as const,
    icon: <ArrowLeftRight size={17} />,
    label: "Two-way",
    desc: "Both sides stay in sync. Conflicts are flagged for review.",
  },
];

function PathRow({
  label,
  hint,
  placeholder,
  error,
  reg,
  onPick,
}: {
  label: string;
  hint: string;
  placeholder: string;
  error?: string;
  reg: ReturnType<ReturnType<typeof useForm<FormData>>["register"]>;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-text/90">{label}</label>
        <span className="text-[11px] text-faint">{hint}</span>
      </div>
      <div className="flex gap-2">
        <input
          {...reg}
          placeholder={placeholder}
          spellCheck={false}
          className={`field flex-1 min-w-0 h-10 px-3 text-xs font-mono ${error ? "!border-danger/50" : ""}`}
        />
        <motion.button
          type="button"
          onClick={onPick}
          whileTap={{ scale: 0.92 }}
          className="grid place-items-center w-10 h-10 rounded-[10px] border border-border bg-surface-2 text-muted hover:text-accent hover:border-accent/40 hover:bg-accent/[0.06] transition-colors cursor-pointer flex-shrink-0"
          title="Browse…"
        >
          <FolderOpen size={16} />
        </motion.button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function OptionCard({
  active,
  icon,
  label,
  desc,
  onClick,
  group,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
  group: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-start gap-3 p-3 rounded-xl border text-left transition-colors duration-150 cursor-pointer ${
        active
          ? "border-accent/40 text-text"
          : "border-border bg-surface-2/60 text-muted hover:border-border-2 hover:text-text"
      }`}
    >
      {active && (
        <motion.span
          layoutId={`opt-${group}`}
          className="absolute inset-0 rounded-xl bg-accent/[0.07] shadow-[inset_0_0_0_1px_rgb(124_255_178/0.35),0_0_24px_-8px_rgb(124_255_178/0.5)]"
          transition={{ type: "spring", stiffness: 600, damping: 40 }}
        />
      )}
      <span
        className={`relative grid place-items-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors ${
          active ? "bg-accent text-accent-ink" : "bg-surface-3 text-muted"
        }`}
      >
        {icon}
      </span>
      <span className="relative flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-xs text-muted leading-snug">{desc}</span>
      </span>
    </button>
  );
}

export function AddPairDialog({ open, onClose }: Props) {
  const { addPair, refresh } = usePairs();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { kind: "folder", direction: "oneWay", ignoreRaw: "" },
  });

  const kind = watch("kind");
  const direction = watch("direction");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onSubmit = async (data: FormData) => {
    setError(null);
    const ignore =
      kind === "folder"
        ? data.ignoreRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    try {
      const pair = await ipc.addPair({
        name: data.name,
        source: data.source,
        destination: data.destination,
        kind: data.kind,
        direction: data.direction,
        ignore,
      });
      addPair(pair);
      refresh().catch(() => {});
      reset();
      onClose();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const pickSource = async () => {
    const p = await pickPath(kind);
    if (p) setValue("source", p, { shouldValidate: true });
  };

  const pickDest = async () => {
    const p = await pickPath(kind);
    if (p) setValue("destination", p, { shouldValidate: true });
  };

  const srcPlaceholder =
    kind === "file" ? "/home/user/MyGame/game.log" : "/home/user/MyGame/logs/";
  const dstPlaceholder =
    kind === "file"
      ? "/home/user/workspace/mirrored-game.log"
      : "/home/user/workspace/logs/";
  const srcHint =
    kind === "file" ? "exact path to the file" : "root folder to watch";
  const dstHint =
    kind === "file" ? "exact path of the copy" : "root folder to mirror into";

  return (
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
            className="relative z-10 w-full max-w-xl max-h-full bg-surface ring-gradient rounded-2xl shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9),0_0_0_1px_rgb(0_0_0/0.5)] overflow-hidden flex flex-col"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 520, damping: 38 }}
          >
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-accent/[0.06] to-transparent pointer-events-none" />

            <div className="relative flex items-start justify-between px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
                  <Link2 size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.02em] text-text leading-none">New sync pair</h2>
                  <p className="text-[13px] text-muted mt-1.5">
                    Link two paths and changes replicate automatically.
                  </p>
                </div>
              </div>
              <IconButton onClick={onClose} title="Close (Esc)">
                <X size={16} />
              </IconButton>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="relative flex flex-col min-h-0">
              <div className="px-6 pb-5 flex flex-col gap-5 overflow-y-auto">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text/90">Name</label>
                  <input
                    {...register("name")}
                    placeholder="Game Logs"
                    autoFocus
                    className={`field h-10 px-3 text-sm ${errors.name ? "!border-danger/50" : ""}`}
                  />
                  {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text/90">What to sync</label>
                  <div className="grid grid-cols-2 gap-2">
                    {KIND_OPTIONS.map((opt) => (
                      <OptionCard
                        key={opt.value}
                        group="kind"
                        active={kind === opt.value}
                        icon={opt.icon}
                        label={opt.label}
                        desc={opt.desc}
                        onClick={() => setValue("kind", opt.value)}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text/90">Direction</label>
                  <div className="grid grid-cols-2 gap-2">
                    {DIR_OPTIONS.map((opt) => (
                      <OptionCard
                        key={opt.value}
                        group="dir"
                        active={direction === opt.value}
                        icon={opt.icon}
                        label={opt.label}
                        desc={opt.desc}
                        onClick={() => setValue("direction", opt.value)}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3.5 p-4 rounded-xl bg-bg/50 border border-border">
                  <PathRow
                    label="Source"
                    hint={srcHint}
                    placeholder={srcPlaceholder}
                    error={errors.source?.message}
                    reg={register("source")}
                    onPick={pickSource}
                  />
                  <PathRow
                    label="Destination"
                    hint={dstHint}
                    placeholder={dstPlaceholder}
                    error={errors.destination?.message}
                    reg={register("destination")}
                    onPick={pickDest}
                  />
                </div>

                <AnimatePresence initial={false}>
                  {kind === "folder" && (
                    <motion.div
                      key="ignore"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.16 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between">
                          <label className="text-xs font-medium text-text/90">Ignore patterns</label>
                          <span className="text-[11px] text-faint">comma-separated globs</span>
                        </div>
                        <input
                          {...register("ignoreRaw")}
                          placeholder="build/, *.cache, dist/"
                          spellCheck={false}
                          className="field h-10 px-3 text-xs font-mono"
                        />
                        <p className="text-[11px] text-faint">
                          Always excluded: node_modules, .git, *.tmp, *.swp
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="selectable text-xs text-danger bg-danger/[0.08] border border-danger/20 rounded-xl px-3 py-2.5 leading-relaxed"
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-bg/40">
                <span className="text-[11px] text-faint">
                  <span className="kbd">Esc</span> to close
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Creating…
                      </>
                    ) : (
                      "Create pair"
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
