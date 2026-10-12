use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::SystemTime,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    db,
    events::EVENT_TOMBSTONE_CLEARED,
    sync::{
        apply::{resolve_keep_both, resolve_keep_dest, resolve_keep_source},
        pair::{Kind, NewPair, PairStatus, SyncPair},
        SyncManager,
    },
};

pub type DbState = Arc<Mutex<rusqlite::Connection>>;
pub type ManagerState = Arc<Mutex<SyncManager>>;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_pairs(manager: State<'_, ManagerState>) -> Vec<SyncPair> {
    let mgr = manager.lock().unwrap();
    let mut pairs = mgr.list_pairs();
    pairs.sort_by_key(|p| p.created_at);
    pairs
}


#[tauri::command]
pub async fn add_pair(
    input: NewPair,
    manager: State<'_, ManagerState>,
) -> Result<SyncPair, String> {
    let source = PathBuf::from(&input.source);
    let destination = PathBuf::from(&input.destination);

    if input.name.trim().is_empty() {
        return Err("Pair name is required".into());
    }
    if !source.exists() {
        return Err(format!("Source path does not exist: {}", input.source));
    }
    if source == destination {
        return Err("Source and destination must be different paths".into());
    }
    match input.kind {
        Kind::File => {
            if !source.is_file() {
                return Err(format!(
                    "Kind is 'file' but source is not a file: {}",
                    input.source
                ));
            }
            if destination.exists() && destination.is_dir() {
                return Err(format!(
                    "Destination must be a file path (not an existing directory): {}",
                    input.destination
                ));
            }
            if let Some(parent) = destination.parent() {
                if !parent.as_os_str().is_empty() && !parent.exists() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create destination parent dir: {e}")
                    })?;
                }
            }
        }
        Kind::Folder => {
            if !source.is_dir() {
                return Err(format!(
                    "Kind is 'folder' but source is not a directory: {}",
                    input.source
                ));
            }
            if destination.exists() && !destination.is_dir() {
                return Err(format!(
                    "Destination exists and is not a directory: {}",
                    input.destination
                ));
            }
            if source.starts_with(&destination) || destination.starts_with(&source) {
                return Err(
                    "Source and destination cannot be nested inside each other".into(),
                );
            }
            if !destination.exists() {
                std::fs::create_dir_all(&destination).map_err(|e| {
                    format!("Failed to create destination dir: {e}")
                })?;
            }
        }
    }

    let pair = SyncPair {
        id: Uuid::new_v4(),
        name: input.name,
        source,
        destination,
        kind: input.kind,
        direction: input.direction,
        ignore: input.ignore,
        auto_resume_paths: HashSet::new(),
        status: PairStatus::Idle,
        created_at: now_ms(),
    };

    let id = pair.id;
    let mut mgr = manager.lock().unwrap();
    mgr.add_pair(pair);

    mgr.get_pair(id).ok_or_else(|| "Failed to register pair".into())
}


#[tauri::command]
pub async fn remove_pair(id: String, manager: State<'_, ManagerState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut mgr = manager.lock().unwrap();
    mgr.remove_pair(uuid);
    Ok(())
}


#[tauri::command]
pub async fn pause_pair(id: String, manager: State<'_, ManagerState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut mgr = manager.lock().unwrap();
    mgr.pause_pair(uuid);
    Ok(())
}


#[tauri::command]
pub async fn resume_pair(id: String, manager: State<'_, ManagerState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut mgr = manager.lock().unwrap();
    mgr.resume_pair(uuid);
    Ok(())
}

#[tauri::command]
pub fn get_activity(
    limit: i64,
    offset: i64,
    db: State<'_, DbState>,
) -> Vec<db::DbEvent> {
    let conn = db.lock().unwrap();
    db::load_events(&conn, limit, offset).unwrap_or_default()
}

#[tauri::command]
pub fn get_tombstones(
    pair_id: Option<String>,
    db: State<'_, DbState>,
) -> Vec<db::DbTombstone> {
    let conn = db.lock().unwrap();
    let uuid = pair_id.as_deref().and_then(|s| Uuid::parse_str(s).ok());
    db::load_tombstones(&conn, uuid).unwrap_or_default()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RespawnDecision {
    ResumeOnce,
    AlwaysResume,
    Ignore,
}


#[tauri::command]
pub async fn respond_respawn(
    pair_id: String,
    rel_path: String,
    decision: RespawnDecision,
    manager: State<'_, ManagerState>,
    db: State<'_, DbState>,
    app: AppHandle,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&pair_id).map_err(|e| e.to_string())?;

    match decision {
        RespawnDecision::Ignore => {

        }
        RespawnDecision::ResumeOnce | RespawnDecision::AlwaysResume => {
            let always = matches!(decision, RespawnDecision::AlwaysResume);
            {
                let mut mgr = manager.lock().unwrap();
                mgr.update_auto_resume(uuid, rel_path.clone(), always);
            }
            {
                let conn = db.lock().unwrap();
                let _ = db::clear_tombstone(&conn, uuid, &rel_path);
            }
            let _ = app.emit(
                EVENT_TOMBSTONE_CLEARED,
                serde_json::json!({ "pairId": pair_id, "relPath": rel_path }),
            );

            let pair = {
                let mgr = manager.lock().unwrap();
                mgr.get_pair(uuid)
            };
            if let Some(pair) = pair {
                let src_abs = pair.source.join(&rel_path);
                let dst_abs = pair.destination.join(&rel_path);
                if src_abs.is_file() {
                    let _ = crate::sync::apply::copy_file(&src_abs, &dst_abs);
                }
            }
        }
    }
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictChoice {
    KeepSource,
    KeepDest,
    KeepBoth,
}


#[tauri::command]
pub async fn resolve_conflict(
    pair_id: String,
    rel_path: String,
    choice: ConflictChoice,
    manager: State<'_, ManagerState>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&pair_id).map_err(|e| e.to_string())?;
    let pair = {
        let mgr = manager.lock().unwrap();
        mgr.get_pair(uuid).ok_or("Pair not found")?
    };

    let src_abs = pair.source.join(&rel_path);
    let dst_abs = pair.destination.join(&rel_path);

    match choice {
        ConflictChoice::KeepSource => {
            resolve_keep_source(&src_abs, &dst_abs).map_err(|e| e.to_string())?;
        }
        ConflictChoice::KeepDest => {
            resolve_keep_dest(&src_abs, &dst_abs).map_err(|e| e.to_string())?;
        }
        ConflictChoice::KeepBoth => {
            resolve_keep_both(&src_abs, &dst_abs).map_err(|e| e.to_string())?;
        }
    }


    if let Some(hash) = crate::sync::apply::hash_file(&dst_abs) {
        let mtime = crate::sync::apply::mtime_ms(&dst_abs).unwrap_or(0);
        let conn = db.lock().unwrap();
        let _ = db::upsert_snapshot(&conn, uuid, &rel_path, &hash, mtime);
        let _ = db::log_event(&conn, uuid, "resolved", &rel_path, None);
    }

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub autostart: bool,
    pub default_ignores: Vec<String>,
}

#[tauri::command]
pub fn get_settings(db: State<'_, DbState>) -> AppSettings {
    let conn = db.lock().unwrap();
    let autostart = db::get_setting(&conn, "autostart")
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(false);
    let default_ignores = db::get_setting(&conn, "default_ignores")
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default();
    AppSettings { autostart, default_ignores }
}

#[tauri::command]
pub fn set_settings(
    settings: AppSettings,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    let _ = db::set_setting(&conn, "autostart", if settings.autostart { "true" } else { "false" });
    let ignores_json = serde_json::to_string(&settings.default_ignores).unwrap_or_default();
    let _ = db::set_setting(&conn, "default_ignores", &ignores_json);
    Ok(())
}

#[tauri::command]
pub fn pick_path(_kind: String) -> Option<String> {

    None
}


#[tauri::command]
pub fn qa_create_workspace() -> Result<String, String> {
    let mut dir = std::env::temp_dir();
    dir.push(format!("zfilesync-qa-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn qa_write_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn qa_read_file(path: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn qa_delete_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn qa_path_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
pub fn qa_list_dir(path: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<String> = vec![];
    fn walk(dir: &std::path::Path, base: &std::path::Path, out: &mut Vec<String>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let p = entry.path();
            if entry.file_type()?.is_dir() {
                walk(&p, base, out)?;
            } else {
                let rel = p.strip_prefix(base).unwrap_or(&p);
                out.push(rel.to_string_lossy().to_string());
            }
        }
        Ok(())
    }
    walk(&root, &root, &mut out).map_err(|e| e.to_string())?;
    out.sort();
    Ok(out)
}
