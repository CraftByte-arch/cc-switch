import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, Trash2 } from "lucide-react";
import type { CodexCatalogModel, Provider } from "@/types";
import type {
  CodexRoutingProviderEdit,
  CodexRoutingProviderEditResult,
} from "@/types/codexModelRouting";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodexCatalogModelFields } from "@/components/providers/forms/CodexCatalogModelFields";
import { fetchModelsForConfig, type FetchedModel } from "@/lib/api/model-fetch";
import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
} from "@/utils/providerConfigUtils";
import { normalizeEditedCodexCatalogModel } from "@/utils/codexCatalog";
import { modelRoutingOptions } from "@/utils/codexModelRouting";
import { extractErrorMessage } from "@/utils/errorUtils";

export interface RoutingProviderEditorTarget {
  provider: Provider;
  mode: "name" | "model" | "fetch";
  model?: CodexCatalogModel;
}

export function CodexRoutingProviderEditor({
  target,
  referenced,
  lastLiveModel,
  pending,
  onSave,
  onClose,
}: {
  target: RoutingProviderEditorTarget;
  referenced: boolean;
  lastLiveModel: boolean;
  pending: boolean;
  onSave: (
    edit: CodexRoutingProviderEdit,
  ) => Promise<CodexRoutingProviderEditResult>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The target is a snapshot taken when opening. A concurrent edit is rejected
  // by the backend, rather than overwriting new provider settings silently.
  const { provider, mode } = target;
  const [model, setModel] = useState<CodexCatalogModel>(() =>
    structuredClone(target.model ?? { model: "" }),
  );
  const [name, setName] = useState(provider.name);
  const [models, setModels] = useState<FetchedModel[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const alive = useRef(true);
  const started = useRef(false);
  const originalModels = modelRoutingOptions(provider);
  const existing = new Set(originalModels.map((row) => row.model));
  const title = t(
    mode === "name"
      ? "codexRouting.quick.renameProvider"
      : mode === "fetch"
        ? "codexRouting.quick.fetchModels"
        : target.model
          ? "codexRouting.quick.editModel"
          : "codexRouting.quick.addModel",
  );
  const fetchModels = async () => {
    setFetching(true);
    setError("");
    try {
      const config = provider.settingsConfig.config ?? "";
      const baseUrl = extractCodexBaseUrl(config);
      const apiKey =
        provider.settingsConfig.auth?.OPENAI_API_KEY ||
        extractCodexExperimentalBearerToken(config);
      if (!baseUrl || !apiKey)
        throw new Error(t("providerForm.fetchModelsNeedConfig"));
      const result = await fetchModelsForConfig(
        baseUrl,
        apiKey,
        provider.meta?.isFullUrl,
        undefined,
        provider.meta?.customUserAgent,
      );
      if (!alive.current) return;
      const unique = Array.from(
        new Map(
          result.filter((row) => row.id.trim()).map((row) => [row.id, row]),
        ).values(),
      );
      setModels(unique);
      const available = new Set(unique.map((row) => row.id));
      setSelected(
        (current) =>
          new Set(
            [...current].filter((id) => available.has(id) && !existing.has(id)),
          ),
      );
      setFetched(true);
    } catch (e) {
      if (alive.current)
        setError(
          t("codexRouting.quick.fetchFailed", {
            error: extractErrorMessage(e),
          }),
        );
    } finally {
      if (alive.current) setFetching(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (mode === "fetch" && !started.current) {
      started.current = true;
      void fetchModels();
    }
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async () => {
    setError("");
    try {
      const edit: CodexRoutingProviderEdit = { providerId: provider.id };
      if (mode === "name") {
        if (!name.trim()) throw new Error(t("codexRouting.quick.nameRequired"));
        edit.name = name.trim();
        edit.expectedName = provider.name;
      } else {
        edit.expectedCatalog = provider.settingsConfig.modelCatalog ?? null;
        // Untouched rows are carried through verbatim, including future/hidden fields.
        const rows: CodexCatalogModel[] =
          provider.settingsConfig.modelCatalog?.models ?? [];
        if (mode === "fetch") {
          edit.models = [
            ...rows,
            ...models
              .filter((row) => selected.has(row.id) && !existing.has(row.id))
              .map((row) => ({ model: row.id })),
          ];
        } else if (deleting) {
          edit.models = rows.filter(
            (row) => row.model.trim() !== target.model?.model,
          );
        } else {
          const id = model.model.trim();
          if (!id) throw new Error(t("codexRouting.quick.modelRequired"));
          if (id !== target.model?.model && existing.has(id))
            throw new Error(t("codexRouting.quick.duplicateModel"));
          if (
            model.contextWindow &&
            (!Number.isSafeInteger(Number(model.contextWindow)) ||
              Number(model.contextWindow) <= 0)
          )
            throw new Error(t("codexRouting.quick.invalidContext"));
          const updated = normalizeEditedCodexCatalogModel(model);
          edit.models = target.model
            ? rows.map((row) =>
                row.model.trim() === target.model?.model ? updated : row,
              )
            : [...rows, updated];
          if (target.model && id !== target.model.model)
            edit.rename = { from: target.model.model, to: id };
        }
      }
      await onSave(edit);
      onClose();
    } catch (e) {
      if (alive.current) setError(extractErrorMessage(e));
    }
  };
  const visible = models.filter((row) =>
    row.id.toLowerCase().includes(search.toLowerCase()),
  );
  const disabled =
    pending ||
    fetching ||
    (mode === "fetch" && selected.size === 0) ||
    (mode === "name" && (!name.trim() || name.trim() === provider.name)) ||
    (deleting && lastLiveModel);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        zIndex="top"
        className="max-w-2xl gap-0 p-0"
        onEscapeKeyDown={(event) => {
          event.stopPropagation();
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>
            {title}
            <span className="ml-2 break-words text-sm font-normal text-muted-foreground">
              {provider.name}
            </span>
          </DialogTitle>
          <DialogDescription>
            {t("codexRouting.quick.saveHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset disabled={pending} className="min-w-0 space-y-4">
            {mode === "name" ? (
              <Input
                autoFocus
                aria-label={t("codexRouting.quick.providerName")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !disabled) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            ) : mode === "model" ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <CodexCatalogModelFields
                    labels
                    model={model}
                    onChange={(patch) =>
                      setModel((current) => ({ ...current, ...patch }))
                    }
                    fetchedModels={models}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fetching}
                  onClick={() => void fetchModels()}
                >
                  {fetching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {t("codexRouting.quick.fetchModels")}
                </Button>
                {fetched && models.length === 0 && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("providerForm.fetchModelsEmpty")}
                  </p>
                )}
                {referenced && model.model.trim() !== target.model?.model && (
                  <p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
                    {t("codexRouting.quick.renameHint")}
                  </p>
                )}
                {deleting && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  >
                    {t(
                      lastLiveModel
                        ? "codexRouting.quick.lastModel"
                        : referenced
                          ? "codexRouting.quick.deleteReferenced"
                          : "codexRouting.quick.deleteConfirm",
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    aria-label={t("codexRouting.search")}
                    placeholder={t("codexRouting.search")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={fetching}
                    onClick={() => void fetchModels()}
                  >
                    {t("common.refresh")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("codexRouting.quick.fetchHint")}
                </p>
                {fetching ? (
                  <p role="status" className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("codexRouting.quick.fetching")}
                  </p>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {visible.map((row) => (
                      <label
                        key={row.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted has-[:disabled]:cursor-default"
                      >
                        <input
                          type="checkbox"
                          checked={existing.has(row.id) || selected.has(row.id)}
                          disabled={existing.has(row.id)}
                          onChange={(e) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(row.id);
                              else next.delete(row.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 break-all font-mono text-xs">
                          {row.id}
                        </span>
                        {existing.has(row.id) && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t("codexRouting.quick.alreadyAdded")}
                          </span>
                        )}
                      </label>
                    ))}
                    {fetched && !visible.length && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {t(
                          search
                            ? "codexRouting.layout.noSearchResults"
                            : "providerForm.fetchModelsEmpty",
                        )}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-wrap gap-2 border-t px-5 py-4 sm:justify-between">
          <div>
            {mode === "model" && target.model && (
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() => setDeleting(!deleting)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t(
                  deleting ? "common.cancel" : "codexRouting.quick.deleteModel",
                )}
              </Button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={pending} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={disabled}
              variant={deleting ? "destructive" : "default"}
              onClick={() => void submit()}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t(
                deleting
                  ? "codexRouting.quick.confirmDelete"
                  : mode === "fetch"
                    ? "codexRouting.quick.addSelected"
                    : "codexRouting.quick.saveProvider",
                { count: selected.size },
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
