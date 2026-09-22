import { useTranslation } from "react-i18next";
import type { CodexCatalogModel } from "@/types";
import type { FetchedModel } from "@/lib/api/model-fetch";
import { Input } from "@/components/ui/input";
import { ModelDropdown } from "./shared";
import { ReasoningLevelsEditor } from "./ReasoningLevelsEditor";
import { optimizeCodexModelDisplayName } from "@/utils/codexCatalog";

/** Shared by the provider form and router quick editor. Hidden metadata stays on the row. */
export function CodexCatalogModelFields({
  model,
  onChange,
  fetchedModels = [],
  labels = false,
}: {
  model: CodexCatalogModel;
  onChange: (patch: Partial<CodexCatalogModel>) => void;
  fetchedModels?: FetchedModel[];
  labels?: boolean;
}) {
  const { t } = useTranslation();
  const display = t("codexConfig.catalogColumnDisplay", {
    defaultValue: "菜单显示名",
  });
  const upstream = t("codexConfig.catalogColumnModel", {
    defaultValue: "实际请求模型",
  });
  const context = t("codexConfig.catalogColumnContext", {
    defaultValue: "上下文窗口",
  });
  const reasoning = t("codexConfig.catalogColumnReasoning", {
    defaultValue: "思考等级",
  });
  return (
    <>
      <div className="min-w-0 space-y-1.5">
        {labels && <p className="text-xs font-medium">{display}</p>}
        <Input
          aria-label={display}
          value={model.displayName ?? ""}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder={t("codexConfig.catalogDisplayNamePlaceholder", {
            defaultValue: "例如: DeepSeek V4 Flash",
          })}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        {labels && <p className="text-xs font-medium">{upstream}</p>}
        <div className="flex gap-1">
          <Input
            aria-label={upstream}
            value={model.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder={t("codexConfig.catalogModelPlaceholder", {
              defaultValue: "例如: deepseek-v4-flash",
            })}
            className="min-w-0 flex-1"
          />
          {fetchedModels.length > 0 && (
            <ModelDropdown
              models={fetchedModels}
              onSelect={(id) =>
                onChange({
                  model: id,
                  displayName: model.displayName?.trim()
                    ? model.displayName
                    : optimizeCodexModelDisplayName(id),
                })
              }
            />
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        {labels && <p className="text-xs font-medium">{context}</p>}
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label={context}
          value={model.contextWindow ?? ""}
          onChange={(e) =>
            onChange({ contextWindow: e.target.value.replace(/[^\d]/g, "") })
          }
          placeholder={t("codexConfig.contextWindowPlaceholder", {
            defaultValue: "例如: 128000",
          })}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        {labels && <p className="text-xs font-medium">{reasoning}</p>}
        <ReasoningLevelsEditor
          levels={model.reasoningLevels}
          defaultLevel={model.defaultReasoningLevel}
          onLevelsChange={(levels) => onChange({ reasoningLevels: levels })}
          onDefaultLevelChange={(level) =>
            onChange({ defaultReasoningLevel: level })
          }
        />
      </div>
    </>
  );
}
