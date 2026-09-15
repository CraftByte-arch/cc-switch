import type { CodexCatalogModel, Provider } from "@/types";
import type { CodexModelSelection } from "@/types/codexModelRouting";
import { resolveCodexOfficialIdentity } from "./providerCapabilities";

export function isModelRoutingProvider(provider: Provider): boolean {
  const identity = resolveCodexOfficialIdentity("codex", provider);
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
