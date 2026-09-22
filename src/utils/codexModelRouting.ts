import type { CodexCatalogModel, Provider } from "@/types";
import type {
  CodexModelRoutingConfig,
  CodexModelSelection,
} from "@/types/codexModelRouting";
import { resolveCodexOfficialIdentity } from "./providerCapabilities";

export const CODEX_NATIVE_ROUTE_ID = "cc-switch-current-codex-login";

export function isModelRoutingProvider(provider: Provider): boolean {
  const identity = resolveCodexOfficialIdentity("codex", provider);
  if (provider.id === CODEX_NATIVE_ROUTE_ID) return identity === "native_login";
  return (
    identity !== "native_login" &&
    identity !== "managed_account" &&
    !["codex_oauth", "xai_oauth", "github_copilot"].includes(
      provider.meta?.providerType ?? "",
    )
  );
}

export function modelRoutingOptions(provider: Provider): CodexCatalogModel[] {
  const rows: unknown = provider.settingsConfig.modelCatalog?.models;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row || typeof row.model !== "string" || !row.model.trim()) return [];
    const model = row.model.trim();
    if (seen.has(model)) return [];
    seen.add(model);
    return [
      {
        ...row,
        model,
        displayName: row.displayName ?? row.display_name,
        contextWindow: row.contextWindow ?? row.context_window,
        reasoningLevels: row.reasoningLevels ?? row.reasoning_levels,
        defaultReasoningLevel:
          row.defaultReasoningLevel ?? row.default_reasoning_level,
        supportsParallelToolCalls:
          row.supportsParallelToolCalls ?? row.supports_parallel_tool_calls,
        inputModalities: row.inputModalities ?? row.input_modalities,
        baseInstructions: row.baseInstructions ?? row.base_instructions,
      },
    ];
  });
}

export function formatContextWindow(value: number | null | undefined): string {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) return "";
  const tokens = value as number;
  if (tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
  if (tokens % (1024 * 1024) === 0) return `${tokens / (1024 * 1024)}M`;
  if (tokens % 1_000 === 0) return `${tokens / 1_000}K`;
  if (tokens % 1024 === 0) return `${tokens / 1024}K`;
  return tokens.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function modelRoutingSelectionKey(
  selection: CodexModelSelection,
): string {
  return JSON.stringify([selection.providerId, selection.model]);
}

export function modelRoutingModelLabel(model: CodexCatalogModel): string {
  return model.displayName?.trim() || model.model;
}

export function modelRoutingCombinationKey(
  provider: Provider,
  model: CodexCatalogModel,
): string {
  return JSON.stringify([provider.name.trim(), modelRoutingModelLabel(model)]);
}

/** Append a distinct provider/model route while retaining menu/default order. */
export function selectRoutedModel(
  selections: CodexModelSelection[],
  target: CodexModelSelection,
): CodexModelSelection[] {
  const targetKey = modelRoutingSelectionKey(target);
  const exists = selections.some(
    (entry) => modelRoutingSelectionKey(entry) === targetKey,
  );
  return exists ? selections : [...selections, target];
}

/** Native labels only; relay custom display names must remain byte-for-byte intact. */
export function nativeModelLabel(name: string): string {
  const trimmed = name.trim();
  if (!/^gpt-\d/i.test(trimmed)) return trimmed;
  return trimmed
    .slice(4)
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function routedModelLabel(
  config: CodexModelRoutingConfig,
  providerId: string,
  providerName: string,
  modelName: string,
  duplicate: boolean,
): string {
  if (providerId === CODEX_NATIVE_ROUTE_ID) {
    const label = nativeModelLabel(modelName);
    return (config.showNativeModelPrefix ?? true)
      ? `${(config.nativeModelPrefix ?? "官方").trim()} · ${label}`
      : label;
  }
  return !config.smartModelNames || duplicate
    ? `${providerName.trim()} · ${modelName}`
    : modelName;
}
