import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export interface SyncPair {
  id: string;
  name: string;
  source: string;
  destination: string;
  kind: "file" | "folder";
  direction: "oneWay" | "twoWay";
  ignore: string[];
  autoResumePaths: string[];
  status: "idle" | "scanning" | "syncing" | "paused" | "conflict" | "missing" | "error";
  createdAt: number;
}

export interface NewPair {
  name: string;
  source: string;
  destination: string;
  kind: "file" | "folder";
  direction: "oneWay" | "twoWay";
  ignore: string[];
}

export interface ActivityEvent {
  pairId: string;
  kind: string;
  path: string;
  detail?: string;
  ts: number;
}

export interface DbEvent {
  id: number;
  pairId: string;
  kind: string;
  path: string;
  detail?: string;
  ts: number;
}

export interface DbTombstone {
  id: number;
  pairId: string;
  relPath: string;
  deletedAt: number;
}

export interface ConflictPrompt {
  pairId: string;
  relPath: string;
  sourceModified: number;
  destModified: number;
}

export interface RespawnPrompt {
  pairId: string;
  relPath: string;
}

export interface AppSettings {
  autostart: boolean;
  defaultIgnores: string[];
}

export interface PairProgress {
  pairId: string;
  phase: "scanning" | "comparing" | "copying";
  done: number;
  total: number;
}

export interface SyncError {
  pairId: string;
  op: string;
  path: string;
  message: string;
  ts: number;
}

export const qa = {
  createWorkspace: () => invoke<string>("qa_create_workspace"),
  writeFile: (path: string, content: string) =>
    invoke<void>("qa_write_file", { path, content }),
  readFile: (path: string) => invoke<string | null>("qa_read_file", { path }),
  deletePath: (path: string) => invoke<void>("qa_delete_path", { path }),
  pathExists: (path: string) => invoke<boolean>("qa_path_exists", { path }),
  listDir: (path: string) => invoke<string[]>("qa_list_dir", { path }),
};

export const ipc = {
  listPairs: () => invoke<SyncPair[]>("list_pairs"),
  addPair: (input: NewPair) => invoke<SyncPair>("add_pair", { input }),
  removePair: (id: string) => invoke<void>("remove_pair", { id }),
  pausePair: (id: string) => invoke<void>("pause_pair", { id }),
  resumePair: (id: string) => invoke<void>("resume_pair", { id }),
  getActivity: (limit = 100, offset = 0) =>
    invoke<DbEvent[]>("get_activity", { limit, offset }),
  getTombstones: (pairId?: string) =>
    invoke<DbTombstone[]>("get_tombstones", { pairId }),
  respondRespawn: (
    pairId: string,
    relPath: string,
    decision: "resumeOnce" | "alwaysResume" | "ignore"
  ) => invoke<void>("respond_respawn", { pairId, relPath, decision }),
  resolveConflict: (
    pairId: string,
    relPath: string,
    choice: "keepSource" | "keepDest" | "keepBoth"
  ) => invoke<void>("resolve_conflict", { pairId, relPath, choice }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (settings: AppSettings) =>
    invoke<void>("set_settings", { settings }),
};

export async function pickPath(mode: "file" | "folder"): Promise<string | null> {
  const result = await open({
    directory: mode === "folder",
    multiple: false,
    title: mode === "folder" ? "Select Folder" : "Select File",
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export function onActivity(cb: (e: ActivityEvent) => void) {
  return listen<ActivityEvent>("activity", (ev) => cb(ev.payload));
}

export function onPairStatus(cb: (e: { pairId: string; status: string }) => void) {
  return listen<{ pairId: string; status: string }>("pair_status", (ev) =>
    cb(ev.payload)
  );
}

export function onConflictPrompt(cb: (e: ConflictPrompt) => void) {
  return listen<ConflictPrompt>("conflict_prompt", (ev) => cb(ev.payload));
}

export function onRespawnPrompt(cb: (e: RespawnPrompt) => void) {
  return listen<RespawnPrompt>("respawn_prompt", (ev) => cb(ev.payload));
}

export function onTombstoneAdded(cb: (e: DbTombstone) => void) {
  return listen<DbTombstone>("tombstone_added", (ev) => cb(ev.payload));
}

export function onTombstoneCleared(cb: (e: { pairId: string; relPath: string }) => void) {
  return listen<{ pairId: string; relPath: string }>("tombstone_cleared", (ev) =>
    cb(ev.payload)
  );
}

export function onSyncError(cb: (e: SyncError) => void) {
  return listen<SyncError>("sync_error", (ev) => cb(ev.payload));
}

export function onPairProgress(cb: (e: PairProgress) => void) {
  return listen<PairProgress>("pair_progress", (ev) => cb(ev.payload));
}
