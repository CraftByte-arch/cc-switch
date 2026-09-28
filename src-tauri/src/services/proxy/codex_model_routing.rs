use super::ProxyService;
use crate::{
    app_config::AppType,
    error::AppError,
    provider::Provider,
    proxy::codex_model_routing::{self as routing, CodexModelRoutingConfig},
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

/// Only the two files owned by this feature. Never snapshot/restore auth.json.
pub(crate) struct RouterFiles(Vec<(PathBuf, Option<String>)>);

impl RouterFiles {
    pub(crate) fn capture() -> Result<Self, String> {
        let paths = [
            crate::codex_config::get_codex_config_path(),
            crate::codex_config::get_codex_config_dir().join(routing::CATALOG_FILENAME),
        ];
        let mut files = Vec::new();
        for path in paths {
            if std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
                return Err(format!(
                    "为避免覆盖其它文件，模型路由不写入符号链接：{}",
                    path.display()
                ));
            }
            let contents = match std::fs::read_to_string(&path) {
                Ok(text) => Some(text),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(format!("读取 {} 失败: {e}", path.display())),
            };
            files.push((path, contents));
        }
        Ok(Self(files))
    }

    pub(crate) fn restore(&self) -> Result<(), String> {
        for (path, text) in &self.0 {
            if let Some(text) = text {
                crate::config::write_text_file(path, text).map_err(|e| e.to_string())?;
            } else if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoutingSaveResult {
    pub config: CodexModelRoutingConfig,
    /// Menu/capability changes may require Codex to reload its model catalog.
    pub catalog_changed: bool,
}


fn codex_file_has_login() -> bool {
    let path = crate::codex_config::get_codex_auth_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(auth) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    let placeholder = auth.get("OPENAI_API_KEY").and_then(|value| value.as_str())
        == Some(crate::live::project::claude::PROXY_TOKEN_PLACEHOLDER);
    !placeholder && crate::codex_config::codex_auth_has_openai_account_material(&auth)
}

fn codex_live_login_state(config_text: &str) -> Option<bool> {
    use crate::codex_config::CodexAuthStoreMode;
    match crate::codex_config::codex_config_auth_store_mode(config_text) {
        CodexAuthStoreMode::File => Some(codex_file_has_login()),
        CodexAuthStoreMode::Ephemeral => Some(false),
        CodexAuthStoreMode::Keyring
        | CodexAuthStoreMode::Auto
        | CodexAuthStoreMode::Unknown => None,
    }
}

impl ProxyService {
    pub(crate) fn codex_model_routing_config(&self) -> Result<CodexModelRoutingConfig, String> {
        self.db.get_codex_model_routing().map_err(|e| e.to_string())
    }

    pub(crate) fn codex_model_routing_enabled(&self) -> Result<bool, String> {
        Ok(self.codex_model_routing_config()?.enabled)
    }

    fn validate_model_routing_targets(
        &self,
        config: &CodexModelRoutingConfig,
        providers: &IndexMap<String, Provider>,
        proxy_url: &str,
    ) -> Result<(), String> {
        config
            .validate(providers, true)
            .map_err(|e| e.to_string())?;
        let adapter = crate::proxy::providers::get_adapter(&AppType::Codex)
            .ok_or("Codex adapter unavailable")?;
        let local_url = url::Url::parse(proxy_url).map_err(|e| e.to_string())?;
        for selection in &config.models {
            let provider = &providers[&selection.provider_id];
            let base = adapter
                .extract_base_url(provider)
                .map_err(|e| e.to_string())?;
            let upstream =
                url::Url::parse(&base).map_err(|e| format!("{} 地址无效: {e}", provider.name))?;
            if !matches!(upstream.scheme(), "http" | "https") {
                return Err(format!("{} 必须使用 HTTP/HTTPS 地址", provider.name));
            }
            let local_host = matches!(
                upstream.host_str(),
                Some("127.0.0.1" | "localhost" | "0.0.0.0" | "[::1]" | "[::]")
            );
            if upstream.port_or_known_default() == local_url.port_or_known_default()
                && (local_host || upstream.host_str() == local_url.host_str())
            {
                return Err(format!(
                    "{} 指向本地路由自身，请修正供应商地址",
                    provider.name
                ));
            }
            if provider.id != crate::proxy::codex_native_route::PROVIDER_ID
                && adapter.extract_auth(provider).is_none()
            {
                return Err(format!("{} 缺少 API Key，请先编辑供应商", provider.name));
            }
        }
        Ok(())
    }

    /// Caller owns the Codex switch lock. DB is not changed here.
    pub(crate) async fn project_codex_model_routing(
        &self,
        config: &CodexModelRoutingConfig,
        providers: &IndexMap<String, Provider>,
    ) -> Result<bool, String> {
        let (_, base_url) = self.build_proxy_urls().await?;
        self.validate_model_routing_targets(config, providers, &base_url)?;
        let catalog = config.catalog(providers).map_err(|e| e.to_string())?;
        let existing = crate::codex_config::read_codex_config_text().map_err(|e| e.to_string())?;
        let mut projected =
            routing::project_config(&existing, config, &base_url).map_err(|e| e.to_string())?;
        // Preserve the login-aware desktop compatibility behavior without
        // reading, rewriting or exposing the login itself.
        if let Some(has_login) = codex_live_login_state(&projected) {
            projected =
                crate::codex_config::align_codex_requires_openai_auth_with_login_preservation(
                    &projected, has_login,
                )
                .map_err(|e| e.to_string())?;
        }
        let path = crate::codex_config::get_codex_config_dir().join(routing::CATALOG_FILENAME);
        let old_catalog = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        let catalog_changed = old_catalog.as_ref() != Some(&catalog);
        let snapshot = RouterFiles::capture()?;
        let result = (|| {
            if catalog_changed {
                crate::config::write_json_file(&path, &catalog).map_err(|e| e.to_string())?;
            }
            if existing != projected {
                crate::codex_config::write_codex_live_config_atomic(Some(&projected))
                    .map_err(|e| e.to_string())?;
            }
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            snapshot
                .restore()
                .map_err(|rollback| format!("{error}; 回滚失败: {rollback}"))?;
            return Err(error);
        }
        Ok(catalog_changed)
    }

    /// Saving a draft never activates the service or changes the mode flag.
    pub async fn save_codex_model_routing_config(
        &self,
        mut config: CodexModelRoutingConfig,
    ) -> Result<ModelRoutingSaveResult, String> {
        let _guard = self.switch_locks.lock_for_app("codex").await;
        let old = self.codex_model_routing_config()?;
        config.enabled = old.enabled;
        config.provider_name = config.provider_name.trim().to_string();
        config.native_model_prefix = config.native_model_prefix.trim().to_string();
        if !config.native_subscription_enabled
            && config
                .models
                .iter()
                .any(|entry| entry.provider_id == crate::proxy::codex_native_route::PROVIDER_ID)
        {
            return Err("官方订阅已关闭，请移除官方模型后再保存".into());
        }
        config.native_catalog = if config
            .models
            .iter()
            .any(|model| model.provider_id == crate::proxy::codex_native_route::PROVIDER_ID)
        {
            Some(
                crate::proxy::codex_native_route::catalog_for_save(
                    &self.db,
                    config.native_catalog_revision.as_deref(),
                )
                .await?,
            )
        } else {
            config.native_catalog_revision = None;
            None
        };

        let providers = crate::proxy::codex_native_route::providers_for_config(&self.db, &config)
            .map_err(|e| e.to_string())?;
        let taken_over = self
            .db
            .get_proxy_config_for_app("codex")
            .await
            .map_err(|e| e.to_string())?
            .enabled;
        let active = config.enabled && taken_over;
        config
            .validate(&providers, active)
            .map_err(|e| e.to_string())?;
        config
            .validate_visible_combinations(&providers)
            .map_err(|e| e.to_string())?;
        let files = if active {
            Some(RouterFiles::capture()?)
        } else {
            None
        };
        let catalog_changed = if active {
            self.project_codex_model_routing(&config, &providers)
                .await?
        } else {
            false
        };
        if let Err(error) = self.db.save_codex_model_routing(&config) {
            if let Some(files) = files {
                files
                    .restore()
                    .map_err(|rollback| format!("{error}; 回滚失败: {rollback}"))?;
            }
            return Err(error.to_string());
        }
        if active {
            self.mark_codex_routing_active_target(&config.provider_name).await;
        }
        Ok(ModelRoutingSaveResult {
            config,
            catalog_changed,
        })
    }

    /// Turn Codex model routing on or off.
    ///
    /// Enabling enters proxy mode and projects the routed `config.toml`.
    /// Disabling leaves proxy mode first, while the flag is still on, so the
    /// direct provider's key fields replace the routing projection. An ordinary
    /// proxy session is left alone when routing is already off.
    pub async fn set_codex_model_routing_enabled(
        &self,
        state: &crate::store::AppState,
        enabled: bool,
    ) -> Result<(), String> {
        let app = AppType::Codex;
        let _guard = crate::mode::controller::lock_settled(state, &app)
            .await
            .map_err(|error| error.to_string())?;
        let old = self.codex_model_routing_config()?;
        if !enabled && !old.enabled {
            return Ok(());
        }
        let mut config = old.clone();
        config.enabled = enabled;
        if enabled
            && config
                .models
                .iter()
                .any(|model| model.provider_id == crate::proxy::codex_native_route::PROVIDER_ID)
        {
            let login = crate::proxy::codex_native_auth::read_login()
                .await?
                .filter(|login| !login.expired)
                .ok_or("请先在 Codex 中登录并同步官方模型")?;
            if config
                .native_catalog
                .as_ref()
                .map(|catalog| &catalog.account_key)
                != Some(&login.account_key)
            {
                return Err("官方模型配置属于其他登录或旧缓存，请同步后重新保存".into());
            }
        }
        let was_proxy = crate::mode::current::is_proxy(&app);
        if enabled {
            let providers =
                crate::proxy::codex_native_route::providers_for_config(&self.db, &config)
                    .map_err(|e| e.to_string())?;
            let (_, url) = self.build_proxy_urls().await?;
            self.validate_model_routing_targets(&config, &providers, &url)?;
            config
                .validate_visible_combinations(&providers)
                .map_err(|e| e.to_string())?;
            config.catalog(&providers).map_err(|e| e.to_string())?;
            let snapshot = RouterFiles::capture()?;
            self.db
                .save_codex_model_routing(&config)
                .map_err(|e| e.to_string())?;
            if let Err(error) = crate::mode::controller::enter_locked(
                state,
                &app,
                crate::mode::state::op::ENTER,
            )
            .await
            {
                let db_rollback = self.db.save_codex_model_routing(&old);
                if !was_proxy {
                    let _ = crate::mode::controller::exit_locked(
                        state,
                        &app,
                        false,
                    );
                }
                let file_rollback = snapshot.restore();
                return Err(format!(
                    "{error}; 配置回滚: {db_rollback:?}; 文件回滚: {file_rollback:?}"
                ));
            }
        } else if old.enabled {
            // Leave proxy while the flag is still on, then record routing as off.
            // exit_locked writes the direct provider back over the projection.
            crate::mode::controller::exit_locked(state, &app, false)?;
            self.db
                .save_codex_model_routing(&config)
                .map_err(|e| e.to_string())?;
            drop(_guard);
            crate::mode::controller::stop_server_if_unused(state).await;
        }
        Ok(())
    }

    /// Model routing owns the live config. Switching only changes the provider
    /// restored after routing is turned off.
    pub(crate) async fn set_codex_default_provider_while_routing_inner(
        &self,
        provider_id: &str,
    ) -> Result<(), String> {
        if !self.codex_model_routing_enabled()? {
            return Err("Codex 模型路由未启用".into());
        }
        let provider = self
            .db
            .get_provider_by_id(provider_id, "codex")
            .map_err(|e| format!("读取供应商失败: {e}"))?
            .ok_or_else(|| format!("供应商不存在: {provider_id}"))?;
        let previous = crate::mode::current::provider_for(
            &self.db,
            &AppType::Codex,
            crate::mode::current::Purpose::Direct,
        )
        .map_err(|e| e.to_string())?;
        if let Err(error) =
            crate::settings::set_current_provider(&AppType::Codex, Some(provider_id))
        {
            return Err(format!("更新本地默认供应商失败: {error}"));
        }
        if let Err(error) = self.db.set_current_provider("codex", provider_id) {
            if let Err(rollback_error) =
                crate::settings::set_current_provider(&AppType::Codex, previous.as_deref())
            {
                log::error!("恢复本地 Codex 默认供应商失败: {rollback_error}");
            }
            return Err(format!("更新默认供应商失败: {error}"));
        }
        log::info!(
            "Codex 模型路由开启：已将关闭路由后的默认供应商设置为 {} ({})，未改写 Live 配置",
            provider.name,
            provider.id
        );
        Ok(())
    }

    /// Remove route entries for a provider before deleting it. Returns the
    /// previous config so the caller can restore it if deletion fails.
    /// The caller owns the Codex switch lock.
    pub(crate) async fn remove_codex_provider_references_inner(
        &self,
        provider_id: &str,
    ) -> Result<Option<crate::proxy::codex_model_routing::CodexModelRoutingConfig>, String> {
        let old = self.codex_model_routing_config()?;
        if !old.references_provider(provider_id) {
            return Ok(None);
        }
        let mut next = old.clone();
        next.models.retain(|entry| entry.provider_id != provider_id);
        let providers = crate::proxy::codex_native_route::providers_for_config(&self.db, &next)
            .map_err(|e| e.to_string())?;
        let takeover = self
            .db
            .get_proxy_config_for_app("codex")
            .await
            .map_err(|e| e.to_string())?
            .enabled;
        let active = old.enabled && takeover;
        next.validate(&providers, active)
            .map_err(|e| e.to_string())?;
        next.validate_visible_combinations(&providers)
            .map_err(|e| e.to_string())?;

        let files = if active {
            Some(RouterFiles::capture().map_err(|e| e.to_string())?)
        } else {
            None
        };
        if active {
            if let Err(error) = self.project_codex_model_routing(&next, &providers).await {
                return Err(error);
            }
        }
        if let Err(error) = self.db.save_codex_model_routing(&next) {
            if let Some(files) = files {
                files
                    .restore()
                    .map_err(|rollback| format!("{error}; 回滚路由文件失败: {rollback}"))?;
            }
            return Err(error.to_string());
        }
        Ok(Some(old))
    }

    pub(crate) async fn restore_codex_model_routing_config_inner(
        &self,
        config: &crate::proxy::codex_model_routing::CodexModelRoutingConfig,
    ) -> Result<(), String> {
        let providers = crate::proxy::codex_native_route::providers_for_config(&self.db, config)
            .map_err(|e| e.to_string())?;
        let takeover = self
            .db
            .get_proxy_config_for_app("codex")
            .await
            .map_err(|e| e.to_string())?
            .enabled;
        if config.enabled && takeover {
            self.project_codex_model_routing(config, &providers).await?;
        }
        self.db
            .save_codex_model_routing(config)
            .map_err(|e| e.to_string())
    }

    pub(crate) async fn project_codex_model_routing_if_enabled(&self) -> Result<(), String> {
        let config = self.codex_model_routing_config()?;
        if !config.enabled {
            return Ok(());
        }
        let providers = crate::proxy::codex_native_route::providers_for_config(&self.db, &config)
            .map_err(|e| e.to_string())?;
        self.project_codex_model_routing(&config, &providers).await?;
        self.mark_codex_routing_active_target(&config.provider_name)
            .await;
        Ok(())
    }

    async fn mark_codex_routing_active_target(&self, provider_name: &str) {
        if let Some(server) = self.server.read().await.as_ref() {
            server
                .set_active_target(
                    "codex",
                    crate::proxy::codex_model_routing::PROVIDER_ID,
                    provider_name.trim(),
                )
                .await;
        }
    }

    /// Provider edit fast path while routing owns Live. Do not replace the
    /// original takeover backup, switch accounts, or backfill a merged catalog.
    /// The caller already holds the Codex switch lock.
    pub(crate) async fn update_codex_provider_in_model_routing(
        &self,
        provider: &Provider,
    ) -> Result<(), AppError> {
        self.update_codex_provider_in_model_routing_with_rename(provider, None)
            .await
    }

    pub(crate) async fn update_codex_provider_in_model_routing_with_rename(
        &self,
        provider: &Provider,
        rename: Option<(&str, &str)>,
    ) -> Result<(), AppError> {
        let old_config = self.db.get_codex_model_routing()?;
        let mut providers =
            crate::proxy::codex_native_route::providers_for_config(&self.db, &old_config)?;
        let old_provider = providers.insert(provider.id.clone(), provider.clone());
        let mut next_config = old_config.clone();

        if let Some((from, to)) = rename {
            next_config.rename_route(&provider.id, from, to);
        }
        // Editing a provider's model catalog is allowed while routing is live.
        // Any selected route that no longer exists is removed atomically with
        // the provider edit instead of making the whole form impossible to save.
        next_config.models.retain(|entry| {
            entry.provider_id != provider.id || routing::has_model(provider, &entry.model)
        });
        next_config.rebase_default();
        if next_config.models.is_empty() {
            return Err(AppError::InvalidInput(
                "该供应商删除了模型路由中唯一启用的模型，请先在「管理模型」中选择其他模型后再保存"
                    .into(),
            ));
        }
        next_config.validate(&providers, true)?;
        next_config.validate_visible_combinations(&providers)?;

        let files = RouterFiles::capture().map_err(AppError::Message)?;
        if let Err(error) = self
            .project_codex_model_routing(&next_config, &providers)
            .await
        {
            files.restore().map_err(AppError::Message)?;
            return Err(AppError::Message(error));
        }
        if let Err(error) = self.db.save_provider("codex", provider) {
            files.restore().map_err(AppError::Message)?;
            return Err(error);
        }
        if let Err(error) = self.db.save_codex_model_routing(&next_config) {
            if let Some(old_provider) = old_provider.as_ref() {
                let _ = self.db.save_provider("codex", old_provider);
            }
            files.restore().map_err(AppError::Message)?;
            return Err(error);
        }
        Ok(())
    }
}
