import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { codexModelRoutingApi } from "@/lib/api/codexModelRouting";
import type { CodexNativeLoginStatus } from "@/types/codexModelRouting";
import { extractErrorMessage } from "@/utils/errorUtils";

export function CodexNativeLoginButton({
  disabled,
  onComplete,
  openSignal = 0,
  promptOnly = false,
}: {
  disabled: boolean;
  onComplete: () => Promise<unknown>;
  /** Increment to open the existing login confirmation. */
  openSignal?: number;
  /** Hide the inline button; still show the confirm dialog and waiting state. */
  promptOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<CodexNativeLoginStatus>();
  const [error, setError] = useState("");
  const runRef = useRef<string>();
  const alive = useRef(true);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (runRef.current)
        void codexModelRoutingApi
          .cancelNativeLogin(runRef.current)
          .catch(() => undefined);
    };
  }, []);
  const seenSignal = useRef(0);
  useEffect(() => {
    if (!openSignal || openSignal === seenSignal.current) return;
    seenSignal.current = openSignal;
    setConfirm(true);
  }, [openSignal]);

  useEffect(() => {
    if (!run || run.status !== "waiting") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await codexModelRoutingApi.nativeLoginStatus(run.id);
        if (disposed) return;
        setRun(next);
        if (next.status === "waiting")
          timer = setTimeout(() => void poll(), 1500);
        else {
          runRef.current = undefined;
          if (next.status === "succeeded") {
            toast.success(t("codexRouting.subscription.loginSucceeded"));
            try {
              await completeRef.current();
            } catch (e) {
              if (!disposed) setError(extractErrorMessage(e));
            }
          } else if (next.error) setError(next.error);
        }
      } catch (e) {
        if (!disposed) {
          setError(extractErrorMessage(e));
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [run?.id, run?.status]);
  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const next = await codexModelRoutingApi.startNativeLogin();
      if (!alive.current) {
        await codexModelRoutingApi.cancelNativeLogin(next.id);
        return;
      }
      runRef.current = next.id;
      setRun(next);
      setConfirm(false);
    } catch (e) {
      if (alive.current) {
        setError(extractErrorMessage(e));
        setConfirm(false);
      }
    } finally {
      if (alive.current) setStarting(false);
    }
  };
  const cancel = async () => {
    if (!run) return;
    try {
      await codexModelRoutingApi.cancelNativeLogin(run.id);
      runRef.current = undefined;
      setRun(undefined);
      setError("");
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  };
  const showStatus = !promptOnly || run?.status === "waiting" || Boolean(error);
  return (
    <>
      {showStatus && (
        <div className="space-y-1.5">
          {run?.status === "waiting" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
              <span role="status">
                {t("codexRouting.subscription.loginWaiting")}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void cancel()}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || starting}
              onClick={() => setConfirm(true)}
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t("codexRouting.subscription.login")}
            </Button>
          )}
          {error && (
            <p
              role="alert"
              className="max-w-sm break-words text-xs text-destructive"
            >
              {error}
            </p>
          )}
          {run?.status === "waiting" && (
            <p className="max-w-sm text-xs text-muted-foreground">
              {t("codexRouting.subscription.loginFallback")}
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirm}
        title={t("codexRouting.subscription.login")}
        message={t("codexRouting.subscription.loginConfirm")}
        confirmText={t("codexRouting.subscription.loginContinue")}
        variant="info"
        pending={starting}
        onConfirm={() => void start()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
