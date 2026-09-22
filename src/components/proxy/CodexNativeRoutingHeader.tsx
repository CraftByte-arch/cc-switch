import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Pencil, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodexNativeLoginButton } from "./CodexNativeLoginButton";
import { extractErrorMessage } from "@/utils/errorUtils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  CODEX_NATIVE_ROUTE_ID,
  routedModelLabel,
} from "@/utils/codexModelRouting";
import type {
  CodexModelRoutingConfig,
  CodexNativeRoutingStatus,
} from "@/types/codexModelRouting";

export function CodexNativeRoutingHeader({
  state,
  busy,
  requestError,
  disabled,
  onRefresh,
  config,
  onChange,
  expanded,
  onExpandedChange,
  previewModel,
  onEnabledChange,
  visible,
}: {
  visible: boolean;
  onEnabledChange: (enabled: boolean) => void;
  config: CodexModelRoutingConfig;
  onChange: (config: CodexModelRoutingConfig) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  previewModel?: string;
  state?: CodexNativeRoutingStatus;
  busy: boolean;
  requestError?: unknown;
  disabled: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const enabled = config.nativeSubscriptionEnabled ?? true;
  const [refreshNotice, setRefreshNotice] = useState("");
  const loginNeeded =
    state?.status === "signedOut" || state?.status === "loginRequired";
  const ready = state?.status === "ready";
  const error = requestError ? extractErrorMessage(requestError) : state?.error;
  const showPrefix = config.showNativeModelPrefix ?? true;
  const prefix =
    config.nativeModelPrefix ?? t("codexRouting.nativePrefixDefault");
  const invalidPrefix = showPrefix && !prefix.trim();
  const statusText = !enabled
    ? t("codexRouting.subscription.off")
    : busy
      ? t(
          state?.provider
            ? "codexRouting.refreshingNative"
            : "codexRouting.checkingNative",
        )
      : error
        ? error
        : ready
          ? t(
              state?.cached
                ? "codexRouting.nativeCached"
                : "codexRouting.nativeSynced",
            )
          : loginNeeded
            ? ""
            : t("codexRouting.nativeNotReady");

  return (
    <div className="routing-native">
      <div className="routing-native-bar">
        <div className="routing-native-main">
          <h4>{t("codexRouting.nativeName")}</h4>
          {enabled && (
            <Button
              id="native-prefix-trigger"
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 max-w-full gap-1 px-1.5 text-xs"
              disabled={disabled}
              aria-expanded={expanded}
              aria-controls="native-prefix-editor"
              onClick={() => onExpandedChange(!expanded)}
            >
              <span className={invalidPrefix ? "text-destructive" : undefined}>
                {t(
                  showPrefix
                    ? "codexRouting.prefixSummary"
                    : "codexRouting.prefixOff",
                  { prefix: prefix.trim() || "—" },
                )}
              </span>
              {expanded ? (
                <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
            </Button>
          )}
          {statusText && (
            <span
              className={
                error
                  ? "routing-native-status text-amber-800 dark:text-amber-200"
                  : "routing-native-status"
              }
              role={error ? "alert" : "status"}
              title={statusText}
            >
              {statusText}
            </span>
          )}
        </div>
        <div className="routing-native-actions">
          {enabled && visible && loginNeeded && (
            <CodexNativeLoginButton
              disabled={disabled}
              onComplete={onRefresh}
            />
          )}
          {enabled && (
            <Button
              type="button"
              variant={ready ? "outline" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy || disabled}
              onClick={() => {
                setRefreshNotice("");
                void onRefresh()
                  .then((result) => {
                    const next = result as CodexNativeRoutingStatus | undefined;
                    if (next?.status === "ready" && !next.cached) {
                      setRefreshNotice(
                        t(
                          next.catalogRevision === state?.catalogRevision
                            ? "codexRouting.nativeNoChanges"
                            : "codexRouting.nativeRefreshed",
                        ),
                      );
                    }
                  })
                  .catch(() => undefined);
              }}
            >
              {busy ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              {t(
                loginNeeded
                  ? "codexRouting.recheckLogin"
                  : ready
                    ? "codexRouting.refreshNative"
                    : "codexRouting.retryNative",
              )}
            </Button>
          )}
          <Switch
            checked={enabled}
            disabled={disabled}
            aria-label={t("codexRouting.subscription.enable")}
            onCheckedChange={onEnabledChange}
          />
        </div>
      </div>
      {enabled && expanded && (
        <div id="native-prefix-editor" className="routing-native-prefix">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Label htmlFor="native-show-prefix" className="text-xs">
              {t("codexRouting.showNativePrefix")}
            </Label>
            <Switch
              id="native-show-prefix"
              checked={showPrefix}
              disabled={disabled}
              onCheckedChange={(showNativeModelPrefix) =>
                onChange({ ...config, showNativeModelPrefix })
              }
            />
            {showPrefix && (
              <Input
                id="native-prefix"
                aria-label={t("codexRouting.nativePrefix")}
                className="h-8 w-full sm:w-48"
                value={prefix}
                maxLength={32}
                disabled={disabled}
                aria-invalid={invalidPrefix}
                aria-describedby={
                  invalidPrefix ? "native-prefix-error" : undefined
                }
                onChange={(event) =>
                  onChange({ ...config, nativeModelPrefix: event.target.value })
                }
              />
            )}
          </div>
          {invalidPrefix && (
            <p id="native-prefix-error" className="text-xs text-destructive">
              {t("codexRouting.nativePrefixRequired")}
            </p>
          )}
          <p className="break-words text-xs" aria-live="polite">
            {t(
              previewModel
                ? "codexRouting.nativeNamePreview"
                : "codexRouting.nativeNameExample",
              {
                name: routedModelLabel(
                  config,
                  CODEX_NATIVE_ROUTE_ID,
                  "",
                  previewModel || "6 Astra",
                  false,
                ),
              },
            )}
          </p>
        </div>
      )}
      {enabled && refreshNotice && ready && !busy && !error && (
        <p role="status" className="routing-native-note">
          {refreshNotice}
        </p>
      )}
    </div>
  );
}
