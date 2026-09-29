//! Delegate native login to the installed official CLI. No tokens pass through IPC.
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, sync::Mutex};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
    pub error_code: Option<LoginErrorCode>,
    pub cli: Option<LoginCli>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginCli {
    pub path: String,
    pub version: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoginErrorCode {
    CliNotFound,
    ConfigInvalid,
    ConfigIncompatible,
    StorageUnsupported,
    LaunchFailed,
    PortInUse,
    PolicyRestricted,
    Network,
    Timeout,
    ProcessFailed,
    Unknown,
}

impl LoginErrorCode {
    // Never expose raw CLI output: it may contain credentials or OAuth URLs.
    fn message(self) -> &'static str {
        match self {
            Self::CliNotFound => {
                "未找到可用的 Codex CLI，请安装或更新 CLI / 含 CLI 的桌面客户端后重试"
            }
            Self::ConfigInvalid => "Codex 配置无法读取或解析，请检查配置文件格式、路径及权限",
            Self::ConfigIncompatible => {
                "当前 Codex CLI 不支持配置中的字段或参数，请更新实际调用的 CLI 后重试"
            }
            Self::StorageUnsupported => {
                "当前凭据存储方式不支持持久登录，请检查 cli_auth_credentials_store 配置"
            }
            Self::LaunchFailed => "无法启动 Codex CLI，请检查程序和配置目录是否存在、权限是否正常",
            Self::PortInUse => "Codex 登录回调端口被占用，请结束其他正在进行的 Codex 登录后重试",
            Self::PolicyRestricted => "Codex 登录受到策略限制，请检查强制登录方式或联系管理员",
            Self::Network => "Codex 登录连接失败，请检查网络、代理或系统证书后重试",
            Self::Timeout => "等待浏览器授权已超时，请重新登录并在 10 分钟内完成授权",
            Self::ProcessFailed => "无法获取 Codex 登录进程的结果，请重试",
            Self::Unknown => {
                "Codex 登录未完成，尚未识别具体原因；可在终端运行相同 CLI 的 login 命令排查"
            }
        }
    }
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
    let Some((path, version)) = crate::services::codex_oauth_models::native_client_command().await
    else {
        return Ok(failed_start(&mut slot, None, LoginErrorCode::CliNotFound));
    };
    let cli = LoginCli {
        path: path.to_string_lossy().into_owned(),
        version,
    };
    let home = crate::codex_config::get_codex_config_dir();
    let config = match crate::codex_config::read_codex_config_text() {
        Ok(config) => config,
        Err(_) => {
            return Ok(failed_start(
                &mut slot,
                Some(cli),
                LoginErrorCode::ConfigInvalid,
            ))
        }
    };
    use crate::codex_config::{codex_config_auth_store_mode, CodexAuthStoreMode};
    if matches!(
        codex_config_auth_store_mode(&config),
        CodexAuthStoreMode::Ephemeral | CodexAuthStoreMode::Unknown
    ) {
        return Ok(failed_start(
            &mut slot,
            Some(cli),
            LoginErrorCode::StorageUnsupported,
        ));
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
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            return Ok(failed_start(
                &mut slot,
                Some(cli),
                LoginErrorCode::LaunchFailed,
            ))
        }
    };
    Ok(launch(
        &mut slot,
        child,
        Duration::from_secs(600),
        Some(cli),
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

// Drain stderr concurrently so a verbose CLI cannot fill its pipe and deadlock.
// Keep only a bounded prefix for classification; never expose raw diagnostics,
// OAuth URLs, credentials, or config contents through IPC or logs.
async fn read_login_stderr(stderr: Option<tokio::process::ChildStderr>) -> Vec<u8> {
    const LIMIT: usize = 16 * 1024;
    let Some(mut stderr) = stderr else {
        return Vec::new();
    };
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match stderr.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(len) => {
                let keep = len.min(LIMIT - captured.len());
                captured.extend_from_slice(&buffer[..keep]);
            }
        }
    }
    captured
}

fn classify_login_failure(stderr: &[u8]) -> LoginErrorCode {
    let diagnostic = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if diagnostic.contains("error loading configuration") {
        return if diagnostic.contains("unknown variant") || diagnostic.contains("unknown field") {
            LoginErrorCode::ConfigIncompatible
        } else {
            LoginErrorCode::ConfigInvalid
        };
    }
    if [
        "address already in use",
        "os error 48",
        "os error 98",
        "os error 10048",
    ]
    .iter()
    .any(|pattern| diagnostic.contains(pattern))
    {
        LoginErrorCode::PortInUse
    } else if [
        "forced_login_method",
        "login is restricted",
        "disabled by policy",
        "only api key login is allowed",
        "only chatgpt login is allowed",
    ]
    .iter()
    .any(|pattern| diagnostic.contains(pattern))
    {
        LoginErrorCode::PolicyRestricted
    } else if [
        "error sending request",
        "connection refused",
        "dns error",
        "certificate verify failed",
        "invalid peer certificate",
        "connection timed out",
    ]
    .iter()
    .any(|pattern| diagnostic.contains(pattern))
    {
        LoginErrorCode::Network
    } else {
        LoginErrorCode::Unknown
    }
}

fn failed_start(
    slot: &mut Option<LoginRun>,
    cli: Option<LoginCli>,
    code: LoginErrorCode,
) -> LoginStatus {
    let state = LoginStatus {
        id: uuid::Uuid::new_v4().to_string(),
        status: "failed".into(),
        error: Some(code.message().into()),
        error_code: Some(code),
        cli,
    };
    *slot = Some(LoginRun {
        state: state.clone(),
        task: tokio::spawn(async {}),
    });
    state
}

fn launch(
    slot: &mut Option<LoginRun>,
    child: tokio::process::Child,
    timeout: Duration,
    cli: Option<LoginCli>,
    on_success: impl FnOnce() + Send + 'static,
) -> LoginStatus {
    let id = uuid::Uuid::new_v4().to_string();
    let state = LoginStatus {
        id: id.clone(),
        status: "waiting".into(),
        error: None,
        error_code: None,
        cli,
    };
    let task = tokio::spawn(async move {
        let mut child = child;
        let stderr = child.stderr.take();
        let result = tokio::time::timeout(timeout, async {
            tokio::join!(child.wait(), read_login_stderr(stderr))
        })
        .await;
        let code = match result {
            Ok((Ok(exit), _)) if exit.success() => None,
            Ok((Ok(_), stderr)) => Some(classify_login_failure(&stderr)),
            Ok((Err(_), _)) => Some(LoginErrorCode::ProcessFailed),
            Err(_) => {
                let _ = child.kill().await;
                Some(LoginErrorCode::Timeout)
            }
        };
        let should_return = {
            let mut slot = LOGIN.lock().await;
            if let Some(run) = slot
                .as_mut()
                .filter(|run| run.state.id == id && run.state.status == "waiting")
            {
                run.state.status = if code.is_none() {
                    "succeeded"
                } else {
                    "failed"
                }
                .into();
                run.state.error = code.map(|code| code.message().into());
                run.state.error_code = code;
                code.is_none()
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
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        launch(&mut *LOGIN.lock().await, child, timeout, None, || {
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
    #[test]
    fn login_diagnostics_are_specific_without_exposing_secrets() {
        for (diagnostic, expected) in [
            (
                "Error loading configuration: unknown variant `max`, expected high",
                LoginErrorCode::ConfigIncompatible,
            ),
            (
                "Error loading configuration: unknown field `future_option`",
                LoginErrorCode::ConfigIncompatible,
            ),
            (
                "Error loading configuration: TOML parse error",
                LoginErrorCode::ConfigInvalid,
            ),
            (
                "Error loading configuration: permission denied",
                LoginErrorCode::ConfigInvalid,
            ),
            ("Address already in use", LoginErrorCode::PortInUse),
            ("os error 48", LoginErrorCode::PortInUse),
            ("os error 98", LoginErrorCode::PortInUse),
            ("os error 10048", LoginErrorCode::PortInUse),
            (
                "forced_login_method only permits API keys",
                LoginErrorCode::PolicyRestricted,
            ),
            ("error sending request", LoginErrorCode::Network),
            ("connection refused", LoginErrorCode::Network),
            (
                "https://auth.openai.com/?code=secret-token",
                LoginErrorCode::Unknown,
            ),
        ] {
            let code = classify_login_failure(format!("{diagnostic} secret-token").as_bytes());
            assert_eq!(code, expected);
            assert!(!code.message().contains("secret-token"));
            assert!(!code.message().contains("https://"));
        }
    }

    #[tokio::test]
    async fn startup_failure_is_structured_and_keeps_selected_cli() {
        let mut slot = None;
        let cli = LoginCli {
            path: "/fixture/codex".into(),
            version: "0.128.0".into(),
        };
        let state = failed_start(&mut slot, Some(cli), LoginErrorCode::LaunchFailed);
        assert_eq!(state.status, "failed");
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["errorCode"], "launchFailed");
        assert_eq!(json["cli"]["path"], "/fixture/codex");
        assert_eq!(json["cli"]["version"], "0.128.0");
        assert_eq!(slot.unwrap().state.id, state.id);
    }

    #[tokio::test]
    async fn login_stderr_is_bounded_and_drained() {
        let mut child = tokio::process::Command::new("/bin/sh")
            .args(["-c", "head -c 131072 /dev/zero >&2"])
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stderr = child.stderr.take();
        let (exit, captured) = tokio::time::timeout(Duration::from_secs(3), async {
            tokio::join!(child.wait(), read_login_stderr(stderr))
        })
        .await
        .unwrap();
        assert!(exit.unwrap().success());
        assert_eq!(captured.len(), 16 * 1024);
    }

    #[tokio::test]
    async fn native_login_lifecycle_is_bounded_cancellable_and_id_scoped() {
        // Fixture-only local commands: never invoke Codex or read actual credentials.
        let success = fixture("/usr/bin/true", &[], Duration::from_secs(1)).await;
        assert_eq!(finished(&success.id).await.status, "succeeded");
        let failure = fixture("/usr/bin/false", &[], Duration::from_secs(1)).await;
        assert_eq!(finished(&failure.id).await.status, "failed");
        assert!(status(&success.id).await.is_err());
        let incompatible = fixture(
            "/bin/sh",
            &[
                "-c",
                "echo 'Error loading configuration: unknown variant max' >&2; exit 1",
            ],
            Duration::from_secs(1),
        )
        .await;
        let result = finished(&incompatible.id).await;
        assert_eq!(result.status, "failed");
        assert_eq!(result.error_code, Some(LoginErrorCode::ConfigIncompatible));

        let timeout = fixture("/bin/sleep", &["10"], Duration::from_millis(20)).await;
        assert_eq!(
            finished(&timeout.id).await.error.as_deref(),
            Some(LoginErrorCode::Timeout.message())
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
