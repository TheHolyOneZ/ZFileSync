use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use walkdir::WalkDir;

use super::{
    apply::{copy_file, delete_path, hash_file, mtime_ms, mtime_of},
    ignore::IgnoreSet,
};
use crate::db::{self, DbSnapshot};
use uuid::Uuid;


pub struct Ctx<'a> {
    pub db: &'a Mutex<rusqlite::Connection>,
    pub pair_id: Uuid,
    pub stop: &'a AtomicBool,
    pub progress: &'a dyn Fn(&str, usize, usize),
}

impl Ctx<'_> {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    fn with_db<T>(&self, f: impl FnOnce(&rusqlite::Connection) -> T) -> T {
        let conn = self.db.lock().unwrap();
        f(&conn)
    }
}

#[derive(Debug)]
struct FileEntry {
    abs: PathBuf,
    size: u64,
    mtime: i64,
    hash: Option<String>,
}

struct Scan {
    files: HashMap<PathBuf, FileEntry>,

    errors: usize,
}

fn scan(root: &Path, ignore: &IgnoreSet, ctx: &Ctx) -> Scan {
    let mut out = Scan { files: HashMap::new(), errors: 0 };
    if !root.is_dir() {
        return out;
    }
    for entry in WalkDir::new(root).follow_links(false) {
        if ctx.stopped() {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                log::warn!("scan error under {:?}: {e}", root);
                out.errors += 1;
                continue;
            }
        };
        if entry.file_type().is_dir() {
            continue;
        }
        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r.to_owned(),
            Err(_) => continue,
        };
        if ignore.is_ignored(&rel) {
            continue;
        }
        let (size, mtime) = match entry.metadata() {
            Ok(m) => (m.len(), mtime_of(&m).unwrap_or(0)),
            Err(_) => {
                out.errors += 1;
                continue;
            }
        };
        out.files.insert(rel, FileEntry { abs: entry.path().to_owned(), size, mtime, hash: None });
        if out.files.len() % 200 == 0 {
            (ctx.progress)("scanning", out.files.len(), 0);
        }
    }
    out
}

fn get_hash(entry: &mut FileEntry) -> &str {
    if entry.hash.is_none() {
        entry.hash = hash_file(&entry.abs);
    }
    entry.hash.as_deref().unwrap_or("")
}

fn files_differ(a: &mut FileEntry, b: &mut FileEntry) -> bool {
    if a.size != b.size {
        return true;
    }
    if (a.mtime - b.mtime).abs() <= 2000 {
        return false;
    }
    get_hash(a) != get_hash(b)
}

pub struct ReconcileResult {
    pub copied: usize,
    pub deleted: usize,
    pub conflicts: Vec<PathBuf>,
    pub errors: Vec<(String, String)>,
}

impl ReconcileResult {
    fn new() -> Self {
        Self { copied: 0, deleted: 0, conflicts: vec![], errors: vec![] }
    }
}


pub fn reconcile_one_way_file(source: &Path, dest: &Path, ctx: &Ctx) -> ReconcileResult {
    let mut result = ReconcileResult::new();
    if !source.is_file() {
        result.errors.push((source.display().to_string(), "source file not found".into()));
        return result;
    }
    if dest.is_file() && super::apply::likely_same(source, dest) {
        return result;
    }
    let src_hash = hash_file(source).unwrap_or_default();
    let src_mtime = mtime_ms(source).unwrap_or(0);

    let need_copy = if dest.exists() {
        let d_hash = hash_file(dest).unwrap_or_default();
        d_hash != src_hash
    } else {
        true
    };

    if need_copy {
        (ctx.progress)("copying", 0, 1);
        match copy_file(source, dest) {
            Ok(()) => {
                ctx.with_db(|c| db::upsert_snapshot(c, ctx.pair_id, "", &src_hash, src_mtime)).ok();
                result.copied += 1;
            }
            Err(e) => result.errors.push((dest.display().to_string(), e.to_string())),
        }
    }
    result
}

pub fn reconcile_two_way_file(source: &Path, dest: &Path, ctx: &Ctx) -> ReconcileResult {
    let mut result = ReconcileResult::new();
    let s_exists = source.is_file();
    let d_exists = dest.is_file();
    let pair_id = ctx.pair_id;


    let snap = ctx
        .with_db(|c| db::load_snapshots(c, pair_id))
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.rel_path.is_empty());
    let snap_hash = snap.map(|s| s.hash).unwrap_or_default();

    match (s_exists, d_exists) {
        (true, true) => {
            let s_hash = hash_file(source).unwrap_or_default();
            let d_hash = hash_file(dest).unwrap_or_default();
            let s_changed = s_hash != snap_hash;
            let d_changed = d_hash != snap_hash;
            if s_hash == d_hash {

                let m = mtime_ms(source).unwrap_or(0);
                ctx.with_db(|c| db::upsert_snapshot(c, pair_id, "", &s_hash, m)).ok();
            } else if s_changed && !d_changed {
                match copy_file(source, dest) {
                    Ok(()) => {
                        let m = mtime_ms(source).unwrap_or(0);
                        ctx.with_db(|c| db::upsert_snapshot(c, pair_id, "", &s_hash, m)).ok();
                        result.copied += 1;
                    }
                    Err(e) => result.errors.push((dest.display().to_string(), e.to_string())),
                }
            } else if d_changed && !s_changed {
                match copy_file(dest, source) {
                    Ok(()) => {
                        let m = mtime_ms(dest).unwrap_or(0);
                        ctx.with_db(|c| db::upsert_snapshot(c, pair_id, "", &d_hash, m)).ok();
                        result.copied += 1;
                    }
                    Err(e) => result.errors.push((source.display().to_string(), e.to_string())),
                }
            } else if s_changed && d_changed {
                result.conflicts.push(PathBuf::new());
            }
        }
        (true, false) => match copy_file(source, dest) {
            Ok(()) => {
                let h = hash_file(source).unwrap_or_default();
                let m = mtime_ms(source).unwrap_or(0);
                ctx.with_db(|c| db::upsert_snapshot(c, pair_id, "", &h, m)).ok();
                result.copied += 1;
            }
            Err(e) => result.errors.push((dest.display().to_string(), e.to_string())),
        },
        (false, true) => match copy_file(dest, source) {
            Ok(()) => {
                let h = hash_file(dest).unwrap_or_default();
                let m = mtime_ms(dest).unwrap_or(0);
                ctx.with_db(|c| db::upsert_snapshot(c, pair_id, "", &h, m)).ok();
                result.copied += 1;
            }
            Err(e) => result.errors.push((source.display().to_string(), e.to_string())),
        },
        (false, false) => {}
    }
    result
}


pub fn reconcile_one_way(source: &Path, dest: &Path, ignore: &IgnoreSet, ctx: &Ctx) -> ReconcileResult {
    let mut result = ReconcileResult::new();
    let mut src = scan(source, ignore, ctx);
    let mut dst = scan(dest, ignore, ctx);
    if ctx.stopped() {
        return result;
    }

    let mut todo: Vec<PathBuf> = vec![];
    let src_keys: Vec<PathBuf> = src.files.keys().cloned().collect();
    for (i, rel) in src_keys.into_iter().enumerate() {
        if ctx.stopped() {
            return result;
        }
        let src_entry = src.files.get_mut(&rel).unwrap();
        let need_copy = match dst.files.get_mut(&rel) {
            Some(dst_entry) => files_differ(src_entry, dst_entry),
            None => true,
        };
        if need_copy {
            todo.push(rel);
        }
        if i % 200 == 0 {
            (ctx.progress)("comparing", i, src.files.len());
        }
    }

    let total = todo.len();
    for (i, rel) in todo.into_iter().enumerate() {
        if ctx.stopped() {
            return result;
        }
        (ctx.progress)("copying", i, total);
        let src_entry = &src.files[&rel];
        let dst_abs = dest.join(&rel);
        match copy_file(&src_entry.abs, &dst_abs) {
            Ok(()) => {
                let rel_str = rel.to_string_lossy().to_string();
                ctx.with_db(|c| db::log_event(c, ctx.pair_id, "copied", &rel_str, None)).ok();
                result.copied += 1;
            }
            Err(e) => result.errors.push((dst_abs.display().to_string(), e.to_string())),
        }
    }
    (ctx.progress)("copying", total, total);

    let orphans: Vec<PathBuf> = dst.files.keys().filter(|k| !src.files.contains_key(*k)).cloned().collect();
    if orphans.is_empty() {
        return result;
    }


    if src.errors > 0 || src.files.is_empty() {
        result.errors.push((
            source.display().to_string(),
            format!(
                "source could not be read completely ({} unreadable entries, {} files found); skipped deleting {} file(s) in destination",
                src.errors,
                src.files.len(),
                orphans.len()
            ),
        ));
        return result;
    }
    for rel in orphans {
        if ctx.stopped() {
            return result;
        }
        let abs = &dst.files[&rel].abs;
        let rel_str = rel.to_string_lossy().to_string();
        match delete_path(abs) {
            Ok(()) => {
                ctx.with_db(|c| db::delete_snapshot(c, ctx.pair_id, &rel_str)).ok();
                result.deleted += 1;
            }
            Err(e) => result.errors.push((abs.display().to_string(), e.to_string())),
        }
    }

    result
}

pub fn reconcile_two_way(source: &Path, dest: &Path, ignore: &IgnoreSet, ctx: &Ctx) -> ReconcileResult {
    let mut result = ReconcileResult::new();
    let pair_id = ctx.pair_id;
    let mut src = scan(source, ignore, ctx);
    let mut dst = scan(dest, ignore, ctx);
    if ctx.stopped() {
        return result;
    }

    let allow_delete = src.errors == 0 && dst.errors == 0;
    if !allow_delete {
        result.errors.push((
            source.display().to_string(),
            "some files could not be read; deletions skipped this run".into(),
        ));
    }
    let snapshots: HashMap<PathBuf, DbSnapshot> = ctx
        .with_db(|c| db::load_snapshots(c, pair_id))
        .unwrap_or_default()
        .into_iter()
        .map(|s| (PathBuf::from(&s.rel_path), s))
        .collect();

    let all_keys: std::collections::HashSet<PathBuf> = src
        .files
        .keys()
        .chain(dst.files.keys())
        .cloned()
        .collect();
    let total = all_keys.len();

    for (i, rel) in all_keys.into_iter().enumerate() {
        if ctx.stopped() {
            return result;
        }
        if i % 50 == 0 {
            (ctx.progress)("copying", i, total);
        }
        let snap = snapshots.get(&rel);
        let rel_str = rel.to_string_lossy().to_string();
        let snap_hash = snap.map(|sn| sn.hash.as_str()).unwrap_or("");

        match (src.files.get_mut(&rel), dst.files.get_mut(&rel)) {
            (Some(s), Some(d)) => {
                if !files_differ(s, d) && snap.is_some() {
                    continue;
                }
                let s_hash = get_hash(s).to_string();
                let d_hash = get_hash(d).to_string();
                if s_hash == d_hash {
                    ctx.with_db(|c| db::upsert_snapshot(c, pair_id, &rel_str, &s_hash, s.mtime)).ok();
                    continue;
                }
                let s_changed = s_hash != snap_hash;
                let d_changed = d_hash != snap_hash;
                if s_changed && !d_changed {
                    match copy_file(&s.abs, &dest.join(&rel)) {
                        Ok(()) => {
                            ctx.with_db(|c| db::upsert_snapshot(c, pair_id, &rel_str, &s_hash, s.mtime)).ok();
                            result.copied += 1;
                        }
                        Err(e) => result.errors.push((dest.join(&rel).display().to_string(), e.to_string())),
                    }
                } else if d_changed && !s_changed {
                    match copy_file(&d.abs, &source.join(&rel)) {
                        Ok(()) => {
                            ctx.with_db(|c| db::upsert_snapshot(c, pair_id, &rel_str, &d_hash, d.mtime)).ok();
                            result.copied += 1;
                        }
                        Err(e) => result.errors.push((source.join(&rel).display().to_string(), e.to_string())),
                    }
                } else {
                    result.conflicts.push(rel);
                }
            }
            (Some(s), None) => {
                let s_hash = get_hash(s).to_string();
                if snap.is_none() || s_hash != snap_hash || !allow_delete {
                    match copy_file(&s.abs, &dest.join(&rel)) {
                        Ok(()) => {
                            ctx.with_db(|c| db::upsert_snapshot(c, pair_id, &rel_str, &s_hash, s.mtime)).ok();
                            result.copied += 1;
                        }
                        Err(e) => result.errors.push((dest.join(&rel).display().to_string(), e.to_string())),
                    }
                } else {
                    match delete_path(&s.abs) {
                        Ok(()) => {
                            ctx.with_db(|c| db::delete_snapshot(c, pair_id, &rel_str)).ok();
                            result.deleted += 1;
                        }
                        Err(e) => result.errors.push((s.abs.display().to_string(), e.to_string())),
                    }
                }
            }
            (None, Some(d)) => {
                let d_hash = get_hash(d).to_string();
                if snap.is_none() || d_hash != snap_hash || !allow_delete {
                    match copy_file(&d.abs, &source.join(&rel)) {
                        Ok(()) => {
                            ctx.with_db(|c| db::upsert_snapshot(c, pair_id, &rel_str, &d_hash, d.mtime)).ok();
                            result.copied += 1;
                        }
                        Err(e) => result.errors.push((source.join(&rel).display().to_string(), e.to_string())),
                    }
                } else {
                    match delete_path(&d.abs) {
                        Ok(()) => {
                            ctx.with_db(|c| db::delete_snapshot(c, pair_id, &rel_str)).ok();
                            result.deleted += 1;
                        }
                        Err(e) => result.errors.push((d.abs.display().to_string(), e.to_string())),
                    }
                }
            }
            (None, None) => {}
        }
    }
    (ctx.progress)("copying", total, total);

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf, Mutex<rusqlite::Connection>) {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        let conn = db::open(tmp.path().join("t.db")).unwrap();
        (tmp, src, dst, Mutex::new(conn))
    }

    #[test]
    fn one_way_copies_then_skips_unchanged() {
        let (_t, src, dst, db) = setup();
        std::fs::write(src.join("a.log"), "hello").unwrap();
        std::fs::write(src.join("sub/b.log"), "world").unwrap();
        std::fs::write(dst.join("stale.txt"), "x").unwrap();
        let stop = AtomicBool::new(false);
        let ctx = Ctx { db: &db, pair_id: Uuid::new_v4(), stop: &stop, progress: &|_, _, _| {} };
        let ignore = IgnoreSet::new(&[]);

        let r = reconcile_one_way(&src, &dst, &ignore, &ctx);
        assert_eq!((r.copied, r.deleted, r.errors.len()), (2, 1, 0));
        assert_eq!(std::fs::read_to_string(dst.join("sub/b.log")).unwrap(), "world");
        assert_eq!(mtime_ms(&src.join("a.log")), mtime_ms(&dst.join("a.log")));

        let r = reconcile_one_way(&src, &dst, &ignore, &ctx);
        assert_eq!((r.copied, r.deleted), (0, 0));
    }

    #[test]
    fn one_way_never_deletes_from_empty_source() {
        let (_t, src, dst, db) = setup();
        std::fs::write(dst.join("keep.txt"), "x").unwrap();
        let stop = AtomicBool::new(false);
        let ctx = Ctx { db: &db, pair_id: Uuid::new_v4(), stop: &stop, progress: &|_, _, _| {} };
        let r = reconcile_one_way(&src, &dst, &IgnoreSet::new(&[]), &ctx);
        assert_eq!(r.deleted, 0);
        assert_eq!(r.errors.len(), 1);
        assert!(dst.join("keep.txt").exists());
    }

    #[test]
    fn stop_flag_aborts_run() {
        let (_t, src, dst, db) = setup();
        std::fs::write(src.join("a.log"), "hello").unwrap();
        let stop = AtomicBool::new(true);
        let ctx = Ctx { db: &db, pair_id: Uuid::new_v4(), stop: &stop, progress: &|_, _, _| {} };
        let r = reconcile_one_way(&src, &dst, &IgnoreSet::new(&[]), &ctx);
        assert_eq!(r.copied, 0);
        assert!(!dst.join("a.log").exists());
    }
}
