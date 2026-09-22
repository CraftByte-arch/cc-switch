//! Current-login discovery. Only verified official responses enter this cache.
//! Candidate refresh never replaces the snapshot saved in the active route config.
use crate::{database::Database, error::AppError, provider::Provider};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub const PROVIDER_ID: &str = "cc-switch-current-codex-login";
const CATALOG_KEY: &str = "codex_native_route_catalog_v2";
const REFRESH_SECONDS: i64 = 3600;
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeCatalog {
    pub account_key: String,
    pub synced_at: i64,
    pub models: Vec<Value>,
    #[serde(default)]
    pub requires_revalidation: bool,
}
impl NativeCatalog {
    pub fn revision(&self) -> String {
        // A successful refresh without content changes should not dirty the form.
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(&self.account_key, &self.models)).unwrap())
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRoutingStatus {
    pub status: &'static str,
    pub provider: Option<Provider>,
    pub synced_at: Option<i64>,
    pub catalog_revision: Option<String>,
    pub cached: bool,
    pub error: Option<String>,
}
impl NativeRoutingStatus {
    fn empty(status: &'static str, error: Option<String>) -> Self {
        Self {
            status,
            provider: None,
            synced_at: None,
            catalog_revision: None,
            cached: false,
            error,
        }
    }
    fn ready(catalog: &NativeCatalog, error: Option<String>) -> Self {
        Self {
            status: "ready",
            provider: Some(from_catalog(catalog)),
            synced_at: Some(catalog.synced_at),
            catalog_revision: Some(catalog.revision()),
            cached: error.is_some(),
            error,
        }
    }
}

pub fn parse_official_models(value: Value) -> Result<Vec<Value>, String> {
    let rows = value
        .get("models")
        .or_else(|| value.get("data"))
        .and_then(Value::as_array)
        .ok_or("官方未返回可识别的完整模型目录，未替换已有目录")?;
    let mut seen = std::collections::HashSet::new();
    let models: Vec<_> = rows
        .iter()
        .filter(|entry| {
            entry["slug"].as_str().is_some_and(|slug| {
                !slug.is_empty()
                    && !slug.contains('@')
                    && !slug.chars().any(char::is_whitespace)
                    && entry["visibility"].as_str() != Some("hide")
                    && seen.insert(slug.to_owned())
            })
        })
        .cloned()
        .collect();
    if models.is_empty() {
        return Err("官方未返回可选模型，未替换已有目录；请确认账号权限后重试".into());
    }
    Ok(models)
}

/// Validation-only stand-in. Login expiry must not delete saved official
/// selections or make an unrelated provider edit fail.
pub fn placeholder_for_saved_models(models: &[String]) -> Provider {
    from_catalog(&NativeCatalog {
        account_key: String::new(),
        synced_at: 0,
        requires_revalidation: true,
        models: models
            .iter()
            .map(|model| json!({ "slug": model, "display_name": model }))
            .collect(),
    })
}

pub fn from_catalog(catalog: &NativeCatalog) -> Provider {
    let rows: Vec<Value> = catalog.models.iter().map(|entry| json!({
        "model": entry["slug"], "displayName": friendly_name(entry["display_name"].as_str().unwrap_or_else(|| entry["slug"].as_str().unwrap_or(""))),
        "contextWindow": entry["context_window"], "inputModalities": entry["input_modalities"],
        "reasoningLevels": entry["supported_reasoning_levels"].as_array().map(|levels|
            levels.iter().filter_map(|level| level["effort"].as_str()).collect::<Vec<_>>()),
        "defaultReasoningLevel": entry["default_reasoning_level"],
    })).collect();
    let name = match crate::settings::get_settings().language.as_deref() {
        Some("zh") => "官方订阅",
        Some("zh-TW") => "官方訂閱",
        Some("ja") => "公式サブスクリプション",
        _ => "Official subscription",
    };
    let mut provider = Provider::with_id(
        PROVIDER_ID.into(),
        name.into(),
        json!({"auth":{},"config":"",
        "modelCatalog":{"models":rows},"nativeCatalog":{"models":catalog.models},
        "nativeAccountKey":catalog.account_key}),
        None,
    );
    provider.category = Some("official".into());
    provider
}

/// Match Codex's short GPT labels, before adding a user-selected prefix.
/// Non-GPT names are left alone; do not normalize user labels on relay routes.
pub fn friendly_name(name: &str) -> String {
    let trimmed = name.trim();
    let Some(rest) = trimmed
        .get(..4)
        .filter(|prefix| prefix.eq_ignore_ascii_case("gpt-"))
        .and_then(|_| trimmed.get(4..))
    else {
        return trimmed.into();
    };
    if !rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return trimmed.into();
    }
    rest.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn cached_catalog(db: &Database) -> Result<Option<NativeCatalog>, AppError> {
    db.get_setting(CATALOG_KEY)?
        .map(|text| {
            serde_json::from_str(&text)
                .map_err(|_| AppError::Config("已保存的官方目录损坏，请刷新官方模型".into()))
        })
        .transpose()
}

pub fn providers_for_config(
    db: &Database,
    config: &super::codex_model_routing::CodexModelRoutingConfig,
) -> Result<IndexMap<String, Provider>, AppError> {
    let mut providers = db.get_all_providers("codex")?;
    if let Some(catalog) = &config.native_catalog {
        providers.insert(PROVIDER_ID.into(), from_catalog(catalog));
    }
    Ok(providers)
}

pub fn catalog(provider: &Provider) -> Option<Value> {
    (provider.id == PROVIDER_ID).then(|| provider.settings_config["nativeCatalog"].clone())
}

type LoginFuture = std::pin::Pin<
    Box<
        dyn std::future::Future<
                Output = Result<Option<super::codex_native_auth::NativeLogin>, String>,
            > + Send,
    >,
>;
type CatalogFuture<'a> = std::pin::Pin<
    Box<
        dyn std::future::Future<
                Output = Result<Value, crate::services::codex_oauth_models::NativeCatalogError>,
            > + Send
            + 'a,
    >,
>;

pub async fn sync(db: Arc<Database>, force: bool) -> Result<NativeRoutingStatus, String> {
    let _guard = SYNC_LOCK.lock().await;
    sync_with(
        db,
        force,
        || Box::pin(super::codex_native_auth::read_login()),
        |login| {
            Box::pin(crate::services::codex_oauth_models::fetch_native_catalog(
                &login.access_token,
                &login.workspace,
            ))
        },
    )
    .await
}

async fn sync_with(
    db: Arc<Database>,
    force: bool,
    read: impl Fn() -> LoginFuture,
    fetch: impl for<'a> FnOnce(&'a super::codex_native_auth::NativeLogin) -> CatalogFuture<'a>,
) -> Result<NativeRoutingStatus, String> {
    let login = match read().await {
        Ok(Some(login)) if !login.expired => login,
        Ok(Some(_)) => {
            return Ok(NativeRoutingStatus::empty(
                "loginRequired",
                Some("登录凭据已过期，请打开 Codex 刷新登录后重新检测".into()),
            ))
        }
        Ok(None) => return Ok(NativeRoutingStatus::empty("signedOut", None)),
        Err(error) => return Ok(NativeRoutingStatus::empty("unavailable", Some(error))),
    };
    // Never adopt legacy/unattributed models_cache.json or v1 candidates.
    let cached = cached_catalog(&db)
        .ok()
        .flatten()
        .filter(|cache| cache.account_key == login.account_key);
    let now = chrono::Utc::now().timestamp();
    if !force {
        if let Some(cache) = cached.as_ref().filter(|cache| {
            !cache.requires_revalidation
                && now >= cache.synced_at
                && now - cache.synced_at < REFRESH_SECONDS
        }) {
            return Ok(NativeRoutingStatus::ready(cache, None));
        }
    }
    use crate::services::codex_oauth_models::NativeCatalogError;
    let result = match fetch(&login).await {
        Ok(value) => parse_official_models(value),
        Err(NativeCatalogError::LoginRequired) => {
            if let Some(mut previous) = cached.clone() {
                previous.requires_revalidation = true;
                db.set_setting(
                    CATALOG_KEY,
                    &serde_json::to_string(&previous).map_err(|_| "无法记录登录状态")?,
                )
                .map_err(|_| "无法记录登录状态，请重试")?;
            }
            return Ok(NativeRoutingStatus::empty(
                "loginRequired",
                Some("官方登录已失效，请在 Codex 中登录后重新检测".into()),
            ));
        }
        Err(NativeCatalogError::Other(error)) => Err(error),
    };
    // A user can change accounts while the network request is in flight.
    let current = read().await;
    if !matches!(&current, Ok(Some(current)) if !current.expired && current.account_key == login.account_key)
    {
        return Ok(NativeRoutingStatus::empty(
            "unavailable",
            Some("登录状态在同步期间发生变化，请重新检测".into()),
        ));
    }
    match result {
        Ok(models) => {
            let cache = NativeCatalog {
                account_key: login.account_key,
                synced_at: chrono::Utc::now().timestamp(),
                models,
                requires_revalidation: false,
            };
            db.set_setting(
                CATALOG_KEY,
                &serde_json::to_string(&cache).map_err(|_| "无法保存官方目录")?,
            )
            .map_err(|_| "无法保存官方目录，请重试")?;
            Ok(NativeRoutingStatus::ready(&cache, None))
        }
        Err(error)
            if cached
                .as_ref()
                .is_some_and(|cache| cache.requires_revalidation) =>
        {
            Ok(NativeRoutingStatus::empty(
                "loginRequired",
                Some(format!("官方登录尚未重新验证：{error}")),
            ))
        }
        Err(error) => Ok(cached
            .as_ref()
            .map(|cache| NativeRoutingStatus::ready(cache, Some(error.clone())))
            .unwrap_or_else(|| NativeRoutingStatus::empty("syncFailed", Some(error)))),
    }
}

/// Save only the catalog previewed by this client, and only for the current login.
pub async fn catalog_for_save(
    db: &Database,
    revision: Option<&str>,
) -> Result<NativeCatalog, String> {
    let login = super::codex_native_auth::read_login()
        .await?
        .filter(|login| !login.expired)
        .ok_or("官方模型需要 Codex 当前有效的 ChatGPT 登录，请先登录并同步")?;
    let cache = cached_catalog(db)
        .map_err(|e| e.to_string())?
        .filter(|cache| cache.account_key == login.account_key)
        .ok_or("请先为当前账号同步官方模型")?;
    if cache.requires_revalidation {
        return Err("官方登录曾被拒绝，请重新登录并成功同步后再保存".into());
    }
    if revision != Some(cache.revision().as_str()) {
        return Err("官方目录已变化，请刷新模型预览后重新保存".into());
    }
    Ok(cache)
}

#[cfg(test)]
pub(crate) fn save_test_catalog(
    db: &Database,
    account_key: String,
    models: Vec<Value>,
) -> NativeCatalog {
    let catalog = NativeCatalog {
        account_key,
        models,
        synced_at: chrono::Utc::now().timestamp(),
        requires_revalidation: false,
    };
    db.set_setting(CATALOG_KEY, &serde_json::to_string(&catalog).unwrap())
        .unwrap();
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn friendly_names_and_native_capabilities_are_preserved() {
        for (name, expected) in [
            ("GPT-6-Astra", "6 Astra"),
            ("GPT-5.6-Sol", "5.6 Sol"),
            ("GPT-5.4-Mini", "5.4 Mini"),
            ("Custom Label", "Custom Label"),
        ] {
            assert_eq!(friendly_name(name), expected);
        }
        let native = json!({"slug":"gpt-example","display_name":"Custom Label","context_window":200000,
            "supported_reasoning_levels":[{"effort":"high"}],"custom_tool":"keep"});
        let rows = parse_official_models(json!({"models":[native.clone(),native.clone(),
            {"slug":"x@relay"},{"slug":"hidden","visibility":"hide"}]}))
        .unwrap();
        assert_eq!(rows, vec![native.clone()]);
        let cache = NativeCatalog {
            account_key: "test".into(),
            synced_at: 1,
            models: rows,
            requires_revalidation: false,
        };
        let provider = from_catalog(&cache);
        assert_eq!(catalog(&provider).unwrap()["models"][0], native);
        assert_eq!(provider.settings_config["auth"], json!({}));
        let mut later = cache.clone();
        later.synced_at += 1;
        assert_eq!(cache.revision(), later.revision());
        assert!(parse_official_models(json!({"models":[]})).is_err());
        assert!(parse_official_models(json!({"data":[{"id":"x"}]})).is_err());
    }
    #[test]
    fn discovery_does_not_mutate_the_saved_route_snapshot() {
        let db = Database::memory().unwrap();
        let old = save_test_catalog(&db, "alice".into(), vec![json!({"slug":"old"})]);
        let config = super::super::codex_model_routing::CodexModelRoutingConfig {
            native_catalog: Some(old),
            ..Default::default()
        };
        save_test_catalog(&db, "bob".into(), vec![json!({"slug":"new"})]);
        let applied = providers_for_config(&db, &config).unwrap();
        assert_eq!(
            applied[PROVIDER_ID].settings_config["modelCatalog"]["models"][0]["model"],
            "old"
        );
        assert_eq!(
            applied[PROVIDER_ID].settings_config["nativeAccountKey"],
            "alice"
        );
    }
    fn login(user: &str) -> super::super::codex_native_auth::NativeLogin {
        let token = super::super::codex_native_auth::test_token(user, "workspace", i64::MAX);
        let (workspace, account_key, expired) =
            super::super::codex_native_auth::token_identity(&token).unwrap();
        super::super::codex_native_auth::NativeLogin {
            access_token: token,
            workspace,
            account_key,
            expired,
        }
    }
    fn read_alice() -> LoginFuture {
        Box::pin(async { Ok(Some(login("alice"))) })
    }

    #[tokio::test]
    async fn native_sync_requires_login_and_does_not_adopt_unverified_cache() {
        let db = Arc::new(Database::memory().unwrap());
        db.set_setting(
            "codex_native_route_catalog_v1",
            r#"{"models":[{"slug":"fake"}]}"#,
        )
        .unwrap();
        let state = sync_with(
            db.clone(),
            false,
            || Box::pin(async { Ok(None) }),
            |_| panic!("signed out must not fetch"),
        )
        .await
        .unwrap();
        assert_eq!(state.status, "signedOut");
        assert!(state.provider.is_none());
        let state = sync_with(
            db.clone(),
            false,
            || Box::pin(async { Err("keyring denied".into()) }),
            |_| panic!("auth error must not fetch"),
        )
        .await
        .unwrap();
        assert_eq!(state.status, "unavailable");
        assert!(cached_catalog(&db).unwrap().is_none());
    }
    #[tokio::test]
    async fn native_sync_keeps_full_metadata_and_reuses_fresh_verified_cache() {
        let db = Arc::new(Database::memory().unwrap());
        let state = sync_with(db.clone(), false, read_alice, |_| {
            Box::pin(async {
                Ok(json!({"models":[{
            "slug":"gpt-example","context_window":321000,"custom_tool":"preserved"}]}))
            })
        })
        .await
        .unwrap();
        assert_eq!(state.status, "ready");
        assert!(!state.cached);
        let before = db.get_setting(CATALOG_KEY).unwrap();
        let state = sync_with(db.clone(), false, read_alice, |_| {
            panic!("fresh cache must skip network")
        })
        .await
        .unwrap();
        assert_eq!(
            state.provider.unwrap().settings_config["nativeCatalog"]["models"][0]["custom_tool"],
            "preserved"
        );
        assert_eq!(db.get_setting(CATALOG_KEY).unwrap(), before);
        assert!(!before.unwrap().contains("access_token"));
    }
    #[tokio::test]
    async fn native_sync_failures_preserve_only_the_same_accounts_cache() {
        use crate::services::codex_oauth_models::NativeCatalogError;
        let db = Arc::new(Database::memory().unwrap());
        let old = save_test_catalog(&db, login("alice").account_key, vec![json!({"slug":"old"})]);
        let state = sync_with(db.clone(), true, read_alice, |_| {
            Box::pin(async { Err(NativeCatalogError::Other("offline".into())) })
        })
        .await
        .unwrap();
        assert_eq!(state.status, "ready");
        assert!(state.cached);
        assert_eq!(state.synced_at, Some(old.synced_at));
        let state = sync_with(
            db.clone(),
            true,
            || Box::pin(async { Ok(Some(login("bob"))) }),
            |_| Box::pin(async { Err(NativeCatalogError::Other("offline".into())) }),
        )
        .await
        .unwrap();
        assert_eq!(state.status, "syncFailed");
        assert!(state.provider.is_none());
        let state = sync_with(db.clone(), true, read_alice, |_| {
            Box::pin(async { Err(NativeCatalogError::LoginRequired) })
        })
        .await
        .unwrap();
        assert_eq!(state.status, "loginRequired");
        assert!(state.provider.is_none());
        let rejected = cached_catalog(&db).unwrap().unwrap();
        assert!(rejected.requires_revalidation);
        assert_eq!(rejected.synced_at, old.synced_at);
        assert_eq!(rejected.models, old.models);
        let state = sync_with(db.clone(), false, read_alice, |_| {
            Box::pin(async { Err(NativeCatalogError::LoginRequired) })
        })
        .await
        .unwrap();
        assert_eq!(state.status, "loginRequired"); // no fresh-cache bypass after a 401
    }
    #[tokio::test]
    async fn native_sync_account_change_and_empty_response_never_replace_saved_catalog() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let db = Arc::new(Database::memory().unwrap());
        let old = save_test_catalog(&db, login("alice").account_key, vec![json!({"slug":"old"})]);
        let state = sync_with(db.clone(), true, read_alice, |_| {
            Box::pin(async { Ok(json!({"models":[]})) })
        })
        .await
        .unwrap();
        assert!(state.cached);
        let calls = AtomicUsize::new(0);
        let state = sync_with(
            db.clone(),
            true,
            || {
                let user = if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    "alice"
                } else {
                    "bob"
                };
                Box::pin(async move { Ok(Some(login(user))) })
            },
            |_| Box::pin(async { Ok(json!({"models":[{"slug":"new"}]})) }),
        )
        .await
        .unwrap();
        assert_eq!(state.status, "unavailable");
        assert!(state.provider.is_none());
        assert_eq!(cached_catalog(&db).unwrap(), Some(old));
    }
}
