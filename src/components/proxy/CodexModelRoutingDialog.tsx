import { useEffect, useMemo, useState } from "react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  Check,
  GripVertical,
  Loader2,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { CodexCatalogModel, Provider } from "@/types";
import type {
  CodexModelRoutingConfig,
  CodexModelSelection,
} from "@/types/codexModelRouting";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useCodexModelRouting,
  useCodexModelRoutingCapabilities,
  useSaveCodexModelRouting,
} from "@/lib/query/codexModelRouting";
import {
  formatContextWindow,
  isModelRoutingProvider,
  modelRoutingCombinationKey,
  modelRoutingModelLabel,
  modelRoutingOptions,
  modelRoutingSelectionKey,
  selectRoutedModel,
} from "@/utils/codexModelRouting";
import { extractErrorMessage } from "@/utils/errorUtils";
import { cn } from "@/lib/utils";

const EMPTY: CodexModelRoutingConfig = {
  enabled: false,
  providerName: "CC Switch Router",
  models: [],
};

function ModelCapabilities({
  model,
  contextWindow,
  contextLoading,
}: {
  model?: CodexCatalogModel;
  contextWindow?: number | null;
  contextLoading: boolean;
}) {
  const { t } = useTranslation();
  const levels = Array.isArray(model?.reasoningLevels)
    ? model.reasoningLevels
    : [];
  const formattedContextWindow = formatContextWindow(contextWindow);
  return (
    <span className="text-xs text-muted-foreground">
      <span
        title={
          contextWindow ? `${contextWindow.toLocaleString()} tokens` : undefined
        }
      >
        {t("codexRouting.effectiveContextWindow", {
          defaultValue: "生效上下文",
        })}
        ：
        {contextLoading
          ? t("codexRouting.calculating", { defaultValue: "计算中…" })
          : formattedContextWindow ||
            t("codexRouting.unavailable", { defaultValue: "无法计算" })}
      </span>
      <span aria-hidden="true"> · </span>
      {t("codexRouting.reasoning", { defaultValue: "推理" })}：
      {levels.length
        ? levels.join(" / ")
        : t("codexRouting.inherited", { defaultValue: "供应商默认" })}
      {model?.defaultReasoningLevel
        ? ` · ${t("codexRouting.default", { defaultValue: "默认" })} ${model.defaultReasoningLevel}`
        : ""}
    </span>
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
  index,
  disabled,
  onRemove,
}: {
  entry: CodexModelSelection;
  provider?: Provider;
  model?: CodexCatalogModel;
  contextWindow?: number | null;
  contextLoading: boolean;
  displayName: string;
  conflict: boolean;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: modelRoutingSelectionKey(entry), disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-xl border border-border-default bg-muted/20 p-2",
        !model && "border-destructive",
        conflict &&
          "border-amber-400/70 bg-amber-50/70 dark:border-amber-500/50 dark:bg-amber-950/30",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={t("codexRouting.reorder", {
          model: entry.model,
          defaultValue: "排序 {{model}}",
        })}
        className="touch-none rounded p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-xs tabular-nums text-primary">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="break-all text-sm font-semibold">{displayName}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span>{provider?.name ?? entry.providerId}</span>
          <span className="break-all font-mono">{entry.model}</span>
        </div>
        {model ? (
          <div className="mt-0.5">
            <ModelCapabilities
              model={model}
              contextWindow={contextWindow}
              contextLoading={contextLoading}
            />
          </div>
        ) : (
          <span className="text-xs text-destructive">
            {t("codexRouting.missing", {
              defaultValue: "供应商或模型已不存在，请移除后重新选择",
            })}
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className="rounded p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("codexRouting.remove", {
          model: entry.model,
          defaultValue: "移除 {{model}}",
        })}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function CodexModelRoutingDialog({
  open,
  onOpenChange,
  providers,
  active,
  onEditProvider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Record<string, Provider>;
  active: boolean;
  onEditProvider: (provider: Provider) => void;
}) {
  const { t } = useTranslation();
  const query = useCodexModelRouting();
  const capabilitiesQuery = useCodexModelRoutingCapabilities(open);
  const save = useSaveCodexModelRouting();
  const [draft, setDraft] = useState(EMPTY);
  const [baseline, setBaseline] = useState(EMPTY);
  const [initialized, setInitialized] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
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
      setDraft(structuredClone(query.data));
      setBaseline(structuredClone(query.data));
      setSearch("");
      setError("");
      setInitialized(true);
    }
  }, [open, query.data, initialized]);

  const groups = useMemo(
    () =>
      Object.values(providers)
        .filter(isModelRoutingProvider)
        .map((provider) => ({
          provider,
          models: modelRoutingOptions(provider),
        })),
    [providers],
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const selectedMissing = draft.models.some(
    (entry) => !routingIndex.bySelection.has(modelRoutingSelectionKey(entry)),
  );
  const selectedConflict = Array.from(
    selectedState.combinationCounts.values(),
  ).some((count) => count > 1);
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      visible: group.models.filter((model) =>
        `${group.provider.name} ${model.model} ${model.displayName ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    }))
    .filter((group) => !search || group.visible.length > 0);
  const pending = save.isPending;
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
    if (existing) {
      setDraft({
        ...draft,
        models: draft.models.filter(
          (row) => modelRoutingSelectionKey(row) !== targetKey,
        ),
      });
    } else {
      setDraft({ ...draft, models: selectRoutedModel(draft.models, entry) });
    }
  };
  const submit = async () => {
    setError("");
    try {
      const result = await save.mutateAsync(draft);
      setDraft(result.config);
      setBaseline(result.config);
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
    }
  };

  return (
    <>
      <FullScreenPanel
        isOpen={open}
        title={t("codexRouting.title", { defaultValue: "Codex 模型路由" })}
        onClose={close}
        footer={
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              {active
                ? t("codexRouting.activeHint", {
                    defaultValue: "路由运行中 · 保存后对后续请求生效",
                  })
                : t("codexRouting.draftHint", {
                    defaultValue: "仅保存配置 · 不启动服务",
                  })}
            </span>
            <Button variant="outline" onClick={close} disabled={pending}>
              {t("common.close", { defaultValue: "关闭" })}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={
                !dirty ||
                !initialized ||
                pending ||
                !draft.providerName.trim() ||
                selectedMissing ||
                selectedConflict ||
                (active && !draft.models.length)
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("codexRouting.save", { defaultValue: "保存配置" })}
            </Button>
          </>
        }
      >
        <div className="space-y-2 border-b border-border-default pb-4">
          <p className="text-sm text-muted-foreground">
            {t("codexRouting.description", {
              defaultValue:
                "选择已有供应商的模型，合并成一套 Codex 菜单。地址、密钥、协议、推理能力及上下文限制均继承原供应商。",
            })}
          </p>
        </div>
        <div className="space-y-6">
          {query.isLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("common.loading", { defaultValue: "加载中…" })}
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("codexRouting.loadFailed", {
                defaultValue: "读取模型路由配置失败",
              })}{" "}
              <Button variant="link" onClick={() => query.refetch()}>
                {t("common.retry", { defaultValue: "重试" })}
              </Button>
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
            <Label htmlFor="codex-router-name">
              {t("codexRouting.providerName", {
                defaultValue: "Provider 显示名称",
              })}
            </Label>
            <Input
              id="codex-router-name"
              value={draft.providerName}
              maxLength={80}
              disabled={pending || !initialized}
              onChange={(e) =>
                setDraft({ ...draft, providerName: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground sm:col-start-2">
              {t("codexRouting.fixedId", {
                defaultValue:
                  "内部 Provider ID 固定为 custom；更换模型来源不会改变这个身份。",
              })}
            </p>
          </div>
          {routingIndex.conflicts.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/35 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium">
                  {t("codexRouting.duplicateCombinationTitle", {
                    count: routingIndex.conflicts.length,
                    defaultValue:
                      "检测到 {{count}} 组相同的供应商名称和模型显示名称",
                  })}
                </p>
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                  {t("codexRouting.duplicateCombinationHint", {
                    defaultValue:
                      "为避免 Codex 菜单无法区分，同一组合只能启用一个。可点击下方供应商旁的“编辑”，修改供应商名称或模型显示名称。",
                  })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {routingIndex.conflicts
                    .slice(0, 4)
                    .map(({ key, options }) => (
                      <span
                        key={key}
                        className="rounded-md border border-amber-300/70 bg-white/70 px-2 py-1 text-xs font-medium dark:border-amber-500/40 dark:bg-amber-950/50"
                      >
                        {options[0].provider.name} ·{" "}
                        {modelRoutingModelLabel(options[0].model)}
                      </span>
                    ))}
                  {routingIndex.conflicts.length > 4 && (
                    <span className="px-1 py-1 text-xs">
                      +{routingIndex.conflicts.length - 4}
                    </span>
                  )}
                </div>
                {selectedConflict && (
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                    {t("codexRouting.selectedCombinationConflict", {
                      defaultValue:
                        "当前已选择模型中存在冲突，请取消其中一项或先编辑供应商后再保存。",
                    })}
                  </p>
                )}
              </div>
            </div>
          )}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">
                {t("codexRouting.selected", {
                  count: draft.models.length,
                  defaultValue: "已选择模型 · {{count}}",
                })}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("codexRouting.sortHint", {
                  defaultValue:
                    "拖动排序，也可聚焦拖动柄后用空格和方向键排序。首次启用时，第一项作为默认模型。",
                })}
              </p>
            </div>
            {draft.models.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-default py-6 text-center text-sm text-muted-foreground">
                {t("codexRouting.emptySelection", {
                  defaultValue: "从下方点击模型即可添加",
                })}
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active: dragged, over }) => {
                  if (!over || pending) return;
                  const from = draft.models.findIndex(
                    (entry) => modelRoutingSelectionKey(entry) === dragged.id,
                  );
                  const to = draft.models.findIndex(
                    (entry) => modelRoutingSelectionKey(entry) === over.id,
                  );
                  if (from >= 0 && to >= 0)
                    setDraft({
                      ...draft,
                      models: arrayMove(draft.models, from, to),
                    });
                }}
              >
                <SortableContext
                  items={draft.models.map(modelRoutingSelectionKey)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    {draft.models.map((entry, index) => {
                      const selectionKey = modelRoutingSelectionKey(entry);
                      const detail = selectedState.details.get(selectionKey);
                      const duplicateModelName =
                        (selectedState.modelNameCounts.get(
                          detail?.modelName ?? entry.model,
                        ) ?? 0) > 1;
                      const displayName = duplicateModelName
                        ? `${detail?.provider?.name ?? entry.providerId} · ${detail?.modelName ?? entry.model}`
                        : (detail?.modelName ?? entry.model);
                      const conflict = Boolean(
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
                          disabled={pending}
                          provider={detail?.provider}
                          model={detail?.model}
                          contextWindow={contextWindows.get(selectionKey)}
                          contextLoading={capabilitiesQuery.isLoading}
                          displayName={displayName}
                          conflict={conflict}
                          onRemove={() =>
                            setDraft({
                              ...draft,
                              models: draft.models.filter(
                                (row) =>
                                  modelRoutingSelectionKey(row) !==
                                  selectionKey,
                              ),
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>
          <section className="space-y-4 border-t border-border-default pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {t("codexRouting.available", {
                  defaultValue: "已有供应商的模型",
                })}
              </h3>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("codexRouting.search", {
                    defaultValue: "搜索供应商或模型",
                  })}
                  placeholder={t("codexRouting.search", {
                    defaultValue: "搜索供应商或模型",
                  })}
                />
              </div>
            </div>
            <TooltipProvider delayDuration={250}>
              {visibleGroups.map(({ provider, visible }) => (
                <div
                  key={provider.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-start"
                >
                  <div className="flex shrink-0 items-center gap-1 self-start sm:w-44">
                    <span className="min-w-0 flex-1 break-words rounded-full bg-muted px-3 py-2 text-sm font-semibold">
                      {provider.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
                      disabled={pending}
                      onClick={() => onEditProvider(provider)}
                      aria-label={t("codexRouting.editProvider", {
                        provider: provider.name,
                        defaultValue: "编辑供应商 {{provider}}",
                      })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t("common.edit", { defaultValue: "编辑" })}
                    </Button>
                  </div>
                  <div className="flex flex-1 flex-wrap gap-2">
                    {visible.map((model) => {
                      const selection = {
                        providerId: provider.id,
                        model: model.model,
                      };
                      const selectionKey = modelRoutingSelectionKey(selection);
                      const selected = draft.models.some(
                        (entry) =>
                          modelRoutingSelectionKey(entry) === selectionKey,
                      );
                      const combinationKey = modelRoutingCombinationKey(
                        provider,
                        model,
                      );
                      const conflictingSelection = draft.models.find(
                        (entry) => {
                          const entryKey = modelRoutingSelectionKey(entry);
                          if (entryKey === selectionKey) return false;
                          return (
                            routingIndex.bySelection.get(entryKey)
                              ?.combinationKey === combinationKey
                          );
                        },
                      );
                      const blocked =
                        !selected && Boolean(conflictingSelection);
                      const modelLabel = modelRoutingModelLabel(model);
                      const conflictReason = t(
                        "codexRouting.duplicateCombinationDisabled",
                        {
                          provider: provider.name,
                          model: modelLabel,
                          defaultValue:
                            "“{{provider}} · {{model}}”与另一个已选模型使用相同的供应商名称和模型显示名称。请先修改其中一个供应商名称或模型显示名称，再启用此项。",
                        },
                      );
                      const modelButton = (
                        <button
                          type="button"
                          aria-pressed={selected}
                          disabled={pending || !initialized || blocked}
                          onClick={() => choose(selection)}
                          aria-label={`${provider.name} / ${modelLabel}`}
                          className={cn(
                            "max-w-full rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : blocked
                                ? "cursor-not-allowed border-border-default bg-muted/60 text-muted-foreground opacity-60"
                                : "border-border-default hover:bg-muted",
                            (pending || !initialized) && "opacity-50",
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm">
                            <span className="w-4 shrink-0">
                              {selected && <Check className="h-4 w-4" />}
                            </span>
                            <span className="break-all font-medium">
                              {modelLabel}
                            </span>
                          </span>
                          {modelLabel !== model.model && (
                            <span className="ml-6 block break-all font-mono text-xs text-muted-foreground">
                              {model.model}
                            </span>
                          )}
                          <span className="ml-6 block">
                            <ModelCapabilities
                              model={model}
                              contextWindow={contextWindows.get(selectionKey)}
                              contextLoading={capabilitiesQuery.isLoading}
                            />
                          </span>
                        </button>
                      );

                      if (!blocked) {
                        return <span key={selectionKey}>{modelButton}</span>;
                      }

                      return (
                        <Tooltip key={selectionKey}>
                          <TooltipTrigger asChild>
                            <span
                              tabIndex={0}
                              aria-label={conflictReason}
                              className="inline-flex max-w-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {modelButton}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs leading-relaxed">
                            {conflictReason}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    {!visible.length && (
                      <p className="py-2 text-xs text-muted-foreground">
                        {t("codexRouting.noCatalog", {
                          defaultValue:
                            "还没有模型映射，请先在该供应商的编辑页添加模型。",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </TooltipProvider>
            {!visibleGroups.length && (
              <p className="py-4 text-sm text-muted-foreground">
                {t("codexRouting.noProviders", {
                  defaultValue:
                    "没有可选模型。请添加 Codex API Key 供应商并配置模型映射，或调整搜索条件。",
                })}
              </p>
            )}
          </section>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("codexRouting.safetyHint", {
              defaultValue:
                "仅支持 API Key 供应商。不同供应商可以同时启用同一个模型；Codex 菜单会自动区分来源。不使用全局故障转移。跨站切换后，依赖原站响应 ID 的已有会话可能需要新建；不会清除或改写历史。",
            })}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </FullScreenPanel>
      <ConfirmDialog
        isOpen={discard}
        title={t("codexRouting.discard", {
          defaultValue: "放弃未保存的修改？",
        })}
        message={t("codexRouting.discardHint", {
          defaultValue: "已保存的路由配置不受影响。",
        })}
        onConfirm={() => {
          setDiscard(false);
          onOpenChange(false);
        }}
        onCancel={() => setDiscard(false)}
      />
    </>
  );
}
