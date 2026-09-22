//! Delegate native login to the installed official CLI. No tokens pass through IPC.
use std::{process::Stdio, time::Duration};
use tokio::sync::Mutex;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
}
struct LoginRun {
    state: LoginStatus,
    task: tokio::task::JoinHandle<()>,
}
static LOGIN: Mutex<Option<LoginRun>> = Mutex::const_new(None);

pub async fn start(app: tauri::AppHandle) -> Result<LoginStatus, String> {
    let mut slot = LOGIN.lock().await;
    if let Some(run) = slot.as_ref().filter(|run| run.state.status == "waiting") {
        return Ok(run.state.clone());
    }
    let (path, _) = crate::services::codex_oauth_models::native_client_command()
        .await
        .ok_or("未找到可用的 Codex CLI，请安装 Codex 桌面应用或 CLI 后重试")?;
    let home = crate::codex_config::get_codex_config_dir();
    let config =
        crate::codex_config::read_codex_config_text().map_err(|_| "无法读取 Codex 配置")?;
    use crate::codex_config::{codex_config_auth_store_mode, CodexAuthStoreMode};
    if matches!(
        codex_config_auth_store_mode(&config),
        CodexAuthStoreMode::Ephemeral | CodexAuthStoreMode::Unknown
    ) {
        return Err("当前凭据存储配置不能保存持久登录，请检查 Codex 配置后重试".into());
    }
    // Bare `login` opens ChatGPT browser OAuth even when the configured provider
    // is a relay. Never pass --with-api-key, override policy, or rewrite config.
    let mut command = tokio::process::Command::new(path);
    command
        .arg("login")
        .env("CODEX_HOME", &home)
        .current_dir(&home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let child = command
        .spawn()
        .map_err(|_| "无法启动 Codex 登录，请确认客户端安装及目录权限")?;
    Ok(launch(
        &mut slot,
        child,
        Duration::from_secs(600),
        move || {
            // Native completion, not a webview timer: background browsers can throttle
            // renderer polling. Only the matching, successful login raises our window.
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                use tauri::Manager;
                if let Some(window) = handle.get_webview_window("main") {
                    #[cfg(target_os = "macos")]
                    crate::tray::apply_tray_policy(&handle, true);
                    #[cfg(target_os = "windows")]
                    let _ = window.set_skip_taskbar(false);
                    let _ = window.unminimize();
                    let _ = window.show();
                    if let Err(error) = window.set_focus() {
                        log::warn!(
                            "Codex login succeeded, but restoring CC Switch focus failed: {error}"
                        );
                    }
                    #[cfg(target_os = "linux")]
                    crate::linux_fix::nudge_main_window(window);
                }
            }) {
                log::warn!("Codex login succeeded, but scheduling CC Switch focus failed: {error}");
            }
        },
    ))
}

fn launch(
    slot: &mut Option<LoginRun>,
    child: tokio::process::Child,
    timeout: Duration,
    on_success: impl FnOnce() + Send + 'static,
) -> LoginStatus {
    let id = uuid::Uuid::new_v4().to_string();
    let state = LoginStatus {
        id: id.clone(),
        status: "waiting".into(),
        error: None,
    };
    let task = tokio::spawn(async move {
        let mut child = child;
        let result = tokio::time::timeout(timeout, child.wait()).await;
        let (status, error) = match result {
            Ok(Ok(exit)) if exit.success() => ("succeeded", None),
            Ok(_) => ("failed", Some("Codex 登录未完成，请检查浏览器授权、登录策略或回调端口占用；也可在终端运行 codex login".into())),
            Err(_) => { let _ = child.kill().await; ("failed", Some("登录等待超时，请重试".into())) },
        };
        let should_return = {
            let mut slot = LOGIN.lock().await;
            if let Some(run) = slot
                .as_mut()
                .filter(|run| run.state.id == id && run.state.status == "waiting")
            {
                run.state.status = status.into();
                run.state.error = error;
                status == "succeeded"
            } else {
                false
            }
        };
        if should_return {
            on_success();
        }
    });
    *slot = Some(LoginRun {
        state: state.clone(),
        task,
    });
    state
}

pub async fn status(id: &str) -> Result<LoginStatus, String> {
    LOGIN
        .lock()
        .await
        .as_ref()
        .filter(|run| run.state.id == id)
        .map(|run| run.state.clone())
        .ok_or_else(|| "登录流程已失效，请重试".into())
}

pub async fn cancel(id: &str) -> Result<(), String> {
    let mut slot = LOGIN.lock().await;
    if let Some(run) = slot
        .as_mut()
        .filter(|run| run.state.id == id && run.state.status == "waiting")
    {
        run.task.abort(); // dropping the owned child kills this login process only
        let _ = (&mut run.task).await;
        run.state.status = "cancelled".into();
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    static RETURNS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    async fn fixture(program: &str, args: &[&str], timeout: Duration) -> LoginStatus {
        let child = tokio::process::Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        launch(&mut *LOGIN.lock().await, child, timeout, || {
            RETURNS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
    }
    async fn finished(id: &str) -> LoginStatus {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let state = status(id).await.unwrap();
                if state.status != "waiting" {
                    return state;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }
    #[tokio::test]
    async fn native_login_lifecycle_is_bounded_cancellable_and_id_scoped() {
        // Fixture-only local commands: never invoke Codex or read actual credentials.
        let success = fixture("/usr/bin/true", &[], Duration::from_secs(1)).await;
        assert_eq!(finished(&success.id).await.status, "succeeded");
        let failure = fixture("/usr/bin/false", &[], Duration::from_secs(1)).await;
        assert_eq!(finished(&failure.id).await.status, "failed");
        assert!(status(&success.id).await.is_err());
        let timeout = fixture("/bin/sleep", &["10"], Duration::from_millis(20)).await;
        assert_eq!(
            finished(&timeout.id).await.error.as_deref(),
            Some("登录等待超时，请重试")
        );
        let pending = fixture("/bin/sleep", &["10"], Duration::from_secs(10)).await;
        cancel(&timeout.id).await.unwrap();
        assert_eq!(status(&pending.id).await.unwrap().status, "waiting");
        cancel(&pending.id).await.unwrap();
        assert_eq!(status(&pending.id).await.unwrap().status, "cancelled");
        // One successful flow restores the app exactly once. Polls, failed,
        // timed-out and cancelled flows must not steal focus.
        assert_eq!(RETURNS.load(std::sync::atomic::Ordering::SeqCst), 1);
        *LOGIN.lock().await = None;
    }
}
