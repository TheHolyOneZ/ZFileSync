use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

use crate::sync::pair::{Direction, Kind, PairStatus, SyncPair};

pub fn open(path: PathBuf) -> SqlResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS pairs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source TEXT NOT NULL,
            destination TEXT NOT NULL,
            kind TEXT NOT NULL,
            direction TEXT NOT NULL,
            ignore_json TEXT NOT NULL DEFAULT '[]',
            auto_resume_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'idle',
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pair_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            path TEXT NOT NULL,
            detail TEXT,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_pair ON events(pair_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);

        CREATE TABLE IF NOT EXISTS tombstones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pair_id TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            deleted_at INTEGER NOT NULL,
            UNIQUE(pair_id, rel_path)
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            pair_id TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            hash TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            PRIMARY KEY(pair_id, rel_path)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn insert_pair(conn: &Connection, pair: &SyncPair) -> SqlResult<()> {
    let ignore_json = serde_json::to_string(&pair.ignore).unwrap_or_default();
    let auto_json = serde_json::to_string(&pair.auto_resume_paths).unwrap_or_default();
    let kind_str = match pair.kind {
        Kind::File => "file",
        Kind::Folder => "folder",
    };
    let dir_str = match pair.direction {
        Direction::OneWay => "oneway",
        Direction::TwoWay => "twoway",
    };
    conn.execute(
        "INSERT INTO pairs (id, name, source, destination, kind, direction, ignore_json, auto_resume_json, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'idle', ?9)",
        params![
            pair.id.to_string(),
            pair.name,
            pair.source.to_string_lossy().to_string(),
            pair.destination.to_string_lossy().to_string(),
            kind_str,
            dir_str,
            ignore_json,
            auto_json,
            pair.created_at,
        ],
    )?;
    Ok(())
}

pub fn load_all_pairs(conn: &Connection) -> SqlResult<Vec<SyncPair>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, source, destination, kind, direction, ignore_json, auto_resume_json, status, created_at FROM pairs ORDER BY created_at",
    )?;
    let pairs = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let source: String = row.get(2)?;
        let destination: String = row.get(3)?;
        let kind_str: String = row.get(4)?;
        let dir_str: String = row.get(5)?;
        let ignore_json: String = row.get(6)?;
        let auto_json: String = row.get(7)?;
        let status_str: String = row.get(8)?;
        let created_at: i64 = row.get(9)?;

        let kind = if kind_str == "folder" { Kind::Folder } else { Kind::File };
        let direction = if dir_str == "twoway" { Direction::TwoWay } else { Direction::OneWay };
        let status = parse_status(&status_str);
        let ignore: Vec<String> = serde_json::from_str(&ignore_json).unwrap_or_default();
        let auto_resume_paths: std::collections::HashSet<String> = serde_json::from_str(&auto_json).unwrap_or_default();

        Ok(SyncPair {
            id: Uuid::parse_str(&id).unwrap_or_else(|_| Uuid::new_v4()),
            name,
            source: PathBuf::from(source),
            destination: PathBuf::from(destination),
            kind,
            direction,
            ignore,
            auto_resume_paths,
            status,
            created_at,
        })
    })?;
    pairs.collect()
}

pub fn delete_pair(conn: &Connection, id: Uuid) -> SqlResult<()> {
    let id_str = id.to_string();
    conn.execute("DELETE FROM pairs WHERE id = ?1", params![id_str])?;
    conn.execute("DELETE FROM tombstones WHERE pair_id = ?1", params![id_str])?;
    conn.execute("DELETE FROM snapshots WHERE pair_id = ?1", params![id_str])?;
    Ok(())
}

pub fn update_pair_status(conn: &Connection, id: Uuid, status: &PairStatus) -> SqlResult<()> {
    let s = crate::sync::pair::status_str(status);
    conn.execute("UPDATE pairs SET status = ?1 WHERE id = ?2", params![s, id.to_string()])?;
    Ok(())
}

pub fn update_pair_auto_resume(conn: &Connection, pair: &SyncPair) -> SqlResult<()> {
    let auto_json = serde_json::to_string(&pair.auto_resume_paths).unwrap_or_default();
    conn.execute("UPDATE pairs SET auto_resume_json = ?1 WHERE id = ?2", params![auto_json, pair.id.to_string()])?;
    Ok(())
}

pub fn log_event(conn: &Connection, pair_id: Uuid, kind: &str, path: &str, detail: Option<&str>) -> SqlResult<i64> {
    conn.execute(
        "INSERT INTO events (pair_id, kind, path, detail, ts) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![pair_id.to_string(), kind, path, detail, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn load_events(conn: &Connection, limit: i64, offset: i64) -> SqlResult<Vec<DbEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, pair_id, kind, path, detail, ts FROM events ORDER BY ts DESC LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit, offset], |row| {
        Ok(DbEvent {
            id: row.get(0)?,
            pair_id: row.get(1)?,
            kind: row.get(2)?,
            path: row.get(3)?,
            detail: row.get(4)?,
            ts: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn insert_tombstone(conn: &Connection, pair_id: Uuid, rel_path: &str) -> SqlResult<i64> {
    conn.execute(
        "INSERT OR REPLACE INTO tombstones (pair_id, rel_path, deleted_at) VALUES (?1, ?2, ?3)",
        params![pair_id.to_string(), rel_path, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn clear_tombstone(conn: &Connection, pair_id: Uuid, rel_path: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM tombstones WHERE pair_id = ?1 AND rel_path = ?2",
        params![pair_id.to_string(), rel_path],
    )?;
    Ok(())
}

pub fn load_tombstones(conn: &Connection, pair_id: Option<Uuid>) -> SqlResult<Vec<DbTombstone>> {
    if let Some(pid) = pair_id {
        let mut stmt = conn.prepare("SELECT id, pair_id, rel_path, deleted_at FROM tombstones WHERE pair_id = ?1")?;
        let rows = stmt.query_map(params![pid.to_string()], tombstone_from_row)?;
        rows.collect()
    } else {
        let mut stmt = conn.prepare("SELECT id, pair_id, rel_path, deleted_at FROM tombstones ORDER BY deleted_at DESC")?;
        let rows = stmt.query_map([], tombstone_from_row)?;
        rows.collect()
    }
}

pub fn tombstone_exists(conn: &Connection, pair_id: Uuid, rel_path: &str) -> SqlResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tombstones WHERE pair_id = ?1 AND rel_path = ?2",
        params![pair_id.to_string(), rel_path],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

pub fn upsert_snapshot(conn: &Connection, pair_id: Uuid, rel_path: &str, hash: &str, mtime: i64) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO snapshots (pair_id, rel_path, hash, mtime) VALUES (?1, ?2, ?3, ?4)",
        params![pair_id.to_string(), rel_path, hash, mtime],
    )?;
    Ok(())
}

pub fn load_snapshots(conn: &Connection, pair_id: Uuid) -> SqlResult<Vec<DbSnapshot>> {
    let mut stmt = conn.prepare("SELECT rel_path, hash FROM snapshots WHERE pair_id = ?1")?;
    let rows = stmt.query_map(params![pair_id.to_string()], |row| {
        Ok(DbSnapshot {
            rel_path: row.get(0)?,
            hash: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn delete_snapshot(conn: &Connection, pair_id: Uuid, rel_path: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM snapshots WHERE pair_id = ?1 AND rel_path = ?2",
        params![pair_id.to_string(), rel_path],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> SqlResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

fn tombstone_from_row(row: &rusqlite::Row) -> rusqlite::Result<DbTombstone> {
    Ok(DbTombstone {
        id: row.get(0)?,
        pair_id: row.get(1)?,
        rel_path: row.get(2)?,
        deleted_at: row.get(3)?,
    })
}

fn parse_status(s: &str) -> PairStatus {
    match s {
        "scanning" => PairStatus::Scanning,
        "syncing" => PairStatus::Syncing,
        "paused" => PairStatus::Paused,
        "conflict" => PairStatus::Conflict,
        "missing" => PairStatus::Missing,
        "error" => PairStatus::Error,
        _ => PairStatus::Idle,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbEvent {
    pub id: i64,
    pub pair_id: String,
    pub kind: String,
    pub path: String,
    pub detail: Option<String>,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTombstone {
    pub id: i64,
    pub pair_id: String,
    pub rel_path: String,
    pub deleted_at: i64,
}

#[derive(Debug, Clone)]
pub struct DbSnapshot {
    pub rel_path: String,
    pub hash: String,
}
