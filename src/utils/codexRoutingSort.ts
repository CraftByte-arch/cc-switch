import type { CodexModelSelection } from "@/types/codexModelRouting";
import { modelRoutingSelectionKey } from "@/utils/codexModelRouting";

export type RoutingSortMode = "manual" | "provider" | "model";

export function resolveRoutingDefault(
  models: CodexModelSelection[],
  defaultModel?: CodexModelSelection | null,
): CodexModelSelection | undefined {
  if (!models.length) return undefined;
  if (defaultModel) {
    const key = modelRoutingSelectionKey(defaultModel);
    const found = models.find(
      (entry) => modelRoutingSelectionKey(entry) === key,
    );
    if (found) return found;
  }
  return models[0];
}

export function withRoutedModels(
  current: {
    models: CodexModelSelection[];
    defaultModel?: CodexModelSelection;
  },
  models: CodexModelSelection[],
): { models: CodexModelSelection[]; defaultModel?: CodexModelSelection } {
  return {
    models,
    defaultModel: resolveRoutingDefault(models, current.defaultModel),
  };
}

/** Display order is independent of the runtime default. */
export function sortRoutingModels(
  models: CodexModelSelection[],
  mode: RoutingSortMode,
  describe: (entry: CodexModelSelection) => { provider: string; model: string },
  locale?: string,
): CodexModelSelection[] {
  if (mode === "manual" || models.length < 2) return models;
  const compare = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  }).compare;
  const decorated = models.map((entry) => ({ entry, names: describe(entry) }));
  decorated.sort((a, b) => {
    const provider =
      compare(a.names.provider, b.names.provider) ||
      compare(a.entry.providerId, b.entry.providerId);
    const modelName = compare(a.names.model, b.names.model);
    const modelId = compare(a.entry.model, b.entry.model);
    return mode === "provider"
      ? provider || modelName || modelId
      : modelName || provider || modelId;
  });
  const result = decorated.map(({ entry }) => entry);
  return result.every((entry, i) => entry === models[i]) ? models : result;
}
