//! User-invoked provider visibility repair. Inspired by cockpit-tools' provider
//! alignment approach, independently implemented for CC Switch's current home.
//! Never changes messages, archive flags, timestamps, auth, or config.toml.
use crate::{codex_state_db::codex_state_db_paths, config::atomic_write_private as atomic_write};
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairReport {
    pub provider: String,
    pub changed_files: usize,
    pub changed_threads: usize,
    pub backup_path: Option<String>,
    pub pruned_backups: usize,
    pub warnings: Vec<String>,
    pub skipped_files: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairPreview {
    pub provider: String,
    pub scanned_files: usize,
    pub changed_files: usize,
    pub changed_threads: usize,
    pub database_count: usize,
    pub skipped_files: usize,
    pub estimated_backup_bytes: u64,
    pub warnings: Vec<String>,
}
impl RepairPreview {
    pub fn needs_repair(&self) -> bool {
        self.changed_files > 0 || self.changed_threads > 0
    }
    pub fn unchanged_report(self) -> RepairReport {
        RepairReport {
            provider: self.provider,
            warnings: self.warnings,
            skipped_files: self.skipped_files,
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairProgress {
    pub phase: &'static str,
    pub completed: u64,
    pub total: Option<u64>,
    pub unit: &'static str,
    pub item: Option<String>,
}
pub type ProgressReporter<'a> = &'a dyn Fn(RepairProgress);
pub fn progress(
    reporter: ProgressReporter<'_>,
    phase: &'static str,
    completed: u64,
    total: Option<u64>,
    unit: &'static str,
    path: Option<&Path>,
) {
    reporter(RepairProgress {
        phase,
        completed,
        total,
        unit,
        item: path
            .and_then(|p| p.file_name())
            .map(|v| v.to_string_lossy().into_owned()),
    });
}

// A normal rollout starts with session_meta. Bound malformed headers rather
// than scanning the entire conversation to guess where its metadata might be.
const MAX_HEADER_BYTES: u64 = 2 * 1024 * 1024;
fn read_header(reader: &mut impl BufRead) -> Result<Vec<u8>, String> {
    let mut header = Vec::new();
    reader
        .take(MAX_HEADER_BYTES + 1)
        .read_until(b'\n', &mut header)
        .map_err(|e| e.to_string())?;
    if header.len() as u64 > MAX_HEADER_BYTES {
        return Err("首条元数据超过大小限制".into());
    }
    if header.is_empty() {
        return Err("空会话文件".into());
    }
    Ok(header)
}
fn rewrite_header(header: &[u8], provider: &str) -> Result<Option<Vec<u8>>, String> {
    let line = header.strip_suffix(b"\n").unwrap_or(header);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let mut value: Value =
        serde_json::from_slice(line).map_err(|_| "无法识别首条会话元数据".to_string())?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return Err("首条记录不是 session_meta".into());
    }
    let payload = value
        .get_mut("payload")
        .and_then(Value::as_object_mut)
        .ok_or("session_meta 缺少 payload")?;
    if payload.get("model_provider").and_then(Value::as_str) == Some(provider) {
        return Ok(None);
    }
    payload.insert("model_provider".into(), Value::String(provider.into()));
    let mut out = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    out.extend_from_slice(&header[line.len()..]);
    Ok(Some(out))
}
fn open_rollout(path: &Path) -> Result<BufReader<fs::File>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("会话不是普通文件".into());
    }
    Ok(BufReader::new(
        fs::File::open(path).map_err(|e| e.to_string())?,
    ))
}

struct ScanPlan {
    preview: RepairPreview,
    files: Vec<PathBuf>,
    databases: Vec<PathBuf>,
}
fn discover_databases(home: &Path, config: &str) -> Result<Vec<PathBuf>, String> {
    let mut paths = codex_state_db_paths(home, config);
    for dir in [home.to_path_buf(), home.join("sqlite")] {
        if !dir.exists() {
            continue;
        }
        if fs::symlink_metadata(&dir)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err(format!("不扫描符号链接数据库目录：{}", dir.display()));
        }
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
            if (name.starts_with("state_") && name.ends_with(".sqlite")) || name == "codex-dev.db" {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths.dedup();
    let mut canonical = std::collections::HashSet::new();
    let mut result = Vec::new();
    for path in paths {
        if !path.exists() {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(format!("不扫描非普通数据库：{}", path.display()));
        }
        if canonical.insert(fs::canonicalize(&path).map_err(|e| e.to_string())?) {
            result.push(path);
        }
    }
    Ok(result)
}
fn db_change_count(connection: &Connection, provider: &str) -> Result<usize, String> {
    let columns: Vec<String> = connection
        .prepare("PRAGMA table_info(threads)")
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    if !columns.iter().any(|c| c == "model_provider") {
        return Ok(0);
    }
    let count = connection
        .query_row(
            "SELECT COUNT(*) FROM threads WHERE model_provider IS NOT ?1",
            [provider],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 && !columns.iter().any(|c| c == "id") {
        return Err("会话数据库缺少线程 ID，无法安全修复".into());
    }
    Ok(count)
}
fn scan(home: &Path, config: &str, reporter: ProgressReporter<'_>) -> Result<ScanPlan, String> {
    let provider = target_provider(config)?;
    let mut summary = RepairPreview {
        provider: provider.clone(),
        ..Default::default()
    };
    let mut all_files = Vec::new();
    progress(reporter, "discover", 0, None, "files", None);
    collect_rollouts(&home.join("sessions"), &mut all_files, reporter)?;
    collect_rollouts(&home.join("archived_sessions"), &mut all_files, reporter)?;
    all_files.sort();
    let total = all_files.len() as u64;
    let mut files = Vec::new();
    progress(reporter, "scan_files", 0, Some(total), "files", None);
    for path in all_files {
        let mut reader = open_rollout(&path)?;
        let changed =
            read_header(&mut reader).and_then(|header| rewrite_header(&header, &provider));
        match changed {
            Ok(Some(_)) => {
                summary.estimated_backup_bytes += reader
                    .get_ref()
                    .metadata()
                    .map_err(|e| e.to_string())?
                    .len();
                files.push(path.clone());
                summary.changed_files += 1;
            }
            Ok(None) => {}
            Err(e) => {
                summary.skipped_files += 1;
                if summary.warnings.len() < 10 {
                    summary.warnings.push(format!(
                        "跳过 {}：{e}",
                        path.file_name().unwrap_or_default().to_string_lossy()
                    ));
                }
            }
        }
        summary.scanned_files += 1;
        progress(
            reporter,
            "scan_files",
            summary.scanned_files as u64,
            Some(total),
            "files",
            Some(&path),
        );
    }
    let paths = discover_databases(home, config)?;
    let total = paths.len() as u64;
    let mut databases = Vec::new();
    progress(
        reporter,
        "scan_databases",
        0,
        Some(total),
        "databases",
        None,
    );
    for path in paths {
        progress(
            reporter,
            "scan_databases",
            summary.database_count as u64,
            Some(total),
            "databases",
            Some(&path),
        );
        let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        let count = db_change_count(&db, &provider)?;
        if count > 0 {
            summary.changed_threads += count;
            summary.estimated_backup_bytes += fs::metadata(&path).map_err(|e| e.to_string())?.len();
            summary.estimated_backup_bytes += fs::metadata(format!("{}-wal", path.display()))
                .map(|m| m.len())
                .unwrap_or(0);
            databases.push(path.clone());
        }
        summary.database_count += 1;
        progress(
            reporter,
            "scan_databases",
            summary.database_count as u64,
            Some(total),
            "databases",
            Some(&path),
        );
    }
    Ok(ScanPlan {
        preview: summary,
        files,
        databases,
    })
}

/// Read-only: no lifecycle operation, full-body reads, backups, or retention.
pub fn preview(
    home: &Path,
    config: &str,
    reporter: ProgressReporter<'_>,
) -> Result<RepairPreview, String> {
    Ok(scan(home, config, reporter)?.preview)
}

fn private_temp(path: &Path) -> Result<tempfile::NamedTempFile, String> {
    let parent = path.parent().ok_or("无效的会话路径")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(file)
}
fn persist(file: tempfile::NamedTempFile, path: &Path) -> Result<(), String> {
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

// Stream bodies byte-for-byte without deserializing messages or holding a whole
// conversation in memory. Only the first session_meta record is changed.
fn stage_file(
    path: &Path,
    backup: &Path,
    staged: &Path,
    provider: &str,
    reporter: ProgressReporter<'_>,
) -> Result<Option<Vec<u8>>, String> {
    let mut source = open_rollout(path)?;
    let header = read_header(&mut source)?;
    let Some(updated) = rewrite_header(&header, provider)? else {
        return Ok(None);
    };
    let total = source
        .get_ref()
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    let mut original = private_temp(backup)?;
    let mut replacement = private_temp(staged)?;
    let mut hash = Sha256::new();
    hash.update(&header);
    original.write_all(&header).map_err(|e| e.to_string())?;
    replacement.write_all(&updated).map_err(|e| e.to_string())?;
    let mut completed = header.len() as u64;
    let mut buffer = vec![0; 256 * 1024];
    progress(
        reporter,
        "backup_files",
        completed,
        Some(total),
        "bytes",
        Some(path),
    );
    loop {
        let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        original
            .write_all(&buffer[..n])
            .map_err(|e| e.to_string())?;
        replacement
            .write_all(&buffer[..n])
            .map_err(|e| e.to_string())?;
        completed += n as u64;
        progress(
            reporter,
            "backup_files",
            completed,
            Some(total),
            "bytes",
            Some(path),
        );
    }
    persist(original, backup)?;
    persist(replacement, staged)?;
    Ok(Some(hash.finalize().to_vec()))
}
fn hash_file(path: &Path, reporter: ProgressReporter<'_>) -> Result<Vec<u8>, String> {
    let mut source = open_rollout(path)?;
    let total = source
        .get_ref()
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 256 * 1024];
    let mut completed = 0;
    progress(
        reporter,
        "verify_files",
        0,
        Some(total),
        "bytes",
        Some(path),
    );
    loop {
        let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        completed += n as u64;
        progress(
            reporter,
            "verify_files",
            completed,
            Some(total),
            "bytes",
            Some(path),
        );
    }
    Ok(hash.finalize().to_vec())
}
fn copy_atomic(source: &Path, dest: &Path, reporter: ProgressReporter<'_>) -> Result<(), String> {
    let mut input = open_rollout(source)?;
    let total = input.get_ref().metadata().map_err(|e| e.to_string())?.len();
    let mut output = private_temp(dest)?;
    let mut buffer = vec![0; 256 * 1024];
    let mut completed = 0;
    progress(reporter, "write_files", 0, Some(total), "bytes", Some(dest));
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        completed += n as u64;
        progress(
            reporter,
            "write_files",
            completed,
            Some(total),
            "bytes",
            Some(dest),
        );
    }
    persist(output, dest)
}

pub(crate) fn target_provider(config: &str) -> Result<String, String> {
    let doc = config
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "Codex config.toml 无效，无法判断当前 Provider".to_string())?;
    let root_provider = doc.get("model_provider");
    let selected_provider = match doc.get("profile") {
        None => root_provider,
        Some(profile) => {
            let name = profile
                .as_str()
                .ok_or("Codex profile 必须是字符串，已停止修复")?;
            let profile = doc
                .get("profiles")
                .and_then(|profiles| profiles.get(name))
                .filter(|profile| profile.as_table_like().is_some())
                .ok_or("找不到当前 Codex profile，已停止修复")?;
            profile.get("model_provider").or(root_provider)
        }
    };
    let provider = match selected_provider {
        Some(provider) => provider
            .as_str()
            .ok_or("Codex model_provider 必须是字符串，已停止修复")?,
        None => "openai",
    };
    if provider.trim().is_empty() {
        return Err("当前 Codex Provider 为空".into());
    }
    Ok(provider.to_string())
}

fn collect_rollouts(
    dir: &Path,
    files: &mut Vec<PathBuf>,
    reporter: ProgressReporter<'_>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    if fs::symlink_metadata(dir)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(format!(
            "为保护外部数据，不修复符号链接目录：{}",
            dir.display()
        ));
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_rollouts(&entry.path(), files, reporter)?;
        } else if kind.is_file() && entry.path().extension().is_some_and(|v| v == "jsonl") {
            files.push(entry.path());
            progress(
                reporter,
                "discover",
                files.len() as u64,
                None,
                "files",
                None,
            );
        }
    }
    Ok(())
}

struct FilePlan {
    path: PathBuf,
    backup: PathBuf,
    staged: PathBuf,
    hash: Vec<u8>,
}
struct DbPlan {
    connection: Connection,
    backup: PathBuf,
    path: PathBuf,
    version: i64,
}

/// Caller must ensure Codex is stopped, and hold the Codex switch/history locks.
#[cfg(test)]
pub fn repair(home: &Path, config: &str, backup_parent: &Path) -> Result<RepairReport, String> {
    repair_with_progress(home, config, backup_parent, &|_| {})
}
pub fn repair_with_progress(
    home: &Path,
    config: &str,
    backup_parent: &Path,
    reporter: ProgressReporter<'_>,
) -> Result<RepairReport, String> {
    let plan = scan(home, config, reporter)?;
    if !plan.preview.needs_repair() {
        return Ok(plan.preview.unchanged_report());
    }
    crate::codex_visibility_backups::validate_root(backup_parent)?;
    let provider = plan.preview.provider;
    let files = plan.files;
    let db_paths = plan.databases;
    let backup_root = backup_parent.join(format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S"),
        uuid::Uuid::new_v4()
    ));
    let mut plans = Vec::new();
    let mut databases = Vec::new();
    let mut report = RepairReport {
        provider: provider.clone(),
        warnings: plan.preview.warnings,
        skipped_files: plan.preview.skipped_files,
        ..Default::default()
    };
    // Stage every file and take SQLite online backups (including committed WAL)
    // before any mutation. Preparation errors leave original data untouched.
    let prepare = (|| -> Result<(), String> {
        for path in files {
            let relative = path.strip_prefix(home).map_err(|e| e.to_string())?;
            let backup = backup_root.join("rollouts").join(relative);
            let staged = backup_root.join("staged").join(relative);
            ensure_preparing_manifest(&backup_root, home, &provider)?;
            if let Some(hash) = stage_file(&path, &backup, &staged, &provider, reporter)? {
                plans.push(FilePlan {
                    path,
                    backup,
                    staged,
                    hash,
                });
            }
        }
        let mut canonical_dbs = std::collections::HashSet::new();
        for path in db_paths {
            if !path.exists() {
                continue;
            }
            if fs::symlink_metadata(&path)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err(format!("不修复符号链接数据库：{}", path.display()));
            }
            if !canonical_dbs.insert(fs::canonicalize(&path).map_err(|e| e.to_string())?) {
                continue;
            }
            let connection = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE)
                .map_err(|e| e.to_string())?;
            connection
                .busy_timeout(Duration::from_secs(3))
                .map_err(|e| e.to_string())?;
            let columns: Vec<String> = connection
                .prepare("PRAGMA table_info(threads)")
                .map_err(|e| e.to_string())?
                .query_map([], |r| r.get(1))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            if !columns.iter().any(|c| c == "model_provider") {
                continue;
            }
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM threads WHERE model_provider IS NOT ?1",
                    [&provider],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count == 0 {
                continue;
            }
            if !columns.iter().any(|c| c == "id") {
                return Err(format!(
                    "会话数据库缺少线程 ID，无法安全修复：{}",
                    path.display()
                ));
            }
            ensure_preparing_manifest(&backup_root, home, &provider)?;
            let backup = backup_root.join(format!("state-{}.sqlite", databases.len()));
            // Create private backup before SQLite opens it; histories can
            // contain secrets even though this operation never edits auth.
            atomic_write(&backup, &[]).map_err(|e| e.to_string())?;
            let version = connection
                .query_row("PRAGMA data_version", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let mut dest = Connection::open(&backup).map_err(|e| e.to_string())?;
            progress(reporter, "backup_database", 0, None, "pages", Some(&path));
            let backup_job = Backup::new(&connection, &mut dest).map_err(|e| e.to_string())?;
            let deadline = std::time::Instant::now() + Duration::from_secs(60);
            loop {
                let step = backup_job.step(128).map_err(|e| e.to_string())?;
                let pages = backup_job.progress();
                progress(
                    reporter,
                    "backup_database",
                    (pages.pagecount - pages.remaining).max(0) as u64,
                    Some(pages.pagecount.max(0) as u64),
                    "pages",
                    Some(&path),
                );
                match step {
                    StepResult::Done => break,
                    StepResult::Busy | StepResult::Locked => {
                        std::thread::sleep(Duration::from_millis(10))
                    }
                    _ => {}
                }
                if std::time::Instant::now() >= deadline {
                    return Err(
                        "会话数据库备份超时，原始数据未改动；请停止 Codex CLI 后重试".into(),
                    );
                }
            }
            drop(backup_job);
            databases.push(DbPlan {
                connection,
                backup,
                path,
                version,
            });
        }
        if !plans.is_empty() || !databases.is_empty() {
            let manifest = serde_json::json!({
                "owner": crate::codex_visibility_backups::OWNER, "version": 1,
                "status": "preparing", "codexHome": home, "targetProvider": provider,
                "files": plans.iter().map(|p| serde_json::json!({"original":p.path,"backup":p.backup})).collect::<Vec<_>>(),
                "databases": databases.iter().map(|p| serde_json::json!({"original":p.path,"backup":p.backup})).collect::<Vec<_>>()
            });
            atomic_write(
                &backup_root.join("manifest.json"),
                &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = prepare {
        return Err(format!(
            "修复准备失败，原始会话未改动：{error}；备份目录：{}",
            backup_root.display()
        ));
    }
    let mut written = 0;
    let mut committed = 0;
    let result = (|| -> Result<(), String> {
        progress(
            reporter,
            "write_database",
            0,
            Some(databases.len() as u64),
            "databases",
            None,
        );
        for (index, db) in databases.iter().enumerate() {
            progress(
                reporter,
                "write_database",
                index as u64,
                Some(databases.len() as u64),
                "databases",
                Some(&db.path),
            );
            db.connection
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            let current: i64 = db
                .connection
                .query_row("PRAGMA data_version", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if current != db.version {
                return Err("会话数据库仍在被其他进程写入，请退出 Codex CLI 后重试".into());
            }
            report.changed_threads += db
                .connection
                .execute(
                    "UPDATE threads SET model_provider = ?1 WHERE model_provider IS NOT ?1",
                    [&provider],
                )
                .map_err(|e| e.to_string())?;
            progress(
                reporter,
                "write_database",
                (index + 1) as u64,
                Some(databases.len() as u64),
                "databases",
                Some(&db.path),
            );
        }
        for file in &plans {
            if hash_file(&file.path, reporter)? != file.hash {
                return Err("会话文件仍在变化，请退出 Codex CLI 后重试".into());
            }
            copy_atomic(&file.staged, &file.path, reporter)?;
            written += 1;
        }
        progress(
            reporter,
            "commit",
            0,
            Some(databases.len() as u64),
            "databases",
            None,
        );
        for db in &databases {
            db.connection
                .execute_batch("COMMIT")
                .map_err(|e| e.to_string())?;
            committed += 1;
            progress(
                reporter,
                "commit",
                committed as u64,
                Some(databases.len() as u64),
                "databases",
                Some(&db.path),
            );
        }
        Ok(())
    })();
    if let Err(error) = result {
        progress(reporter, "rollback", 0, None, "steps", None);
        let mut rollback_errors = Vec::new();
        for db in databases.iter().skip(committed) {
            let _ = db.connection.execute_batch("ROLLBACK");
        }
        for db in databases.iter().take(committed) {
            if let Err(e) = restore_database_providers(db) {
                rollback_errors.push(format!("{}: {e}", db.path.display()));
            }
        }
        for file in plans.iter().take(written) {
            let restore = (|| -> Result<(), String> {
                // Do not overwrite a CLI append that happened after our write.
                if hash_file(&file.path, &|_| {})? != hash_file(&file.staged, &|_| {})? {
                    return Err("文件在修复后被其他进程修改，保留现状，请从备份手动恢复".into());
                }
                copy_atomic(&file.backup, &file.path, &|_| {})
            })();
            if let Err(e) = restore {
                rollback_errors.push(format!("{}: {e}", file.path.display()));
            }
        }
        return Err(format!(
            "修复失败：{error}；回滚错误：{rollback_errors:?}；备份目录：{}",
            backup_root.display()
        ));
    }
    report.changed_files = written;
    if !plans.is_empty() || !databases.is_empty() {
        report.backup_path = Some(backup_root.display().to_string());
    }
    // Staged replacement files aren't needed after a successful repair. Backups stay.
    if backup_root.join("staged").exists() {
        let _ = fs::remove_dir_all(backup_root.join("staged"));
    }
    if report.backup_path.is_some() {
        let completed = (|| -> Result<(), String> {
            let path = backup_root.join("manifest.json");
            let mut manifest: Value =
                serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            manifest["status"] = Value::String("completed".into());
            atomic_write(
                &path,
                &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())
        })();
        if let Err(e) = completed {
            report.warnings.push(format!(
                "修复已完成，但备份完成标记保存失败，将保留该备份：{e}"
            ));
        }
    }
    progress(reporter, "cleanup", 0, None, "steps", None);
    match crate::codex_visibility_backups::prune(
        backup_parent,
        report.backup_path.as_deref().map(Path::new),
    ) {
        Ok(cleanup) => {
            report.pruned_backups = cleanup.deleted_count;
            report.warnings.extend(cleanup.warnings);
        }
        Err(e) => report
            .warnings
            .push(format!("修复已完成，旧备份清理未完成：{e}")),
    }
    Ok(report)
}

fn ensure_preparing_manifest(root: &Path, home: &Path, provider: &str) -> Result<(), String> {
    let path = root.join("manifest.json");
    if !path.exists() {
        let manifest = serde_json::json!({
            "owner": crate::codex_visibility_backups::OWNER, "version": 1,
            "status": "preparing", "codexHome": home, "targetProvider": provider,
            "files": [], "databases": [],
        });
        atomic_write(
            &path,
            &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Compensate a committed database without replacing the entire live database.
// Hold a write lock while checking for concurrent writers and restoring only
// provider columns. Backups remain available if safe automatic recovery fails.
fn restore_database_providers(db: &DbPlan) -> Result<(), String> {
    db.connection
        .execute(
            "ATTACH DATABASE ?1 AS visibility_backup",
            [db.backup.to_string_lossy().as_ref()],
        )
        .map_err(|e| e.to_string())?;
    let restored = (|| -> Result<(), String> {
        db.connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let version: i64 = db
            .connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version != db.version {
            return Err("数据库被其他进程修改，保留现状，请从备份手动恢复".into());
        }
        db.connection
            .execute_batch(
                "UPDATE main.threads SET model_provider = (
                SELECT original.model_provider FROM visibility_backup.threads AS original
                WHERE original.id = main.threads.id
            ) WHERE EXISTS (
                SELECT 1 FROM visibility_backup.threads AS original
                WHERE original.id = main.threads.id
                AND original.model_provider IS NOT main.threads.model_provider
            );
            COMMIT;",
            )
            .map_err(|e| e.to_string())
    })();
    if restored.is_err() {
        let _ = db.connection.execute_batch("ROLLBACK");
    }
    let _ = db
        .connection
        .execute_batch("DETACH DATABASE visibility_backup");
    restored
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn seed(home: &Path) -> (PathBuf, Vec<u8>) {
        let file = home.join("sessions/2026/09/rollout-test.jsonl");
        let bytes = b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"one\",\"model_provider\":\"openai\",\"cwd\":\"/project\"}}\r\n{\"type\":\"response_item\",\"payload\":{\"text\":\"leave me exactly unchanged\"}}\r\npartial-record".to_vec();
        atomic_write(&file, &bytes).unwrap();
        (file, bytes)
    }

    #[test]
    fn aligns_provider_with_backups_and_preserves_messages_archive_and_wal() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let backups = root.path().join("backups");
        let (file, original) = seed(&home);
        let archived = home.join("archived_sessions/archived.jsonl");
        atomic_write(&archived, &original).unwrap();
        let config = "model_provider = \"custom\"\n[desktop]\nfollowUpQueueMode = \"queue\"\n";
        atomic_write(&home.join("config.toml"), config.as_bytes()).unwrap();
        atomic_write(&home.join("auth.json"), b"untouched-auth").unwrap();
        let db_path = home.join("state_5.sqlite");
        let connection = Connection::open(&db_path).unwrap();
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT, archived INTEGER, cwd TEXT, has_user_event INTEGER); INSERT INTO threads VALUES ('one', 'openai', 1, '/project', 0);").unwrap();
        let result = repair(&home, config, &backups).unwrap();
        assert_eq!(result.changed_files, 2);
        assert_eq!(result.changed_threads, 1);
        let changed = fs::read(&file).unwrap();
        assert!(changed.ends_with(b"\r\n{\"type\":\"response_item\",\"payload\":{\"text\":\"leave me exactly unchanged\"}}\r\npartial-record"));
        assert_eq!(
            serde_json::from_slice::<Value>(changed.split(|b| *b == b'\n').next().unwrap())
                .unwrap()["payload"]["model_provider"],
            json!("custom")
        );
        let row: (String, i64, String, i64) = connection
            .query_row(
                "SELECT model_provider, archived, cwd, has_user_event FROM threads",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(row, ("custom".into(), 1, "/project".into(), 0));
        let backup = PathBuf::from(result.backup_path.unwrap());
        assert_eq!(
            fs::read(backup.join("rollouts/sessions/2026/09/rollout-test.jsonl")).unwrap(),
            original
        );
        let saved = Connection::open(backup.join("state-0.sqlite")).unwrap();
        assert_eq!(
            saved
                .query_row("SELECT model_provider FROM threads", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "openai"
        );
        assert_eq!(
            fs::read(home.join("config.toml")).unwrap(),
            config.as_bytes()
        );
        assert_eq!(fs::read(home.join("auth.json")).unwrap(), b"untouched-auth");
        let second = repair(&home, config, &backups).unwrap();
        assert_eq!((second.changed_files, second.changed_threads), (0, 0));
        assert!(second.backup_path.is_none());
    }

    #[test]
    fn malformed_db_aborts_preparation_before_any_rollout_changes() {
        let root = tempfile::tempdir().unwrap();
        let (file, original) = seed(root.path());
        atomic_write(&root.path().join("state_5.sqlite"), b"not sqlite").unwrap();
        assert!(repair(
            root.path(),
            "model_provider = 'custom'",
            &root.path().join("backups")
        )
        .is_err());
        assert_eq!(fs::read(file).unwrap(), original);
    }

    #[test]
    fn sqlite_failure_rolls_back_updates_and_preserves_files() {
        let root = tempfile::tempdir().unwrap();
        let (file, original) = seed(root.path());
        let db = Connection::open(root.path().join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT); INSERT INTO threads VALUES ('one', 'openai'); CREATE TRIGGER reject_update BEFORE UPDATE ON threads BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        let error = repair(
            root.path(),
            "model_provider = 'custom'",
            &root.path().join("backups"),
        )
        .unwrap_err();
        assert!(error.contains("injected failure"), "{error}");
        assert_eq!(fs::read(file).unwrap(), original);
        assert_eq!(
            db.query_row("SELECT model_provider FROM threads", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "openai"
        );
    }

    #[test]
    fn respects_profile_and_external_sqlite_home_without_creating_missing_dbs() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        fs::create_dir_all(&home).unwrap();
        let external = root.path().join("external");
        fs::create_dir_all(&external).unwrap();
        let db = Connection::open(external.join("state_5.sqlite")).unwrap();
        db.execute_batch(
            "CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT); INSERT INTO threads VALUES ('one', NULL)",
        )
        .unwrap();
        let config = format!("sqlite_home = '{}'\nprofile = 'work'\nmodel_provider = 'openai'\n[profiles.work]\nmodel_provider = 'station'\n", external.display());
        let report = repair(&home, &config, &root.path().join("backups")).unwrap();
        assert_eq!(report.provider, "station");
        assert_eq!(report.changed_threads, 1);
        assert!(!home.join("state_5.sqlite").exists());
    }

    #[test]
    fn committed_database_compensation_preserves_other_columns() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state_5.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT, title TEXT); INSERT INTO threads VALUES ('one', 'old', 'keep');").unwrap();
        let backup = root.path().join("backup.sqlite");
        let version = connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .unwrap();
        let mut destination = Connection::open(&backup).unwrap();
        Backup::new(&connection, &mut destination)
            .unwrap()
            .run_to_completion(128, Duration::from_millis(10), None)
            .unwrap();
        drop(destination);
        connection
            .execute("UPDATE threads SET model_provider = 'new'", [])
            .unwrap();
        let plan = DbPlan {
            connection,
            backup,
            path,
            version,
        };
        restore_database_providers(&plan).unwrap();
        let row: (String, String) = plan
            .connection
            .query_row("SELECT model_provider, title FROM threads", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(row, ("old".into(), "keep".into()));
        assert!(plan.backup.exists());
    }

    #[test]
    fn compensation_refuses_to_overwrite_concurrent_database_changes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state_5.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT); INSERT INTO threads VALUES ('one', 'old');").unwrap();
        let backup = root.path().join("backup.sqlite");
        let version = connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .unwrap();
        let mut destination = Connection::open(&backup).unwrap();
        Backup::new(&connection, &mut destination)
            .unwrap()
            .run_to_completion(128, Duration::from_millis(10), None)
            .unwrap();
        drop(destination);
        connection
            .execute("UPDATE threads SET model_provider = 'new'", [])
            .unwrap();
        let other = Connection::open(&path).unwrap();
        other
            .execute("UPDATE threads SET model_provider = 'cli'", [])
            .unwrap();
        let plan = DbPlan {
            connection,
            backup,
            path,
            version,
        };
        assert!(restore_database_providers(&plan)
            .unwrap_err()
            .contains("其他进程"));
        assert_eq!(
            plan.connection
                .query_row("SELECT model_provider FROM threads", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "cli"
        );
        assert!(plan.connection.is_autocommit());
    }

    #[test]
    fn successful_repairs_are_bounded_and_manual_cleanup_never_touches_live_files() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let backups = root.path().join("backups/codex-session-visibility");
        let (file, original) = seed(&home);
        for _ in 0..5 {
            // New legacy records arrive; each repair needs its own rollback copy.
            atomic_write(&file, &original).unwrap();
            let report = repair(&home, "model_provider = 'custom'", &backups).unwrap();
            assert!(Path::new(report.backup_path.as_deref().unwrap()).exists());
            assert!(report.warnings.is_empty());
            assert!(
                crate::codex_visibility_backups::inventory(&backups)
                    .unwrap()
                    .count
                    <= 3
            );
        }
        let stats = crate::codex_visibility_backups::inventory(&backups).unwrap();
        assert_eq!(stats.count, 3);
        assert_eq!(stats.protected_count, 0);
        let live = fs::read(&file).unwrap();
        let noop = repair(&home, "model_provider = 'custom'", &backups).unwrap();
        assert!(noop.backup_path.is_none());
        assert_eq!(
            crate::codex_visibility_backups::inventory(&backups)
                .unwrap()
                .count,
            3
        );
        crate::codex_visibility_backups::cleanup(&backups, &stats.snapshot).unwrap();
        assert_eq!(fs::read(&file).unwrap(), live);
        assert_eq!(
            crate::codex_visibility_backups::inventory(&backups)
                .unwrap()
                .count,
            0
        );
    }

    #[test]
    fn invalid_database_fails_preflight_without_creating_any_backup() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let backups = root.path().join("backups/codex-session-visibility");
        let (file, original) = seed(&home);
        fs::write(home.join("state_5.sqlite"), b"corrupt database").unwrap();
        assert!(repair(&home, "model_provider = 'custom'", &backups).is_err());
        let stats = crate::codex_visibility_backups::inventory(&backups).unwrap();
        assert_eq!(stats.count, 0);
        assert_eq!(stats.protected_count, 0);
        assert!(!backups.exists());
        assert_eq!(
            crate::codex_visibility_backups::prune(&backups, None)
                .unwrap()
                .deleted_count,
            0
        );
        assert_eq!(fs::read(file).unwrap(), original);
    }

    #[test]
    fn ambiguous_provider_configuration_is_rejected_before_mutating() {
        for config in [
            "model_provider = 1",
            "model_provider = ''",
            "profile = 1",
            "profile = 'missing'",
            "profile = 'work'\n[profiles.work]\nmodel_provider = []",
        ] {
            assert!(target_provider(config).is_err(), "{config}");
        }
        assert_eq!(
            target_provider(
                "profile = 'work'\nmodel_provider = 'custom'\n[profiles.work]\nmodel = 'fixture'"
            )
            .unwrap(),
            "custom"
        );
    }

    #[test]
    fn no_history_is_noop_and_missing_provider_defaults_to_openai() {
        let root = tempfile::tempdir().unwrap();
        let report = repair(root.path(), "", &root.path().join("backups")).unwrap();
        assert_eq!(report.provider, "openai");
        assert!(report.backup_path.is_none());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        assert!(target_provider("model_provider = [").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_session_symlinks_outside_the_home() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let (outside_file, original) = seed(outside.path());
        fs::create_dir_all(root.path().join("sessions")).unwrap();
        std::os::unix::fs::symlink(&outside_file, root.path().join("sessions/external.jsonl"))
            .unwrap();
        let report = repair(
            root.path(),
            "model_provider = 'custom'",
            &root.path().join("backups"),
        )
        .unwrap();
        assert_eq!(report.changed_files, 0);
        assert_eq!(fs::read(outside_file).unwrap(), original);
    }
    #[test]
    fn preview_is_read_only_and_matches_execution_scope() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let backups = root.path().join("backups");
        let (file, original) = seed(&home);
        let aligned = home.join("sessions/aligned.jsonl");
        let aligned_bytes = b"{\"type\":\"session_meta\",\"payload\":{\"model_provider\":\"custom\"}}\nuntouched body";
        atomic_write(&aligned, aligned_bytes).unwrap();
        let archived = home.join("archived_sessions/archived.jsonl");
        atomic_write(&archived, &original).unwrap();
        let db_path = home.join("state_5.sqlite");
        let db = Connection::open(&db_path).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT, archived INTEGER); INSERT INTO threads VALUES ('a', 'openai', 0), ('b', NULL, 1), ('c', 'custom', 0);").unwrap();
        drop(db);
        let db_bytes = fs::read(&db_path).unwrap();
        let events = std::cell::RefCell::new(Vec::new());
        let preview = preview(&home, "model_provider = 'custom'", &|p| {
            events.borrow_mut().push(p)
        })
        .unwrap();
        assert_eq!(preview.provider, "custom");
        assert_eq!(
            (
                preview.scanned_files,
                preview.changed_files,
                preview.changed_threads,
                preview.database_count,
                preview.skipped_files
            ),
            (3, 2, 2, 1, 0)
        );
        assert_eq!(
            preview.estimated_backup_bytes,
            original.len() as u64 * 2 + db_bytes.len() as u64
        );
        assert_eq!(fs::read(&file).unwrap(), original);
        assert_eq!(fs::read(&archived).unwrap(), original);
        assert_eq!(fs::read(&aligned).unwrap(), aligned_bytes);
        assert_eq!(fs::read(&db_path).unwrap(), db_bytes);
        assert!(!backups.exists());
        assert_eq!(events.borrow().last().unwrap().phase, "scan_databases");
        assert!(events
            .borrow()
            .iter()
            .all(|p| ["discover", "scan_files", "scan_databases"].contains(&p.phase)));
        assert!(events
            .borrow()
            .iter()
            .any(|p| p.phase == "scan_files" && p.completed == 3 && p.total == Some(3)));
        let report = repair_with_progress(&home, "model_provider = 'custom'", &backups, &|p| {
            events.borrow_mut().push(p)
        })
        .unwrap();
        assert_eq!(
            (report.changed_files, report.changed_threads),
            (preview.changed_files, preview.changed_threads)
        );
        for phase in [
            "backup_files",
            "backup_database",
            "verify_files",
            "write_database",
            "write_files",
            "commit",
            "cleanup",
        ] {
            assert!(events.borrow().iter().any(|p| p.phase == phase), "{phase}");
        }
        assert!(events
            .borrow()
            .iter()
            .all(|p| p.item.as_ref().is_none_or(|name| !name.contains('/'))));
        assert!(events
            .borrow()
            .iter()
            .all(|p| p.total.is_none_or(|total| p.completed <= total)));
        assert!(events
            .borrow()
            .iter()
            .any(|p| p.phase == "commit" && p.completed == 1 && p.total == Some(1)));
        assert_eq!(fs::read(&aligned).unwrap(), aligned_bytes);
        assert!(!Path::new(report.backup_path.as_ref().unwrap())
            .join("rollouts/sessions/aligned.jsonl")
            .exists());
    }

    #[test]
    fn header_scan_does_not_read_the_conversation_body_and_bounds_bad_headers() {
        struct HeaderOnly {
            header: std::io::Cursor<Vec<u8>>,
            bytes_read: usize,
        }
        impl Read for HeaderOnly {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                assert!(
                    self.header.position() < self.header.get_ref().len() as u64,
                    "attempted to read the body"
                );
                let n = self.header.read(buf)?;
                self.bytes_read += n;
                Ok(n)
            }
        }
        let header = b"{\"type\":\"session_meta\",\"payload\":{\"model_provider\":\"custom\"}}\n";
        let mut reader = BufReader::with_capacity(
            8,
            HeaderOnly {
                header: std::io::Cursor::new(header.to_vec()),
                bytes_read: 0,
            },
        );
        assert!(rewrite_header(&read_header(&mut reader).unwrap(), "custom")
            .unwrap()
            .is_none());
        assert_eq!(reader.get_ref().bytes_read, header.len());
        // No newline, so this represents an infinite malformed first record.
        let mut oversized = BufReader::new(std::io::repeat(b'x'));
        assert!(read_header(&mut oversized)
            .unwrap_err()
            .contains("大小限制"));
    }

    #[test]
    fn streaming_preserves_binary_body_crlf_and_missing_final_newline() {
        for eol in [b"\r\n".as_slice(), b"\n".as_slice(), b"".as_slice()] {
            let root = tempfile::tempdir().unwrap();
            let home = root.path().join("codex");
            let file = home.join("sessions/fixture.jsonl");
            let mut original = b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"fixture\",\"model_provider\":\"old\"}}".to_vec();
            original.extend_from_slice(eol);
            let body = if eol.is_empty() {
                Vec::new()
            } else {
                let mut bytes = vec![0xff; 3 * 256 * 1024 + 17];
                bytes.extend_from_slice(b"\n{\"type\":\"session_meta\",\"payload\":{\"model_provider\":\"not-the-header\"}}");
                bytes
            };
            original.extend_from_slice(&body);
            atomic_write(&file, &original).unwrap();
            let report = repair(
                &home,
                "model_provider = 'custom'",
                &root.path().join("backups"),
            )
            .unwrap();
            let changed = fs::read(&file).unwrap();
            let header_len = if eol.is_empty() {
                changed.len()
            } else {
                changed.iter().position(|b| *b == b'\n').unwrap() + 1
            };
            assert_eq!(&changed[header_len..], &body);
            assert!(changed[..header_len].ends_with(eol));
            let header: Value = serde_json::from_slice(&changed[..header_len]).unwrap();
            assert_eq!(header["payload"]["model_provider"], "custom");
            assert_eq!(
                fs::read(
                    Path::new(&report.backup_path.unwrap()).join("rollouts/sessions/fixture.jsonl")
                )
                .unwrap(),
                original
            );
        }
    }

    #[test]
    fn unrecognized_metadata_is_skipped_counted_and_never_rewritten() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let backups = root.path().join("backups");
        let (_, valid) = seed(&home);
        let mut invalid = vec![
            b"".to_vec(),
            b"bad json\n".to_vec(),
            b"{\"type\":\"response_item\"}\n".to_vec(),
            b"{\"type\":\"session_meta\",\"payload\":null}\n".to_vec(),
            vec![b'x'; MAX_HEADER_BYTES as usize + 1],
        ];
        invalid.extend((0..10).map(|_| b"bad json\n".to_vec()));
        for (i, bytes) in invalid.iter().enumerate() {
            atomic_write(&home.join(format!("sessions/bad-{i}.jsonl")), bytes).unwrap();
        }
        let preview = preview(&home, "model_provider = 'custom'", &|_| {}).unwrap();
        assert_eq!(preview.changed_files, 1);
        assert_eq!(preview.scanned_files, invalid.len() + 1);
        assert_eq!(preview.skipped_files, invalid.len());
        assert_eq!(preview.warnings.len(), 10);
        assert_eq!(preview.estimated_backup_bytes, valid.len() as u64);
        let report = repair(&home, "model_provider = 'custom'", &backups).unwrap();
        assert_eq!(report.skipped_files, invalid.len());
        for (i, bytes) in invalid.iter().enumerate() {
            assert_eq!(
                &fs::read(home.join(format!("sessions/bad-{i}.jsonl"))).unwrap(),
                bytes
            );
        }
    }

    #[test]
    fn no_op_does_not_even_validate_or_prune_the_backup_root() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        seed(&home); // already openai
        let backups = root.path().join("not-a-directory");
        fs::write(&backups, b"must not touch").unwrap();
        let report = repair(&home, "", &backups).unwrap();
        assert!(report.backup_path.is_none());
        assert_eq!(report.pruned_backups, 0);
        assert_eq!(fs::read(backups).unwrap(), b"must not touch");
    }

    #[test]
    fn post_scan_preparation_failure_keeps_recognizable_backup() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let backups = root.path().join("backups");
        let (file, original) = seed(&home);
        let second = file.parent().unwrap().join("zzz.jsonl");
        atomic_write(&second, &original).unwrap();
        let injected = std::cell::Cell::new(false);
        let error = repair_with_progress(&home, "model_provider = 'custom'", &backups, &|p| {
            if p.phase == "backup_files" && !injected.replace(true) {
                fs::write(&second, b"concurrent invalid header").unwrap();
            }
        })
        .unwrap_err();
        assert!(error.contains("修复准备失败"));
        assert_eq!(fs::read(&file).unwrap(), original);
        let stats = crate::codex_visibility_backups::inventory(&backups).unwrap();
        assert_eq!((stats.count, stats.protected_count), (1, 1));
        assert_eq!(
            crate::codex_visibility_backups::prune(&backups, None)
                .unwrap()
                .deleted_count,
            0
        );
    }

    #[test]
    fn rollback_after_one_file_write_restores_files_and_database() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let (file, original) = seed(&home);
        let second = file.parent().unwrap().join("zzz.jsonl");
        atomic_write(&second, &original).unwrap();
        let db = Connection::open(home.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, model_provider TEXT); INSERT INTO threads VALUES ('one','openai')").unwrap();
        let injected = std::cell::Cell::new(false);
        let rollback_seen = std::cell::Cell::new(false);
        let backups = root.path().join("backups");
        let error = repair_with_progress(&home, "model_provider = 'custom'", &backups, &|p| {
            if p.phase == "write_files" && !injected.replace(true) {
                fs::write(&second, b"external change").unwrap();
            }
            if p.phase == "rollback" {
                rollback_seen.set(true);
            }
        })
        .unwrap_err();
        assert!(error.contains("仍在变化"));
        assert!(rollback_seen.get());
        assert_eq!(fs::read(&file).unwrap(), original);
        assert_eq!(fs::read(&second).unwrap(), b"external change");
        assert_eq!(
            db.query_row("SELECT model_provider FROM threads", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "openai"
        );
        assert_eq!(
            crate::codex_visibility_backups::inventory(&backups)
                .unwrap()
                .protected_count,
            1
        );
    }

    #[test]
    fn aligned_large_histories_need_only_header_scans() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        fs::create_dir_all(home.join("sessions")).unwrap();
        let header = b"{\"type\":\"session_meta\",\"payload\":{\"model_provider\":\"custom\"}}\n";
        // Sparse bodies: 1000 histories represent >15 GiB without allocating it.
        for i in 0..1000 {
            let mut file = fs::File::create(home.join(format!("sessions/{i:04}.jsonl"))).unwrap();
            file.write_all(header).unwrap();
            file.set_len(16 * 1024 * 1024).unwrap();
        }
        let db = Connection::open(home.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id INTEGER PRIMARY KEY, model_provider TEXT); WITH RECURSIVE ids(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM ids WHERE x<20000) INSERT INTO threads SELECT x, 'custom' FROM ids;").unwrap();
        let started = std::time::Instant::now();
        let summary = preview(&home, "model_provider = 'custom'", &|_| {}).unwrap();
        eprintln!(
            "Fixture preview: {} sessions (15.625 GiB sparse bodies), 20000 index rows, {:?}",
            summary.scanned_files,
            started.elapsed()
        );
        assert_eq!(summary.scanned_files, 1000);
        assert_eq!(
            (
                summary.changed_files,
                summary.changed_threads,
                summary.skipped_files,
                summary.estimated_backup_bytes
            ),
            (0, 0, 0, 0)
        );
        assert!(!root.path().join("backups").exists());
    }
}
