//! Codex OAuth model list service.
//!
//! ChatGPT Codex exposes models through `chatgpt.com/backend-api/codex/models`,
//! which is not an OpenAI-compatible `/v1/models` endpoint.

use crate::proxy::providers::codex_oauth_auth::{
    CODEX_OAUTH_CLIENT_VERSION, CODEX_OAUTH_ORIGINATOR,
};
use crate::services::model_fetch::FetchedModel;
use serde_json::Value;
use std::time::Duration;

const CODEX_OAUTH_MODELS_URL: &str = "https://chatgpt.com/backend-api/codex/models";
const CODEX_OAUTH_FETCH_TIMEOUT_SECS: u64 = 15;
const ERROR_BODY_MAX_CHARS: usize = 512;

pub async fn fetch_models_with_token(
    token: &str,
    account_id: &str,
) -> Result<Vec<FetchedModel>, String> {
    let client = crate::proxy::http_client::get();
    let response = build_models_request(&client, token, account_id)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = truncate_body(response.text().await.unwrap_or_default());
        return Err(format!("HTTP {status}: {body}"));
    }

    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    Ok(parse_models(value))
}

/// Full native ModelInfo discovery for the current-login route. No custom URL,
/// redirect, response-body error, or fallback to API-key billing is allowed.
pub async fn fetch_native_catalog(
    token: &str,
    account_id: &str,
) -> Result<Value, NativeCatalogError> {
    let client = crate::proxy::http_client::get_without_redirects()
        .map_err(|_| NativeCatalogError::Other("无法创建官方目录连接，请检查代理配置".into()))?;
    let version = detected_native_client_version()
        .await
        .unwrap_or_else(|| CODEX_OAUTH_CLIENT_VERSION.into());
    let mut response = build_models_request_with_version(&client, token, account_id, &version)
        .send()
        .await
        .map_err(|_| NativeCatalogError::Other("获取官方模型超时或网络连接失败，请重试".into()))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(NativeCatalogError::LoginRequired);
    }
    if !status.is_success() {
        return Err(NativeCatalogError::Other(format!(
            "官方目录请求失败（HTTP {}），未替换已有目录",
            status.as_u16()
        )));
    }
    const LIMIT: usize = 16 * 1024 * 1024;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| NativeCatalogError::Other("官方目录接收中断，请重试".into()))?
    {
        if bytes.len() + chunk.len() > LIMIT {
            return Err(NativeCatalogError::Other("官方目录超过大小限制".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| NativeCatalogError::Other("官方目录格式无法解析，未替换已有目录".into()))
}

pub enum NativeCatalogError {
    LoginRequired,
    Other(String),
}

fn build_models_request(
    client: &reqwest::Client,
    token: &str,
    account_id: &str,
) -> reqwest::RequestBuilder {
    build_models_request_with_version(client, token, account_id, CODEX_OAUTH_CLIENT_VERSION)
}

fn build_models_request_with_version(
    client: &reqwest::Client,
    token: &str,
    account_id: &str,
    version: &str,
) -> reqwest::RequestBuilder {
    client
        .get(CODEX_OAUTH_MODELS_URL)
        .query(&[("client_version", version)])
        .header("Authorization", format!("Bearer {token}"))
        .header("originator", CODEX_OAUTH_ORIGINATOR)
        .header("version", version)
        .header("chatgpt-account-id", account_id)
        .timeout(Duration::from_secs(CODEX_OAUTH_FETCH_TIMEOUT_SECS))
}

// Query only --version, never auth/login or a model request. Keep model discovery
// compatible with the installed desktop/CLI rather than a frozen CCS version.
async fn detected_native_client_version() -> Option<String> {
    native_client_command().await.map(|(_, version)| version)
}

// Resolve desktop bundles without AppleScript's `path to application`: that can
// activate the GUI even though we only need its CLI, not the desktop login UI.
#[cfg(target_os = "macos")]
async fn desktop_app_bundles() -> Vec<std::path::PathBuf> {
    let mut bundles = Vec::new();
    let output = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new("/usr/bin/mdfind")
            .arg("kMDItemCFBundleIdentifier == 'com.openai.codex'")
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    if let Ok(Ok(output)) = output {
        if output.status.success() {
            if let Ok(paths) = String::from_utf8(output.stdout) {
                bundles.extend(
                    paths
                        .lines()
                        .filter(|path| !path.is_empty())
                        .map(std::path::PathBuf::from),
                );
            }
        }
    }
    // Spotlight may be disabled or have a stale index. GUI apps also usually
    // lack the shell PATH, so cover both names and per-user installations.
    for applications in [
        std::path::PathBuf::from("/Applications"),
        crate::config::get_home_dir().join("Applications"),
    ] {
        for name in ["ChatGPT.app", "Codex.app"] {
            let bundle = applications.join(name);
            if !bundles.contains(&bundle) {
                bundles.push(bundle);
            }
        }
    }
    bundles
}

#[cfg(any(target_os = "macos", test))]
fn desktop_cli_candidates(bundle: &std::path::Path) -> Vec<std::path::PathBuf> {
    // New desktop releases nest the CLI in codex-cli; older releases placed it
    // directly under Resources. Prefer the supported launcher when present.
    [
        "Contents/Resources/codex-cli/bin/codex",
        "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
        "Contents/Resources/codex",
    ]
    .into_iter()
    .map(|relative| bundle.join(relative))
    .filter(|path| path.is_file())
    .collect()
}

pub(crate) async fn native_client_command() -> Option<(std::path::PathBuf, String)> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    for bundle in desktop_app_bundles().await {
        candidates.extend(desktop_cli_candidates(&bundle));
    }
    candidates.extend(crate::codex_config::codex_cli_candidates());
    // Desktop discovery has its own two-second limit. Probe for at most another
    // three seconds, keeping the best completed result even if another CLI hangs.
    probe_native_client_candidates(candidates).await
}

async fn probe_native_client_candidates(
    candidates: Vec<std::path::PathBuf>,
) -> Option<(std::path::PathBuf, String)> {
    probe_native_client_candidates_with_budget(candidates, Duration::from_secs(3)).await
}

async fn probe_native_client_candidates_with_budget(
    candidates: Vec<std::path::PathBuf>,
    budget: Duration,
) -> Option<(std::path::PathBuf, String)> {
    use futures::StreamExt;
    use semver::Version;
    use std::collections::HashSet;

    let deadline = tokio::time::Instant::now() + budget;
    let mut seen = HashSet::new();
    let candidates = candidates
        .into_iter()
        .map(resolve_native_cli_path)
        .filter(|path| is_cli_executable(path) && seen.insert(path.clone()))
        .collect::<Vec<_>>();
    // Do not let candidate order or one slow installation hide a newer CLI.
    let probes = futures::stream::iter(candidates.into_iter().enumerate())
        .map(|(index, candidate)| async move {
            let mut command = tokio::process::Command::new(&candidate);
            command
                .arg("--version")
                .stdin(std::process::Stdio::null())
                .kill_on_drop(true);
            #[cfg(target_os = "windows")]
            command.creation_flags(0x08000000);
            let output = tokio::time::timeout(Duration::from_secs(2), command.output())
                .await
                .ok()?
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let text = parsed_client_version(&String::from_utf8_lossy(&output.stdout))?;
            let version = Version::parse(&text).ok()?;
            Some((index, candidate, version))
        })
        .buffer_unordered(8);
    futures::pin_mut!(probes);
    let mut selected: Option<(usize, std::path::PathBuf, Version)> = None;
    while let Ok(Some(result)) = tokio::time::timeout_at(deadline, probes.next()).await {
        let Some((index, path, version)) = result else {
            continue;
        };
        let preferred = selected.as_ref().is_none_or(|(old_index, _, old_version)| {
            // SemVer precedence compares numeric components and prereleases;
            // build metadata does not rank a release higher. Break true ties by
            // original candidate order, not whichever process finished first.
            version
                .cmp_precedence(old_version)
                .then_with(|| old_index.cmp(&index))
                .is_gt()
        });
        if preferred {
            selected = Some((index, path, version));
        }
    }
    selected.map(|(_, path, version)| (path, version.to_string()))
}

fn resolve_native_cli_path(candidate: std::path::PathBuf) -> std::path::PathBuf {
    if candidate.components().count() != 1 {
        return candidate;
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            let path = directory.join(&candidate);
            if is_cli_executable(&path) {
                return if path.is_absolute() {
                    path
                } else {
                    std::env::current_dir()
                        .map(|cwd| cwd.join(&path))
                        .unwrap_or(path)
                };
            }
            #[cfg(target_os = "windows")]
            for extension in ["exe", "cmd", "bat"] {
                let path = path.with_extension(extension);
                if path.is_file() {
                    return path;
                }
            }
        }
    }
    candidate
}

fn is_cli_executable(path: &std::path::Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn parsed_client_version(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|part| part.len() < 96 && semver::Version::parse(part).is_ok())
        .map(str::to_owned)
}

fn parse_models(value: Value) -> Vec<FetchedModel> {
    let entries = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .or_else(|| value.get("items").and_then(Value::as_array))
        .or_else(|| value.as_array());

    let mut models = Vec::new();

    if let Some(entries) = entries {
        for entry in entries {
            push_model_entry(&mut models, entry, None);
        }
    }

    if let Some(model_map) = value.get("models").and_then(Value::as_object) {
        for (key, entry) in model_map {
            push_model_entry(&mut models, entry, Some(key));
        }
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);
    models
}

fn push_model_entry(models: &mut Vec<FetchedModel>, entry: &Value, fallback_id: Option<&str>) {
    if let Some(id) = entry.as_str().map(str::trim).filter(|id| !id.is_empty()) {
        models.push(FetchedModel {
            id: id.to_string(),
            owned_by: Some("Codex".to_string()),
        });
        return;
    }

    let Some(obj) = entry.as_object() else {
        if let Some(id) = fallback_id.map(str::trim).filter(|id| !id.is_empty()) {
            models.push(FetchedModel {
                id: id.to_string(),
                owned_by: Some("Codex".to_string()),
            });
        }
        return;
    };

    let Some(id) = string_field(obj, &["slug", "id", "model", "name"]).or_else(|| {
        fallback_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
    }) else {
        return;
    };
    let owned_by = string_field(
        obj,
        &[
            "owned_by", "ownedBy", "provider", "vendor", "category", "owner",
        ],
    )
    .or_else(|| Some("Codex".to_string()));

    models.push(FetchedModel { id, owned_by });
}

fn string_field(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| obj.get(*key))
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn truncate_body(body: String) -> String {
    if body.chars().count() <= ERROR_BODY_MAX_CHARS {
        body
    } else {
        let mut s: String = body.chars().take(ERROR_BODY_MAX_CHARS).collect();
        s.push_str("...");
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[cfg(unix)]
    #[test]
    fn cli_path_lookup_rejects_non_executable_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("codex");
        assert!(!is_cli_executable(&path));
        std::fs::write(&path, "fixture").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!is_cli_executable(&path));
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(is_cli_executable(&path));
        assert!(!is_cli_executable(dir.path()));
        assert_eq!(resolve_native_cli_path(path.clone()), path);
    }

    #[test]
    fn desktop_cli_candidates_support_new_and_legacy_layouts() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("ChatGPT.app");
        assert!(desktop_cli_candidates(&bundle).is_empty());
        let legacy = bundle.join("Contents/Resources/codex");
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        std::fs::write(&legacy, "fixture").unwrap();
        assert_eq!(desktop_cli_candidates(&bundle), vec![legacy.clone()]);

        let native = bundle.join("Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex");
        std::fs::create_dir_all(native.parent().unwrap()).unwrap();
        std::fs::write(&native, "fixture").unwrap();
        assert_eq!(
            desktop_cli_candidates(&bundle),
            vec![native.clone(), legacy.clone()]
        );

        let launcher = bundle.join("Contents/Resources/codex-cli/bin/codex");
        std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        std::fs::write(&launcher, "fixture").unwrap();
        assert_eq!(
            desktop_cli_candidates(&bundle),
            vec![launcher, native, legacy]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_client_prefers_nested_desktop_cli_over_old_path_cli() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("ChatGPT.app");
        let desktop = bundle.join("Contents/Resources/codex-cli/bin/codex");
        let old_cli = dir.path().join("old-codex");
        for (path, version) in [(&desktop, "0.158.0-alpha.2.1"), (&old_cli, "0.128.0")] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                path,
                format!("#!/bin/sh\n[ \"$1\" = --version ] || exit 1\necho codex-cli {version}\n"),
            )
            .unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut candidates = desktop_cli_candidates(&bundle);
        candidates.push(old_cli.clone());
        let (path, version) = probe_native_client_candidates(candidates).await.unwrap();
        assert_eq!(path, desktop);
        assert_eq!(version, "0.158.0-alpha.2.1");

        // Missing/broken desktop installations still fall back to a CLI install.
        std::fs::write(&desktop, "#!/bin/sh\nexit 1\n").unwrap();
        let (path, version) = probe_native_client_candidates(vec![desktop, old_cli.clone()])
            .await
            .unwrap();
        assert_eq!(path, old_cli);
        assert_eq!(version, "0.128.0");
    }

    #[test]
    fn client_versions_accept_semver_and_reject_invalid_or_unsafe_tokens() {
        for version in ["0.158.0", "0.158.0-alpha.2.1", "1.10.0", "0.158.0+build.7"] {
            assert_eq!(
                parsed_client_version(&format!("codex-cli {version}")),
                Some(version.into())
            );
        }
        for output in [
            "not a version",
            "codex-cli 0.158",
            "codex-cli 0.158.0.1",
            "codex-cli 01.158.0",
            "codex-cli 0.158.0-alpha.01",
        ] {
            assert!(parsed_client_version(output).is_none());
        }
    }

    #[cfg(unix)]
    fn write_version_fixture(path: &std::path::Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            path,
            format!("#!/bin/sh\n[ \"$1\" = --version ] || exit 90\n{body}\n"),
        )
        .unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_client_selects_highest_version_regardless_of_installation_order() {
        let dir = tempfile::tempdir().unwrap();
        let desktop = dir
            .path()
            .join("ChatGPT App.app/Contents/Resources/codex-cli/bin/codex");
        let standalone = dir.path().join("standalone/codex");
        for (desktop_version, standalone_version, standalone_wins) in [
            ("0.128.0", "0.158.0", true),
            ("0.159.0", "0.158.0", false),
            ("0.158.0-alpha.2.1", "0.158.0", true),
            ("0.158.0", "0.158.0-alpha.2.1", false),
            ("0.158.0", "0.159.0-alpha.1", true),
            ("0.9.0", "0.10.0", true),
            ("0.158.0-alpha.2.1", "0.158.0-alpha.10.1", true),
        ] {
            write_version_fixture(&desktop, &format!("echo codex-cli {desktop_version}"));
            write_version_fixture(&standalone, &format!("echo codex-cli {standalone_version}"));
            for reverse in [false, true] {
                let mut candidates = vec![desktop.clone(), standalone.clone()];
                if reverse {
                    candidates.reverse();
                }
                let (path, version) = probe_native_client_candidates(candidates).await.unwrap();
                let (expected_path, expected_version) = if standalone_wins {
                    (&standalone, standalone_version)
                } else {
                    (&desktop, desktop_version)
                };
                assert_eq!(
                    &path, expected_path,
                    "{desktop_version} vs {standalone_version}"
                );
                assert_eq!(version, expected_version);
            }
        }
        // Either installation remains sufficient on its own.
        for path in [desktop, standalone] {
            assert_eq!(
                probe_native_client_candidates(vec![path.clone()])
                    .await
                    .unwrap()
                    .0,
                path
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn equal_precedence_keeps_candidate_order_not_probe_completion_order() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first-codex");
        let second = dir.path().join("second-codex");
        for (first_version, second_version) in [
            ("0.158.0", "0.158.0"),
            ("0.158.0+build.1", "0.158.0+build.99"),
        ] {
            write_version_fixture(
                &first,
                &format!("sleep 0.08; echo codex-cli {first_version}"),
            );
            write_version_fixture(&second, &format!("echo codex-cli {second_version}"));
            let selected = probe_native_client_candidates(vec![first.clone(), second.clone()])
                .await
                .unwrap();
            assert_eq!(selected, (first.clone(), first_version.into()));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn slow_or_invalid_candidates_do_not_discard_a_usable_cli() {
        let dir = tempfile::tempdir().unwrap();
        let slow = dir.path().join("slow-codex");
        let invalid = dir.path().join("invalid-codex");
        let usable = dir.path().join("usable-codex");
        write_version_fixture(&slow, "exec /bin/sleep 30");
        write_version_fixture(&invalid, "echo not-a-version");
        write_version_fixture(&usable, "echo codex-cli 0.158.0");
        let selected = tokio::time::timeout(
            Duration::from_secs(3),
            probe_native_client_candidates_with_budget(
                vec![slow, invalid, usable.clone()],
                Duration::from_millis(500),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(selected, (usable, "0.158.0".into()));
        assert!(probe_native_client_candidates(Vec::new()).await.is_none());
    }

    #[test]
    fn codex_oauth_model_discovery_uses_gpt6_compatible_identity() {
        let request = build_models_request(&reqwest::Client::new(), "test-token", "test-account")
            .build()
            .unwrap();
        assert_eq!(request.headers()["authorization"], "Bearer test-token");
        assert_eq!(request.headers()["chatgpt-account-id"], "test-account");
        assert_eq!(request.headers()["originator"], "codex_cli_rs");
        let version = request
            .url()
            .query_pairs()
            .find(|(key, _)| key == "client_version")
            .unwrap()
            .1
            .into_owned();
        let parts: Vec<u32> = version
            .split('.')
            .map(|part| part.parse().unwrap())
            .collect();
        // Sol and Luna are absent from the 0.153.4 catalog for this account.
        assert!(parts.as_slice() >= [0, 155, 0].as_slice());
        assert_eq!(request.headers()["version"], version);
        let models = parse_models(json!({"models": [
            {"slug": "gpt-6-sol", "minimal_client_version": "0.155.0"},
            {"slug": "gpt-6-luna", "minimal_client_version": "0.155.0"}
        ]}));
        assert_eq!(models[0].id, "gpt-6-luna");
        assert_eq!(models[1].id, "gpt-6-sol");
    }

    #[test]
    fn native_discovery_uses_detected_version_without_changing_managed_accounts() {
        let version = parsed_client_version("codex-cli 0.155.0-alpha.9.2\n").unwrap();
        let request = build_models_request_with_version(
            &reqwest::Client::new(),
            "fixture",
            "workspace",
            &version,
        )
        .build()
        .unwrap();
        assert_eq!(request.headers()["version"], version);
        assert_eq!(request.url().host_str(), Some("chatgpt.com"));
        assert!(request
            .url()
            .query_pairs()
            .any(|(key, value)| key == "client_version" && value == version));
        assert!(parsed_client_version("error loading executable").is_none());
    }

    #[test]
    fn parse_codex_oauth_models_accepts_openai_style_data() {
        let models = parse_models(json!({
            "data": [
                { "id": "gpt-5.4", "owned_by": "openai" },
                { "id": "gpt-5.4-mini", "ownedBy": "openai" }
            ]
        }));

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-5.4");
        assert_eq!(models[0].owned_by.as_deref(), Some("openai"));
        assert_eq!(models[1].id, "gpt-5.4-mini");
        assert_eq!(models[1].owned_by.as_deref(), Some("openai"));
    }

    #[test]
    fn parse_codex_oauth_models_accepts_model_list_shape() {
        let models = parse_models(json!({
            "models": [
                { "slug": "gpt-5.3-codex", "display_name": "GPT-5.3 Codex" },
                "gpt-5.5"
            ]
        }));

        assert_eq!(
            models.into_iter().map(|model| model.id).collect::<Vec<_>>(),
            vec!["gpt-5.3-codex".to_string(), "gpt-5.5".to_string()]
        );
    }

    #[test]
    fn parse_codex_oauth_models_deduplicates_ids() {
        let models = parse_models(json!({
            "data": [
                { "id": "gpt-5.4" },
                { "model": "gpt-5.4" }
            ]
        }));

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.4");
    }

    #[test]
    fn parse_codex_oauth_models_accepts_model_map_shape() {
        let models = parse_models(json!({
            "models": {
                "gpt-5.4": { "display_name": "GPT-5.4" },
                "gpt-5.5": { "slug": "gpt-5.5" }
            }
        }));

        assert_eq!(
            models.into_iter().map(|model| model.id).collect::<Vec<_>>(),
            vec!["gpt-5.4".to_string(), "gpt-5.5".to_string()]
        );
    }
}
