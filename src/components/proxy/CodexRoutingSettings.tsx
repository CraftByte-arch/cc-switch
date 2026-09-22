import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CodexModelRoutingConfig } from "@/types/codexModelRouting";

export function CodexRoutingSettings({
  config,
  disabled,
  onChange,
}: {
  config: CodexModelRoutingConfig;
  disabled: boolean;
  onChange: (value: CodexModelRoutingConfig) => void;
}) {
  const { t } = useTranslation();
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="routing-setting-name">
            <Label htmlFor="codex-router-name" className="shrink-0 text-xs">
              {t("codexRouting.providerName")}
            </Label>
            <Input
              id="codex-router-name"
              value={config.providerName}
              maxLength={80}
              disabled={disabled}
              aria-invalid={!config.providerName.trim()}
              onChange={(event) =>
                onChange({ ...config, providerName: event.target.value })
              }
              className="h-7 min-w-0"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {t("codexRouting.providerNameHint")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="routing-setting-switch">
            <Label htmlFor="codex-router-smart-model-names" className="text-xs">
              {t("codexRouting.smartModelNames")}
            </Label>
            <Switch
              id="codex-router-smart-model-names"
              checked={config.smartModelNames}
              disabled={disabled}
              onCheckedChange={(smartModelNames) =>
                onChange({ ...config, smartModelNames })
              }
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {t(
            config.smartModelNames
              ? "codexRouting.smartModelNamesEnabled"
              : "codexRouting.smartModelNamesDisabled",
          )}
        </TooltipContent>
      </Tooltip>
      <div className="routing-setting-actions">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="routing-icon-button"
              aria-label={t("codexRouting.layout.settingsHelp")}
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-4 text-xs leading-relaxed"
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <p>{t("codexRouting.fixedId")}</p>
            <p>
              {t(
                config.smartModelNames
                  ? "codexRouting.smartModelNamesEnabled"
                  : "codexRouting.smartModelNamesDisabled",
              )}
            </p>
            <p>{t("codexRouting.nativeSmartHint")}</p>
            <p>{t("codexRouting.safetyHint")}</p>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
