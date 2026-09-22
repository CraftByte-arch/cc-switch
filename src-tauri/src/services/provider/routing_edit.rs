//! Field-scoped edits from the router. Provider storage remains the sole catalog source.
use super::{live, ProviderService};
use crate::{
    app_config::AppType, error::AppError, provider::Provider,
    proxy::codex_model_routing as routing, store::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexRoutingProviderEdit {
    pub provider_id: String,
    pub expected_name: Option<String>,
    pub name: Option<String>,
    pub expected_catalog: Option<Value>,
    pub models: Option<Vec<Value>>,
    pub rename: Option<ModelRename>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelRename {
    pub from: String,
    pub to: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRoutingProviderEditResult {
    pub provider: Provider,
    pub config: routing::CodexModelRoutingConfig,
    pub affects_live: bool,
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.into())
}

impl CodexRoutingProviderEdit {
    fn apply(&self, original: &Provider) -> Result<Provider, AppError> {
        if original.category.as_deref() == Some("official")
            || matches!(
                original
                    .meta
                    .as_ref()
                    .and_then(|meta| meta.provider_type.as_deref()),
                Some("codex_oauth" | "xai_oauth" | "github_copilot")
            )
            || !routing::provider_is_eligible(original)
            || original.id == crate::proxy::codex_native_route::PROVIDER_ID
        {
            return Err(invalid("官方或托管账号的模型不能在此修改"));
        }
        let mut provider = original.clone();
        if let Some(name) = &self.name {
            if self.expected_name.as_deref() != Some(original.name.as_str()) {
                return Err(invalid("供应商名称已在其他页面修改，请重新打开编辑器"));
            }
            if name.trim().is_empty() {
                return Err(invalid("供应商名称不能为空"));
            }
            provider.name = name.trim().into();
        }
        if let Some(models) = &self.models {
            let catalog = original
                .settings_config
                .get("modelCatalog")
                .cloned()
                .unwrap_or(Value::Null);
            if self.expected_catalog.as_ref().unwrap_or(&Value::Null) != &catalog {
                return Err(invalid("模型设置已在其他页面修改，请重新打开编辑器"));
            }
            let mut ids = std::collections::HashSet::new();
            for model in models {
                let id = model.get("model").and_then(Value::as_str).unwrap_or("");
                if id.trim().is_empty() || id != id.trim() || !ids.insert(id) {
                    return Err(invalid("实际请求模型不能为空或重复"));
                }
                if let Some(window) = model.get("contextWindow") {
                    if window
                        .as_u64()
                        .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
                        .is_none()
                    {
                        return Err(invalid("上下文长度必须为正整数"));
                    }
                }
                if let Some(levels) = model.get("reasoningLevels") {
                    let valid = [
                        "none",
                        "minimal",
                        "low",
                        "medium",
                        "high",
                        "xhigh",
                        "max",
                        "ultra",
                        "persistent",
                    ];
                    let Some(levels) = levels.as_array() else {
                        return Err(invalid("推理强度必须为列表"));
                    };
                    if levels
                        .iter()
                        .any(|v| !v.as_str().is_some_and(|v| valid.contains(&v)))
                    {
                        return Err(invalid("推理强度不受支持"));
                    }
                    if let Some(default) = model.get("defaultReasoningLevel") {
                        if !levels.contains(default) {
                            return Err(invalid("默认推理强度必须在支持列表中"));
                        }
                    }
                }
            }
            let mut catalog = catalog.as_object().cloned().unwrap_or_default();
            catalog.insert("models".into(), Value::Array(models.clone()));
            provider.settings_config["modelCatalog"] = Value::Object(catalog);
        }
        if let Some(rename) = &self.rename {
            if self.models.is_none()
                || rename.from == rename.to
                || !routing::has_model(original, &rename.from)
                || routing::has_model(&provider, &rename.from)
                || !routing::has_model(&provider, &rename.to)
                || routing::has_model(original, &rename.to)
            {
                return Err(invalid("模型重命名无效，请重新打开编辑器"));
            }
        }
        // Match the full provider form's empty-default fallback, and keep an
        // explicitly renamed default model pointing to the new upstream ID.
        if let Some(models) = &self.models {
            let text = provider.settings_config["config"].as_str().unwrap_or("");
            let mut document = text
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| invalid("供应商 TOML 配置无效，请进入详细设置修复"))?;
            let default_model = document.get("model").and_then(toml_edit::Item::as_str);
            let replacement = if let Some(rename) = &self.rename {
                if default_model == Some(rename.from.as_str()) {
                    Some(rename.to.as_str())
                } else {
                    None
                }
            } else {
                None
            }
            .or_else(|| {
                if default_model.is_none_or(|id| id.trim().is_empty()) {
                    models.first().and_then(|m| m["model"].as_str())
                } else {
                    None
                }
            });
            if let Some(replacement) = replacement {
                document["model"] = toml_edit::value(replacement);
                provider.settings_config["config"] = Value::String(document.to_string());
            }
        }
        Ok(provider)
    }
}

impl ProviderService {
    pub fn edit_codex_routing_provider(
        state: &AppState,
        edit: CodexRoutingProviderEdit,
    ) -> Result<CodexRoutingProviderEditResult, AppError> {
        let _guard = futures::executor::block_on(state.proxy_service.lock_switch_for_app("codex"));
        let original = state
            .db
            .get_provider_by_id(&edit.provider_id, "codex")?
            .ok_or_else(|| invalid("供应商已不存在"))?;
        let provider = edit.apply(&original)?;
        Self::validate_provider_settings(&AppType::Codex, &provider)?;
        let old_config = state.db.get_codex_model_routing()?;
        let active = old_config.enabled
            && futures::executor::block_on(state.db.get_proxy_config_for_app("codex"))?.enabled;
        if active {
            futures::executor::block_on(
                state
                    .proxy_service
                    .update_codex_provider_in_model_routing_with_rename(
                        &provider,
                        edit.rename
                            .as_ref()
                            .map(|r| (r.from.as_str(), r.to.as_str())),
                    ),
            )?;
            return Ok(CodexRoutingProviderEditResult {
                affects_live: old_config.references_provider(&provider.id),
                provider,
                config: state.db.get_codex_model_routing()?,
            });
        }
        let mut config = old_config.clone();
        if let Some(rename) = &edit.rename {
            config.rename_route(&provider.id, &rename.from, &rename.to);
        }
        config.models.retain(|entry| {
            entry.provider_id != provider.id || routing::has_model(&provider, &entry.model)
        });
        config.rebase_default();
        let mut providers =
            crate::proxy::codex_native_route::providers_for_config(&state.db, &config)?;
        providers.insert(provider.id.clone(), provider.clone());
        config.validate(&providers, false)?;
        config.validate_visible_combinations(&providers)?;
        let current = crate::settings::get_effective_current_provider(&state.db, &AppType::Codex)?
            .as_deref()
            == Some(&provider.id);
        let snapshot = if current {
            Some(crate::codex_config::CodexLiveStateSnapshot::capture()?)
        } else {
            None
        };
        let backup = if current {
            futures::executor::block_on(state.db.get_live_backup("codex"))?
        } else {
            None
        };
        let result = (|| {
            if current {
                live::sync_live_for_provider_respecting_takeover_guarded(
                    state,
                    &AppType::Codex,
                    &provider,
                )?;
            }
            state.db.save_provider("codex", &provider)?;
            state.db.save_codex_model_routing(&config)?;
            Ok::<(), AppError>(())
        })();
        if let Err(error) = result {
            let mut failures = Vec::new();
            if let Err(e) = state.db.save_provider("codex", &original) {
                failures.push(e.to_string());
            }
            if let Err(e) = state.db.save_codex_model_routing(&old_config) {
                failures.push(e.to_string());
            }
            let error = if let Some(snapshot) = &snapshot {
                Self::managed_codex_takeover_transaction_error(
                    state,
                    "修改供应商模型",
                    error,
                    snapshot,
                    backup.as_ref(),
                    None,
                )
            } else {
                error
            };
            return Err(if failures.is_empty() {
                error
            } else {
                AppError::Message(format!("{error}; 回滚失败: {}", failures.join("; ")))
            });
        }
        Ok(CodexRoutingProviderEditResult {
            provider,
            config,
            affects_live: current,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;

    fn fixture() -> Provider {
        Provider::with_id(
            "station".into(),
            "Station".into(),
            json!({
                "auth": { "OPENAI_API_KEY": "fixture-key" },
                "config": "model = \"old\"\nmodel_provider = \"custom\"\n[model_providers.custom]\nname = \"Custom\"\nbase_url = \"https://fixture.example/v1\"\nwire_api = \"responses\"\n",
                "modelCatalog": { "customVersion": 1, "models": [
                    {"model":"old", "contextWindow":128000, "reasoningLevels":["low","high"], "supportsParallelToolCalls":true, "baseInstructions":"Fixture instructions"},
                    {"model":"second"}
                ]}
            }),
            None,
        )
    }
    fn edit(provider: &Provider, models: Value, rename: Value) -> CodexRoutingProviderEdit {
        serde_json::from_value(json!({"providerId":provider.id, "expectedCatalog":provider.settings_config["modelCatalog"], "models":models, "rename":rename})).unwrap()
    }
    fn routes() -> routing::CodexModelRoutingConfig {
        serde_json::from_value(json!({"providerName":"Router", "models":[{"providerId":"station","model":"old"},{"providerId":"station","model":"second"}]})).unwrap()
    }
    #[test]
    fn quick_edit_rejects_stale_fields_and_preserves_credentials_and_metadata() {
        let original = fixture();
        let rename: CodexRoutingProviderEdit = serde_json::from_value(
            json!({"providerId":"station","name":"New name","expectedName":"Station"}),
        )
        .unwrap();
        let updated = rename.apply(&original).unwrap();
        assert_eq!(updated.settings_config, original.settings_config);
        assert_eq!(updated.name, "New name");
        assert!(rename.apply(&updated).is_err());
        let mut models = original.settings_config["modelCatalog"]["models"].clone();
        models[0]["contextWindow"] = json!(200000);
        let patch = edit(&original, models, Value::Null);
        let updated = patch.apply(&original).unwrap();
        assert_eq!(
            updated.settings_config["auth"],
            original.settings_config["auth"]
        );
        assert_eq!(updated.settings_config["modelCatalog"]["customVersion"], 1);
        assert_eq!(
            updated.settings_config["modelCatalog"]["models"][0]["baseInstructions"],
            "Fixture instructions"
        );
        assert!(patch.apply(&updated).is_err());
    }
    #[test]
    fn quick_edit_validates_ids_context_and_default_effort() {
        let original = fixture();
        for models in [
            json!([{"model":""}]),
            json!([{"model":"x"},{"model":"x"}]),
            json!([{"model":"x","contextWindow":0}]),
            json!([{"model":"x","reasoningLevels":["low"],"defaultReasoningLevel":"high"}]),
        ] {
            assert!(edit(&original, models, Value::Null)
                .apply(&original)
                .is_err());
        }
        let renamed = edit(
            &original,
            json!([{"model":"new"},{"model":"second"}]),
            json!({"from":"old","to":"new"}),
        )
        .apply(&original)
        .unwrap();
        assert!(renamed.settings_config["config"]
            .as_str()
            .unwrap()
            .contains("model = \"new\""));
        let mut official = original.clone();
        official.category = Some("official".into());
        assert!(edit(&official, json!([]), Value::Null)
            .apply(&official)
            .is_err());
    }
    #[test]
    #[serial]
    fn quick_edit_offline_renames_and_deletes_references_without_creating_live_files() {
        super::super::tests::with_test_home(|state, _| {
            crate::settings::reload_settings().unwrap();
            let original = fixture();
            state.db.save_provider("codex", &original).unwrap();
            state.db.save_codex_model_routing(&routes()).unwrap();
            let result = ProviderService::edit_codex_routing_provider(
                state,
                edit(
                    &original,
                    json!([{"model":"new"},{"model":"second"}]),
                    json!({"from":"old","to":"new"}),
                ),
            )
            .unwrap();
            assert_eq!(result.config.models[0].model, "new");
            assert_eq!(result.config.models[1].model, "second");
            assert!(!result.affects_live);
            assert!(!crate::codex_config::get_codex_config_path().exists());
            let result = ProviderService::edit_codex_routing_provider(
                state,
                edit(&result.provider, json!([{"model":"second"}]), Value::Null),
            )
            .unwrap();
            assert_eq!(result.config.models.len(), 1);
            assert_eq!(result.config.models[0].model, "second");
        });
    }
    #[test]
    #[serial]
    fn quick_edit_live_preserves_route_order_and_rejects_removing_last_model() {
        super::super::tests::with_test_home(|state, _| {
            crate::settings::reload_settings().unwrap();
            let original = fixture();
            state.db.save_provider("codex", &original).unwrap();
            let mut config = routes();
            config.enabled = true;
            state.db.save_codex_model_routing(&config).unwrap();
            tauri::async_runtime::block_on(async {
                let mut proxy = state.db.get_proxy_config_for_app("codex").await.unwrap();
                proxy.enabled = true;
                state.db.update_proxy_config_for_app(proxy).await.unwrap();
            });
            let result = ProviderService::edit_codex_routing_provider(state,edit(&original,json!([{"model":"new","contextWindow":200000,"reasoningLevels":["low","high","max"]},{"model":"second"}]),json!({"from":"old","to":"new"}))).unwrap();
            assert!(result.affects_live);
            assert_eq!(result.config.models[0].model, "new");
            let catalog = std::fs::read_to_string(
                crate::codex_config::get_codex_config_dir().join(routing::CATALOG_FILENAME),
            )
            .unwrap();
            assert!(catalog.contains("new@station"));
            assert!(catalog.contains("200000"));
            let result = ProviderService::edit_codex_routing_provider(
                state,
                edit(&result.provider, json!([{"model":"new"}]), Value::Null),
            )
            .unwrap();
            let before = std::fs::read(crate::codex_config::get_codex_config_path()).unwrap();
            assert!(ProviderService::edit_codex_routing_provider(
                state,
                edit(&result.provider, json!([]), Value::Null)
            )
            .is_err());
            assert_eq!(state.db.get_codex_model_routing().unwrap().models.len(), 1);
            assert_eq!(
                std::fs::read(crate::codex_config::get_codex_config_path()).unwrap(),
                before
            );
        });
    }
}
