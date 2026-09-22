import type { CodexCatalogModel, Provider } from "@/types";
import type { CodexRoutingProviderEdit } from "@/types/codexModelRouting";
import { modelRoutingOptions } from "@/utils/codexModelRouting";

export function applyRoutingProviderEdit(
  provider: Provider,
  edit: CodexRoutingProviderEdit,
): Provider {
  const next = structuredClone(provider);
  if (edit.name) next.name = edit.name;
  if (edit.models) {
    const catalog =
      next.settingsConfig.modelCatalog &&
      typeof next.settingsConfig.modelCatalog === "object"
        ? { ...next.settingsConfig.modelCatalog, models: edit.models }
        : { models: edit.models };
    next.settingsConfig = { ...next.settingsConfig, modelCatalog: catalog };
  }
  return next;
}

export function mergeRoutingProviderEdit(
  original: Provider,
  previous: CodexRoutingProviderEdit | undefined,
  next: CodexRoutingProviderEdit,
  applied: Provider,
): CodexRoutingProviderEdit {
  const merged: CodexRoutingProviderEdit = { providerId: original.id };
  if (applied.name !== original.name) {
    merged.name = applied.name;
    merged.expectedName = original.name;
  }
  const originalCatalog = original.settingsConfig.modelCatalog ?? null;
  const appliedCatalog = applied.settingsConfig.modelCatalog ?? null;
  if (JSON.stringify(originalCatalog) !== JSON.stringify(appliedCatalog)) {
    merged.expectedCatalog = originalCatalog;
    merged.models = modelRoutingOptions(applied);
    const rename = composeRename(previous?.rename, next.rename);
    if (rename && isValidRename(original, applied, rename)) {
      merged.rename = rename;
    }
  }
  return merged;
}

export function splitRoutingProviderPersist(
  edit: CodexRoutingProviderEdit,
  original: Provider,
): {
  upsert: CodexRoutingProviderEdit;
  remaining?: CodexRoutingProviderEdit;
} {
  if (!edit.models) return { upsert: edit };
  const originalModels = catalogModels(original);
  const appliedIds = new Set(edit.models.map((row) => row.model));
  const renamedFrom = edit.rename?.from;
  const deleted = originalModels.filter(
    (row) => !appliedIds.has(row.model) && row.model !== renamedFrom,
  );
  if (!deleted.length) return { upsert: edit };
  return {
    upsert: { ...edit, models: [...edit.models, ...deleted] },
    remaining: {
      providerId: edit.providerId,
      models: edit.models,
    },
  };
}

function composeRename(
  previous: { from: string; to: string } | undefined,
  next: { from: string; to: string } | undefined,
) {
  if (!next) return previous;
  if (previous && previous.to === next.from) {
    return previous.from === next.to
      ? undefined
      : { from: previous.from, to: next.to };
  }
  return next;
}

function isValidRename(
  original: Provider,
  applied: Provider,
  rename: { from: string; to: string },
) {
  const originalIds = new Set(
    modelRoutingOptions(original).map((row) => row.model),
  );
  const appliedIds = new Set(
    modelRoutingOptions(applied).map((row) => row.model),
  );
  return (
    rename.from !== rename.to &&
    originalIds.has(rename.from) &&
    !originalIds.has(rename.to) &&
    appliedIds.has(rename.to) &&
    !appliedIds.has(rename.from)
  );
}

function catalogModels(provider: Provider): CodexCatalogModel[] {
  const rows = provider.settingsConfig.modelCatalog?.models;
  return Array.isArray(rows) ? rows : [];
}
