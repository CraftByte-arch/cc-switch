import { useEffect, useState } from "react";
import {
  CODEX_GUIDE_EVENT,
  updateCodexGuideSignals,
  type CodexGuideDetail,
} from "@/lib/codexGuide";
import { useTranslation } from "react-i18next";
import { Network, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useCodexModelRouting,
  useSetCodexModelRoutingEnabled,
} from "@/lib/query/codexModelRouting";
import { useProxyStatusQuery, useProxyTakeoverStatus } from "@/lib/query/proxy";
import { extractErrorMessage } from "@/utils/errorUtils";
import { CodexModelRoutingDialog } from "./CodexModelRoutingDialog";

export function CodexModelRoutingCard({
  providers,
  onEditProvider,
  detailEditorOpen = false,
  onAddProvider,
  addProviderOpen = false,
}: {
  providers: Record<string, Provider>;
  onEditProvider: (provider: Provider) => void;
  detailEditorOpen?: boolean;
  onAddProvider?: () => void;
  addProviderOpen?: boolean;
}) {
  const { t } = useTranslation();
  const query = useCodexModelRouting();
  const toggle = useSetCodexModelRoutingEnabled();
  const { data: takeover } = useProxyTakeoverStatus();
  const { data: status } = useProxyStatusQuery();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onPlace = (event: Event) => {
      const detail = (event as CustomEvent<CodexGuideDetail>).detail;
      if (!detail.stepId) return;
      const place = detail.place;
      const showRouting =
        place === "routing-available" || place === "routing-selected";
      if (showRouting) setOpenedToEnable(false);
      setOpen(showRouting);
    };
    window.addEventListener(CODEX_GUIDE_EVENT, onPlace);
    return () => window.removeEventListener(CODEX_GUIDE_EVENT, onPlace);
  }, []);
  const [openedToEnable, setOpenedToEnable] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const hasModels = (query.data?.models.length ?? 0) > 0;
  const active = Boolean(
    query.data?.enabled && takeover?.codex && status?.running,
  );

  useEffect(() => {
    updateCodexGuideSignals({
      routeEnabled: active,
      proxyEnabled: Boolean(takeover?.codex && status?.running),
    });
  }, [active, takeover?.codex, status?.running]);

  const setEnabled = async (enabled: boolean) => {
    try {
      await toggle.mutateAsync(enabled);
      setConfirmEnable(false);
      toast.success(
        t(
          enabled ? "codexRouting.enabledToast" : "codexRouting.disabledToast",
          {
            defaultValue: enabled
              ? "模型路由已启用。首次接管后请重新打开 Codex，让它加载统一模型目录。"
              : "模型路由已关闭，Codex 配置已恢复。",
          },
        ),
      );
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  };

  return (
    <>
      <section
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-card px-4 py-3"
        data-tour="codex-routing-card"
        aria-label={t("codexRouting.cardTitle", {
          defaultValue: "Codex 聚合模型路由",
        })}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Network className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {t("codexRouting.cardTitle", {
                defaultValue: "Codex 聚合模型路由",
              })}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("codexRouting.cardIntro", {
                defaultValue:
                  "同时接入多个供应商和官方订阅；配置生效后，在 Codex 内按模型切换来源，无需每次重启。",
              })}
            </p>
            {query.data && (
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                {t("codexRouting.routeNameSummary", {
                  name: query.data.providerName,
                  count: query.data.models.length,
                  defaultValue: "聚合路由名称：{{name}} · {{count}} 个模型",
                })}
              </p>
            )}
            {query.data && !hasModels && (
              <p
                id="codex-routing-pick-hint"
                className="mt-1 text-xs text-muted-foreground"
              >
                {t("codexRouting.pickModelsFirst", {
                  defaultValue: "还没选择模型。点开关或「管理模型」去挑选。",
                })}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpenedToEnable(false);
              setOpen(true);
            }}
            disabled={toggle.isPending}
            data-tour="codex-routing-manage"
          >
            <Settings2 className="mr-2 h-4 w-4" />
            {t("codexRouting.manage", { defaultValue: "管理模型" })}
          </Button>
          {toggle.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Switch
            data-tour="codex-routing-switch"
            checked={active}
            disabled={query.isLoading || query.isError || toggle.isPending}
            aria-label={t("codexRouting.enable", {
              defaultValue: "启用 Codex 模型路由",
            })}
            aria-describedby={
              query.data && !hasModels ? "codex-routing-pick-hint" : undefined
            }
            title={
              query.data && !hasModels
                ? t("codexRouting.pickModelsFirstHint", {
                    defaultValue: "请先选择模型",
                  })
                : undefined
            }
            onCheckedChange={(enabled) => {
              if (!enabled) {
                void setEnabled(false);
                return;
              }
              if (!query.data?.models.length) {
                setOpenedToEnable(true);
                setOpen(true);
                return;
              }
              setConfirmEnable(true);
            }}
          />
        </div>
        {query.isError && (
          <p role="alert" className="w-full text-sm text-destructive">
            {t("codexRouting.loadFailed", {
              defaultValue: "读取模型路由配置失败",
            })}
            <Button variant="link" onClick={() => query.refetch()}>
              {t("common.retry", { defaultValue: "重试" })}
            </Button>
          </p>
        )}
      </section>
      <CodexModelRoutingDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setOpenedToEnable(false);
        }}
        promptToEnable={openedToEnable}
        providers={providers}
        active={active}
        onEditProvider={onEditProvider}
        detailEditorOpen={detailEditorOpen}
        onAddProvider={onAddProvider}
        addProviderOpen={addProviderOpen}
      />
      <ConfirmDialog
        isOpen={confirmEnable}
        title={t("codexRouting.enable", {
          defaultValue: "启用 Codex 模型路由",
        })}
        message={t("codexRouting.enableConfirm", {
          defaultValue:
            "将启动本地路由、备份并接管 Codex 配置。Codex 使用固定的 custom Provider 和统一模型目录，真实密钥仍由原供应商管理。不会修改登录文件或迁移已有历史。首次启用后请重新打开 Codex。",
        })}
        confirmText={t("codexRouting.startAndEnable", {
          defaultValue: "启动并启用",
        })}
        variant="info"
        pending={toggle.isPending}
        onConfirm={() => void setEnabled(true)}
        onCancel={() => setConfirmEnable(false)}
      />
    </>
  );
}
