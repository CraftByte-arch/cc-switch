import "./CodexModelRoutingDialog.css";
import {
  CodexRoutingProviderEditor,
  type RoutingProviderEditorTarget,
} from "./CodexRoutingProviderEditor";
import { CodexRoutingSettings } from "./CodexRoutingSettings";
import {
  RoutingCapabilitySummary,
  RoutingModelDetails,
} from "./CodexRoutingModelInfo";
import { CodexNativeRoutingHeader } from "./CodexNativeRoutingHeader";
import { CodexNativeLoginButton } from "./CodexNativeLoginButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  GripVertical,
  Loader2,
  Pencil,
  ExternalLink,
  Plus,
  Download,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { CodexCatalogModel, Provider } from "@/types";
import type {
  CodexModelRoutingConfig,
  CodexModelSelection,
  CodexRoutingProviderEdit,
  CodexRoutingProviderEditResult,
} from "@/types/codexModelRouting";
import { useQueryClient } from "@tanstack/react-query";
import {
  requestCodexMaintenance,
  codexRoutingOwnsLive,
} from "@/lib/codexMaintenance";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useCodexModelRouting,
  useEditCodexRoutingProvider,
  useCodexNativeRoutingProvider,
  useCodexModelRoutingCapabilities,
  useSaveCodexModelRouting,
  codexModelRoutingKey,
} from "@/lib/query/codexModelRouting";
import {
  CODEX_NATIVE_ROUTE_ID,
  nativeModelLabel,
  routedModelLabel,
  isModelRoutingProvider,
  modelRoutingCombinationKey,
  modelRoutingModelLabel,
  modelRoutingOptions,
  modelRoutingSelectionKey,
  selectRoutedModel,
} from "@/utils/codexModelRouting";
import { optimizeCodexModelDisplayName } from "@/utils/codexCatalog";
import { extractErrorMessage } from "@/utils/errorUtils";
import { cn } from "@/lib/utils";
import {
  resolveRoutingDefault,
  sortRoutingModels,
  withRoutedModels,
  type RoutingSortMode,
} from "@/utils/codexRoutingSort";
import {
  applyRoutingProviderEdit,
  mergeRoutingProviderEdit,
  splitRoutingProviderPersist,
} from "@/utils/codexRoutingProviderDraft";

const EMPTY: CodexModelRoutingConfig = {
  enabled: false,
  providerName: "CC Switch Router",
  smartModelNames: true,
  models: [],
};

function patchRoutedModels(
  current: CodexModelRoutingConfig,
  models: CodexModelSelection[],
): CodexModelRoutingConfig {
  return { ...current, ...withRoutedModels(current, models) };
}

function SortModeSwitch({
  value,
  disabled,
  onChange,
}: {
  value: RoutingSortMode;
  disabled: boolean;
  onChange: (mode: RoutingSortMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="routing-sort-switch"
      role="radiogroup"
      aria-label={t("codexRouting.sorting.label")}
      data-value={value}
    >
      <span className="routing-sort-indicator" aria-hidden="true" />
      {(["provider", "model", "manual"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          disabled={disabled}
          onClick={() => onChange(mode)}
        >
          {t(`codexRouting.sorting.${mode}`)}
        </button>
      ))}
    </div>
  );
}

function SelectedModel({
  entry,
  provider,
  model,
  contextWindow,
  contextLoading,
  displayName,
  conflict,
  missingReason,
  index,
  isDefault,
  disabled,
  onRemove,
  onEdit,
  onSetDefault,
}: {
  entry: CodexModelSelection;
  provider?: Provider;
  model?: CodexCatalogModel;
  contextWindow?: number | null;
  contextLoading: boolean;
  displayName: string;
  conflict: boolean;
  missingReason?: string;
  index: number;
  isDefault: boolean;
  disabled: boolean;
  onRemove: () => void;
  onEdit?: () => void;
  onSetDefault: () => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: modelRoutingSelectionKey(entry), disabled });
  const providerName =
    provider?.name ??
    (entry.providerId === CODEX_NATIVE_ROUTE_ID
      ? t("codexRouting.nativeName")
      : entry.providerId);
  const native = entry.providerId === CODEX_NATIVE_ROUTE_ID;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 1 : undefined,
      }}
      className="routing-selected-row"
      data-conflict={conflict || !model}
      data-default={isDefault}
    >
      <button
        type="button"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={t("codexRouting.reorder", { model: entry.model })}
        className="routing-icon-button touch-none cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <div className="routing-selected-content min-w-0">
        <div className="routing-selected-heading flex min-h-6 flex-wrap items-center gap-2">
          <span className="routing-selected-name">{displayName}</span>
          {isDefault ? (
            <button type="button" className="routing-set-default" disabled>
              {t("codexRouting.sorting.defaultLabel")}
            </button>
          ) : (
            <button
              type="button"
              className="routing-set-default"
              disabled={disabled}
              onClick={onSetDefault}
            >
              {t("codexRouting.sorting.setDefault")}
            </button>
          )}
        </div>
        {model && (
          <RoutingModelDetails
            model={model}
            modelId={entry.model}
            providerName={providerName}
            contextWindow={contextWindow}
            contextLoading={contextLoading}
            native={native}
          />
        )}
        {conflict && (
          <p className="mt-1 text-xs text-destructive">
            {t("codexRouting.nativeLabelConflict")}
          </p>
        )}
        {!model && (
          <p className="mt-1 text-xs text-destructive">
            {missingReason ?? t("codexRouting.missing")}
          </p>
        )}
      </div>
      <div className="routing-selected-actions">
        {onEdit && (
          <button
            type="button"
            className="routing-icon-button"
            disabled={disabled}
            onClick={onEdit}
            aria-label={t("codexRouting.quick.editNamedModel", {
              provider: providerName,
              model: model ? modelRoutingModelLabel(model) : entry.model,
            })}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="routing-icon-button"
          aria-label={t("codexRouting.remove", { model: entry.model })}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function CodexModelRoutingDialog({
  open,
  onOpenChange,
  providers,
  active,
  onEditProvider,
  detailEditorOpen = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Record<string, Provider>;
  active: boolean;
  onEditProvider: (provider: Provider) => void;
  detailEditorOpen?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const query = useCodexModelRouting();
  const capabilitiesQuery = useCodexModelRoutingCapabilities(open);
  const queryClient = useQueryClient();
  const save = useSaveCodexModelRouting({ requestRestart: false });
  const [draft, setDraft] = useState(EMPTY);
  const [baseline, setBaseline] = useState(EMPTY);
  const [providerEdits, setProviderEdits] = useState<
    Record<string, CodexRoutingProviderEdit>
  >({});
  const [sortMode, setSortMode] = useState<RoutingSortMode>("manual");
  const [initialized, setInitialized] = useState(false);
  const nativeEnabled = draft.nativeSubscriptionEnabled ?? true;
  const nativeQuery = useCodexNativeRoutingProvider(
    open && initialized && nativeEnabled,
  );
  const [confirmDisableNative, setConfirmDisableNative] = useState(false);
  const [expiredOfficialChoice, setExpiredOfficialChoice] = useState(false);
  const [loginSignal, setLoginSignal] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [activePane, setActivePane] = useState<"available" | "selected">(
    "available",
  );
  const [nativePrefixExpanded, setNativePrefixExpanded] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [providerEditor, setProviderEditor] =
    useState<RoutingProviderEditorTarget>();
  const lastSavedRouting = useRef("");
  const previousProviders = useRef(providers);
  const persisting = useRef(false);
  const editProvider = useEditCodexRoutingProvider(undefined, {
    requestRestart: false,
  });
  const overlayProviders = useMemo(() => {
    const next: Record<string, Provider> = { ...providers };
    for (const [id, edit] of Object.entries(providerEdits)) {
      if (next[id]) next[id] = applyRoutingProviderEdit(next[id], edit);
    }
    return next;
  }, [providers, providerEdits]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    if (!initialized && query.data) {
      const cloned = structuredClone(query.data);
      const initial = {
        ...cloned,
        nativeSubscriptionEnabled: query.data.nativeSubscriptionEnabled ?? true,
        showNativeModelPrefix: query.data.showNativeModelPrefix ?? true,
        nativeModelPrefix:
          query.data.nativeModelPrefix ?? t("codexRouting.nativePrefixDefault"),
        defaultModel: resolveRoutingDefault(cloned.models, cloned.defaultModel),
      };
      lastSavedRouting.current = JSON.stringify(query.data);
      previousProviders.current = providers;
      setDraft(initial);
      setBaseline(structuredClone(initial));
      setSortMode("manual");
      setSearch("");
      setActivePane("available");
      setNativePrefixExpanded(false);
      setSelectionNotice("");
      setError("");
      setProviderEdits({});
      setInitialized(true);
    }
  }, [open, query.data, initialized]);

  useEffect(() => {
    if (!open || !initialized || !query.data || persisting.current) return;
    const snapshot = JSON.stringify(query.data);
    if (snapshot !== lastSavedRouting.current) {
      lastSavedRouting.current = snapshot;
      const nextKeys = new Set(query.data.models.map(modelRoutingSelectionKey));
      const removed = new Set(
        baseline.models
          .map(modelRoutingSelectionKey)
          .filter((key) => !nextKeys.has(key)),
      );
      setDraft((current) =>
        patchRoutedModels(
          current,
          current.models.filter(
            (entry) => !removed.has(modelRoutingSelectionKey(entry)),
          ),
        ),
      );
      setBaseline((current) => ({ ...current, ...query.data }));
    }
    // Detailed provider editing may also remove models selected only in the
    // unsaved route draft. Retain everything else (search, order and settings).
    const previous = previousProviders.current;
    previousProviders.current = providers;
    if (previous !== providers) {
      setDraft((current) =>
        patchRoutedModels(
          current,
          current.models.filter((entry) => {
            if (entry.providerId === CODEX_NATIVE_ROUTE_ID) return true;
            const before = previous[entry.providerId];
            if (
              !before ||
              !modelRoutingOptions(before).some(
                (row) => row.model === entry.model,
              )
            )
              return true;
            return Boolean(
              providers[entry.providerId] &&
                modelRoutingOptions(providers[entry.providerId]).some(
                  (row) => row.model === entry.model,
                ),
            );
          }),
        ),
      );
    }
  }, [open, initialized, query.data, providers, baseline.models]);

  const groups = useMemo(
    () =>
      [
        {
          ...((nativeEnabled ? nativeQuery.data?.provider : null) ?? {
            id: CODEX_NATIVE_ROUTE_ID,
            category: "official",
            settingsConfig: {
              auth: {},
              config: "",
              modelCatalog: { models: [] },
            },
          }),
          name: t("codexRouting.nativeName"),
        } as Provider,
        ...Object.values(overlayProviders),
      ]
        .filter(isModelRoutingProvider)
        .map((provider) => ({
          provider,
          models: modelRoutingOptions(provider),
        })),
    [overlayProviders, nativeQuery.data, nativeEnabled, t],
  );
  const contextWindows = useMemo(
    () =>
      new Map(
        (capabilitiesQuery.data ?? []).map((capability) => [
          modelRoutingSelectionKey(capability),
          capability.contextWindow,
        ]),
      ),
    [capabilitiesQuery.data],
  );
  const routingIndex = useMemo(() => {
    const bySelection = new Map<
      string,
      {
        provider: Provider;
        model: CodexCatalogModel;
        combinationKey: string;
      }
    >();
    const byCombination = new Map<
      string,
      Array<{ provider: Provider; model: CodexCatalogModel }>
    >();

    for (const group of groups) {
      for (const model of group.models) {
        const selection = {
          providerId: group.provider.id,
          model: model.model,
        };
        const combinationKey = modelRoutingCombinationKey(
          group.provider,
          model,
        );
        bySelection.set(modelRoutingSelectionKey(selection), {
          provider: group.provider,
          model,
          combinationKey,
        });
        const options = byCombination.get(combinationKey) ?? [];
        options.push({ provider: group.provider, model });
        byCombination.set(combinationKey, options);
      }
    }

    return {
      bySelection,
      conflicts: Array.from(byCombination.entries())
        .filter(([, options]) => options.length > 1)
        .map(([key, options]) => ({ key, options })),
    };
  }, [groups]);
  useEffect(() => {
    if (!open || !initialized || sortMode === "manual") return;
    setDraft((current) => {
      const models = sortRoutingModels(
        current.models,
        sortMode,
        (entry) => {
          const detail = routingIndex.bySelection.get(
            modelRoutingSelectionKey(entry),
          );
          return {
            provider: detail?.provider.name ?? entry.providerId,
            model: detail ? modelRoutingModelLabel(detail.model) : entry.model,
          };
        },
        i18n.resolvedLanguage,
      );
      return models === current.models ? current : { ...current, models };
    });
  }, [
    open,
    initialized,
    sortMode,
    routingIndex,
    draft.models,
    i18n.resolvedLanguage,
  ]);

  const selectedState = useMemo(() => {
    const modelNameCounts = new Map<string, number>();
    const combinationCounts = new Map<string, number>();
    const details = new Map<
      string,
      {
        provider?: Provider;
        model?: CodexCatalogModel;
        modelName: string;
        combinationKey?: string;
      }
    >();

    for (const entry of draft.models) {
      const selectionKey = modelRoutingSelectionKey(entry);
      const option = routingIndex.bySelection.get(selectionKey);
      const modelName = option
        ? modelRoutingModelLabel(option.model)
        : entry.providerId === CODEX_NATIVE_ROUTE_ID
          ? nativeModelLabel(entry.model)
          : entry.model;
      details.set(selectionKey, {
        provider: option?.provider,
        model: option?.model,
        modelName,
        combinationKey: option?.combinationKey,
      });
      modelNameCounts.set(modelName, (modelNameCounts.get(modelName) ?? 0) + 1);
      if (option) {
        combinationCounts.set(
          option.combinationKey,
          (combinationCounts.get(option.combinationKey) ?? 0) + 1,
        );
      }
    }

    return { details, modelNameCounts, combinationCounts };
  }, [draft.models, routingIndex]);
  const hasNativeSelection = draft.models.some(
    (entry) => entry.providerId === CODEX_NATIVE_ROUTE_ID,
  );
  const metadataUpdated =
    hasNativeSelection &&
    nativeQuery.data?.status === "ready" &&
    nativeQuery.data.catalogRevision !== baseline.nativeCatalogRevision;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) ||
    metadataUpdated ||
    Object.keys(providerEdits).length > 0;
  const selectedMissing = draft.models.some(
    (entry) => !routingIndex.bySelection.has(modelRoutingSelectionKey(entry)),
  );
  const displayLabel = (entry: CodexModelSelection) => {
    const detail = selectedState.details.get(modelRoutingSelectionKey(entry));
    const modelName = detail?.modelName ?? entry.model;
    return routedModelLabel(
      draft,
      entry.providerId,
      detail?.provider?.name ?? entry.providerId,
      modelName,
      (selectedState.modelNameCounts.get(modelName) ?? 0) > 1,
    );
  };
  const labelCounts = new Map<string, number>();
  for (const entry of draft.models) {
    const label = displayLabel(entry);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const nativeLabelConflicts = new Set(
    draft.models
      .filter(
        (entry) =>
          entry.providerId === CODEX_NATIVE_ROUTE_ID &&
          (labelCounts.get(displayLabel(entry)) ?? 0) > 1,
      )
      .map(displayLabel),
  );
  const selectedConflict =
    nativeLabelConflicts.size > 0 ||
    Array.from(selectedState.combinationCounts.values()).some(
      (count) => count > 1,
    );
  const invalidPrefix =
    nativeEnabled &&
    (draft.showNativeModelPrefix ?? true) &&
    !(draft.nativeModelPrefix ?? "").trim();
  const nativeBusy = hasNativeSelection && nativeQuery.isSyncing;
  const nativeMissingReason = t(
    nativeQuery.data?.status === "signedOut" ||
      nativeQuery.data?.status === "loginRequired"
      ? "codexRouting.nativeNeedsLogin"
      : nativeQuery.data?.status === "ready"
        ? "codexRouting.nativeMissingModel"
        : "codexRouting.nativeNeedsSync",
  );
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      visible: group.models.filter((model) =>
        `${group.provider.name} ${model.model} ${model.displayName ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    }))
    .filter(
      (group) =>
        group.provider.id === CODEX_NATIVE_ROUTE_ID ||
        !search ||
        group.visible.length > 0,
    );
  const pending = save.isPending || editProvider.isPending;
  const disableNative = () => {
    setDraft((current) =>
      patchRoutedModels(
        {
          ...current,
          nativeSubscriptionEnabled: false,
          nativeCatalog: null,
          nativeCatalogRevision: null,
        },
        current.models.filter(
          (entry) => entry.providerId !== CODEX_NATIVE_ROUTE_ID,
        ),
      ),
    );
    setConfirmDisableNative(false);
  };

  const close = () => {
    if (!pending) {
      if (dirty) setDiscard(true);
      else onOpenChange(false);
    }
  };
  const choose = (entry: CodexModelSelection) => {
    const targetKey = modelRoutingSelectionKey(entry);
    const existing = draft.models.some(
      (row) => modelRoutingSelectionKey(row) === targetKey,
    );
    const label = routingIndex.bySelection.get(targetKey);
    setSelectionNotice(
      t(
        existing
          ? "codexRouting.layout.modelRemoved"
          : "codexRouting.layout.modelAdded",
        { model: label ? modelRoutingModelLabel(label.model) : entry.model },
      ),
    );
    if (existing) {
      setDraft(
        patchRoutedModels(
          draft,
          draft.models.filter(
            (row) => modelRoutingSelectionKey(row) !== targetKey,
          ),
        ),
      );
    } else {
      setDraft(
        patchRoutedModels(draft, selectRoutedModel(draft.models, entry)),
      );
    }
  };
  const applyProviderDraft = async (
    edit: CodexRoutingProviderEdit,
  ): Promise<CodexRoutingProviderEditResult> => {
    const original = providers[edit.providerId];
    if (!original) throw new Error(t("codexRouting.missing"));
    const current = overlayProviders[edit.providerId] ?? original;
    const applied = applyRoutingProviderEdit(current, edit);
    const merged = mergeRoutingProviderEdit(
      original,
      providerEdits[edit.providerId],
      edit,
      applied,
    );
    setProviderEdits((prev) => {
      if (!merged.name && !merged.models) {
        const next = { ...prev };
        delete next[edit.providerId];
        return next;
      }
      return { ...prev, [edit.providerId]: merged };
    });
    const valid = new Set(modelRoutingOptions(applied).map((row) => row.model));
    setDraft((currentDraft) =>
      patchRoutedModels(
        {
          ...currentDraft,
          defaultModel:
            edit.rename &&
            currentDraft.defaultModel?.providerId === edit.providerId &&
            currentDraft.defaultModel.model === edit.rename.from
              ? { ...currentDraft.defaultModel, model: edit.rename.to }
              : currentDraft.defaultModel,
        },
        currentDraft.models.flatMap((entry) => {
          if (entry.providerId !== edit.providerId) return [entry];
          const model =
            edit.rename?.from === entry.model ? edit.rename.to : entry.model;
          return valid.has(model) ? [{ ...entry, model }] : [];
        }),
      ),
    );
    toast.success(t("codexRouting.quick.saved"));
    return { provider: applied, config: draft, affectsLive: false };
  };
  const optimizeAllDisplayNames = () => {
    const nextEdits = { ...providerEdits };
    let changed = 0;
    for (const group of groups) {
      if (group.provider.id === CODEX_NATIVE_ROUTE_ID) continue;
      const original = providers[group.provider.id];
      if (!original) continue;
      const current = overlayProviders[group.provider.id] ?? original;
      const rows = modelRoutingOptions(current);
      let providerChanged = false;
      const models = rows.map((row) => {
        const displayName = optimizeCodexModelDisplayName(row.model);
        if ((row.displayName?.trim() || row.model) === displayName) return row;
        providerChanged = true;
        changed += 1;
        return { ...row, displayName };
      });
      if (!providerChanged) continue;
      const edit = {
        providerId: group.provider.id,
        models,
      };
      const applied = applyRoutingProviderEdit(current, edit);
      nextEdits[group.provider.id] = mergeRoutingProviderEdit(
        original,
        providerEdits[group.provider.id],
        edit,
        applied,
      );
    }
    if (!changed) {
      toast.message(t("codexRouting.quick.optimizeNamesNone"));
      return;
    }
    setProviderEdits(nextEdits);
    toast.success(
      t("codexRouting.quick.optimizeAllNamesDone", { count: changed }),
    );
  };

  const optimizeProviderDisplayNames = (
    provider: Provider,
    onlyModel?: string,
  ) => {
    const current = overlayProviders[provider.id] ?? provider;
    const rows = modelRoutingOptions(current);
    let changed = false;
    const models = rows.map((row) => {
      if (onlyModel && row.model !== onlyModel) return row;
      const displayName = optimizeCodexModelDisplayName(row.model);
      if ((row.displayName?.trim() || row.model) === displayName) return row;
      changed = true;
      return { ...row, displayName };
    });
    if (!changed) {
      toast.message(t("codexRouting.quick.optimizeNamesNone"));
      return;
    }
    void applyProviderDraft({
      providerId: provider.id,
      expectedCatalog:
        providers[provider.id]?.settingsConfig.modelCatalog ?? null,
      models,
    });
  };

  const revertDrafts = () => {
    setDraft(structuredClone(baseline));
    setProviderEdits({});
    setSortMode("manual");
    setError("");
  };
  const submit = async (source: CodexModelRoutingConfig = draft) => {
    setError("");
    persisting.current = true;
    try {
      const payload = {
        ...source,
        defaultModel: resolveRoutingDefault(draft.models, draft.defaultModel),
        nativeCatalog: null,
        nativeCatalogRevision: source.models.some(
          (entry) => entry.providerId === CODEX_NATIVE_ROUTE_ID,
        )
          ? (nativeQuery.data?.catalogRevision ?? null)
          : null,
      };
      const previous = queryClient.getQueryData(codexModelRoutingKey);
      const routingChanged =
        JSON.stringify(previous) !== JSON.stringify(payload);
      const wasLive = codexRoutingOwnsLive(queryClient);
      let affectsLive = false;
      const remaining: CodexRoutingProviderEdit[] = [];
      for (const edit of Object.values(providerEdits)) {
        const original = providers[edit.providerId];
        if (!original) continue;
        const split = splitRoutingProviderPersist(edit, original);
        const result = await editProvider.mutateAsync(split.upsert);
        affectsLive = affectsLive || result.affectsLive;
        if (split.remaining) {
          remaining.push({
            ...split.remaining,
            expectedCatalog:
              result.provider.settingsConfig.modelCatalog ?? null,
          });
        }
      }
      const result = await save.mutateAsync(payload);
      for (const edit of remaining) {
        const leftover = await editProvider.mutateAsync(edit);
        affectsLive = affectsLive || leftover.affectsLive;
      }
      lastSavedRouting.current = JSON.stringify(result.config);
      setDraft(result.config);
      setBaseline(structuredClone(result.config));
      setProviderEdits({});
      if (affectsLive || (wasLive && routingChanged)) {
        requestCodexMaintenance();
      }
      toast.success(
        result.catalogChanged
          ? t("codexRouting.savedCatalog", {
              defaultValue:
                "已保存。模型菜单或能力已变化，若 Codex 未刷新，请重新打开 Codex。",
            })
          : t(active ? "codexRouting.savedLive" : "codexRouting.savedDraft", {
              defaultValue: active
                ? "已保存，后续请求使用新路由；进行中的请求不受影响。"
                : "配置已保存，未启动服务，也未修改 Codex 配置。",
            }),
      );
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      persisting.current = false;
    }
  };

  const selectionProblem = selectedMissing || selectedConflict;
  // A stopped route is only a draft. Missing or duplicate entries stay
  // visible as a warning, but must not block saving unrelated edits.
  const selectionWarning =
    !active && selectionProblem
      ? t("codexRouting.selectionNeedsAttentionDraft")
      : "";
  const saveBlockReason = !draft.providerName.trim()
    ? t("codexRouting.layout.nameRequired")
    : invalidPrefix
      ? t("codexRouting.nativePrefixRequired")
      : active && selectedConflict
        ? t("codexRouting.nativeLabelConflict")
        : active && selectedMissing
          ? t("codexRouting.selectionNeedsAttention")
          : nativeBusy
            ? t("codexRouting.nativeSyncBeforeSave")
            : active && !draft.models.length
              ? t("codexRouting.layout.activeNeedsModel")
              : "";
  const saveDisabled =
    !dirty || !initialized || pending || Boolean(saveBlockReason);

  return (
    <>
      <FullScreenPanel
        isOpen={open}
        title={t("codexRouting.title")}
        onClose={() => {
          if (!providerEditor && !detailEditorOpen) close();
        }}
        scrollMode="contained"
        contentClassName="h-full min-h-0 space-y-0 px-4 py-2 sm:px-6"
        footer={
          <>
            <div className="mr-auto min-w-0 text-xs">
              <p className="font-medium">
                {t("codexRouting.layout.selectionCount", {
                  count: draft.models.length,
                })}
                <span className="mx-1.5 text-muted-foreground">·</span>
                {t(
                  dirty
                    ? "codexRouting.layout.unsaved"
                    : "codexRouting.layout.saved",
                )}
              </p>
              <p className="mt-0.5 hidden text-muted-foreground sm:block">
                {t("codexRouting.quick.pageHint")}
              </p>
            </div>
            {dirty && (
              <Button
                variant="ghost"
                className="shrink-0"
                onClick={revertDrafts}
                disabled={pending}
              >
                {t("common.cancel")}
              </Button>
            )}
            <Button
              variant="outline"
              className="shrink-0"
              onClick={close}
              disabled={pending}
            >
              {t("common.close")}
            </Button>
            <Button
              onClick={() => {
                const officialBlocked =
                  draft.models.some(
                    (entry) => entry.providerId === CODEX_NATIVE_ROUTE_ID,
                  ) &&
                  (nativeQuery.data?.status === "signedOut" ||
                    nativeQuery.data?.status === "loginRequired" ||
                    nativeQuery.data?.status === "unavailable");
                if (officialBlocked) {
                  setExpiredOfficialChoice(true);
                  return;
                }
                void submit();
              }}
              className="shrink-0"
              disabled={saveDisabled}
              aria-describedby={
                saveBlockReason ? "routing-save-reason" : undefined
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("codexRouting.save")}
            </Button>
          </>
        }
      >
        <div className="codex-routing-layout">
          <CodexNativeLoginButton
            disabled={pending || !initialized}
            onComplete={() => nativeQuery.refresh()}
            openSignal={loginSignal}
            promptOnly
          />
          <div className="routing-toolbar">
            <div
              className="routing-tabs"
              data-pane={activePane}
              role="tablist"
              aria-label={t("codexRouting.title")}
              onKeyDown={(event) => {
                const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "available"
                    : event.key === "End"
                      ? "selected"
                      : activePane === "available"
                        ? "selected"
                        : "available";
                setActivePane(next);
                event.currentTarget
                  .querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)
                  ?.focus();
              }}
            >
              <span className="routing-tabs-indicator" aria-hidden="true" />
              <button
                type="button"
                role="tab"
                id="routing-available-tab"
                data-pane="available"
                aria-controls="routing-available-pane"
                aria-selected={activePane === "available"}
                tabIndex={activePane === "available" ? 0 : -1}
                onClick={() => setActivePane("available")}
              >
                {t("codexRouting.available")}
              </button>
              <button
                type="button"
                role="tab"
                id="routing-selected-tab"
                data-pane="selected"
                aria-controls="routing-selected-pane"
                aria-selected={activePane === "selected"}
                tabIndex={activePane === "selected" ? 0 : -1}
                onClick={() => setActivePane("selected")}
              >
                {t("codexRouting.selected", { count: draft.models.length })}
              </button>
            </div>
            <div className="routing-toolbar-main">
              <div
                className="routing-toolbar-search"
                hidden={activePane !== "available"}
              >
                <Search
                  className="routing-search-icon h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  className="h-9 pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label={t("codexRouting.search")}
                  placeholder={t("codexRouting.search")}
                />
              </div>
              <div
                className="routing-toolbar-sort"
                hidden={activePane !== "selected"}
              >
                <SortModeSwitch
                  value={sortMode}
                  disabled={pending}
                  onChange={setSortMode}
                />
              </div>
            </div>
          </div>
          <div className="routing-toolbar-secondary">
            <CodexRoutingSettings
              config={draft}
              disabled={pending || !initialized}
              onChange={setDraft}
            />
            {groups.some(
              (group) => group.provider.id !== CODEX_NATIVE_ROUTE_ID,
            ) && (
              <TooltipProvider delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 px-2 text-xs"
                      disabled={pending || !initialized}
                      onClick={optimizeAllDisplayNames}
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("codexRouting.quick.optimizeAllNames")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">
                    {t("codexRouting.quick.optimizeAllNamesHint")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {(query.isLoading ||
            query.isError ||
            saveBlockReason ||
            selectionWarning ||
            error ||
            (metadataUpdated && !selectedMissing) ||
            routingIndex.conflicts.length > 0) && (
            <div className="routing-notices space-y-1.5">
              {query.isLoading && <p role="status">{t("common.loading")}</p>}
              {query.isError && (
                <p role="alert" className="text-destructive">
                  {t("codexRouting.loadFailed")}{" "}
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => query.refetch()}
                  >
                    {t("common.retry")}
                  </Button>
                </p>
              )}
              {(saveBlockReason || selectionWarning) && (
                <div
                  id="routing-save-reason"
                  role={nativeBusy ? "status" : "alert"}
                  className="flex flex-wrap items-center gap-x-2 rounded-md bg-muted/60 px-3 py-2"
                >
                  {!nativeBusy && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <span>{saveBlockReason || selectionWarning}</span>
                  {invalidPrefix || !draft.providerName.trim() ? (
                    <button
                      type="button"
                      className="font-medium text-primary underline underline-offset-2"
                      onClick={() => {
                        if (invalidPrefix) {
                          setActivePane("available");
                          setNativePrefixExpanded(true);
                          requestAnimationFrame(() => {
                            const pane = document.querySelector(
                              ".routing-candidates-scroll",
                            );
                            if (pane) pane.scrollTop = 0;
                            document
                              .getElementById("native-prefix")
                              ?.focus({ preventScroll: true });
                          });
                        } else {
                          document.getElementById("codex-router-name")?.focus();
                        }
                      }}
                    >
                      {t(
                        invalidPrefix
                          ? "codexRouting.editNativePrefix"
                          : "codexRouting.layout.checkSettings",
                      )}
                    </button>
                  ) : (
                    selectionProblem && (
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-2"
                        onClick={() => setActivePane("selected")}
                      >
                        {t("codexRouting.layout.reviewSelected")}
                      </button>
                    )
                  )}
                </div>
              )}
              {routingIndex.conflicts.length > 0 && (
                <details className="rounded-md border border-amber-300/60 px-3 py-2 dark:border-amber-500/40">
                  <summary className="cursor-pointer font-medium">
                    {t("codexRouting.duplicateCombinationTitle", {
                      count: routingIndex.conflicts.length,
                    })}
                  </summary>
                  <p className="pt-2 leading-relaxed text-muted-foreground">
                    {t("codexRouting.duplicateCombinationHint")}
                  </p>
                </details>
              )}
              {metadataUpdated && !selectedMissing && (
                <p role="status" className="text-muted-foreground">
                  {t("codexRouting.nativeMetadataUpdated")}
                </p>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
          <div className="routing-workspace">
            <section
              id="routing-available-pane"
              className="routing-pane"
              data-pane="available"
              data-active={activePane === "available"}
              aria-hidden={activePane !== "available"}
              role="tabpanel"
              aria-labelledby="routing-available-tab"
            >
              <div
                className="routing-pane-scroll routing-candidates-scroll scroll-overlay"
                tabIndex={0}
                aria-label={t("codexRouting.available")}
              >
                <div className="routing-provider-list">
                  {visibleGroups.map(({ provider, visible }) => (
                    <section
                      key={provider.id}
                      className={cn(
                        "routing-provider",
                        provider.id === CODEX_NATIVE_ROUTE_ID &&
                          "routing-provider-native",
                      )}
                      aria-label={provider.name}
                    >
                      {provider.id === CODEX_NATIVE_ROUTE_ID ? (
                        <CodexNativeRoutingHeader
                          state={nativeQuery.data}
                          busy={nativeQuery.isSyncing}
                          requestError={nativeQuery.syncError}
                          disabled={pending || !initialized}
                          onRefresh={() => nativeQuery.refresh()}
                          config={draft}
                          visible={open}
                          onEnabledChange={(enabled) => {
                            if (enabled)
                              setDraft({
                                ...draft,
                                nativeSubscriptionEnabled: true,
                              });
                            else if (hasNativeSelection)
                              setConfirmDisableNative(true);
                            else disableNative();
                          }}
                          onChange={setDraft}
                          expanded={nativePrefixExpanded}
                          onExpandedChange={setNativePrefixExpanded}
                          previewModel={
                            nativeQuery.data?.status === "ready" &&
                            groups[0]?.models[0]
                              ? modelRoutingModelLabel(groups[0].models[0])
                              : undefined
                          }
                        />
                      ) : (
                        <div className="routing-provider-header">
                          <div className="flex min-w-0 items-center gap-1">
                            <h4 className="min-w-0 flex-1 break-words text-sm font-semibold">
                              {provider.name}
                            </h4>
                            <button
                              type="button"
                              className="routing-icon-button"
                              disabled={pending}
                              aria-label={t(
                                "codexRouting.quick.renameNamedProvider",
                                { provider: provider.name },
                              )}
                              onClick={() =>
                                setProviderEditor({ provider, mode: "name" })
                              }
                            >
                              <Pencil
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                          <div className="routing-provider-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              className="h-8 gap-1 px-1.5 text-xs text-muted-foreground"
                              onClick={() => onEditProvider(provider)}
                              aria-label={t(
                                "codexRouting.quick.providerDetails",
                                { provider: provider.name },
                              )}
                            >
                              {t("codexRouting.quick.details")}
                              <ExternalLink
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              className="h-8 gap-1 px-1.5 text-xs text-muted-foreground"
                              onClick={() =>
                                setProviderEditor({ provider, mode: "fetch" })
                              }
                              aria-label={t(
                                "codexRouting.quick.fetchNamedProvider",
                                { provider: provider.name },
                              )}
                            >
                              <Download
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                              {t("codexRouting.quick.fetchModels")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              className="h-8 gap-1 px-1.5 text-xs text-muted-foreground"
                              onClick={() =>
                                optimizeProviderDisplayNames(provider)
                              }
                              aria-label={t(
                                "codexRouting.quick.optimizeNamedProvider",
                                {
                                  provider: provider.name,
                                },
                              )}
                            >
                              <Sparkles
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                              {t("codexRouting.quick.optimizeNames")}
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="routing-model-options">
                        {visible.map((model) => {
                          const selection = {
                            providerId: provider.id,
                            model: model.model,
                          };
                          const selectionKey =
                            modelRoutingSelectionKey(selection);
                          const selected = draft.models.some(
                            (entry) =>
                              modelRoutingSelectionKey(entry) === selectionKey,
                          );
                          const combinationKey = modelRoutingCombinationKey(
                            provider,
                            model,
                          );
                          const blocked =
                            !selected &&
                            draft.models.some(
                              (entry) =>
                                modelRoutingSelectionKey(entry) !==
                                  selectionKey &&
                                routingIndex.bySelection.get(
                                  modelRoutingSelectionKey(entry),
                                )?.combinationKey === combinationKey,
                            );
                          const native = provider.id === CODEX_NATIVE_ROUTE_ID;
                          const contextWindow = native
                            ? typeof model.contextWindow === "number"
                              ? model.contextWindow
                              : undefined
                            : contextWindows.get(selectionKey);
                          const contextLoading =
                            !native && capabilitiesQuery.isLoading;
                          const modelLabel = modelRoutingModelLabel(model);
                          const conflictReason = t(
                            "codexRouting.duplicateCombinationDisabled",
                            { provider: provider.name, model: modelLabel },
                          );
                          return (
                            <div
                              key={selectionKey}
                              className="routing-model-option"
                            >
                              <div
                                className="routing-candidate"
                                data-selected={selected}
                              >
                                <button
                                  type="button"
                                  className="routing-model-select"
                                  aria-pressed={selected}
                                  disabled={
                                    pending ||
                                    !initialized ||
                                    blocked ||
                                    (native && nativeQuery.isSyncing)
                                  }
                                  onClick={() => choose(selection)}
                                  aria-label={`${provider.name} / ${modelLabel}`}
                                  aria-describedby={
                                    blocked
                                      ? `routing-blocked-${selectionKey}`
                                      : undefined
                                  }
                                >
                                  <span className="routing-model-copy">
                                    <span className="routing-model-name">
                                      {modelLabel}
                                    </span>
                                    <RoutingCapabilitySummary
                                      model={model}
                                      contextWindow={contextWindow}
                                      contextLoading={contextLoading}
                                      native={native}
                                    />
                                  </span>
                                </button>
                                {!native && (
                                  <button
                                    type="button"
                                    className="routing-icon-button"
                                    disabled={pending}
                                    aria-label={t(
                                      "codexRouting.quick.editNamedModel",
                                      {
                                        provider: provider.name,
                                        model: modelLabel,
                                      },
                                    )}
                                    onClick={() =>
                                      setProviderEditor({
                                        provider,
                                        model,
                                        mode: "model",
                                      })
                                    }
                                  >
                                    <Pencil
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  </button>
                                )}
                                {!native &&
                                  optimizeCodexModelDisplayName(model.model) !==
                                    (model.displayName?.trim() ||
                                      model.model) && (
                                    <button
                                      type="button"
                                      className="routing-icon-button"
                                      disabled={pending}
                                      aria-label={t(
                                        "codexRouting.quick.optimizeNamedModel",
                                        {
                                          provider: provider.name,
                                          model: modelLabel,
                                        },
                                      )}
                                      onClick={() =>
                                        optimizeProviderDisplayNames(
                                          provider,
                                          model.model,
                                        )
                                      }
                                    >
                                      <Sparkles
                                        className="h-3.5 w-3.5"
                                        aria-hidden="true"
                                      />
                                    </button>
                                  )}
                              </div>
                              {blocked && (
                                <p
                                  id={`routing-blocked-${selectionKey}`}
                                  className="px-3 pb-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
                                >
                                  {conflictReason}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {provider.id !== CODEX_NATIVE_ROUTE_ID && (
                          <button
                            type="button"
                            className="routing-add-model"
                            disabled={pending}
                            onClick={() =>
                              setProviderEditor({ provider, mode: "model" })
                            }
                            aria-label={t(
                              "codexRouting.quick.addNamedProvider",
                              { provider: provider.name },
                            )}
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            {t("codexRouting.quick.addModel")}
                          </button>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
                {!visibleGroups.some((group) => group.visible.length > 0) && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t(
                      search
                        ? "codexRouting.layout.noSearchResults"
                        : "codexRouting.noAvailable",
                    )}
                  </p>
                )}
              </div>
            </section>
            <section
              id="routing-selected-pane"
              className="routing-pane routing-selected-pane"
              data-pane="selected"
              data-active={activePane === "selected"}
              aria-hidden={activePane !== "selected"}
              role="tabpanel"
              aria-labelledby="routing-selected-tab"
            >
              <div
                className="routing-pane-scroll scroll-overlay"
                tabIndex={0}
                aria-label={t("codexRouting.selected", {
                  count: draft.models.length,
                })}
              >
                <div className="routing-selected-canvas">
                  <p className="routing-sort-hint">
                    {t(
                      sortMode === "manual"
                        ? "codexRouting.sorting.manualHint"
                        : "codexRouting.sorting.autoHint",
                    )}
                  </p>
                  {draft.models.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("codexRouting.layout.emptySelected")}
                      </p>
                      <Button
                        variant="link"
                        onClick={() => setActivePane("available")}
                      >
                        {t("codexRouting.layout.browseModels")}
                      </Button>
                    </div>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={({ active: dragged, over }) => {
                        if (!over || pending) return;
                        const from = draft.models.findIndex(
                          (entry) =>
                            modelRoutingSelectionKey(entry) === dragged.id,
                        );
                        const to = draft.models.findIndex(
                          (entry) =>
                            modelRoutingSelectionKey(entry) === over.id,
                        );
                        if (from >= 0 && to >= 0 && from !== to) {
                          setSortMode("manual");
                          setDraft(
                            patchRoutedModels(
                              draft,
                              arrayMove(draft.models, from, to),
                            ),
                          );
                        }
                      }}
                    >
                      <SortableContext
                        items={draft.models.map(modelRoutingSelectionKey)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="routing-selected-list">
                          {draft.models.map((entry, index) => {
                            const selectionKey =
                              modelRoutingSelectionKey(entry);
                            const detail =
                              selectedState.details.get(selectionKey);
                            const displayName = displayLabel(entry);
                            const conflict =
                              nativeLabelConflicts.has(displayName) ||
                              Boolean(
                                detail?.combinationKey &&
                                  (selectedState.combinationCounts.get(
                                    detail.combinationKey,
                                  ) ?? 0) > 1,
                              );
                            return (
                              <SelectedModel
                                key={selectionKey}
                                entry={entry}
                                index={index}
                                isDefault={
                                  modelRoutingSelectionKey(
                                    resolveRoutingDefault(
                                      draft.models,
                                      draft.defaultModel,
                                    ) ?? entry,
                                  ) === selectionKey
                                }
                                disabled={pending}
                                provider={detail?.provider}
                                model={detail?.model}
                                contextWindow={
                                  entry.providerId === CODEX_NATIVE_ROUTE_ID
                                    ? typeof detail?.model?.contextWindow ===
                                      "number"
                                      ? detail.model.contextWindow
                                      : undefined
                                    : contextWindows.get(selectionKey)
                                }
                                contextLoading={
                                  entry.providerId === CODEX_NATIVE_ROUTE_ID
                                    ? false
                                    : capabilitiesQuery.isLoading
                                }
                                missingReason={
                                  entry.providerId === CODEX_NATIVE_ROUTE_ID
                                    ? nativeMissingReason
                                    : undefined
                                }
                                displayName={displayName}
                                onEdit={
                                  detail?.provider &&
                                  detail.model &&
                                  entry.providerId !== CODEX_NATIVE_ROUTE_ID
                                    ? () =>
                                        setProviderEditor({
                                          provider: detail.provider!,
                                          model: detail.model,
                                          mode: "model",
                                        })
                                    : undefined
                                }
                                conflict={conflict}
                                onSetDefault={() =>
                                  setDraft({ ...draft, defaultModel: entry })
                                }
                                onRemove={() =>
                                  setDraft(
                                    patchRoutedModels(
                                      draft,
                                      draft.models.filter(
                                        (row) =>
                                          modelRoutingSelectionKey(row) !==
                                          selectionKey,
                                      ),
                                    ),
                                  )
                                }
                              />
                            );
                          })}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </div>
            </section>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {selectionNotice}
          </p>
        </div>
      </FullScreenPanel>
      {providerEditor && (
        <CodexRoutingProviderEditor
          target={{
            ...providerEditor,
            provider:
              overlayProviders[providerEditor.provider.id] ??
              providerEditor.provider,
          }}
          referenced={draft.models.some(
            (entry) =>
              entry.providerId === providerEditor.provider.id &&
              entry.model === providerEditor.model?.model,
          )}
          lastLiveModel={
            active &&
            draft.models.length === 1 &&
            draft.models[0].providerId === providerEditor.provider.id &&
            draft.models[0].model === providerEditor.model?.model
          }
          pending={pending}
          onSave={applyProviderDraft}
          onClose={() => setProviderEditor(undefined)}
        />
      )}
      <Dialog
        open={expiredOfficialChoice}
        onOpenChange={(open) => {
          if (!open && !pending) setExpiredOfficialChoice(false);
        }}
      >
        <DialogContent className="max-w-md" zIndex="top">
          <DialogHeader className="space-y-3 border-b-0 bg-transparent pb-0">
            <DialogTitle>{t("codexRouting.expiredOfficialTitle")}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {t("codexRouting.expiredOfficialMessage")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 border-t-0 bg-transparent pt-2 sm:flex-col sm:items-stretch">
            <Button
              type="button"
              onClick={() => {
                setExpiredOfficialChoice(false);
                setActivePane("available");
                setLoginSignal((current) => current + 1);
              }}
            >
              {t("codexRouting.expiredOfficialLogin")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = patchRoutedModels(
                  {
                    ...draft,
                    nativeSubscriptionEnabled: false,
                    nativeCatalog: null,
                    nativeCatalogRevision: null,
                  },
                  draft.models.filter(
                    (entry) => entry.providerId !== CODEX_NATIVE_ROUTE_ID,
                  ),
                );
                setDraft(next);
                setExpiredOfficialChoice(false);
                void submit(next);
              }}
            >
              {t("codexRouting.expiredOfficialRemove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        isOpen={confirmDisableNative}
        title={t("codexRouting.subscription.disableTitle")}
        message={t("codexRouting.subscription.disableConfirm", {
          count: draft.models.filter(
            (entry) => entry.providerId === CODEX_NATIVE_ROUTE_ID,
          ).length,
        })}
        confirmText={t("codexRouting.subscription.disableAction")}
        onConfirm={disableNative}
        onCancel={() => setConfirmDisableNative(false)}
      />
      <ConfirmDialog
        isOpen={discard}
        title={t("codexRouting.discard")}
        message={t("codexRouting.discardHint")}
        onConfirm={() => {
          setDiscard(false);
          onOpenChange(false);
        }}
        onCancel={() => setDiscard(false)}
      />
    </>
  );
}
