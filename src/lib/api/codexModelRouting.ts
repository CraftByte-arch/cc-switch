import { invoke } from "@tauri-apps/api/core";
import type {
  CodexNativeLoginStatus,
  CodexRoutingProviderEdit,
  CodexRoutingProviderEditResult,
  CodexModelRoutingCapability,
  CodexNativeRoutingStatus,
  CodexModelRoutingConfig,
  ModelRoutingSaveResult,
} from "@/types/codexModelRouting";

export const codexModelRoutingApi = {
  editProvider: (edit: CodexRoutingProviderEdit) =>
    invoke<CodexRoutingProviderEditResult>("edit_codex_routing_provider", {
      edit,
    }),
  getNativeProvider: (force = false) =>
    invoke<CodexNativeRoutingStatus>("get_codex_native_routing_provider", {
      force,
    }),
  startNativeLogin: () =>
    invoke<CodexNativeLoginStatus>("start_codex_native_login"),
  nativeLoginStatus: (id: string) =>
    invoke<CodexNativeLoginStatus>("get_codex_native_login_status", { id }),
  cancelNativeLogin: (id: string) =>
    invoke<void>("cancel_codex_native_login", { id }),
  get: () => invoke<CodexModelRoutingConfig>("get_codex_model_routing"),
  getCapabilities: () =>
    invoke<CodexModelRoutingCapability[]>(
      "get_codex_model_routing_capabilities",
    ),
  save: (config: CodexModelRoutingConfig) =>
    invoke<ModelRoutingSaveResult>("save_codex_model_routing", { config }),
  setEnabled: (enabled: boolean) =>
    invoke<void>("set_codex_model_routing_enabled", { enabled }),
};
