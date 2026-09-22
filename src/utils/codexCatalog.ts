import type { CodexCatalogModel } from "@/types";

export const normalizeCodexCatalogModelsForSave = (
  models: CodexCatalogModel[],
): CodexCatalogModel[] => {
  const seen = new Set<string>();
  const normalized: CodexCatalogModel[] = [];

  for (const item of models) {
    const model = item.model.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);

    const displayName = item.displayName?.trim();
    const rawContextWindow = String(item.contextWindow ?? "").replace(
      /[^\d]/g,
      "",
    );
    const contextWindow = rawContextWindow
      ? Number.parseInt(rawContextWindow, 10)
      : undefined;

    const inputModalities = item.inputModalities?.filter(
      (m) => typeof m === "string" && m.trim(),
    );

    const baseInstructions = item.baseInstructions?.trim();
    const reasoningLevels = item.reasoningLevels
      ?.filter((level) => typeof level === "string" && level.trim())
      .map((level) => level.trim());
    const defaultReasoningLevel = item.defaultReasoningLevel?.trim();

    normalized.push({
      model,
      ...(displayName ? { displayName } : {}),
      ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
      // Native Responses profile overrides (ignored by the chat/proxy profile).
      ...(typeof item.supportsParallelToolCalls === "boolean"
        ? { supportsParallelToolCalls: item.supportsParallelToolCalls }
        : {}),
      ...(inputModalities && inputModalities.length > 0
        ? { inputModalities }
        : {}),
      ...(baseInstructions ? { baseInstructions } : {}),
      ...(reasoningLevels && reasoningLevels.length > 0
        ? { reasoningLevels }
        : {}),
      ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
    });
  }

  return normalized;
};

/** Preserve extension metadata, while replacing all known fields and legacy aliases. */
export function normalizeEditedCodexCatalogModel(
  model: CodexCatalogModel,
): CodexCatalogModel {
  const known = new Set([
    "model",
    "displayName",
    "display_name",
    "contextWindow",
    "context_window",
    "reasoningLevels",
    "reasoning_levels",
    "defaultReasoningLevel",
    "default_reasoning_level",
    "supportsParallelToolCalls",
    "supports_parallel_tool_calls",
    "inputModalities",
    "input_modalities",
    "baseInstructions",
    "base_instructions",
  ]);
  const extensions = Object.fromEntries(
    Object.entries(model).filter(([key]) => !known.has(key)),
  );
  return { ...extensions, ...normalizeCodexCatalogModelsForSave([model])[0] };
}

/** Menu label from a Codex model id: hyphens become spaces, each word capitalized. */
export function optimizeCodexModelDisplayName(modelId: string): string {
  return modelId
    .trim()
    .split(/-+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
