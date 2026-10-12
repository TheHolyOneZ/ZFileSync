use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPromptEvent {
    pub pair_id: String,
    pub rel_path: String,
    pub source_modified: i64,
    pub dest_modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespawnPromptEvent {
    pub pair_id: String,
    pub rel_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TombstoneEvent {
    pub id: i64,
    pub pair_id: String,
    pub rel_path: String,
    pub deleted_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncErrorEvent {
    pub pair_id: String,
    pub op: String,
    pub path: String,
    pub message: String,
    pub ts: i64,
}

pub const EVENT_ACTIVITY: &str = "activity";
pub const EVENT_PAIR_STATUS: &str = "pair_status";
pub const EVENT_CONFLICT_PROMPT: &str = "conflict_prompt";
pub const EVENT_RESPAWN_PROMPT: &str = "respawn_prompt";
pub const EVENT_TOMBSTONE_ADDED: &str = "tombstone_added";
pub const EVENT_TOMBSTONE_CLEARED: &str = "tombstone_cleared";
pub const EVENT_SYNC_ERROR: &str = "sync_error";
pub const EVENT_PAIR_PROGRESS: &str = "pair_progress";
