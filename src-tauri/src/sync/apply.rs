use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApplyError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("persist: {0}")]
    Persist(#[from] tempfile::PersistError),
}

pub fn copy_file(src: &Path, dst: &Path) -> Result<(), ApplyError> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let dir = dst.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    let mut src_file = std::fs::File::open(src)?;
    std::io::copy(&mut src_file, &mut tmp)?;

    if let Ok(modified) = src_file.metadata().and_then(|m| m.modified()) {
        let _ = tmp.as_file().set_modified(modified);
    }

    match tmp.persist(dst) {
        Ok(_) => {}
        Err(e) => {
            let tmp_path = e.file.path().to_path_buf();
            std::fs::copy(&tmp_path, dst)?;
            let _ = std::fs::remove_file(&tmp_path);
            if let Ok(modified) = std::fs::metadata(src).and_then(|m| m.modified()) {
                if let Ok(f) = std::fs::OpenOptions::new().write(true).open(dst) {
                    let _ = f.set_modified(modified);
                }
            }
        }
    }
    Ok(())
}

pub fn delete_path(path: &Path) -> Result<(), ApplyError> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn hash_file(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(file).ok()?;
    Some(hasher.finalize().to_hex().to_string())
}


pub fn likely_same(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(ma), Ok(mb)) => {
            ma.len() == mb.len()
                && match (mtime_of(&ma), mtime_of(&mb)) {
                    (Some(x), Some(y)) => (x - y).abs() <= 2000,
                    _ => false,
                }
        }
        _ => false,
    }
}

pub fn mtime_of(meta: &std::fs::Metadata) -> Option<i64> {
    let t = meta.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64)
}

pub fn mtime_ms(path: &Path) -> Option<i64> {
    mtime_of(&std::fs::metadata(path).ok()?)
}


pub fn resolve_keep_source(src: &Path, dst: &Path) -> Result<(), ApplyError> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let conflict_name = format!("{}.conflict-{}", dst.file_name().unwrap_or_default().to_string_lossy(), ts);
    let conflict_path = dst.with_file_name(conflict_name);
    if dst.exists() {
        std::fs::rename(dst, &conflict_path)?;
    }
    copy_file(src, dst)?;
    Ok(())
}


pub fn resolve_keep_dest(src: &Path, _dst: &Path) -> Result<(), ApplyError> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let conflict_name = format!("{}.conflict-{}", src.file_name().unwrap_or_default().to_string_lossy(), ts);
    let conflict_path = src.with_file_name(conflict_name);
    if src.exists() {
        std::fs::rename(src, &conflict_path)?;
    }
    Ok(())
}


pub fn resolve_keep_both(src: &Path, dst: &Path) -> Result<(), ApplyError> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let conflict_name = format!("{}.conflict-{}", dst.file_name().unwrap_or_default().to_string_lossy(), ts);
    let conflict_path = dst.with_file_name(conflict_name);
    copy_file(src, &conflict_path)?;
    Ok(())
}
