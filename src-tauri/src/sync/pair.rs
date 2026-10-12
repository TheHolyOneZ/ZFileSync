use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    OneWay,
    TwoWay,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PairStatus {
    Idle,

    Scanning,
    Syncing,
    Paused,
    Conflict,
    Missing,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPair {
    pub id: Uuid,
    pub name: String,
    pub source: PathBuf,
    pub destination: PathBuf,
    pub kind: Kind,
    pub direction: Direction,
    pub ignore: Vec<String>,
    pub auto_resume_paths: HashSet<String>,
    pub status: PairStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPair {
    pub name: String,
    pub source: String,
    pub destination: String,
    pub kind: Kind,
    pub direction: Direction,
    pub ignore: Vec<String>,
}

pub fn status_str(s: &PairStatus) -> &'static str {
    match s {
        PairStatus::Idle => "idle",
        PairStatus::Scanning => "scanning",
        PairStatus::Syncing => "syncing",
        PairStatus::Paused => "paused",
        PairStatus::Conflict => "conflict",
        PairStatus::Missing => "missing",
        PairStatus::Error => "error",
    }
}
