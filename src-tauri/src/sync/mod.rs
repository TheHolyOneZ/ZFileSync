pub mod apply;
pub mod ignore;
pub mod pair;
pub mod reconcile;
pub mod watcher;

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use pair::{PairStatus, SyncPair};
use watcher::spawn_watcher;

use crate::{db, events::EVENT_PAIR_STATUS};

fn emit_pair_status(app: &AppHandle, pair_id: Uuid, status: &str) {
    let _ = app.emit(
        EVENT_PAIR_STATUS,
        serde_json::json!({ "pairId": pair_id.to_string(), "status": status }),
    );
}

pub type StatusCell = Arc<Mutex<PairStatus>>;


pub fn set_status(
    cell: &StatusCell,
    db: &Arc<Mutex<rusqlite::Connection>>,
    app: &AppHandle,
    pair_id: Uuid,
    status: PairStatus,
) {
    *cell.lock().unwrap() = status.clone();
    if let Ok(conn) = db.lock() {
        let _ = db::update_pair_status(&conn, pair_id, &status);
    }
    emit_pair_status(app, pair_id, pair::status_str(&status));
}

struct ActiveEntry {
    pub pair: SyncPair,
    status: StatusCell,
    stop_flag: Option<Arc<AtomicBool>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ActiveEntry {
    fn snapshot(&self) -> SyncPair {
        let mut pair = self.pair.clone();
        pair.status = self.status.lock().unwrap().clone();
        pair
    }
}

pub struct SyncManager {
    entries: HashMap<Uuid, ActiveEntry>,
    pub db: Arc<Mutex<rusqlite::Connection>>,
    app: AppHandle,
}

impl SyncManager {
    pub fn new(db: Arc<Mutex<rusqlite::Connection>>, app: AppHandle) -> Self {
        Self { entries: HashMap::new(), db, app }
    }

    pub fn load_and_start_all(&mut self, pairs: Vec<SyncPair>) {
        for pair in pairs {
            if pair.status == PairStatus::Paused {
                self.entries.insert(
                    pair.id,
                    ActiveEntry {
                        status: Arc::new(Mutex::new(PairStatus::Paused)),
                        pair,
                        stop_flag: None,
                        handle: None,
                    },
                );
            } else {
                self.start_pair(pair);
            }
        }
    }

    pub fn add_pair(&mut self, pair: SyncPair) {
        let conn = self.db.lock().unwrap();
        let _ = db::insert_pair(&conn, &pair);
        drop(conn);
        self.start_pair(pair);
    }

    pub fn remove_pair(&mut self, id: Uuid) -> bool {
        self.stop_entry(id);
        self.entries.remove(&id);
        let conn = self.db.lock().unwrap();
        let _ = db::delete_pair(&conn, id);
        true
    }

    pub fn pause_pair(&mut self, id: Uuid) -> bool {
        self.stop_entry(id);
        if let Some(entry) = self.entries.get_mut(&id) {
            entry.pair.status = PairStatus::Paused;
            set_status(&entry.status, &self.db, &self.app, id, PairStatus::Paused);
        }
        true
    }

    pub fn resume_pair(&mut self, id: Uuid) -> bool {
        let pair = match self.entries.get(&id) {
            Some(e) => e.pair.clone(),
            None => return false,
        };
        self.start_pair(pair);
        true
    }

    pub fn list_pairs(&self) -> Vec<SyncPair> {
        self.entries.values().map(ActiveEntry::snapshot).collect()
    }

    pub fn get_pair(&self, id: Uuid) -> Option<SyncPair> {
        self.entries.get(&id).map(ActiveEntry::snapshot)
    }

    pub fn update_auto_resume(&mut self, id: Uuid, rel_path: String, always: bool) {
        if let Some(entry) = self.entries.get_mut(&id) {
            if always {
                entry.pair.auto_resume_paths.insert(rel_path);
            }
            let conn = self.db.lock().unwrap();
            let _ = db::update_pair_auto_resume(&conn, &entry.pair);
        }
    }


    fn start_pair(&mut self, mut pair: SyncPair) {
        let id = pair.id;
        self.stop_entry(id);

        pair.status = PairStatus::Scanning;
        let status: StatusCell = Arc::new(Mutex::new(PairStatus::Scanning));
        set_status(&status, &self.db, &self.app, id, PairStatus::Scanning);

        let stop_flag = Arc::new(AtomicBool::new(false));
        let handle = spawn_watcher(
            pair.clone(),
            Arc::clone(&self.db),
            self.app.clone(),
            Arc::clone(&stop_flag),
            Arc::clone(&status),
        );

        self.entries.insert(
            id,
            ActiveEntry { pair, status, stop_flag: Some(stop_flag), handle: Some(handle) },
        );
    }

    fn stop_entry(&mut self, id: Uuid) {
        if let Some(entry) = self.entries.get_mut(&id) {
            if let Some(flag) = entry.stop_flag.take() {
                flag.store(true, Ordering::Relaxed);
            }
            entry.handle.take();
        }
    }
}
