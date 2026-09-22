//! Codex-only, opt-in model routing. Persist references, never copies of credentials.
//!
//! A request takes one configuration/provider snapshot. Changing a model's
//! provider affects the next request, not an in-flight stream or global current.

use crate::{database::Database, error::AppError, provider::Provider};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const SETTINGS_KEY: &str = "codex_model_routing_v1";
pub const CATALOG_FILENAME: &str = "cc-switch-router-model-catalog.json";
pub const PROVIDER_ID: &str = "custom";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelSelection {
    pub provider_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoutingCapability {
    pub provider_id: String,
    pub model: String,
    pub context_window: Option<u64>,
}

impl ModelSelection {
    pub fn routed_model_id(&self) -> String {
        format!("{}@{}", self.model, self.provider_id)
    }
}

pub struct ResolvedModelRoute {
    pub provider: Provider,
    pub upstream_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct CodexModelRoutingConfig {
    /// Mode preference. Actual activation also requires Codex takeover.
    pub enabled: bool,
    pub provider_name: String,
    /// Add provider names only for duplicate model labels, or for every model.
    pub smart_model_names: bool,
    pub native_subscription_enabled: bool,
    pub show_native_model_prefix: bool,
    pub native_model_prefix: String,
    pub native_catalog_revision: Option<String>,
    /// Server-owned snapshot: candidate refresh must not alter live routes.
    pub native_catalog: Option<super::codex_native_route::NativeCatalog>,
    /// Ordered, unique provider/model routes. Display order is not the default.
    pub models: Vec<ModelSelection>,
    /// Initial Codex model. Independent of `models` order; falls back to first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<ModelSelection>,
}

impl Default for CodexModelRoutingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_name: "CC Switch Router".into(),
            smart_model_names: true,
            native_subscription_enabled: true,
            show_native_model_prefix: true,
            native_model_prefix: match crate::settings::get_settings().language.as_deref() {
                Some("zh") | Some("zh-TW") => "官方",
                Some("ja") => "公式",
                _ => "Official",
            }
            .into(),
            native_catalog_revision: None,
            native_catalog: None,
            models: Vec::new(),
            default_model: None,
        }
    }
}

impl Database {
    pub fn get_codex_model_routing(&self) -> Result<CodexModelRoutingConfig, AppError> {
        self.get_setting(SETTINGS_KEY)?
            .map(|text| {
                serde_json::from_str(&text)
                    .map_err(|e| AppError::Config(format!("Codex 模型路由配置损坏: {e}")))
            })
            .transpose()
            .map(|config| config.unwrap_or_default())
    }

    pub(crate) fn save_codex_model_routing(
        &self,
        config: &CodexModelRoutingConfig,
    ) -> Result<(), AppError> {
        let text =
            serde_json::to_string(config).map_err(|source| AppError::JsonSerialize { source })?;
        self.set_setting(SETTINGS_KEY, &text)
    }
}

pub fn provider_is_eligible(provider: &Provider) -> bool {
    if provider.id == super::codex_native_route::PROVIDER_ID {
        return super::providers::is_codex_official_provider(provider)
            && !provider.uses_managed_account_auth();
    }
    // Native-login/account-bound routes have their own credential lifecycle.
    // Do not reuse inbound OAuth credentials across selected stations.
    !super::providers::is_codex_official_provider(provider) && !provider.uses_managed_account_auth()
}

fn provider_catalog(provider: &Provider) -> Result<Option<Value>, AppError> {
    if let Some(catalog) = super::codex_native_route::catalog(provider) {
        return Ok(Some(catalog));
    }
    crate::codex_config::codex_model_catalog_from_settings(
        &provider.settings_config,
        provider.settings_config["config"].as_str().unwrap_or(""),
        super::providers::resolve_codex_catalog_tool_profile(provider),
    )
}

pub fn has_model(provider: &Provider, model: &str) -> bool {
    provider
        .settings_config
        .pointer("/modelCatalog/models")
        .and_then(Value::as_array)
        .is_some_and(|rows| {
            rows.iter()
                .any(|row| row.get("model").and_then(Value::as_str).map(str::trim) == Some(model))
        })
}

/// Preview the catalog values that routing would write without changing any
/// saved configuration. A broken provider catalog only affects its own rows.
pub fn model_capabilities(providers: &IndexMap<String, Provider>) -> Vec<ModelRoutingCapability> {
    let mut capabilities = Vec::new();
    for provider in providers
        .values()
        .filter(|provider| provider_is_eligible(provider))
    {
        let mut model_ids = Vec::new();
        let mut seen = HashSet::new();
        if let Some(rows) = provider
            .settings_config
            .pointer("/modelCatalog/models")
            .and_then(Value::as_array)
        {
            for row in rows {
                let Some(model) = row
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|model| !model.is_empty())
                else {
                    continue;
                };
                if seen.insert(model.to_string()) {
                    model_ids.push(model.to_string());
                }
            }
        }

        let context_windows = provider_catalog(provider)
            .ok()
            .flatten()
            .and_then(|catalog| catalog.get("models").and_then(Value::as_array).cloned())
            .map(|models| {
                models
                    .into_iter()
                    .filter_map(|entry| {
                        Some((
                            entry.get("slug")?.as_str()?.to_string(),
                            entry.get("context_window")?.as_u64()?,
                        ))
                    })
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();

        capabilities.extend(model_ids.into_iter().map(|model| ModelRoutingCapability {
            provider_id: provider.id.clone(),
            context_window: context_windows.get(&model).copied(),
            model,
        }));
    }
    capabilities
}

fn model_display_name(provider: &Provider, model: &str) -> String {
    provider
        .settings_config
        .pointer("/modelCatalog/models")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("model").and_then(Value::as_str).map(str::trim) == Some(model))
        })
        .and_then(|row| {
            row.get("displayName")
                .or_else(|| row.get("display_name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
        })
        .unwrap_or(model)
        .to_string()
}

impl CodexModelRoutingConfig {
    pub fn references_provider(&self, id: &str) -> bool {
        self.models.iter().any(|entry| entry.provider_id == id)
    }

    pub fn default_selection(&self) -> Option<&ModelSelection> {
        self.default_model
            .as_ref()
            .and_then(|selected| {
                self.models.iter().find(|entry| {
                    entry.provider_id == selected.provider_id && entry.model == selected.model
                })
            })
            .or_else(|| self.models.first())
    }

    pub fn rename_route(&mut self, provider_id: &str, from: &str, to: &str) {
        for entry in &mut self.models {
            if entry.provider_id == provider_id && entry.model == from {
                entry.model = to.to_string();
            }
        }
        if let Some(selected) = &mut self.default_model {
            if selected.provider_id == provider_id && selected.model == from {
                selected.model = to.to_string();
            }
        }
    }

    pub fn rebase_default(&mut self) {
        if let Some(selected) = &self.default_model {
            let exists = self.models.iter().any(|entry| {
                entry.provider_id == selected.provider_id && entry.model == selected.model
            });
            if !exists {
                self.default_model = self.models.first().cloned();
            }
        }
    }

    pub fn validate(
        &self,
        providers: &IndexMap<String, Provider>,
        require_models: bool,
    ) -> Result<(), AppError> {
        if self.provider_name.trim().is_empty()
            || self.provider_name.chars().count() > 80
            || self.provider_name.chars().any(char::is_control)
        {
            return Err(AppError::InvalidInput(
                "路由名称须为 1–80 个可见字符".into(),
            ));
        }
        if require_models && self.models.is_empty() {
            return Err(AppError::InvalidInput("请至少选择一个 Codex 模型".into()));
        }
        if self.models.len() > 256 {
            return Err(AppError::InvalidInput("最多启用 256 个模型".into()));
        }
        if !self.native_subscription_enabled
            && self
                .models
                .iter()
                .any(|entry| entry.provider_id == super::codex_native_route::PROVIDER_ID)
        {
            return Err(AppError::InvalidInput(
                "官方订阅已关闭，请移除官方模型后再保存".into(),
            ));
        }
        let mut seen_selections = HashSet::new();
        let mut seen_routed_models = HashSet::new();
        for entry in &self.models {
            if entry.model.is_empty()
                || entry.model.trim() != entry.model
                || entry.model.chars().any(char::is_control)
            {
                return Err(AppError::InvalidInput(format!(
                    "模型名称无效：{}",
                    entry.model
                )));
            }
            if !seen_selections.insert((entry.provider_id.clone(), entry.model.clone())) {
                return Err(AppError::InvalidInput(format!(
                    "模型路由重复：{}",
                    entry.routed_model_id()
                )));
            }
            if !seen_routed_models.insert(entry.routed_model_id()) {
                return Err(AppError::InvalidInput(format!(
                    "模型路由标识冲突：{}",
                    entry.routed_model_id()
                )));
            }
            let provider = providers.get(&entry.provider_id).ok_or_else(|| {
                AppError::InvalidInput(format!("供应商已不存在：{}", entry.provider_id))
            })?;
            if !provider_is_eligible(provider) {
                return Err(AppError::InvalidInput(format!(
                    "{} 为账号认证供应商，暂不支持模型路由",
                    provider.name
                )));
            }
            if !has_model(provider, &entry.model) {
                return Err(AppError::InvalidInput(format!(
                    "{} 的模型映射中不存在 {}，请重新选择",
                    provider.name, entry.model
                )));
            }
        }
        if let Some(selected) = &self.default_model {
            if !self.models.iter().any(|entry| {
                entry.provider_id == selected.provider_id && entry.model == selected.model
            }) {
                return Err(AppError::InvalidInput(
                    "默认模型必须是已选择的路由模型".into(),
                ));
            }
        }
        Ok(())
    }

    fn display_label(
        &self,
        provider: &Provider,
        model_name: &str,
        counts: &HashMap<String, usize>,
    ) -> String {
        if provider.id == super::codex_native_route::PROVIDER_ID {
            if self.show_native_model_prefix {
                format!("{} · {}", self.native_model_prefix.trim(), model_name)
            } else {
                model_name.into()
            }
        } else if !self.smart_model_names || counts.get(model_name).copied().unwrap_or(0) > 1 {
            format!("{} · {}", provider.name.trim(), model_name)
        } else {
            model_name.into()
        }
    }

    pub fn validate_visible_combinations(
        &self,
        providers: &IndexMap<String, Provider>,
    ) -> Result<(), AppError> {
        if self.native_subscription_enabled
            && self.show_native_model_prefix
            && (self.native_model_prefix.trim().is_empty()
                || self.native_model_prefix.chars().count() > 32)
        {
            return Err(AppError::InvalidInput(
                "官方模型前缀需为 1–32 个字符；不显示请关闭前缀开关".into(),
            ));
        }
        let mut counts = HashMap::new();
        for selection in &self.models {
            if let Some(provider) = providers.get(&selection.provider_id) {
                *counts
                    .entry(model_display_name(provider, &selection.model))
                    .or_insert(0) += 1;
            }
        }
        let mut final_labels = HashMap::<String, bool>::new();
        let mut seen = HashSet::new();
        for entry in &self.models {
            let provider = providers.get(&entry.provider_id).ok_or_else(|| {
                AppError::InvalidInput(format!("供应商已不存在：{}", entry.provider_id))
            })?;
            let display_name = model_display_name(provider, &entry.model);
            let label = self.display_label(provider, &display_name, &counts);
            let native = provider.id == super::codex_native_route::PROVIDER_ID;
            if final_labels
                .insert(label.clone(), native)
                .is_some_and(|previous| native || previous)
            {
                return Err(AppError::InvalidInput(format!(
                    "菜单名称“{label}”重复，请调整官方前缀或模型显示名称"
                )));
            }
            if !seen.insert((provider.name.trim().to_string(), display_name.clone())) {
                return Err(AppError::InvalidInput(format!(
                    "“{} · {}”与另一个已选模型使用相同的供应商名称和模型显示名称，请先修改供应商名称或模型显示名称",
                    provider.name.trim(),
                    display_name
                )));
            }
        }
        Ok(())
    }

    /// Generate each entry with ITS provider's protocol/tool profile. Merely
    /// concatenating raw form rows or using one global profile loses reasoning,
    /// vision, context limits and native/Chat/Anthropic tool compatibility.
    pub fn catalog(&self, providers: &IndexMap<String, Provider>) -> Result<Value, AppError> {
        self.validate(providers, true)?;
        let mut display_name_counts = HashMap::new();
        for selection in &self.models {
            let provider = &providers[&selection.provider_id];
            let display_name = model_display_name(provider, &selection.model);
            *display_name_counts.entry(display_name).or_insert(0usize) += 1;
        }
        let mut entries = Vec::with_capacity(self.models.len());
        for (index, selection) in self.models.iter().enumerate() {
            let provider = &providers[&selection.provider_id];
            let catalog = provider_catalog(provider)?
                .ok_or_else(|| AppError::Config("供应商模型目录为空".into()))?;
            let mut entry = catalog["models"]
                .as_array()
                .and_then(|models| {
                    models
                        .iter()
                        .find(|model| model["slug"].as_str() == Some(&selection.model))
                })
                .cloned()
                .ok_or_else(|| {
                    AppError::Config(format!("无法生成模型目录：{}", selection.model))
                })?;
            let model_name = model_display_name(provider, &selection.model);
            let display_name = self.display_label(provider, &model_name, &display_name_counts);
            entry["slug"] = json!(selection.routed_model_id());
            entry["display_name"] = json!(display_name);
            entry["description"] = json!(display_name);
            entry["priority"] = json!(1000 + index);
            entries.push(entry);
        }
        Ok(json!({ "models": entries }))
    }

    /// Exact IDs only. Unknown IDs fail closed instead of falling through to an
    /// unrelated current provider (which may not have the user's intended model).
    pub fn resolve(&self, db: &Database, model: &str) -> Result<ResolvedModelRoute, AppError> {
        let selection = self
            .models
            .iter()
            .find(|entry| entry.routed_model_id() == model);
        // Accept the previous bare slug only while it still identifies one route.
        // This keeps an already-open Codex usable during the first catalog refresh.
        let selection = match selection {
            Some(selection) => selection,
            None => {
                let mut legacy_matches = self.models.iter().filter(|entry| entry.model == model);
                match (legacy_matches.next(), legacy_matches.next()) {
                    (Some(selection), None) => selection,
                    _ => {
                        return Err(AppError::InvalidInput(format!(
                            "Codex 模型未启用路由：{model}"
                        )))
                    }
                }
            }
        };
        let provider = if selection.provider_id == super::codex_native_route::PROVIDER_ID {
            self.native_catalog
                .as_ref()
                .map(super::codex_native_route::from_catalog)
        } else {
            db.get_provider_by_id(&selection.provider_id, "codex")?
        }
        .ok_or_else(|| AppError::InvalidInput("模型对应的供应商已被删除，请重新配置路由".into()))?;
        if !provider_is_eligible(&provider) || !has_model(&provider, &selection.model) {
            return Err(AppError::InvalidInput(
                "模型对应的供应商配置已变化，请重新配置路由".into(),
            ));
        }
        Ok(ResolvedModelRoute {
            provider,
            upstream_model: selection.model.clone(),
        })
    }
}

/// Pure projection. Root keys must stay above provider tables in TOML.
/// The old custom table is deliberately replaced, not merged: its credentials,
/// env_key, custom headers and query parameters must not become router auth.
pub fn project_config(
    existing: &str,
    config: &CodexModelRoutingConfig,
    base_url: &str,
) -> Result<String, AppError> {
    let mut doc = existing
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| AppError::Config(format!("Invalid Codex config.toml: {e}")))?;
    if config.models.is_empty() {
        return Err(AppError::InvalidInput("请至少选择一个 Codex 模型".into()));
    }
    // Repair the legacy partial desktop table on routing activation. Preserve
    // every explicit user selection (even []), rather than forcing all efforts
    // on subsequent refreshes. These are picker preferences, not a claim that
    // every routed model supports each effort; model capabilities stay intact.
    if doc.get("desktop").is_none() {
        doc["desktop"] = toml_edit::table();
    }
    let desktop = doc["desktop"]
        .as_table_like_mut()
        .ok_or_else(|| AppError::Config("Codex desktop 必须是 TOML 表".into()))?;
    if desktop.get("enabled-reasoning-efforts").is_none() {
        let efforts: toml_edit::Array = [
            "persistent",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "ultra",
        ]
        .into_iter()
        .collect();
        desktop.insert("enabled-reasoning-efforts", toml_edit::value(efforts));
    }
    let current = doc.get("model").and_then(|item| item.as_str());
    let selected = current
        .and_then(|model| {
            config
                .models
                .iter()
                .find(|entry| entry.routed_model_id() == model)
        })
        .or_else(|| {
            current.and_then(|model| config.models.iter().find(|entry| entry.model == model))
        })
        .or_else(|| config.default_selection())
        .unwrap_or(&config.models[0]);
    let routed_model = selected.routed_model_id();
    if current != Some(routed_model.as_str()) {
        doc["model"] = toml_edit::value(routed_model);
        // A default effort for a removed model may not exist on the new one.
        doc.as_table_mut().remove("model_reasoning_effort");
    }
    doc["model_provider"] = toml_edit::value(PROVIDER_ID);
    doc["model_catalog_json"] = toml_edit::value(CATALOG_FILENAME);
    doc.as_table_mut().remove("openai_base_url");
    doc.as_table_mut().remove("experimental_bearer_token");
    // Root-wide limits from a previously selected station would override the
    // per-model catalog, potentially overstating another model's context size.
    for key in [
        "model_context_window",
        "model_auto_compact_token_limit",
        "model_max_output_tokens",
    ] {
        doc.as_table_mut().remove(key);
    }
    if doc.get("model_providers").is_none() {
        doc["model_providers"] = toml_edit::table();
    }
    let providers = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_like_mut())
        .ok_or_else(|| AppError::Config("model_providers 必须是 TOML 表".into()))?;
    let mut table = toml_edit::Table::new();
    table["name"] = toml_edit::value(config.provider_name.trim());
    table["base_url"] = toml_edit::value(base_url);
    table["wire_api"] = toml_edit::value("responses");
    let native_login = config
        .models
        .iter()
        .any(|entry| entry.provider_id == super::codex_native_route::PROVIDER_ID);
    if !native_login {
        table["experimental_bearer_token"] = toml_edit::value("PROXY_MANAGED");
    }
    table["requires_openai_auth"] = toml_edit::value(native_login);
    table["supports_websockets"] = toml_edit::value(false);
    providers.insert(PROVIDER_ID, toml_edit::Item::Table(table));
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_subscription_disabled_rejects_native_selections_but_allows_relays() {
        let old: CodexModelRoutingConfig = serde_json::from_value(json!({})).unwrap();
        assert!(old.native_subscription_enabled);
        let mut cfg = config("relay");
        cfg.native_subscription_enabled = false;
        cfg.native_model_prefix = String::new();
        let providers = IndexMap::from([("relay".into(), provider("relay"))]);
        assert!(cfg.validate(&providers, false).is_ok());
        cfg.models[0].provider_id = super::super::codex_native_route::PROVIDER_ID.into();
        assert!(cfg
            .validate(&providers, false)
            .unwrap_err()
            .to_string()
            .contains("官方订阅已关闭"));
        let serialized = serde_json::to_value(&cfg).unwrap();
        assert_eq!(serialized["nativeSubscriptionEnabled"], false);
    }
    fn provider(id: &str) -> Provider {
        Provider::with_id(
            id.into(),
            id.into(),
            json!({
                "config": "model = \"x\"\nmodel_provider = \"station\"\n[model_providers.station]\nbase_url = \"https://example.test/v1\"\n",
                "auth": {"OPENAI_API_KEY": "not-a-real-key"},
                "modelCatalog": {"models": [{"model": "x", "reasoningLevels": ["low", "high"], "defaultReasoningLevel": "low", "contextWindow": 64000, "inputModalities": ["text"]}]}
            }),
            None,
        )
    }
    fn config(id: &str) -> CodexModelRoutingConfig {
        CodexModelRoutingConfig {
            enabled: true,
            models: vec![ModelSelection {
                provider_id: id.into(),
                model: "x".into(),
            }],
            ..Default::default()
        }
    }

    fn named_provider(id: &str, name: &str, display_name: Option<&str>) -> Provider {
        let mut provider = provider(id);
        provider.name = name.to_string();
        if let Some(display_name) = display_name {
            provider.settings_config["modelCatalog"]["models"][0]["displayName"] =
                json!(display_name);
        }
        provider
    }
    #[test]
    fn native_subscription_and_relay_keep_separate_auth_and_native_catalog() {
        let mut native = Provider::with_id(
            super::super::codex_native_route::PROVIDER_ID.into(),
            "Official".into(),
            json!({"auth":{}, "config":"", "modelCatalog":{"models":[{"model":"x"}]},
            "nativeCatalog":{"models":[{"slug":"x", "context_window":200000,"native_tools":"unchanged"}]}}),
            None,
        );
        native.category = Some("official".into());
        let providers = IndexMap::from([
            ("a".into(), provider("a")),
            (native.id.clone(), native.clone()),
        ]);
        let mut cfg = config("a");
        cfg.models.push(ModelSelection {
            provider_id: native.id.clone(),
            model: "x".into(),
        });
        cfg.validate(&providers, true).unwrap();
        let catalog = cfg.catalog(&providers).unwrap();
        assert_eq!(catalog["models"][1]["native_tools"], "unchanged");
        assert_eq!(catalog["models"][1]["context_window"], 200000);
        assert_eq!(
            catalog["models"][1]["display_name"],
            format!("{} · x", cfg.native_model_prefix)
        );
        let text = project_config("", &cfg, "http://127.0.0.1:15721/v1").unwrap();
        let doc: toml::Value = text.parse().unwrap();
        let custom = &doc["model_providers"]["custom"];
        assert_eq!(custom["requires_openai_auth"].as_bool(), Some(true));
        assert!(custom.get("experimental_bearer_token").is_none());
        assert!(custom.get("env_key").is_none());
        // Removing official routes restores key-only routing without requiring login.
        cfg.models.pop();
        let doc: toml::Value = project_config(&text, &cfg, "http://127.0.0.1:15721/v1")
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            doc["model_providers"]["custom"]["requires_openai_auth"].as_bool(),
            Some(false)
        );
        assert_eq!(
            doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
            Some("PROXY_MANAGED")
        );
        native.meta = Some(crate::provider::ProviderMeta {
            provider_type: Some("codex_oauth".into()),
            ..Default::default()
        });
        assert!(!provider_is_eligible(&native));
    }

    #[test]
    fn native_prefix_controls_do_not_change_relay_naming_and_reject_final_collisions() {
        let native_catalog = super::super::codex_native_route::NativeCatalog {
            account_key: "test".into(),
            synced_at: 1,
            requires_revalidation: false,
            models: vec![json!({"slug":"x","display_name":"x"})],
        };
        let native = super::super::codex_native_route::from_catalog(&native_catalog);
        let mut relay = provider("a");
        relay.name = "订阅".into();
        let providers = IndexMap::from([("a".into(), relay), (native.id.clone(), native.clone())]);
        let mut cfg = config("a");
        cfg.models.push(ModelSelection {
            provider_id: native.id.clone(),
            model: "x".into(),
        });
        cfg.native_model_prefix = "官方".into();
        cfg.validate_visible_combinations(&providers).unwrap();
        assert_eq!(
            cfg.catalog(&providers).unwrap()["models"][1]["display_name"],
            "官方 · x"
        );
        cfg.native_model_prefix = "订阅".into();
        assert!(cfg.validate_visible_combinations(&providers).is_err());
        cfg.show_native_model_prefix = false;
        cfg.validate_visible_combinations(&providers).unwrap();
        for smart in [true, false] {
            cfg.smart_model_names = smart;
            let catalog = cfg.catalog(&providers).unwrap();
            assert_eq!(catalog["models"][0]["display_name"], "订阅 · x");
            assert_eq!(catalog["models"][1]["display_name"], "x");
            assert_eq!(catalog["models"][1]["slug"], format!("x@{}", native.id));
        }
        let legacy: CodexModelRoutingConfig = serde_json::from_str(r#"{"models":[]}"#).unwrap();
        assert!(legacy.show_native_model_prefix);
        assert!(!legacy.native_model_prefix.is_empty());
    }

    #[test]
    fn defaults_and_reference_roundtrip() {
        let db = Database::memory().unwrap();
        assert!(!db.get_codex_model_routing().unwrap().enabled);
        let legacy: CodexModelRoutingConfig = serde_json::from_value(json!({
            "enabled": false,
            "providerName": "Legacy Router",
            "models": []
        }))
        .unwrap();
        assert!(legacy.smart_model_names);
        db.save_codex_model_routing(&config("a")).unwrap();
        assert_eq!(db.get_codex_model_routing().unwrap(), config("a"));
        db.set_setting(SETTINGS_KEY, "{broken").unwrap();
        assert!(db.get_codex_model_routing().is_err());
    }
    #[test]
    fn resolves_latest_target_without_changing_current() {
        let db = Database::memory().unwrap();
        db.save_provider("codex", &provider("a")).unwrap();
        db.save_provider("codex", &provider("b")).unwrap();
        db.set_current_provider("codex", "a").unwrap();
        let a = config("a").resolve(&db, "x@a").unwrap();
        assert_eq!(a.provider.id, "a");
        assert_eq!(a.upstream_model, "x");
        let b = config("b").resolve(&db, "x@b").unwrap();
        assert_eq!(b.provider.id, "b");
        assert_eq!(b.upstream_model, "x");
        assert_eq!(config("a").resolve(&db, "x").unwrap().provider.id, "a");
        assert_eq!(
            db.get_current_provider("codex").unwrap().as_deref(),
            Some("a")
        );
        assert!(config("a").resolve(&db, "unknown").is_err());
    }
    #[test]
    fn rejects_duplicates_missing_models_and_accounts() {
        let mut providers = IndexMap::from([("a".into(), provider("a"))]);
        let mut cfg = config("a");
        assert!(cfg.validate(&providers, true).is_ok());
        cfg.models.push(cfg.models[0].clone());
        assert!(cfg.validate(&providers, true).is_err());
        cfg.models.pop();
        cfg.models[0].model = "missing".into();
        assert!(cfg.validate(&providers, true).is_err());
        providers["a"].meta = Some(crate::provider::ProviderMeta {
            provider_type: Some("codex_oauth".into()),
            ..Default::default()
        });
        assert!(config("a").validate(&providers, true).is_err());
    }
    #[test]
    fn stable_identity_and_root_fields_without_upstream_credentials() {
        let input = "model = \"x\"\nmodel_context_window = 999999\n[model_providers.custom]\nname = \"Old\"\nenv_key = \"SECRET\"\n[other]\nkeep = true\n";
        let projected = project_config(input, &config("a"), "http://127.0.0.1:15721/v1").unwrap();
        let doc: toml::Value = toml::from_str(&projected).unwrap();
        assert_eq!(doc["model_provider"].as_str(), Some("custom"));
        assert_eq!(doc["model_catalog_json"].as_str(), Some(CATALOG_FILENAME));
        assert!(doc["model_providers"]["custom"].get("env_key").is_none());
        assert!(doc.get("model_context_window").is_none());
        assert_eq!(doc["other"]["keep"].as_bool(), Some(true));
        assert_eq!(
            project_config(&projected, &config("a"), "http://127.0.0.1:15721/v1").unwrap(),
            projected
        );
        assert!(project_config("model_providers = 3", &config("a"), "http://localhost").is_err());
    }
    #[test]
    fn project_config_preserves_codex_desktop_preferences() {
        let input = r#"model = "x"
model_reasoning_effort = "max"

[desktop]
followUpQueueMode = "queue"
enabled-reasoning-efforts = ["low", "high", "max", "ultra"]

[model_providers.custom]
name = "Old"
"#;

        let projected = project_config(input, &config("a"), "http://127.0.0.1:15721/v1").unwrap();
        let doc: toml::Value = toml::from_str(&projected).unwrap();

        assert_eq!(doc["desktop"]["followUpQueueMode"].as_str(), Some("queue"));
        assert_eq!(
            doc["desktop"]["enabled-reasoning-efforts"].as_array(),
            Some(&vec![
                toml::Value::String("low".into()),
                toml::Value::String("high".into()),
                toml::Value::String("max".into()),
                toml::Value::String("ultra".into()),
            ])
        );
        assert!(
            doc.get("model_reasoning_effort").is_none(),
            "routing may reset the per-model effort when the routed model identity changes"
        );
    }

    #[test]
    fn explicit_default_is_independent_of_list_order() {
        let mut cfg = config("a");
        cfg.models = vec![
            ModelSelection {
                provider_id: "a".into(),
                model: "first".into(),
            },
            ModelSelection {
                provider_id: "a".into(),
                model: "second".into(),
            },
        ];
        cfg.default_model = Some(ModelSelection {
            provider_id: "a".into(),
            model: "second".into(),
        });
        assert_eq!(
            cfg.default_selection().map(|entry| entry.model.as_str()),
            Some("second")
        );
        cfg.models.reverse();
        assert_eq!(
            cfg.default_selection().map(|entry| entry.model.as_str()),
            Some("second")
        );

        let projected =
            project_config("model = \"gone\"\n", &cfg, "http://127.0.0.1:15721/v1").unwrap();
        let doc: toml::Value = toml::from_str(&projected).unwrap();
        assert_eq!(doc["model"].as_str(), Some("second@a"));

        let projected =
            project_config("model = \"first@a\"\n", &cfg, "http://127.0.0.1:15721/v1").unwrap();
        let doc: toml::Value = toml::from_str(&projected).unwrap();
        assert_eq!(
            doc["model"].as_str(),
            Some("first@a"),
            "a still-valid current model is kept even if it is not the default"
        );

        cfg.default_model = Some(ModelSelection {
            provider_id: "missing".into(),
            model: "gone".into(),
        });
        cfg.rebase_default();
        assert_eq!(
            cfg.default_model.as_ref().map(|entry| entry.model.as_str()),
            Some("second")
        );
    }

    #[test]
    fn merged_catalog_preserves_reasoning_and_capabilities() {
        let mut a = provider("a");
        a.meta = Some(crate::provider::ProviderMeta {
            api_format: Some("openai_responses".into()),
            ..Default::default()
        });
        let catalog = config("a")
            .catalog(&IndexMap::from([("a".into(), a)]))
            .unwrap();
        let entry = &catalog["models"][0];
        assert_eq!(entry["slug"], "x@a");
        assert_eq!(entry["context_window"], 64000);
        assert_eq!(entry["input_modalities"], json!(["text"]));
        assert_eq!(entry["default_reasoning_level"], "low");
        assert_eq!(entry["supported_reasoning_levels"][1]["effort"], "high");
    }

    #[test]
    fn capability_preview_uses_effective_catalog_context_windows() {
        let mut explicit = provider("explicit");
        explicit.meta = Some(crate::provider::ProviderMeta {
            api_format: Some("openai_responses".into()),
            ..Default::default()
        });

        let mut inherited = provider("inherited");
        inherited.settings_config["modelCatalog"]["models"][0]
            .as_object_mut()
            .unwrap()
            .remove("contextWindow");
        inherited.settings_config["config"] = json!(
            "model = \"x\"\nmodel_provider = \"station\"\nmodel_context_window = 200000\n[model_providers.station]\nbase_url = \"https://example.test/v1\"\n"
        );
        inherited.meta = Some(crate::provider::ProviderMeta {
            api_format: Some("openai_responses".into()),
            ..Default::default()
        });

        let mut fallback = provider("fallback");
        fallback.settings_config["modelCatalog"]["models"][0]
            .as_object_mut()
            .unwrap()
            .remove("contextWindow");
        fallback.meta = Some(crate::provider::ProviderMeta {
            api_format: Some("openai_responses".into()),
            ..Default::default()
        });

        let mut official = provider("official");
        official.settings_config["modelCatalog"]["models"] = json!([{ "model": "deepseek-flash" }]);
        official.settings_config["config"] = json!(
            "model = \"deepseek-flash\"\nmodel_provider = \"deepseek\"\n[model_providers.deepseek]\nbase_url = \"https://api.deepseek.com\"\n"
        );
        official.meta = Some(crate::provider::ProviderMeta {
            api_format: Some("openai_responses".into()),
            ..Default::default()
        });

        let capabilities = model_capabilities(&IndexMap::from([
            (explicit.id.clone(), explicit),
            (inherited.id.clone(), inherited),
            (fallback.id.clone(), fallback),
            (official.id.clone(), official),
        ]));
        let windows: HashMap<_, _> = capabilities
            .into_iter()
            .map(|capability| (capability.provider_id, capability.context_window))
            .collect();

        assert_eq!(windows["explicit"], Some(64_000));
        assert_eq!(windows["inherited"], Some(200_000));
        assert_eq!(windows["fallback"], Some(128_000));
        assert_eq!(windows["official"], Some(1_048_576));
    }

    #[test]
    fn duplicate_models_use_hidden_route_ids_and_station_display_names() {
        let providers = IndexMap::from([
            ("a".into(), named_provider("a", "A站", None)),
            ("b".into(), named_provider("b", "B站", None)),
        ]);
        let config = CodexModelRoutingConfig {
            enabled: true,
            models: vec![
                ModelSelection {
                    provider_id: "a".into(),
                    model: "x".into(),
                },
                ModelSelection {
                    provider_id: "b".into(),
                    model: "x".into(),
                },
            ],
            ..Default::default()
        };

        assert!(config.validate(&providers, true).is_ok());
        let catalog = config.catalog(&providers).unwrap();
        assert_eq!(catalog["models"][0]["slug"], "x@a");
        assert_eq!(catalog["models"][0]["display_name"], "A站 · x");
        assert_eq!(catalog["models"][1]["slug"], "x@b");
        assert_eq!(catalog["models"][1]["display_name"], "B站 · x");

        let db = Database::memory().unwrap();
        db.save_provider("codex", &providers["a"]).unwrap();
        db.save_provider("codex", &providers["b"]).unwrap();
        assert_eq!(config.resolve(&db, "x@b").unwrap().provider.id, "b");
        assert!(config.resolve(&db, "x").is_err());
    }

    #[test]
    fn smart_model_names_can_force_provider_prefix_for_single_models() {
        let providers = IndexMap::from([("a".into(), named_provider("a", "A站", None))]);
        let smart = config("a");
        assert_eq!(
            smart.catalog(&providers).unwrap()["models"][0]["display_name"],
            "x"
        );

        let mut always_prefixed = smart;
        always_prefixed.smart_model_names = false;
        assert_eq!(
            always_prefixed.catalog(&providers).unwrap()["models"][0]["display_name"],
            "A站 · x"
        );
    }

    #[test]
    fn visible_provider_and_model_combination_must_be_unique() {
        let duplicate = IndexMap::from([
            ("a".into(), named_provider("a", "A站", None)),
            ("b".into(), named_provider("b", "A站", None)),
        ]);
        let config = CodexModelRoutingConfig {
            models: vec![
                ModelSelection {
                    provider_id: "a".into(),
                    model: "x".into(),
                },
                ModelSelection {
                    provider_id: "b".into(),
                    model: "x".into(),
                },
            ],
            ..Default::default()
        };
        assert!(config.validate(&duplicate, true).is_ok());
        assert!(config.validate_visible_combinations(&duplicate).is_err());

        let aliased = IndexMap::from([
            ("a".into(), named_provider("a", "A站", None)),
            ("b".into(), named_provider("b", "A站", Some("x-b"))),
        ]);
        assert!(config.validate(&aliased, true).is_ok());
        assert!(config.validate_visible_combinations(&aliased).is_ok());
        let catalog = config.catalog(&aliased).unwrap();
        assert_eq!(catalog["models"][0]["display_name"], "x");
        assert_eq!(catalog["models"][1]["display_name"], "x-b");
    }
}
