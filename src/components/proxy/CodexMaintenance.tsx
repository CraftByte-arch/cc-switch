import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check,
  CircleCheck,
  Loader2,
  RotateCw,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CODEX_MAINTENANCE_EVENT,
  requestCodexMaintenance,
  type CodexMaintenanceReason,
} from "@/lib/codexMaintenance";
import {
  codexMaintenanceApi,
  type CodexMaintenanceAction,
  type CodexMaintenanceResult,
  type CodexBackupCleanupResult,
  type CodexRepairPreview,
  type CodexRepairProgress,
} from "@/lib/api/codexMaintenance";
import { extractErrorMessage } from "@/utils/errorUtils";
import { generateUUID } from "@/utils/uuid";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function CodexMaintenanceActions() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2 pt-3"
      role="group"
      aria-label={t("codexMaintenance.actions")}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => requestCodexMaintenance("cleanup")}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        {t("codexMaintenance.cleanup")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => requestCodexMaintenance("repair")}
      >
        <Wrench className="h-4 w-4 shrink-0" />
        {t("codexMaintenance.repair")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => requestCodexMaintenance("restart")}
      >
        <RotateCw className="h-4 w-4 shrink-0" />
        {t("codexMaintenance.restart")}
      </Button>
    </div>
  );
}

// One root dialog, but distinct actions for restart / repair / backup cleanup.
export function CodexMaintenanceDialog() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [reason, setReason] = useState<CodexMaintenanceReason | null>(null);
  const [pending, setPending] = useState<
    CodexMaintenanceAction | "cleanup" | "preview" | null
  >(null);
  const busy = useRef(false);
  const activeRun = useRef<string | null>(null);
  const progressUnlisten = useRef<(() => void) | null>(null);
  const [preview, setPreview] = useState<CodexRepairPreview | null>(null);
  const [progress, setProgress] = useState<CodexRepairProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [pending]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CodexMaintenanceResult | null>(null);
  const [cleanupResult, setCleanupResult] =
    useState<CodexBackupCleanupResult | null>(null);
  const cleaning = reason === "cleanup";
  const complete = Boolean(result || cleanupResult);
  const status = useQuery({
    queryKey: ["codexMaintenanceStatus"],
    queryFn: codexMaintenanceApi.status,
    enabled: reason !== null && !cleaning && !complete,
    retry: false,
  });
  const backups = useQuery({
    queryKey: ["codexRepairBackups"],
    queryFn: codexMaintenanceApi.backups,
    enabled: cleaning && !complete,
    retry: false,
    // A deletion must always use a fresh inventory, never a cached preview.
    staleTime: 0,
  });
  useEffect(() => {
    const handle = (event: Event) => {
      const next = (event as CustomEvent<CodexMaintenanceReason>).detail;
      if (
        !["config-changed", "restart", "repair", "cleanup"].includes(next) ||
        busy.current
      )
        return;
      setReason(next);
      setError("");
      setResult(null);
      setCleanupResult(null);
      setPreview(null);
      setProgress(null);
      void client.invalidateQueries({ queryKey: ["codexMaintenanceStatus"] });
      void client.invalidateQueries({ queryKey: ["codexRepairBackups"] });
    };
    window.addEventListener(CODEX_MAINTENANCE_EVENT, handle);
    return () => {
      window.removeEventListener(CODEX_MAINTENANCE_EVENT, handle);
      activeRun.current = null;
      progressUnlisten.current?.();
      progressUnlisten.current = null;
    };
  }, [client]);

  const run = async (
    action: CodexMaintenanceAction | "cleanup" | "preview",
  ) => {
    if (busy.current) return;
    if (
      action === "cleanup" &&
      (!backups.data?.count || backups.isFetching || backups.isError)
    )
      return;
    if (
      (action === "repair_and_restart" ||
        action === "check_and_restart" ||
        action === "preview") &&
      (!status.data?.repairTarget ||
        status.data.repairError ||
        status.isFetching ||
        status.isError)
    )
      return;
    busy.current = true;
    setPending(action);
    setError("");
    try {
      const runId = generateUUID();
      if (action !== "cleanup") {
        activeRun.current = runId;
        setProgress({
          runId,
          phase: "waiting",
          completed: 0,
          total: null,
          unit: "steps",
          item: null,
        });
        // Subscribe BEFORE invoking, otherwise a fast scan can finish before
        // the webview has registered its listener. Ignore other/late runs.
        const unlisten = await codexMaintenanceApi.onProgress((event) => {
          if (activeRun.current === event.runId) setProgress(event);
        });
        if (activeRun.current !== runId) {
          unlisten();
          return;
        }
        progressUnlisten.current = unlisten;
      }
      if (action === "preview") {
        setPreview(null);
        setPreview(
          await codexMaintenanceApi.preview(status.data!.repairTarget!, runId),
        );
      } else if (action === "cleanup") {
        setCleanupResult(
          await codexMaintenanceApi.cleanup(backups.data!.snapshot),
        );
      } else {
        const completed =
          action === "restart"
            ? await codexMaintenanceApi.run("restart", undefined, runId)
            : await codexMaintenanceApi.run(
                action,
                status.data!.repairTarget!,
                runId,
              );
        setResult(completed);
        void client.invalidateQueries({ queryKey: ["sessions"] });
        if (!completed.repair) {
          toast.success(t("codexMaintenance.restarted"));
          setReason(null);
        }
      }
      void client.invalidateQueries({
        queryKey: ["codexRepairBackups"],
        refetchType: "none",
      });
    } catch (e) {
      setError(extractErrorMessage(e));
      // Do not silently replace a failed deletion confirmation with a new set
      // of files. Let the user explicitly refresh and confirm again.
    } finally {
      progressUnlisten.current?.();
      progressUnlisten.current = null;
      activeRun.current = null;
      setProgress(null);
      busy.current = false;
      setPending(null);
    }
  };
  const disabled =
    Boolean(pending) || !status.data?.supported || status.isError;
  const previewDisabled =
    Boolean(pending) ||
    status.isError ||
    status.isFetching ||
    !status.data?.repairTarget ||
    Boolean(status.data?.repairError);
  const previewCurrent = preview?.provider === status.data?.repairTarget;
  const previewNoChanges =
    previewCurrent &&
    preview?.changedFiles === 0 &&
    preview?.changedThreads === 0;
  const repairDisabled = disabled || previewDisabled || previewNoChanges;
  const noOp =
    reason === "repair" &&
    result?.repair &&
    !result.restarted &&
    result.repair.changedFiles === 0 &&
    result.repair.changedThreads === 0;
  const stage = t(`codexMaintenance.phases.${progress?.phase ?? "waiting"}`);
  const percent = progress?.total
    ? Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))
    : undefined;
  // The check-and-restart action starts with a read-only scan. Keep the
  // three lifecycle steps hidden until Codex is actually being stopped; this
  // avoids making the scan look like a repair or restart is already running.
  const lifecycleStarted = [
    "stopping",
    "backup_files",
    "backup_database",
    "verify_files",
    "write_files",
    "write_database",
    "commit",
    "rollback",
    "cleanup",
    "restarting",
    "done",
  ].includes(progress?.phase ?? "");
  const showLifecycleSteps = Boolean(
    pending &&
      pending !== "preview" &&
      pending !== "cleanup" &&
      progress &&
      lifecycleStarted &&
      (pending === "repair_and_restart" || pending === "check_and_restart"),
  );
  const lifecycleStep =
    progress?.phase === "restarting"
      ? 2
      : progress?.phase === "stopping"
        ? 0
        : progress?.phase === "done"
          ? 3
          : 1;
  const lifecycleSteps = [
    "codexMaintenance.steps.stop",
    "codexMaintenance.steps.repair",
    "codexMaintenance.steps.restart",
  ] as const;
  const cleanupDisabled =
    Boolean(pending) ||
    backups.isFetching ||
    backups.isError ||
    !backups.data?.count;
  const warnings =
    cleanupResult?.warnings ??
    result?.repair?.warnings ??
    (previewCurrent ? preview?.warnings : []) ??
    [];
  return (
    <Dialog
      open={reason !== null}
      onOpenChange={(open) => {
        if (!open && !busy.current) setReason(null);
      }}
    >
      <DialogContent
        zIndex="top"
        className="sm:max-w-xl"
        onEscapeKeyDown={(e) => {
          if (busy.current) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              complete
                ? noOp
                  ? "codexMaintenance.noChangesTitle"
                  : "codexMaintenance.completed"
                : cleaning
                  ? "codexMaintenance.cleanup"
                  : reason === "config-changed"
                    ? "codexMaintenance.changedTitle"
                    : reason === "repair"
                      ? "codexMaintenance.repair"
                      : "codexMaintenance.restart",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              cleaning
                ? "codexMaintenance.cleanupDescription"
                : reason === "config-changed" && !complete
                  ? "codexMaintenance.changedDescription"
                  : "codexMaintenance.description",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          {pending && !cleaning && progress && (
            <div
              role="status"
              aria-live="polite"
              className="space-y-3 rounded-lg border border-border-default bg-muted/30 p-4 text-sm"
            >
              {showLifecycleSteps && (
                <div
                  data-testid="codex-maintenance-steps"
                  className="grid grid-cols-3 gap-2 border-b border-border-default pb-3"
                  aria-label={t("codexMaintenance.steps.label")}
                >
                  {lifecycleSteps.map((key, index) => {
                    const completeStep = index < lifecycleStep;
                    const activeStep =
                      index === lifecycleStep && lifecycleStep < 3;
                    return (
                      <div
                        key={key}
                        className={`flex min-w-0 items-center gap-1.5 text-xs ${
                          completeStep || activeStep
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            completeStep
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : activeStep
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border-default"
                          }`}
                        >
                          {completeStep ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <span>{index + 1}</span>
                          )}
                        </span>
                        <span className="truncate">{t(key)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {stage}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("codexMaintenance.elapsed", { seconds: elapsed })}
                </span>
              </div>
              <progress
                aria-label={stage}
                max={100}
                value={percent}
                className="h-2 w-full accent-primary"
              />
              {progress.unit !== "steps" && (
                <p className="text-xs text-muted-foreground">
                  {progress.unit === "bytes"
                    ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total ?? 0)}`
                    : t("codexMaintenance.progressCount", {
                        done: progress.completed,
                        total: progress.total ?? "—",
                        unit: t(`codexMaintenance.units.${progress.unit}`),
                      })}
                </p>
              )}
              {progress.item && (
                <p className="break-all text-xs text-muted-foreground">
                  {progress.item}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("codexMaintenance.stageHint")}
              </p>
            </div>
          )}
          {!complete && previewCurrent && preview && (
            <div
              data-testid="codex-repair-preview"
              className={`space-y-2 rounded-lg border p-4 text-sm ${
                previewNoChanges
                  ? "border-emerald-300 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30"
                  : "border-border-default bg-muted/30"
              }`}
            >
              <p
                className={`flex items-center gap-2 ${
                  previewNoChanges
                    ? "text-base font-semibold text-emerald-900 dark:text-emerald-100"
                    : "font-medium"
                }`}
              >
                {previewNoChanges && (
                  <CircleCheck
                    className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                )}
                <span>
                  {t(
                    previewNoChanges
                      ? "codexMaintenance.noChangesTitle"
                      : "codexMaintenance.previewTitle",
                  )}
                </span>
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {t("codexMaintenance.target", { provider: preview.provider })}
              </p>
              <p>
                {t("codexMaintenance.previewScanned", {
                  files: preview.scannedFiles,
                  databases: preview.databaseCount,
                })}
              </p>
              <p>
                {t("codexMaintenance.previewChanges", {
                  files: preview.changedFiles,
                  threads: preview.changedThreads,
                  size: formatBytes(preview.estimatedBackupBytes),
                })}
              </p>
              {preview.skippedFiles > 0 && (
                <p className="text-amber-700 dark:text-amber-300">
                  {t("codexMaintenance.skippedSessions", {
                    count: preview.skippedFiles,
                  })}
                </p>
              )}
              <p
                className={`text-xs ${
                  previewNoChanges
                    ? "text-emerald-900/80 dark:text-emerald-100/80"
                    : "text-muted-foreground"
                }`}
              >
                {t(
                  previewNoChanges
                    ? "codexMaintenance.noChangesDescription"
                    : "codexMaintenance.previewReadOnly",
                )}
              </p>
              {previewNoChanges && (
                <p className="text-xs font-medium text-emerald-900/80 dark:text-emerald-100/80">
                  {t("codexMaintenance.noChangesActionHint")}
                </p>
              )}
            </div>
          )}
          {!complete && !cleaning && (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>{t("codexMaintenance.interruption")}</p>
              {reason === "restart" ? (
                <p>{t("codexMaintenance.restartDescription")}</p>
              ) : (
                <>
                  <p>{t("codexMaintenance.repairDescription")}</p>
                  {status.data?.repairTarget && !previewCurrent && (
                    <p className="break-all font-medium text-foreground">
                      {t("codexMaintenance.target", {
                        provider: status.data.repairTarget,
                      })}
                    </p>
                  )}
                  <p>{t("codexMaintenance.retention")}</p>
                </>
              )}
            </div>
          )}
          {!complete && cleaning && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {t("codexMaintenance.retention")}
              </p>
              {backups.isFetching && (
                <p role="status" className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("codexMaintenance.loadingBackups")}
                </p>
              )}
              {backups.data && (
                <>
                  <p className="font-medium">
                    {t("codexMaintenance.backupStats", {
                      count: backups.data.count,
                      size: formatBytes(backups.data.bytes),
                    })}
                  </p>
                  <p className="break-all text-muted-foreground">
                    {backups.data.path}
                  </p>
                  {backups.data.protectedCount > 0 && (
                    <p>
                      {t("codexMaintenance.protectedBackups", {
                        count: backups.data.protectedCount,
                      })}
                    </p>
                  )}
                  {backups.data.skippedEntries > 0 && (
                    <p>
                      {t("codexMaintenance.skippedBackups", {
                        count: backups.data.skippedEntries,
                      })}
                    </p>
                  )}
                  {backups.data.count > 0 ? (
                    <p className="text-destructive dark:text-red-400">
                      {t("codexMaintenance.cleanupWarning")}
                    </p>
                  ) : (
                    <p>{t("codexMaintenance.noBackups")}</p>
                  )}
                </>
              )}
              {backups.isError && (
                <p
                  role="alert"
                  className="break-words text-destructive dark:text-red-400"
                >
                  {extractErrorMessage(backups.error)}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(pending) || backups.isFetching}
                onClick={() => {
                  setError("");
                  void backups.refetch();
                }}
              >
                {t("codexMaintenance.refreshBackups")}
              </Button>
            </div>
          )}
          {!cleaning && status.data && !status.data.supported && (
            <p
              role="alert"
              className="text-sm text-destructive dark:text-red-400"
            >
              {t("codexMaintenance.unsupported")}
            </p>
          )}
          {!cleaning && status.isError && (
            <div
              role="alert"
              className="text-sm text-destructive dark:text-red-400"
            >
              {t("codexMaintenance.statusFailed")}
              <Button variant="link" onClick={() => status.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {!cleaning &&
            !complete &&
            reason !== "restart" &&
            status.data?.repairError && (
              <p
                role="alert"
                className="break-words text-sm text-destructive dark:text-red-400"
              >
                {status.data.repairError}
              </p>
            )}
          {error && (
            <div
              role="alert"
              className="space-y-2 text-sm text-destructive dark:text-red-400"
            >
              <p className="whitespace-pre-wrap break-words">{error}</p>
              {!cleaning && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(pending) || status.isFetching}
                  onClick={() => {
                    setError("");
                    setPreview(null);
                    void status.refetch();
                  }}
                >
                  {t("codexMaintenance.refreshTarget")}
                </Button>
              )}
            </div>
          )}
          {result?.repair && (
            <div
              role="status"
              className={`space-y-2 rounded-lg border p-4 text-sm ${
                noOp
                  ? "border-emerald-300 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30"
                  : "border-border-default bg-muted/30"
              }`}
            >
              {noOp && (
                <p className="flex items-center gap-2 text-base font-semibold text-emerald-900 dark:text-emerald-100">
                  <CircleCheck
                    className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  {t("codexMaintenance.noChangesTitle")}
                </p>
              )}
              <p>
                {t(
                  noOp ? "codexMaintenance.target" : "codexMaintenance.summary",
                  {
                    files: result.repair.changedFiles,
                    threads: result.repair.changedThreads,
                    provider: result.repair.provider,
                  },
                )}
              </p>
              {result.repair.backupPath && (
                <p className="break-all text-muted-foreground">
                  {t("codexMaintenance.backup", {
                    path: result.repair.backupPath,
                  })}
                </p>
              )}
              {result.repair.prunedBackups > 0 && (
                <p>
                  {t("codexMaintenance.pruned", {
                    count: result.repair.prunedBackups,
                  })}
                </p>
              )}
              {result.repair.skippedFiles > 0 && (
                <p>
                  {t("codexMaintenance.skippedSessions", {
                    count: result.repair.skippedFiles,
                  })}
                </p>
              )}
              <p>
                {t(
                  result.restarted
                    ? "codexMaintenance.restarted"
                    : "codexMaintenance.noChangesDescription",
                )}
              </p>
            </div>
          )}
          {cleanupResult && (
            <p role="status" className="text-sm">
              {t("codexMaintenance.cleaned", {
                count: cleanupResult.deletedCount,
                size: formatBytes(cleanupResult.deletedBytes),
              })}
            </p>
          )}
          {warnings.length > 0 && (
            <div
              role="alert"
              className="space-y-2 break-words text-sm text-destructive dark:text-red-400"
            >
              {warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-wrap gap-2 sm:space-x-0">
          <Button
            variant="outline"
            disabled={Boolean(pending)}
            onClick={() => setReason(null)}
          >
            {t(
              complete
                ? "common.close"
                : reason === "config-changed"
                  ? "codexMaintenance.later"
                  : "common.cancel",
            )}
          </Button>
          {!complete && cleaning && (
            <Button
              variant="destructive"
              disabled={cleanupDisabled}
              onClick={() => void run("cleanup")}
            >
              {pending === "cleanup" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("codexMaintenance.cleanupConfirm")}
            </Button>
          )}
          {!complete &&
            (reason === "restart" || reason === "config-changed") && (
              <Button
                variant={reason === "restart" ? "default" : "outline"}
                disabled={disabled}
                onClick={() => void run("restart")}
              >
                {pending === "restart" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t(
                  reason === "restart"
                    ? "codexMaintenance.restart"
                    : "codexMaintenance.restartOnly",
                )}
              </Button>
            )}
          {!complete && reason === "repair" && (
            <Button
              variant="outline"
              disabled={previewDisabled}
              onClick={() => void run("preview")}
            >
              {pending === "preview" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {t("codexMaintenance.preview")}
            </Button>
          )}
          {!complete && reason === "repair" && (
            <Button
              disabled={repairDisabled}
              onClick={() => void run("repair_and_restart")}
            >
              {pending === "repair_and_restart" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("codexMaintenance.repairAndRestart")}
            </Button>
          )}
          {!complete && reason === "config-changed" && (
            <Button
              disabled={disabled || previewDisabled}
              onClick={() => void run("check_and_restart")}
            >
              {pending === "check_and_restart" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("codexMaintenance.checkAndRestart")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
