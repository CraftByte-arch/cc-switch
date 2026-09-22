import { useTranslation } from "react-i18next";
import type { CodexCatalogModel } from "@/types";
import { formatContextWindow } from "@/utils/codexModelRouting";

export interface RoutingModelInfoProps {
  model?: CodexCatalogModel;
  modelId: string;
  providerName: string;
  contextWindow?: number | null;
  contextLoading: boolean;
  native?: boolean;
  detailed?: boolean;
}

function reasoningLabel(
  t: (key: string) => string,
  model: CodexCatalogModel | undefined,
  native: boolean,
) {
  const levels = Array.isArray(model?.reasoningLevels)
    ? model.reasoningLevels
    : [];
  return levels.length
    ? levels.join(" · ")
    : t(
        native
          ? "codexRouting.nativeNotProvided"
          : "codexRouting.quick.reasoningUnset",
      );
}

export function RoutingCapabilitySummary({
  model,
  contextWindow,
  contextLoading,
  native = false,
}: Omit<RoutingModelInfoProps, "modelId" | "providerName">) {
  const { t } = useTranslation();
  const window =
    contextWindow ??
    (model?.contextWindow ? Number(model.contextWindow) : undefined);
  const context =
    contextLoading && !window
      ? t("codexRouting.calculating")
      : formatContextWindow(window) ||
        t(
          native
            ? "codexRouting.nativeNotProvided"
            : "codexRouting.quick.contextUnset",
        );
  const reasoning = reasoningLabel(t, model, native);
  const levels = Array.isArray(model?.reasoningLevels)
    ? model.reasoningLevels
    : [];
  const reasoningText = levels.length ? levels.join("·") : reasoning;
  return (
    <span className="routing-candidate-capabilities tabular-nums">
      <span
        className="routing-model-context"
        aria-label={`${t(native ? "codexRouting.nativeContextWindow" : "codexRouting.effectiveContextWindow")}：${context}`}
      >
        {context}
      </span>
      <span
        className="routing-model-reasoning"
        title={`${t("codexRouting.reasoning")}：${reasoning}`}
      >
        {reasoningText}
      </span>
    </span>
  );
}

/** Always visible. No info icon or hover-only disclosure for comparison data. */
export function RoutingModelDetails({
  model,
  modelId,
  providerName,
  contextWindow,
  contextLoading,
  native = false,
}: RoutingModelInfoProps) {
  const { t } = useTranslation();
  const window =
    contextWindow ??
    (model?.contextWindow ? Number(model.contextWindow) : undefined);
  const contextText =
    contextLoading && !window
      ? t("codexRouting.calculating")
      : formatContextWindow(window) ||
        t(
          native
            ? "codexRouting.nativeNotProvided"
            : "codexRouting.quick.contextUnset",
        );
  const reasoning = reasoningLabel(t, model, native);
  const contextLabel = t(
    native
      ? "codexRouting.nativeContextWindow"
      : "codexRouting.effectiveContextWindow",
  );

  return (
    <div className="routing-model-details">
      <span
        className="routing-detail-source"
        title={`${t("codexRouting.quick.source")}：${providerName}`}
      >
        {providerName}
      </span>
      <span
        className="routing-detail-model"
        title={`${t("codexRouting.quick.modelId")}：${modelId}`}
      >
        <span className="font-mono text-[11px]">{modelId}</span>
      </span>
      <span
        className="routing-capabilities-summary"
        aria-label={`${contextLabel}：${contextText}`}
        title={`${t("codexRouting.quick.context")}：${contextText}`}
      >
        {contextText}
      </span>
      <span
        className="routing-detail-reasoning"
        aria-label={`${t("codexRouting.reasoning")}：${reasoning}`}
        title={`${t("codexRouting.reasoning")}：${reasoning}`}
      >
        {reasoning}
      </span>
    </div>
  );
}
