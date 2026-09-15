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
    /// Ordered, unique provider/model routes; first entry is the initial default.
    pub models: Vec<ModelSelection>,
}

impl Default for CodexModelRoutingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_name: "CC Switch Router".into(),
            smart_model_names: true,
            models: Vec::new(),
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
    // Native-login/account-bound routes have their own credential lifecycle.
    // Do not reuse inbound OAuth credentials across selected stations.
    !super::providers::is_codex_official_provider(provider) && !provider.uses_managed_account_auth()
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

        let config = provider
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .unwrap_or("");
        let profile = super::providers::resolve_codex_catalog_tool_profile(provider);
        let context_windows = crate::codex_config::codex_model_catalog_from_settings(
            &provider.settings_config,
            config,
            profile,
        )
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
        Ok(())
    }

    pub fn validate_visible_combinations(
        &self,
        providers: &IndexMap<String, Provider>,
    ) -> Result<(), AppError> {
        let mut seen = HashSet::new();
        for entry in &self.models {
            let provider = providers.get(&entry.provider_id).ok_or_else(|| {
                AppError::InvalidInput(format!("供应商已不存在：{}", entry.provider_id))
            })?;
            let display_name = model_display_name(provider, &entry.model);
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
            let config = provider
                .settings_config
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or("");
            let profile = super::providers::resolve_codex_catalog_tool_profile(provider);
            let catalog = crate::codex_config::codex_model_catalog_from_settings(
                &provider.settings_config,
                config,
                profile,
            )?
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
            let display_name = if !self.smart_model_names
                || display_name_counts.get(&model_name).copied().unwrap_or(0) > 1
            {
                format!("{} · {}", provider.name.trim(), model_name)
            } else {
                model_name
            };
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
        let provider = db
            .get_provider_by_id(&selection.provider_id, "codex")?
            .ok_or_else(|| {
                AppError::InvalidInput("模型对应的供应商已被删除，请重新配置路由".into())
            })?;
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
    table["experimental_bearer_token"] = toml_edit::value("PROXY_MANAGED");
    table["requires_openai_auth"] = toml_edit::value(false);
    table["supports_websockets"] = toml_edit::value(false);
    providers.insert(PROVIDER_ID, toml_edit::Item::Table(table));
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
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
