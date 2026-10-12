use notify::{
    event::EventKind, Config, Event, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher,
};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::{
    apply::{copy_file, delete_path, hash_file, likely_same, mtime_ms},
    ignore::IgnoreSet,
    pair::{Direction, Kind, PairStatus, SyncPair},
    reconcile, set_status, StatusCell,
};
use crate::{
    db,
    events::{
        ConflictPromptEvent, RespawnPromptEvent, SyncErrorEvent, TombstoneEvent, EVENT_ACTIVITY,
        EVENT_CONFLICT_PROMPT, EVENT_PAIR_PROGRESS, EVENT_RESPAWN_PROMPT, EVENT_SYNC_ERROR,
        EVENT_TOMBSTONE_ADDED, EVENT_TOMBSTONE_CLEARED,
    },
};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn emit_activity(app: &AppHandle, pair_id: Uuid, kind: &str, path: &str) {
    let _ = app.emit(
        EVENT_ACTIVITY,
        serde_json::json!({
            "pairId": pair_id.to_string(),
            "kind": kind,
            "path": path,
            "ts": now_ms(),
        }),
    );
}

fn emit_error(app: &AppHandle, pair_id: Uuid, op: &str, path: &str, message: &str) {
    let _ = app.emit(
        EVENT_SYNC_ERROR,
        SyncErrorEvent {
            pair_id: pair_id.to_string(),
            op: op.into(),
            path: path.into(),
            message: message.into(),
            ts: now_ms(),
        },
    );
}

pub fn spawn_watcher(
    pair: SyncPair,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    app: AppHandle,
    stop_flag: Arc<AtomicBool>,
    status: StatusCell,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        run_watcher(pair, db_conn, app, stop_flag, status);
    })
}

fn run_reconcile(
    pair: &SyncPair,
    ignore: &IgnoreSet,
    db_conn: &Arc<Mutex<rusqlite::Connection>>,
    app: &AppHandle,
    stop_flag: &AtomicBool,
) -> Vec<(String, String)> {
    match pair.kind {
        Kind::File => {
            if let Some(parent) = pair.destination.parent() {
                if !parent.as_os_str().is_empty() && !parent.exists() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }
        }
        Kind::Folder => {
            if !pair.destination.exists() {
                let _ = std::fs::create_dir_all(&pair.destination);
            }
        }
    }

    let last_emit = Mutex::new(std::time::Instant::now() - Duration::from_secs(1));
    let progress = |phase: &str, done: usize, total: usize| {
        let mut last = last_emit.lock().unwrap();
        if done < total && last.elapsed() < Duration::from_millis(150) {
            return;
        }
        *last = std::time::Instant::now();
        let _ = app.emit(
            EVENT_PAIR_PROGRESS,
            serde_json::json!({ "pairId": pair.id.to_string(), "phase": phase, "done": done, "total": total }),
        );
    };
    let ctx = reconcile::Ctx { db: db_conn, pair_id: pair.id, stop: stop_flag, progress: &progress };

    let result = match (&pair.kind, &pair.direction) {
        (Kind::File, Direction::OneWay) => reconcile::reconcile_one_way_file(&pair.source, &pair.destination, &ctx),
        (Kind::File, Direction::TwoWay) => reconcile::reconcile_two_way_file(&pair.source, &pair.destination, &ctx),
        (Kind::Folder, Direction::OneWay) => {
            if pair.source.is_dir() {
                reconcile::reconcile_one_way(&pair.source, &pair.destination, ignore, &ctx)
            } else {
                let mut r = reconcile::ReconcileResult { copied: 0, deleted: 0, conflicts: vec![], errors: vec![] };
                r.errors.push((pair.source.display().to_string(), "source folder missing".into()));
                r
            }
        }
        (Kind::Folder, Direction::TwoWay) => reconcile::reconcile_two_way(&pair.source, &pair.destination, ignore, &ctx),
    };
    log::info!(
        "pair {} reconciled: {} copied, {} deleted, {} conflicts, {} errors",
        pair.id, result.copied, result.deleted, result.conflicts.len(), result.errors.len()
    );
    result.errors
}


#[cfg(target_os = "linux")]
fn is_network_path(path: &Path) -> bool {
    const NETWORK_FS: &[&str] = &[
        "cifs", "smb3", "smbfs", "nfs", "nfs4", "9p", "afs", "ceph", "glusterfs", "davfs",
        "fuse.sshfs", "fuse.gvfsd-fuse", "fuse.rclone", "fuse.davfs2", "fuse.s3fs",
    ];
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mounts = match std::fs::read_to_string("/proc/self/mounts") {
        Ok(m) => m,
        Err(_) => return false,
    };
    let mut best: Option<(usize, String)> = None;
    for line in mounts.lines() {
        let mut parts = line.split_whitespace();
        let (Some(_), Some(mnt), Some(fstype)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let mnt = mnt.replace("\\040", " ").replace("\\011", "\t").replace("\\134", "\\");
        if path.starts_with(&mnt) && best.as_ref().map_or(true, |(len, _)| mnt.len() >= *len) {
            best = Some((mnt.len(), fstype.to_string()));
        }
    }
    best.is_some_and(|(_, fs)| NETWORK_FS.contains(&fs.as_str()))
}

#[cfg(windows)]
fn is_network_path(path: &Path) -> bool {
    path.to_string_lossy().starts_with("\\\\")
}

#[cfg(not(any(target_os = "linux", windows)))]
fn is_network_path(_path: &Path) -> bool {
    false
}

fn run_watcher(
    pair: SyncPair,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    app: AppHandle,
    stop_flag: Arc<AtomicBool>,
    status: StatusCell,
) {

    let update_status = |s: PairStatus| {
        if !stop_flag.load(Ordering::Relaxed) {
            set_status(&status, &db_conn, &app, pair.id, s);
        }
    };
    let ignore = IgnoreSet::new(&pair.ignore);

    let reconcile_errors = run_reconcile(&pair, &ignore, &db_conn, &app, &stop_flag);
    if stop_flag.load(Ordering::Relaxed) {
        return;
    }
    for (path, msg) in &reconcile_errors {
        emit_error(&app, pair.id, "reconcile", path, msg);
        let conn = db_conn.lock().unwrap();
        let _ = db::log_event(&conn, pair.id, "error", path, Some(msg));
    }

    let (tx, rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();
    let poll = is_network_path(&pair.source)
        || (pair.direction == Direction::TwoWay && is_network_path(&pair.destination));
    let watcher: notify::Result<Box<dyn Watcher + Send>> = if poll {
        log::info!("pair {} is on a network filesystem; using polling watcher", pair.id);
        PollWatcher::new(tx, Config::default().with_poll_interval(Duration::from_secs(3)))
            .map(|w| Box::new(w) as Box<dyn Watcher + Send>)
    } else {
        RecommendedWatcher::new(tx, Config::default()).map(|w| Box::new(w) as Box<dyn Watcher + Send>)
    };
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            let msg = format!("failed to create watcher: {e}");
            log::error!("{msg}");
            emit_error(&app, pair.id, "watch", &pair.source.display().to_string(), &msg);
            update_status(PairStatus::Error);
            return;
        }
    };


    let (source_watch_root, dest_watch_root, recursive) = match pair.kind {
        Kind::File => {
            let src_parent = pair
                .source
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            let dst_parent = pair
                .destination
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            (src_parent, dst_parent, RecursiveMode::NonRecursive)
        }
        Kind::Folder => (
            pair.source.clone(),
            pair.destination.clone(),
            RecursiveMode::Recursive,
        ),
    };

    if let Err(e) = watcher.watch(&source_watch_root, recursive) {
        let msg = format!("failed to watch source: {e}");
        log::error!("{msg} ({:?})", source_watch_root);
        emit_error(&app, pair.id, "watch", &source_watch_root.display().to_string(), &msg);
        update_status(PairStatus::Error);
        return;
    }

    if pair.direction == Direction::TwoWay {
        if let Err(e) = watcher.watch(&dest_watch_root, recursive) {
            let msg = format!("failed to watch destination: {e}");
            log::warn!("{msg} ({:?})", dest_watch_root);
            emit_error(&app, pair.id, "watch", &dest_watch_root.display().to_string(), &msg);
        }
    }

    update_status(if reconcile_errors.is_empty() { PairStatus::Syncing } else { PairStatus::Error });

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {

                std::thread::sleep(Duration::from_millis(300));
                let mut all_paths: Vec<(PathBuf, EventKind)> = event
                    .paths
                    .into_iter()
                    .map(|p| (p, event.kind.clone()))
                    .collect();
                while let Ok(Ok(ev)) = rx.try_recv() {
                    for p in ev.paths {
                        all_paths.push((p, ev.kind.clone()));
                    }
                }
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                all_paths.sort_by(|a, b| a.0.cmp(&b.0));
                all_paths.dedup_by(|a, b| a.0 == b.0 && std::mem::discriminant(&a.1) == std::mem::discriminant(&b.1));

                for (abs_path, kind) in all_paths {
                    handle_fs_event(&pair, &abs_path, &ignore, &db_conn, &app, &kind);
                }
            }
            Ok(Err(e)) => log::warn!("Watcher channel error for pair {}: {e}", pair.id),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_fs_event(
    pair: &SyncPair,
    abs_path: &Path,
    ignore: &IgnoreSet,
    db_conn: &Arc<Mutex<rusqlite::Connection>>,
    app: &AppHandle,
    kind: &EventKind,
) {
    if let Err(e) = try_handle_fs_event(pair, abs_path, ignore, db_conn, app, kind) {
        let msg = e.to_string();
        log::warn!("Sync error on {:?}: {msg}", abs_path);
        emit_error(app, pair.id, "sync", &abs_path.display().to_string(), &msg);
        let conn = db_conn.lock().unwrap();
        let _ = db::log_event(&conn, pair.id, "error", &abs_path.display().to_string(), Some(&msg));
    }
}


fn classify_event(pair: &SyncPair, abs_path: &Path) -> Option<(&'static str, PathBuf)> {
    match pair.kind {
        Kind::File => {
            if abs_path == pair.source {
                Some(("source", PathBuf::new()))
            } else if abs_path == pair.destination {
                Some(("dest", PathBuf::new()))
            } else {
                None
            }
        }
        Kind::Folder => {
            if abs_path.starts_with(&pair.source) {
                let rel = abs_path.strip_prefix(&pair.source).ok()?.to_owned();
                if rel.as_os_str().is_empty() {
                    return None;
                }
                Some(("source", rel))
            } else if abs_path.starts_with(&pair.destination) {
                let rel = abs_path.strip_prefix(&pair.destination).ok()?.to_owned();
                if rel.as_os_str().is_empty() {
                    return None;
                }
                Some(("dest", rel))
            } else {
                None
            }
        }
    }
}

fn try_handle_fs_event(
    pair: &SyncPair,
    abs_path: &Path,
    ignore: &IgnoreSet,
    db_conn: &Arc<Mutex<rusqlite::Connection>>,
    app: &AppHandle,
    kind: &EventKind,
) -> Result<(), Box<dyn std::error::Error>> {
    let (changed_side, rel_path) = match classify_event(pair, abs_path) {
        Some(v) => v,
        None => return Ok(()),
    };

    if pair.kind == Kind::Folder && ignore.is_ignored(&rel_path) {
        return Ok(());
    }

    let rel_str = rel_path.to_string_lossy().to_string();


    let (src_abs, dst_abs) = match pair.kind {
        Kind::File => {
            if changed_side == "source" {
                (pair.source.clone(), pair.destination.clone())
            } else {
                (pair.destination.clone(), pair.source.clone())
            }
        }
        Kind::Folder => {
            let src_root = if changed_side == "source" { &pair.source } else { &pair.destination };
            let dst_root = if changed_side == "source" { &pair.destination } else { &pair.source };
            (src_root.join(&rel_path), dst_root.join(&rel_path))
        }
    };


    if pair.direction == Direction::OneWay && changed_side != "source" {
        return Ok(());
    }

    match kind {
        EventKind::Remove(_) => {


            let target = if pair.kind == Kind::File {
                if changed_side == "source" { pair.destination.clone() } else { pair.source.clone() }
            } else {
                let dst_root = if changed_side == "source" { &pair.destination } else { &pair.source };
                dst_root.join(&rel_path)
            };
            do_delete(pair, &target, &rel_str, db_conn, app)?;
        }
        EventKind::Create(_) | EventKind::Modify(_) => {
            if !src_abs.exists() {
                return Ok(());
            }


            if src_abs.is_dir() {
                if pair.kind != Kind::Folder {
                    return Ok(());
                }
                let src_root = if changed_side == "source" { &pair.source } else { &pair.destination };
                let dst_root = if changed_side == "source" { &pair.destination } else { &pair.source };
                for entry in walkdir::WalkDir::new(&src_abs).follow_links(false).into_iter().flatten() {
                    if !entry.file_type().is_file() {
                        continue;
                    }
                    let abs = entry.path();
                    let inner_rel = match abs.strip_prefix(src_root) {
                        Ok(r) => r.to_path_buf(),
                        Err(_) => continue,
                    };
                    if ignore.is_ignored(&inner_rel) {
                        continue;
                    }
                    let inner_rel_str = inner_rel.to_string_lossy().to_string();
                    let inner_dst = dst_root.join(&inner_rel);
                    if let Err(e) = do_sync(pair, abs, &inner_dst, &inner_rel_str, db_conn, app) {
                        let _ = app.emit(
                            EVENT_SYNC_ERROR,
                            SyncErrorEvent {
                                pair_id: pair.id.to_string(),
                                op: "sync".into(),
                                path: inner_rel_str.clone(),
                                message: e.to_string(),
                                ts: now_ms(),
                            },
                        );
                    }
                }
                return Ok(());
            }
            if !src_abs.is_file() {
                return Ok(());
            }
            do_sync(pair, &src_abs, &dst_abs, &rel_str, db_conn, app)?;
        }
        _ => {}
    }

    Ok(())
}

fn do_delete(
    pair: &SyncPair,
    target_abs: &Path,
    rel_str: &str,
    db_conn: &Arc<Mutex<rusqlite::Connection>>,
    app: &AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    if !target_abs.exists() {
        return Ok(());
    }
    delete_path(target_abs)?;
    let conn = db_conn.lock().unwrap();
    let _ = db::delete_snapshot(&conn, pair.id, rel_str);
    let id = db::insert_tombstone(&conn, pair.id, rel_str).unwrap_or(0);
    let _ = db::log_event(&conn, pair.id, "deleted", rel_str, None);
    drop(conn);

    emit_activity(app, pair.id, "deleted", rel_str);
    let _ = app.emit(
        EVENT_TOMBSTONE_ADDED,
        TombstoneEvent {
            id,
            pair_id: pair.id.to_string(),
            rel_path: rel_str.to_string(),
            deleted_at: now_ms(),
        },
    );
    Ok(())
}

fn do_sync(
    pair: &SyncPair,
    src_abs: &Path,
    dst_abs: &Path,
    rel_str: &str,
    db_conn: &Arc<Mutex<rusqlite::Connection>>,
    app: &AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {


    {
        let conn = db_conn.lock().unwrap();
        let is_tomb = db::tombstone_exists(&conn, pair.id, rel_str).unwrap_or(false);
        if is_tomb {
            let auto = pair.auto_resume_paths.contains(rel_str);
            if auto {
                let _ = db::clear_tombstone(&conn, pair.id, rel_str);
                drop(conn);
                let _ = app.emit(
                    EVENT_TOMBSTONE_CLEARED,
                    serde_json::json!({ "pairId": pair.id.to_string(), "relPath": rel_str }),
                );
            } else {
                drop(conn);
                let _ = app.emit(
                    EVENT_RESPAWN_PROMPT,
                    RespawnPromptEvent {
                        pair_id: pair.id.to_string(),
                        rel_path: rel_str.to_string(),
                    },
                );
                return Ok(());
            }
        }
    }


    if pair.direction == Direction::TwoWay && dst_abs.exists() {
        let snap = {
            let conn = db_conn.lock().unwrap();
            db::load_snapshots(&conn, pair.id)
                .unwrap_or_default()
                .into_iter()
                .find(|s| s.rel_path == rel_str)
        };
        if let Some(snap) = snap {
            let src_hash = hash_file(src_abs).unwrap_or_default();
            let dst_hash = hash_file(dst_abs).unwrap_or_default();
            if src_hash == dst_hash {

                let mtime = mtime_ms(src_abs).unwrap_or(0);
                let conn = db_conn.lock().unwrap();
                let _ = db::upsert_snapshot(&conn, pair.id, rel_str, &src_hash, mtime);
                return Ok(());
            }
            let s_changed = src_hash != snap.hash;
            let d_changed = dst_hash != snap.hash;
            if s_changed && d_changed {
                let src_mtime = mtime_ms(src_abs).unwrap_or(0);
                let dst_mtime = mtime_ms(dst_abs).unwrap_or(0);
                let _ = app.emit(
                    EVENT_CONFLICT_PROMPT,
                    ConflictPromptEvent {
                        pair_id: pair.id.to_string(),
                        rel_path: rel_str.to_string(),
                        source_modified: src_mtime,
                        dest_modified: dst_mtime,
                    },
                );
                let conn = db_conn.lock().unwrap();
                let _ = db::log_event(&conn, pair.id, "conflict", rel_str, None);
                drop(conn);
                emit_activity(app, pair.id, "conflict", rel_str);
                return Ok(());
            }
        }
    }


    if pair.direction == Direction::OneWay && likely_same(src_abs, dst_abs) {
        return Ok(());
    }
    if dst_abs.exists() {
        let s = hash_file(src_abs).unwrap_or_default();
        let d = hash_file(dst_abs).unwrap_or_default();
        if !s.is_empty() && s == d {
            let mtime = mtime_ms(src_abs).unwrap_or(0);
            let conn = db_conn.lock().unwrap();
            let _ = db::upsert_snapshot(&conn, pair.id, rel_str, &s, mtime);
            return Ok(());
        }
    }

    copy_file(src_abs, dst_abs)?;

    let h = if pair.direction == Direction::TwoWay { hash_file(src_abs).unwrap_or_default() } else { String::new() };
    let mtime = mtime_ms(src_abs).unwrap_or(0);
    let conn = db_conn.lock().unwrap();
    let _ = db::upsert_snapshot(&conn, pair.id, rel_str, &h, mtime);
    let _ = db::log_event(&conn, pair.id, "copied", rel_str, None);
    drop(conn);
    emit_activity(app, pair.id, "copied", rel_str);
    Ok(())
}
