//! Read the current Codex login in memory only. Never manage or refresh accounts.
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub struct NativeLogin {
    pub access_token: String,
    pub workspace: String,
    pub account_key: String,
    pub expired: bool,
}

// A workspace alone is not a user identity. Bind the catalog to both.
pub fn token_identity(token: &str) -> Result<(String, String, bool), String> {
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 || parts[0].is_empty() || parts[2].is_empty() {
        return Err("Codex 登录凭据格式无效，请在 Codex 中重新登录".into());
    }
    let value = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .ok_or("无法读取 Codex 登录信息，请在 Codex 中重新登录")?;
    let claims = &value["https://api.openai.com/auth"];
    let workspace = claims["chatgpt_account_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Codex 登录信息缺少 ChatGPT 工作区")?;
    let user = claims["chatgpt_user_id"]
        .as_str()
        .or_else(|| value["sub"].as_str())
        .filter(|s| !s.is_empty())
        .ok_or("Codex 登录信息缺少用户标识")?;
    let key = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(user, workspace)).unwrap())
    );
    let expired = value["exp"]
        .as_i64()
        .is_some_and(|exp| exp <= chrono::Utc::now().timestamp());
    Ok((workspace.into(), key, expired))
}

fn parse_login(text: &str) -> Result<Option<NativeLogin>, String> {
    let auth: Value =
        serde_json::from_str(text).map_err(|_| "Codex 登录文件格式无效，未读取任何模型")?;
    if auth["auth_mode"]
        .as_str()
        .is_some_and(|mode| mode != "chatgpt")
        || (auth["auth_mode"].is_null()
            && auth["OPENAI_API_KEY"]
                .as_str()
                .is_some_and(|key| !key.is_empty()))
    {
        return Ok(None);
    }
    let Some(token) = auth
        .pointer("/tokens/access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    else {
        return if auth.get("tokens").is_some_and(|v| !v.is_null()) {
            Err("Codex 登录凭据不完整，请打开 Codex 检查登录".into())
        } else {
            Ok(None)
        };
    };
    let (workspace, account_key, expired) = token_identity(token)?;
    if auth.pointer("/tokens/account_id").and_then(Value::as_str) != Some(workspace.as_str()) {
        return Err("Codex 登录凭据与工作区不一致，请重新登录".into());
    }
    Ok(Some(NativeLogin {
        access_token: token.into(),
        workspace,
        account_key,
        expired,
    }))
}

/// Prefer a ChatGPT login from the store Codex is configured to use, then the
/// other store. Takeover/API-key live files must not hide a still-valid login.
pub(crate) fn login_from_stores(
    preferred: Option<&str>,
    fallback: Option<&str>,
) -> Result<Option<NativeLogin>, String> {
    if let Some(text) = preferred {
        if let Some(login) = parse_login(text)? {
            return Ok(Some(login));
        }
    }
    if let Some(text) = fallback {
        return parse_login(text);
    }
    Ok(None)
}

async fn keyring_text() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // Codex scopes Keychain items by canonical CODEX_HOME. Never query the
        // service without its account: that can return another installation's login.
        let home = crate::codex_config::get_codex_config_dir();
        let canonical = home.canonicalize().map_err(|_| "无法定位 Codex 登录目录")?;
        let hash = format!(
            "{:x}",
            Sha256::digest(canonical.to_string_lossy().as_bytes())
        );
        let account = format!("cli|{}", &hash[..16]);
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(8),
            tokio::process::Command::new("/usr/bin/security")
                .args([
                    "find-generic-password",
                    "-s",
                    "Codex Auth",
                    "-a",
                    &account,
                    "-w",
                ])
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "读取 Codex 钥匙串超时，请检查系统授权后重试")?
        .map_err(|_| "无法读取 Codex 钥匙串，请检查系统授权")?;
        if output.status.code() == Some(44) {
            return Ok(None);
        }
        if !output.status.success() {
            return Err("Codex 钥匙串不可访问，请检查系统授权后重试".into());
        }
        return String::from_utf8(output.stdout)
            .map(Some)
            .map_err(|_| "Codex 钥匙串内容格式无效".into());
    }
    #[cfg(not(target_os = "macos"))]
    Err("当前平台暂不能读取 Codex 系统凭据库；不会把检测失败当作未登录。可在 Codex 配置中使用 file 凭据存储后重试".into())
}

async fn file_text() -> Result<Option<String>, String> {
    let path = crate::codex_config::get_codex_auth_path();
    match std::fs::metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法读取 Codex 登录文件，请检查文件权限".into()),
        Ok(meta) if meta.len() > 1024 * 1024 => Err("Codex 登录文件大小异常".into()),
        _ => std::fs::read_to_string(path)
            .map(Some)
            .map_err(|_| "无法读取 Codex 登录文件，请检查文件权限".into()),
    }
}

pub async fn read_login() -> Result<Option<NativeLogin>, String> {
    use crate::codex_config::{codex_config_auth_store_mode, CodexAuthStoreMode};
    let config = crate::codex_config::read_codex_config_text()
        .map_err(|_| "无法读取 Codex 配置，请检查文件权限")?;
    let mode = codex_config_auth_store_mode(&config);
    match mode {
        CodexAuthStoreMode::Ephemeral => {
            Err("Codex 使用进程内临时登录，CCS 无法读取；请使用持久化登录后重试".into())
        }
        CodexAuthStoreMode::Unknown => Err("Codex 凭据存储配置无效，无法检测登录状态".into()),
        CodexAuthStoreMode::Keyring | CodexAuthStoreMode::Auto => {
            let keyring = keyring_text().await?;
            let file = match file_text().await {
                Ok(text) => text,
                Err(error) if keyring.is_some() => {
                    log::warn!("Codex auth.json 不可读，继续使用钥匙串登录: {error}");
                    None
                }
                Err(error) => return Err(error),
            };
            login_from_stores(keyring.as_deref(), file.as_deref())
        }
        CodexAuthStoreMode::File => {
            let file = file_text().await?;
            let keyring = match keyring_text().await {
                Ok(text) => text,
                Err(error) => {
                    log::warn!("Codex 钥匙串不可读，继续使用登录文件: {error}");
                    None
                }
            };
            login_from_stores(file.as_deref(), keyring.as_deref())
        }
    }
}

#[cfg(test)]
pub(crate) fn test_token(user: &str, workspace: &str, exp: i64) -> String {
    let payload = serde_json::json!({"sub":user,"exp":exp,"https://api.openai.com/auth":{"chatgpt_account_id":workspace}});
    format!(
        "header.{}.signature",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identities_are_user_and_workspace_scoped_and_errors_never_echo_tokens() {
        let token = test_token("alice", "team", i64::MAX);
        let (_, key, expired) = token_identity(&token).unwrap();
        assert!(!expired);
        assert_ne!(
            key,
            token_identity(&test_token("bob", "team", i64::MAX))
                .unwrap()
                .1
        );
        assert_ne!(
            key,
            token_identity(&test_token("alice", "other", i64::MAX))
                .unwrap()
                .1
        );
        assert!(token_identity(&test_token("alice", "team", 1)).unwrap().2);
        assert!(!token_identity("private-secret")
            .unwrap_err()
            .contains("private-secret"));
        assert!(
            parse_login(r#"{"auth_mode":"apikey","OPENAI_API_KEY":"secret"}"#)
                .unwrap()
                .is_none()
        );
        assert!(parse_login(
            &serde_json::json!({"tokens":{"access_token":token,"account_id":"wrong"}}).to_string()
        )
        .is_err());
        let chatgpt = serde_json::json!({"auth_mode":"chatgpt","tokens":{"access_token":token,"account_id":"team"}}).to_string();
        let apikey = r#"{"auth_mode":"apikey","OPENAI_API_KEY":"secret"}"#;
        assert_eq!(
            login_from_stores(Some(apikey), Some(&chatgpt))
                .unwrap()
                .unwrap()
                .workspace,
            "team"
        );
        assert_eq!(
            login_from_stores(Some(&chatgpt), Some(apikey))
                .unwrap()
                .unwrap()
                .workspace,
            "team"
        );
        assert!(login_from_stores(Some(apikey), Some(apikey))
            .unwrap()
            .is_none());
    }
}
