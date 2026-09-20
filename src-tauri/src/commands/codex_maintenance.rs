//! Explicit, user-confirmed desktop maintenance. Never kill a Codex CLI/agent.
use crate::{
    codex_session_visibility::{
        progress, ProgressReporter, RepairPreview, RepairProgress, RepairReport,
    },
    store::AppState,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

static MAINTENANCE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const PROGRESS_EVENT: &str = "codex-maintenance-progress";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    run_id: String,
    #[serde(flatten)]
    progress: RepairProgress,
}
fn reporter(app: tauri::AppHandle, run_id: String) -> impl Fn(RepairProgress) {
    let last = std::sync::Mutex::new((std::time::Instant::now(), ""));
    move |update: RepairProgress| {
        let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
        if update.phase == last.1
            && last.0.elapsed() < std::time::Duration::from_millis(100)
            && update.total != Some(update.completed)
        {
            return;
        }
        *last = (std::time::Instant::now(), update.phase);
        let _ = app.emit(
            PROGRESS_EVENT,
            ProgressEvent {
                run_id: run_id.clone(),
                progress: update,
            },
        );
    }
}

#[tauri::command]
pub async fn preview_codex_repair(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    expected_provider: String,
    run_id: String,
) -> Result<RepairPreview, String> {
    let report = reporter(app, run_id);
    progress(&report, "waiting", 0, None, "steps", None);
    let _maintenance_guard = MAINTENANCE
        .try_lock()
        .map_err(|_| "已有 Codex 维护任务正在执行")?;
    let _switch_guard = state.proxy_service.lock_switch_for_app("codex").await;
    tauri::async_runtime::spawn_blocking(move || {
        let _history_guard = crate::codex_history_migration::lock_codex_official_history_op();
        let result = (|| {
            let config =
                crate::codex_config::read_codex_config_text().map_err(|e| e.to_string())?;
            validate_repair_target(&config, Some(&expected_provider))?;
            crate::codex_session_visibility::preview(
                &crate::codex_config::get_codex_config_dir(),
                &config,
                &report,
            )
        })();
        progress(
            &report,
            if result.is_ok() {
                "preview_done"
            } else {
                "failed"
            },
            0,
            None,
            "steps",
            None,
        );
        result
    })
    .await
    .map_err(|e| format!("预览修复失败：{e}"))?
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexMaintenanceAction {
    Restart,
    RepairAndRestart,
    CheckAndRestart,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMaintenanceStatus {
    supported: bool,
    app_name: String,
    repair_target: Option<String>,
    repair_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMaintenanceResult {
    restarted: bool,
    repair: Option<RepairReport>,
}

#[tauri::command]
pub fn get_codex_maintenance_status() -> CodexMaintenanceStatus {
    let target = crate::codex_config::read_codex_config_text()
        .map_err(|e| e.to_string())
        .and_then(|config| crate::codex_session_visibility::target_provider(&config));
    let (repair_target, repair_error) = match target {
        Ok(provider) => (Some(provider), None),
        Err(error) => (None, Some(error)),
    };
    CodexMaintenanceStatus {
        supported: cfg!(target_os = "macos"),
        app_name: "Codex".into(),
        repair_target,
        repair_error,
    }
}

#[tauri::command]
pub async fn run_codex_maintenance(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    action: CodexMaintenanceAction,
    expected_provider: Option<String>,
    run_id: String,
) -> Result<CodexMaintenanceResult, String> {
    let report = reporter(app, run_id);
    progress(&report, "waiting", 0, None, "steps", None);
    let _maintenance_guard = MAINTENANCE
        .try_lock()
        .map_err(|_| "已有 Codex 维护任务正在执行")?;
    let _switch_guard = state.proxy_service.lock_switch_for_app("codex").await;
    tauri::async_runtime::spawn_blocking(move || {
        let _history_guard = crate::codex_history_migration::lock_codex_official_history_op();
        let result = perform(action, expected_provider, &report);
        progress(
            &report,
            if result.is_ok() { "done" } else { "failed" },
            0,
            None,
            "steps",
            None,
        );
        result
    })
    .await
    .map_err(|e| format!("Codex 维护任务失败：{e}"))?
}

// Listing and deleting our own backups is available on every desktop platform.
// Share the maintenance lock so cleanup can never race a repair or its rollback.
#[tauri::command]
pub async fn get_codex_repair_backups(
) -> Result<crate::codex_visibility_backups::BackupInventory, String> {
    let _guard = MAINTENANCE
        .try_lock()
        .map_err(|_| "已有 Codex 维护任务正在执行")?;
    tauri::async_runtime::spawn_blocking(|| {
        crate::codex_visibility_backups::inventory(&crate::codex_visibility_backups::backup_root())
    })
    .await
    .map_err(|e| format!("读取修复备份失败：{e}"))?
}

#[tauri::command]
pub async fn cleanup_codex_repair_backups(
    expected_snapshot: String,
) -> Result<crate::codex_visibility_backups::CleanupReport, String> {
    let _guard = MAINTENANCE
        .try_lock()
        .map_err(|_| "已有 Codex 维护任务正在执行")?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::codex_visibility_backups::cleanup(
            &crate::codex_visibility_backups::backup_root(),
            &expected_snapshot,
        )
    })
    .await
    .map_err(|e| format!("清理修复备份失败：{e}"))?
}

fn validate_repair_target(config: &str, expected: Option<&str>) -> Result<(), String> {
    let provider = crate::codex_session_visibility::target_provider(config)?;
    if expected != Some(provider.as_str()) {
        return Err("当前生效的 Provider 与确认时不一致，请刷新弹窗后重新确认；未修复会话".into());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn perform(
    _action: CodexMaintenanceAction,
    _expected_provider: Option<String>,
    _reporter: ProgressReporter<'_>,
) -> Result<CodexMaintenanceResult, String> {
    Err("自动退出和重启 Codex 暂仅支持 macOS；未改动会话文件".into())
}

#[cfg(target_os = "macos")]
fn perform(
    action: CodexMaintenanceAction,
    expected_provider: Option<String>,
    report: ProgressReporter<'_>,
) -> Result<CodexMaintenanceResult, String> {
    maintenance_steps(
        action,
        || {
            let config =
                crate::codex_config::read_codex_config_text().map_err(|e| e.to_string())?;
            validate_repair_target(&config, expected_provider.as_deref())?;
            crate::codex_session_visibility::preview(
                &crate::codex_config::get_codex_config_dir(),
                &config,
                report,
            )
        },
        || {
            progress(report, "stopping", 0, None, "steps", None);
            // Registered bundle ID also handles builds called ChatGPT.app.
            let path = command(
                "/usr/bin/osascript",
                &[
                    "-e",
                    "POSIX path of (path to application id \"com.openai.codex\")",
                ],
            )?;
            if !std::path::Path::new(path.trim()).is_dir() {
                return Err("找不到 Codex 桌面应用，未修改会话".into());
            }
            stop_app()
        },
        || {
            // Re-read after exit in case the desktop flushed its settings.
            let config =
                crate::codex_config::read_codex_config_text().map_err(|e| e.to_string())?;
            validate_repair_target(&config, expected_provider.as_deref())?;
            crate::codex_session_visibility::repair_with_progress(
                &crate::codex_config::get_codex_config_dir(),
                &config,
                &crate::codex_visibility_backups::backup_root(),
                report,
            )
        },
        || {
            progress(report, "restarting", 0, None, "steps", None);
            start_app()
        },
    )
}

#[cfg(any(target_os = "macos", test))]
fn maintenance_steps(
    action: CodexMaintenanceAction,
    preview: impl FnOnce() -> Result<RepairPreview, String>,
    stop: impl FnOnce() -> Result<(), String>,
    repair_history: impl FnOnce() -> Result<RepairReport, String>,
    start: impl FnOnce() -> Result<(), String>,
) -> Result<CodexMaintenanceResult, String> {
    let plan = if matches!(
        action,
        CodexMaintenanceAction::RepairAndRestart | CodexMaintenanceAction::CheckAndRestart
    ) {
        Some(preview()?)
    } else {
        None
    };
    if matches!(action, CodexMaintenanceAction::RepairAndRestart)
        && plan.as_ref().is_some_and(|plan| !plan.needs_repair())
    {
        return Ok(CodexMaintenanceResult {
            restarted: false,
            repair: Some(plan.expect("repair preview is present").unchanged_report()),
        });
    }
    stop()?;
    let repair = match action {
        CodexMaintenanceAction::Restart => None,
        CodexMaintenanceAction::RepairAndRestart | CodexMaintenanceAction::CheckAndRestart => {
            Some(repair_history().map_err(|e| format!("{e}。Codex 保持关闭，未执行重启。"))?)
        }
    };
    start().map_err(|e| {
        format!(
            "{e}；请手动打开 Codex；会话修复结果：{}",
            serde_json::to_string(&repair).unwrap_or_default()
        )
    })?;
    Ok(CodexMaintenanceResult {
        restarted: true,
        repair,
    })
}

#[cfg(target_os = "macos")]
fn app_running() -> Result<bool, String> {
    command(
        "/usr/bin/osascript",
        &["-e", "application id \"com.openai.codex\" is running"],
    )
    .map(|v| v.trim() == "true")
}

#[cfg(target_os = "macos")]
fn wait_for_app(running: bool) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while app_running()? != running {
        if std::time::Instant::now() >= deadline {
            return Err(if running {
                "已发出启动请求，但未检测到 Codex 启动".into()
            } else {
                "Codex 未正常退出，已取消操作；不会强制终止任务或修改会话".into()
            });
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn stop_app() -> Result<(), String> {
    // Never terminate generic 'codex' processes: those include CLI sessions.
    if app_running()? {
        command("/usr/bin/osascript", &["-e", "with timeout of 15 seconds\n tell application id \"com.openai.codex\" to quit\nend timeout"])?;
    }
    wait_for_app(false)
}

#[cfg(target_os = "macos")]
fn start_app() -> Result<(), String> {
    command("/usr/bin/open", &["-b", "com.openai.codex"])?;
    // Launch Services accepting a request is not proof the app has launched.
    wait_for_app(true)
}

#[cfg(target_os = "macos")]
fn command(program: &str, args: &[&str]) -> Result<String, String> {
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!(
                    "系统操作失败（{}）：{}",
                    program,
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        if Instant::now() >= deadline {
            // Only stop our timed-out helper, never the desktop application.
            let _ = child.kill();
            let _ = child.wait();
            return Err("系统操作超时，已取消；请确认 Codex 已结束任务并允许正常退出".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn repair_target_must_match_the_confirmed_effective_provider() {
        assert!(validate_repair_target("model_provider = 'custom'", Some("custom")).is_ok());
        assert!(validate_repair_target("", Some("openai")).is_ok());
        assert!(validate_repair_target(
            "model_provider = 'cc-switch-official'",
            Some("cc-switch-official")
        )
        .is_ok());
        assert!(validate_repair_target("model_provider = 'custom'", None).is_err());
        assert!(validate_repair_target("model_provider = 'custom'", Some("openai")).is_err());
        assert!(validate_repair_target("profile = 'work'\nmodel_provider = 'custom'\n[profiles.work]\nmodel_provider = 'other'", Some("custom")).is_err());
    }

    #[test]
    fn restart_does_not_touch_history() {
        let calls = RefCell::new(Vec::new());
        let result = maintenance_steps(
            CodexMaintenanceAction::Restart,
            || panic!("Restart must not scan history"),
            || {
                calls.borrow_mut().push("stop");
                Ok(())
            },
            || panic!("Restart must never modify history"),
            || {
                calls.borrow_mut().push("start");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*calls.borrow(), vec!["stop", "start"]);
        assert!(result.restarted);
        assert!(result.repair.is_none());
    }

    #[test]
    fn repair_and_restart_is_ordered() {
        let calls = RefCell::new(Vec::new());
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || {
                calls.borrow_mut().push("preview");
                Ok(RepairPreview {
                    changed_files: 1,
                    ..Default::default()
                })
            },
            || {
                calls.borrow_mut().push("stop");
                Ok(())
            },
            || {
                calls.borrow_mut().push("repair");
                Ok(RepairReport::default())
            },
            || {
                calls.borrow_mut().push("start");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*calls.borrow(), vec!["preview", "stop", "repair", "start"]);
        assert!(result.restarted && result.repair.is_some());
    }

    #[test]
    fn no_changes_never_stops_repairs_or_restarts_codex() {
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || {
                Ok(RepairPreview {
                    provider: "custom".into(),
                    ..Default::default()
                })
            },
            || panic!("No-op must not quit"),
            || panic!("No-op must not write backups"),
            || panic!("No-op must not restart"),
        )
        .unwrap();
        assert!(!result.restarted);
        assert_eq!(result.repair.unwrap().provider, "custom");
    }
    #[test]
    fn check_and_restart_restarts_even_when_preview_has_no_changes() {
        let calls = RefCell::new(Vec::new());
        let result = maintenance_steps(
            CodexMaintenanceAction::CheckAndRestart,
            || {
                calls.borrow_mut().push("preview");
                Ok(RepairPreview {
                    provider: "custom".into(),
                    ..Default::default()
                })
            },
            || {
                calls.borrow_mut().push("stop");
                Ok(())
            },
            || {
                calls.borrow_mut().push("repair");
                Ok(RepairReport {
                    provider: "custom".into(),
                    ..Default::default()
                })
            },
            || {
                calls.borrow_mut().push("start");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*calls.borrow(), vec!["preview", "stop", "repair", "start"]);
        assert!(result.restarted);
        assert_eq!(result.repair.unwrap().provider, "custom");
    }

    #[test]
    fn repair_and_restart_still_skips_lifecycle_when_preview_has_no_changes() {
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || Ok(RepairPreview::default()),
            || panic!("manual no-op must not quit"),
            || panic!("manual no-op must not repair"),
            || panic!("manual no-op must not restart"),
        )
        .unwrap();
        assert!(!result.restarted);
    }

    #[test]
    fn scan_failure_never_closes_codex() {
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || Err("cannot read history".into()),
            || panic!("No stop on scan failure"),
            || panic!("No repair on scan failure"),
            || panic!("No restart on scan failure"),
        );
        assert_eq!(result.err().unwrap(), "cannot read history");
    }

    #[test]
    fn quit_failure_never_modifies_history_or_reopens() {
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || {
                Ok(RepairPreview {
                    changed_files: 1,
                    ..Default::default()
                })
            },
            || Err("quit failed".into()),
            || panic!("App has not exited"),
            || panic!("App has not exited"),
        );
        assert_eq!(result.err().unwrap(), "quit failed");
    }

    #[test]
    fn repair_failure_never_reopens() {
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || {
                Ok(RepairPreview {
                    changed_files: 1,
                    ..Default::default()
                })
            },
            || Ok(()),
            || Err("backup failed".into()),
            || panic!("Do not reopen after a failed repair"),
        );
        assert!(result.err().unwrap().contains("backup failed"));
    }

    #[test]
    fn launch_failure_retains_repair_backup_in_error() {
        let result = maintenance_steps(
            CodexMaintenanceAction::RepairAndRestart,
            || {
                Ok(RepairPreview {
                    changed_files: 1,
                    ..Default::default()
                })
            },
            || Ok(()),
            || {
                Ok(RepairReport {
                    backup_path: Some("/fixture/backups".into()),
                    ..Default::default()
                })
            },
            || Err("launch failed".into()),
        );
        let error = result.err().unwrap();
        assert!(error.contains("launch failed") && error.contains("/fixture/backups"));
    }
}
