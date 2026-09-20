//! Retention and user-confirmed cleanup for visibility-repair backups ONLY.
//! No caller-supplied paths; never follow links or delete another backup family.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const OWNER: &str = "cc-switch:codex-session-visibility";
pub const KEEP_SUCCESSFUL: usize = 3;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInventory {
    pub count: usize,
    pub bytes: u64,
    pub protected_count: usize,
    pub skipped_entries: usize,
    pub path: String,
    pub snapshot: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub deleted_count: usize,
    pub deleted_bytes: u64,
    pub warnings: Vec<String>,
}

struct BackupEntry {
    path: PathBuf,
    bytes: u64,
    completed: bool,
    fingerprint: Vec<u8>,
}

pub fn backup_root() -> PathBuf {
    crate::config::get_app_config_dir().join("backups/codex-session-visibility")
}

// Check the managed root and its `backups` parent; don't reject system aliases
// such as macOS /var -> /private/var farther up the path.
pub fn validate_root(root: &Path) -> Result<(), String> {
    for path in [root.parent(), Some(root)].into_iter().flatten() {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!("备份路径不是普通目录，已取消：{}", path.display()))
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn owned_name(name: &str) -> bool {
    let Some((date, id)) = name.split_once('-') else {
        return false;
    };
    chrono::NaiveDateTime::parse_from_str(date, "%Y%m%dT%H%M%S").is_ok()
        && uuid::Uuid::parse_str(id).is_ok()
}

fn tree_size(path: &Path, hash: &mut Sha256, depth: usize) -> Result<u64, String> {
    if depth > 64 {
        return Err("备份目录嵌套过深".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("备份包含符号链接".into());
    }
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update(metadata.len().to_le_bytes());
    hash.update(
        metadata
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .to_le_bytes(),
    );
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Err("备份包含特殊文件".into());
    }
    let mut entries = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .map(|e| e.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort();
    let mut bytes = 0;
    for child in entries {
        bytes += tree_size(&child, hash, depth + 1)?;
    }
    Ok(bytes)
}

fn inspect(path: PathBuf) -> Result<BackupEntry, String> {
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("非备份目录".into());
    }
    if !path
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(owned_name)
    {
        return Err("非本功能生成的目录名".into());
    }
    let manifest_path = path.join("manifest.json");
    let metadata = fs::symlink_metadata(&manifest_path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 16 * 1024 * 1024
    {
        return Err("无法安全读取备份清单".into());
    }
    let manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let current = manifest.get("owner").and_then(Value::as_str) == Some(OWNER)
        && manifest.get("version").and_then(Value::as_u64) == Some(1);
    // Earlier releases wrote this exact manifest without an owner marker.
    // They can be explicitly cleaned, but are never auto-pruned.
    let legacy = manifest.get("owner").is_none()
        && manifest.get("codexHome").is_some_and(Value::is_string)
        && manifest.get("targetProvider").is_some_and(Value::is_string)
        && manifest.get("files").is_some_and(Value::is_array)
        && manifest.get("databases").is_some_and(Value::is_array);
    if !current && !legacy {
        return Err("无法识别备份归属".into());
    }
    let mut hash = Sha256::new();
    let bytes = tree_size(&path, &mut hash, 0)?;
    Ok(BackupEntry {
        path,
        bytes,
        completed: current && manifest["status"] == "completed",
        fingerprint: hash.finalize().to_vec(),
    })
}

fn scan(root: &Path) -> Result<(Vec<BackupEntry>, usize), String> {
    validate_root(root)?;
    if !root.exists() {
        return Ok((Vec::new(), 0));
    }
    let mut backups = Vec::new();
    let mut skipped = 0;
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        match inspect(path) {
            Ok(backup) => backups.push(backup),
            Err(_) => skipped += 1,
        }
    }
    backups.sort_by(|a, b| b.path.cmp(&a.path));
    Ok((backups, skipped))
}

fn summary(root: &Path, entries: &[BackupEntry], skipped: usize) -> BackupInventory {
    let mut hash = Sha256::new();
    hash.update(root.as_os_str().as_encoded_bytes());
    for entry in entries {
        hash.update(&entry.fingerprint);
    }
    BackupInventory {
        count: entries.len(),
        bytes: entries.iter().map(|e| e.bytes).sum(),
        protected_count: entries.iter().filter(|e| !e.completed).count(),
        skipped_entries: skipped,
        path: root.display().to_string(),
        snapshot: format!("{:x}", hash.finalize()),
    }
}

pub fn inventory(root: &Path) -> Result<BackupInventory, String> {
    let (entries, skipped) = scan(root)?;
    Ok(summary(root, &entries, skipped))
}

fn remove(entries: impl IntoIterator<Item = BackupEntry>) -> CleanupReport {
    let mut report = CleanupReport::default();
    for entry in entries {
        let result = (|| {
            let current = inspect(entry.path.clone())?;
            if current.fingerprint != entry.fingerprint {
                return Err("备份在确认后发生变化，已跳过".to_string());
            }
            fs::remove_dir_all(&entry.path).map_err(|e| e.to_string())
        })();
        match result {
            Ok(()) => {
                report.deleted_count += 1;
                report.deleted_bytes += entry.bytes;
            }
            Err(e) => report
                .warnings
                .push(format!("{}: {e}", entry.path.display())),
        }
    }
    report
}

/// Caller holds the maintenance lock. Reject a stale confirmation rather than
/// deleting a newly-created backup the user has never reviewed.
pub fn cleanup(root: &Path, expected_snapshot: &str) -> Result<CleanupReport, String> {
    let (entries, skipped) = scan(root)?;
    if summary(root, &entries, skipped).snapshot != expected_snapshot {
        return Err("备份列表已变化，请刷新后重新确认清理".into());
    }
    Ok(remove(entries))
}

/// Invoked only after successful repair. Failed/unfinished/legacy backups stay.
/// Always protect the backup from this run, even if the clock moved backwards.
pub fn prune(root: &Path, current: Option<&Path>) -> Result<CleanupReport, String> {
    let (entries, _) = scan(root)?;
    let mut kept =
        usize::from(current.is_some_and(|p| entries.iter().any(|e| e.path == p && e.completed)));
    let to_remove = entries.into_iter().filter(|entry| {
        if !entry.completed || current.is_some_and(|p| entry.path == p) {
            return false;
        }
        if kept < KEEP_SUCCESSFUL {
            kept += 1;
            false
        } else {
            true
        }
    });
    Ok(remove(to_remove))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn backup(root: &Path, day: u32, status: &str) -> PathBuf {
        let path = root.join(format!("202609{day:02}T120000-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "owner": OWNER, "version": 1, "status": status,
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(path.join("session.jsonl"), "backup data").unwrap();
        path
    }
    #[test]
    fn retention_keeps_three_successful_and_every_incomplete_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("backups/visibility");
        let all: Vec<_> = (1..=5).map(|day| backup(&root, day, "completed")).collect();
        let failed = backup(&root, 6, "preparing");
        let report = prune(&root, Some(&all[4])).unwrap();
        assert_eq!(report.deleted_count, 2);
        assert!(!all[0].exists() && !all[1].exists());
        assert!(all[2..].iter().all(|p| p.exists()));
        assert!(failed.exists());
        assert_eq!(inventory(&root).unwrap().protected_count, 1);
    }
    #[test]
    fn manual_cleanup_is_scoped_and_requires_fresh_confirmation() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("backups/visibility");
        let first = backup(&root, 1, "completed");
        fs::create_dir_all(root.join("unrelated")).unwrap();
        fs::write(root.join("unrelated/important"), "keep").unwrap();
        let other = tmp.path().join("backups/official-history");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("original"), "keep").unwrap();
        let old = inventory(&root).unwrap();
        let second = backup(&root, 2, "preparing");
        assert!(cleanup(&root, &old.snapshot).is_err());
        assert!(first.exists() && second.exists());
        let now = inventory(&root).unwrap();
        assert_eq!(now.skipped_entries, 1);
        let result = cleanup(&root, &now.snapshot).unwrap();
        assert_eq!(result.deleted_count, 2);
        assert_eq!(result.deleted_bytes, now.bytes);
        assert!(root.join("unrelated/important").exists() && other.join("original").exists());
        assert_eq!(inventory(&root).unwrap().count, 0);
    }
    #[test]
    fn legacy_backups_are_manual_only_and_current_backup_is_always_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("backups/visibility");
        let legacy = backup(&root, 1, "completed");
        fs::write(
            legacy.join("manifest.json"),
            r#"{"codexHome":"/fixture","targetProvider":"custom","files":[],"databases":[]}"#,
        )
        .unwrap();
        let current = backup(&root, 2, "completed");
        for day in 3..=6 {
            backup(&root, day, "completed");
        }
        assert_eq!(prune(&root, Some(&current)).unwrap().deleted_count, 2);
        assert!(current.exists() && legacy.exists());
        assert_eq!(inventory(&root).unwrap().protected_count, 1);
        let stats = inventory(&root).unwrap();
        cleanup(&root, &stats.snapshot).unwrap();
        assert!(!legacy.exists());
    }
    #[test]
    fn missing_root_is_noop_and_invalid_manifests_are_never_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("backups/visibility");
        assert_eq!(inventory(&root).unwrap().count, 0);
        assert!(!root.exists());
        let unknown = backup(&root, 1, "completed");
        fs::write(unknown.join("manifest.json"), "{}").unwrap();
        let stats = inventory(&root).unwrap();
        assert_eq!(stats.skipped_entries, 1);
        assert_eq!(cleanup(&root, &stats.snapshot).unwrap().deleted_count, 0);
        assert!(unknown.exists());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_roots_and_backup_contents_are_never_followed() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("backups/visibility");
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("important"), "keep").unwrap();
        let entry = backup(&root, 1, "completed");
        symlink(outside.path(), entry.join("external")).unwrap();
        let stats = inventory(&root).unwrap();
        assert_eq!(stats.count, 0);
        assert_eq!(stats.skipped_entries, 1);
        cleanup(&root, &stats.snapshot).unwrap();
        assert!(outside.path().join("important").exists());
        let link = tmp.path().join("linked");
        symlink(&root, &link).unwrap();
        assert!(inventory(&link).is_err());
    }
}
