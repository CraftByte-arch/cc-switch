import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Check, Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Provider } from "@/types";
import {
  codexGuidePlace,
  codexGuideSteps,
  getCodexGuideSignals,
  getCodexGuideDetail,
  hasSeenCodexGuide,
  markCodexGuideSeen,
  codexGuideSurface,
  publishCodexGuidePlace,
  readCodexGuideProgress,
  saveCodexGuideProgress,
  startCodexGuide,
  subscribeCodexGuide,
  subscribeCodexGuideSignals,
  updateCodexGuideSignals,
  type CodexGuideMode,
  type CodexGuideStep,
} from "@/lib/codexGuide";

type Rect = { top: number; left: number; width: number; height: number };

function findAnchor(
  step: CodexGuideStep,
  providerId: string,
): HTMLElement | null {
  for (const name of [step.target, step.fallback]) {
    if (!name) continue;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`),
    );
    if (name === "codex-provider-card" && providerId)
      nodes.sort(
        (a, b) =>
          Number(b.dataset.providerId === providerId) -
          Number(a.dataset.providerId === providerId),
      );
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      let ancestor: HTMLElement | null = node;
      let hidden = false;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (
          ancestor.hidden ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          hidden = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!hidden) return node;
    }
  }
  return null;
}

function visibleRect(node: HTMLElement): Rect | null {
  const box = node.getBoundingClientRect();
  // The mapping anchor is the complete section, including every editable row.
  // Leave breathing room outside its controls, then clip to the scroll viewport.
  const padding = node.dataset.tour === "codex-model-mapping" ? 6 : 0;
  let top = Math.max(12, box.top - padding),
    left = Math.max(12, box.left - padding);
  let bottom = Math.min(window.innerHeight - 12, box.bottom + padding),
    right = Math.min(window.innerWidth - 12, box.right + padding);
  let ancestor = node.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    const bounds = ancestor.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    ancestor = ancestor.parentElement;
  }
  return bottom > top && right > left
    ? { top, left, width: right - left, height: bottom - top }
    : null;
}

export function CodexGuide({
  active,
  providers = {},
  currentProviderId = "",
}: {
  active: boolean;
  providers?: Record<string, Provider>;
  currentProviderId?: string;
}) {
  const { t } = useTranslation();
  const [welcome, setWelcome] = useState(false);
  const [choice, setChoice] = useState<CodexGuideMode>("routing");
  const [mode, setMode] = useState<CodexGuideMode | null>(null);
  const [index, setIndex] = useState(0);
  const [providerId, setProviderId] = useState("");
  const [existing, setExisting] = useState("");
  const [summary, setSummary] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [pendingStart, setPendingStart] = useState<boolean | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [anchorName, setAnchorName] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [modalOpen, setModalOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [minimized, setMinimized] = useState(false);
  const signals = useSyncExternalStore(
    subscribeCodexGuideSignals,
    getCodexGuideSignals,
  );
  const previousPanels = useRef({
    providerOpen: signals.providerOpen,
    routingOpen: signals.routingOpen,
  });
  const steps = mode ? codexGuideSteps(mode) : [];
  const step = steps[index];
  const progress = readCodexGuideProgress();
  const tr = (key: string) => t(`codexGuide.${key}`);
  useEffect(() => setMinimized(false), [step]);
  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  // Closing the guide must not close panels or discard their unsaved form data.
  const close = useCallback(() => {
    markCodexGuideSeen();
    setMode(null);
    setWelcome(false);
    setSummary(false);
    setConfirmBack(false);
    setPendingStart(null);
    publishCodexGuidePlace("main", null);
  }, []);

  useEffect(
    () =>
      subscribeCodexGuide((requested) => {
        if (!active) return;
        setChoice(requested ?? "routing");
        setWelcome(true);
      }),
    [active],
  );
  useEffect(() => {
    if (active && !hasSeenCodexGuide() && import.meta.env.MODE !== "test")
      setWelcome(true);
    if (!active) {
      setWelcome(false);
      setMode(null);
      publishCodexGuidePlace("main", null);
    }
  }, [active]);
  useEffect(() => {
    if (!mode || !step) return;
    saveCodexGuideProgress({ mode, stepId: step.id, providerId });
  }, [mode, step, providerId]);
  useEffect(() => {
    if (!mode || providerId || !signals.providerSaved) return;
    const added = signals.savedProviderId;
    if (added) {
      setProviderId(added);
      const detail = getCodexGuideDetail();
      // Saving has already closed the form; only highlight the saved card.
      publishCodexGuidePlace("main", detail.stepId, added);
    }
  }, [signals.savedProviderId, signals.providerSaved, mode, providerId]);
  useEffect(() => {
    if (!mode) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        document.querySelector('[role="dialog"][data-state="open"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, close]);

  const go = (next: number) => {
    const target = steps[next];
    if (!target) return;
    setIndex(next);
    setConfirmBack(false);
    setRect(null);
    publishCodexGuidePlace(
      signals.providerSaved &&
        !signals.providerOpen &&
        codexGuidePlace(target.id) === "add"
        ? "main"
        : codexGuidePlace(target.id),
      target.id,
      providerId,
    );
  };
  const start = (resume: boolean, discardConfirmed = false) => {
    const nextMode = resume && progress ? progress.mode : choice;
    let id = resume && progress ? progress.stepId : "add-provider";
    const chosen = resume && progress ? (progress.providerId ?? "") : existing;
    const nextProvider = providers[chosen] ? chosen : "";
    if (!resume && nextProvider)
      id = nextMode === "provider" ? "enable-provider" : "enter-routing";
    // Form values are never persisted. Resume unsaved setup at the form entry.
    if (resume && codexGuidePlace(id) === "add" && !signals.providerOpen)
      id = nextProvider
        ? nextMode === "provider"
          ? "enable-provider"
          : "enter-routing"
        : "provider-preset";
    const place = codexGuidePlace(id);
    if (
      !discardConfirmed &&
      ((signals.providerOpen && !signals.providerSaved && place !== "add") ||
        (signals.routingOpen &&
          !signals.routingSaved &&
          !place.startsWith("routing-")))
    ) {
      setPendingStart(resume);
      return;
    }
    setPendingStart(null);
    if (!resume)
      updateCodexGuideSignals({
        repaired: false,
        restarted: false,
        ...(!signals.providerOpen
          ? { providerSaved: false, savedProviderId: "" }
          : {}),
      });
    markCodexGuideSeen();
    setWelcome(false);
    setSummary(false);
    setMode(nextMode);
    setProviderId(nextProvider);
    setIndex(codexGuideSteps(nextMode).findIndex((item) => item.id === id));
    publishCodexGuidePlace(codexGuidePlace(id), id, nextProvider);
  };

  // Follow a real page-opening action, not general readiness. Only the two
  // entry steps advance automatically; edits, save and enable still require Next.
  // Track the opening edge so Back cannot bounce forward on a stale open flag.
  useEffect(() => {
    const previous = previousPanels.current;
    previousPanels.current = {
      providerOpen: signals.providerOpen,
      routingOpen: signals.routingOpen,
    };
    if (!active || !mode || welcome || summary) return;
    const nextId =
      step?.id === "add-provider" &&
      !previous.providerOpen &&
      signals.providerOpen
        ? "provider-preset"
        : step?.id === "enter-routing" &&
            !previous.routingOpen &&
            signals.routingOpen
          ? "routing-sources"
          : null;
    if (!nextId) return;
    setIndex(codexGuideSteps(mode).findIndex((item) => item.id === nextId));
    setConfirmBack(false);
    setRect(null);
    publishCodexGuidePlace(codexGuidePlace(nextId), nextId, providerId);
  }, [
    active,
    mode,
    welcome,
    summary,
    step?.id,
    providerId,
    signals.providerOpen,
    signals.routingOpen,
  ]);

  useLayoutEffect(() => {
    if (!step || summary) {
      setRect(null);
      return;
    }
    let lastAnchor: HTMLElement | null = null;
    let anchorObserver: ResizeObserver | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const blocking = Boolean(
        document.querySelector('[role="dialog"][data-state="open"]'),
      );
      setModalOpen(blocking);
      if (blocking) return;
      const anchor = findAnchor(step, providerId);
      if (anchor && anchor !== lastAnchor) {
        if (lastAnchor) anchorObserver?.unobserve(lastAnchor);
        lastAnchor = anchor;
        anchorObserver?.observe(anchor);
        anchor.scrollIntoView?.({
          // Tall preset/model lists should start at their heading and first
          // options, rather than centering halfway through the list.
          block:
            anchor.getBoundingClientRect().height > window.innerHeight / 2
              ? "start"
              : "center",
          inline: "nearest",
          behavior: "instant",
        });
      }
      setAnchorName(anchor?.dataset.tour ?? null);
      const next = anchor ? visibleRect(anchor) : null;
      setRect((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = schedule;
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "data-state"],
    });
    const ro = new ResizeObserver(schedule);
    anchorObserver = ro;
    ro.observe(document.body);
    if (lastAnchor) ro.observe(lastAnchor);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      ro.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step, providerId, retry, summary]);
  let ready = true;
  if (step)
    switch (step.id) {
      case "provider-name":
        ready = signals.nameReady;
        break;
      case "api-key":
        ready = signals.official || signals.keyReady;
        break;
      case "api-url":
        ready = signals.official || signals.urlReady;
        break;
      case "fetch-models":
        ready = signals.official || signals.fetchState === "success";
        break;
      case "model-mapping":
        ready = signals.official || signals.mappingCount > 0;
        break;
      case "save-provider":
        ready = signals.providerSaved;
        break;
      case "enable-provider":
        ready = Boolean(providerId && currentProviderId === providerId);
        break;
      case "select-models":
      case "sort-models":
        ready = signals.selectedCount > 0;
        break;
      case "default-model":
        ready = signals.selectedCount > 0 && signals.defaultReady;
        break;
      case "save-routing":
        ready = signals.routingSaved && signals.selectedCount > 0;
        break;
      case "enable-config":
        ready = signals.routeEnabled;
        break;
      case "enable-proxy":
        ready = signals.proxyEnabled;
        break;
      case "repair-sessions":
        ready = signals.repaired;
        break;
      case "restart":
        ready = signals.restarted;
        break;
    }
  const optional =
    step &&
    ["fetch-models", "model-mapping", "repair-sessions", "restart"].includes(
      step.id,
    );
  const formClosed =
    step &&
    codexGuidePlace(step.id) === "add" &&
    !signals.providerOpen &&
    !signals.providerSaved;
  const routingClosed =
    step &&
    codexGuidePlace(step.id).startsWith("routing-") &&
    !signals.routingOpen;
  const next = () => {
    if (index === steps.length - 1) {
      setSummary(true);
      saveCodexGuideProgress(null);
    } else go(index + 1);
  };
  const back = () => {
    if (!step || index === 0) return;
    const nextPlace = codexGuidePlace(steps[index - 1].id);
    if (
      (signals.providerOpen && !signals.providerSaved && nextPlace !== "add") ||
      (signals.routingOpen &&
        !signals.routingSaved &&
        !nextPlace.startsWith("routing-"))
    ) {
      setConfirmBack(true);
      return;
    }
    // A saved provider should not reopen a new, blank provider form.
    if (
      (signals.providerSaved || providerId) &&
      nextPlace === "add" &&
      !signals.providerOpen
    ) {
      go(0);
      return;
    }
    go(index - 1);
  };
  const saveBubble = Boolean(
    !summary &&
      !minimized &&
      !ready &&
      rect &&
      anchorName === step?.target &&
      (step?.id === "save-provider" || step?.id === "save-routing"),
  );
  const surface = codexGuideSurface(
    viewport,
    minimized,
    saveBubble ? rect : null,
  );
  const surfaceKind = minimized ? "minimized" : saveBubble ? "save" : "bar";
  // Reduced-motion users get a brief fade, without a cross-screen transform.
  useEffect(() => {
    if (!reduceMotion) return;
    const fade = surfaceRef.current?.animate?.(
      [{ opacity: 0.7 }, { opacity: 1 }],
      { duration: 120 },
    );
    return () => fade?.cancel();
  }, [surfaceKind, reduceMotion]);
  const completed =
    mode === "provider"
      ? Boolean(providerId && currentProviderId === providerId)
      : signals.routeEnabled && signals.proxyEnabled;
  return (
    <>
      <Dialog
        open={welcome}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent zIndex="top" className="overflow-y-auto">
          <button
            type="button"
            aria-label={tr("close")}
            className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground hover:bg-muted"
            onClick={close}
          >
            <X className="h-4 w-4" />
          </button>
          <DialogHeader className="pr-12">
            <DialogTitle>{tr("welcomeTitle")}</DialogTitle>
            <DialogDescription>{tr("welcomeBody")}</DialogDescription>
          </DialogHeader>
          <div
            className="grid gap-3 px-6 py-4"
            role="radiogroup"
            aria-label={tr("welcomeTitle")}
          >
            {(["routing", "provider"] as const).map((item) => (
              <button
                key={item}
                role="radio"
                aria-checked={choice === item}
                onClick={() => setChoice(item)}
                className={`rounded-xl border p-4 text-left transition-colors ${choice === item ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
              >
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {tr(item === "provider" ? "providerOnly" : "routing")}
                  {item === "routing" && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {tr("recommended")}
                    </span>
                  )}
                  {choice === item && (
                    <Check
                      aria-hidden="true"
                      className="ml-auto h-4 w-4 shrink-0 text-primary"
                    />
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {tr(`${item}Description`)}
                </span>
              </button>
            ))}
          </div>
          {choice === "routing" && (
            <p className="px-6 pb-4 text-xs leading-relaxed text-muted-foreground">
              {tr("setupNote")}
            </p>
          )}
          {Object.keys(providers).length > 0 && (
            <label className="grid gap-2 px-6 text-sm">
              {tr("providerSource")}
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={existing}
                onChange={(event) => setExisting(event.target.value)}
              >
                <option value="">{tr("createProvider")}</option>
                {Object.values(providers).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {pendingStart !== null && (
            <div className="rounded-lg border border-destructive/30 p-3 text-xs">
              <p>{tr("discardBack")}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPendingStart(null)}
                >
                  {tr("keepEditing")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => start(pendingStart, true)}
                >
                  {tr("discardAndBack")}
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 px-6 py-5">
            <Button variant="ghost" onClick={close}>
              {tr("skip")}
            </Button>
            {progress && (
              <Button variant="outline" onClick={() => start(true)}>
                {tr("resume")}
              </Button>
            )}
            <Button onClick={() => start(false)}>{tr("start")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {mode &&
        step &&
        !welcome &&
        !modalOpen &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-0 z-[90]"
            data-codex-guide="active"
          >
            {!summary && rect && !minimized && (
              <div
                data-testid="codex-guide-highlight"
                aria-hidden="true"
                className="pointer-events-none absolute rounded-lg border-[3px] border-orange-600 ring-2 ring-white shadow-[0_0_0_6px_rgba(234,88,12,0.24),0_0_24px_rgba(234,88,12,0.2)] dark:border-amber-400 dark:ring-slate-950 dark:shadow-[0_0_0_6px_rgba(251,191,36,0.28),0_0_24px_rgba(251,191,36,0.2)]"
                style={rect}
              >
                <span className="absolute -left-2.5 -top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:bg-amber-400 dark:text-slate-950 dark:ring-slate-950">
                  {index + 1}
                </span>
              </div>
            )}
            <motion.div
              ref={surfaceRef}
              layout={!reduceMotion}
              initial={false}
              transition={{
                layout: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
              }}
              role="complementary"
              aria-label={tr("replay")}
              data-guide-layout={surfaceKind}
              data-guide-motion={reduceMotion ? "reduced" : "full"}
              className="pointer-events-auto absolute grid rounded-xl border border-orange-400/80 bg-white/85 text-slate-900 shadow-lg backdrop-blur-xl dark:border-amber-400/60 dark:bg-slate-900/85 dark:text-slate-100"
              style={{
                top: surface.top,
                left: surface.left,
                width: surface.width,
                height: surface.height,
                gridTemplateColumns:
                  !saveBubble && viewport.width >= 640
                    ? "minmax(0,1fr) auto"
                    : "minmax(0,1fr)",
                gridTemplateRows: minimized
                  ? "1fr"
                  : saveBubble || viewport.width < 640
                    ? "32px minmax(0,1fr) 40px"
                    : "32px minmax(0,1fr)",
              }}
            >
              {saveBubble && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute h-2.5 w-2.5 rotate-45 border-orange-400 bg-white/90 dark:border-amber-400/60 dark:bg-slate-900/90"
                  style={{
                    left: (surface.arrowLeft ?? 20) - 5,
                    ...(surface.placement === "above"
                      ? {
                          bottom: -6,
                          borderRightWidth: 1,
                          borderBottomWidth: 1,
                        }
                      : { top: -6, borderLeftWidth: 1, borderTopWidth: 1 }),
                  }}
                />
              )}
              <motion.div
                layout={reduceMotion ? false : "position"}
                className="col-span-full flex min-h-0 items-center justify-between gap-2 rounded-t-xl border-b border-orange-200/70 bg-orange-100/60 px-3 dark:border-amber-400/25 dark:bg-amber-400/10"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex shrink-0 items-center gap-1 text-xs font-semibold text-orange-800 dark:text-amber-300"
                    title={tr("guideLabel")}
                  >
                    <Compass className="h-4 w-4" aria-hidden="true" />
                    <span
                      className={saveBubble ? "hidden" : "hidden sm:inline"}
                    >
                      {tr("guideLabel")}
                    </span>
                  </span>
                  <span
                    aria-label={!summary && rect ? tr("targetHint") : undefined}
                    title={tr(mode === "provider" ? "providerOnly" : "routing")}
                    className="shrink-0 rounded-md bg-orange-600 px-1.5 py-1 text-[11px] font-semibold tabular-nums text-white dark:bg-amber-400 dark:text-slate-950"
                  >
                    {index + 1}/{steps.length}
                  </span>
                  <h2 className="truncate text-sm font-semibold">
                    {summary
                      ? tr("summaryTitle")
                      : tr(`steps.${step.id}.title`)}
                  </h2>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    className="rounded px-2 py-1 text-xs hover:bg-muted"
                    onClick={() => setMinimized(!minimized)}
                  >
                    {tr(minimized ? "expand" : "minimize")}
                  </button>
                  <button
                    aria-label={tr("close")}
                    className="rounded p-2 hover:bg-muted"
                    onClick={close}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
              {!minimized && (
                <>
                  <motion.div
                    layout={reduceMotion ? false : "position"}
                    className="min-h-0 overflow-y-auto px-3 py-1.5"
                  >
                    <p className="text-[13px] leading-5 text-slate-800 dark:text-slate-100">
                      {summary
                        ? tr(completed ? "configured" : "notConfigured")
                        : saveBubble
                          ? tr(
                              step.id === "save-provider"
                                ? "saveProviderHint"
                                : "saveRoutingHint",
                            )
                          : tr(`steps.${step.id}.body`)}
                    </p>
                    {!summary && (
                      <>
                        {signals.official &&
                          [
                            "api-key",
                            "api-url",
                            "fetch-models",
                            "model-mapping",
                          ].includes(step.id) && (
                            <p className="mt-2 text-xs text-primary">
                              {tr("officialHint")}
                            </p>
                          )}
                        {step.id === "fetch-models" && (
                          <p className="mt-2 text-xs" role="status">
                            {tr(`fetch.${signals.fetchState}`)}
                            {signals.fetchState === "success"
                              ? ` (${signals.fetchedCount})`
                              : ""}
                          </p>
                        )}
                        <p
                          className={
                            saveBubble
                              ? "mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
                              : "sr-only"
                          }
                          role="status"
                        >
                          {ready && (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          )}
                          {tr(ready ? "ready" : "waiting")}
                        </p>
                        {!rect && !ready && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {tr("targetMissing")}
                          </p>
                        )}
                        {(formClosed || routingClosed || (!rect && !ready)) && (
                          <Button
                            className="mt-2"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              publishCodexGuidePlace(
                                codexGuidePlace(step.id),
                                step.id,
                                providerId,
                              );
                              setRetry((v) => v + 1);
                            }}
                          >
                            {tr("locate")}
                          </Button>
                        )}
                        {step.id === "select-models" &&
                          signals.selectedCount === 0 && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {tr("noModels")}
                            </p>
                          )}
                        {[
                          "sort-models",
                          "default-model",
                          "save-routing",
                        ].includes(step.id) &&
                          signals.selectedCount === 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              onClick={() =>
                                go(
                                  steps.findIndex(
                                    (s) => s.id === "select-models",
                                  ),
                                )
                              }
                            >
                              {tr("backToModels")}
                            </Button>
                          )}
                        {codexGuidePlace(step.id) === "add" &&
                          signals.providerSaved &&
                          step.id !== "save-provider" && (
                            <Button
                              size="sm"
                              className="mt-2"
                              onClick={() =>
                                go(
                                  steps.findIndex(
                                    (s) => s.id === "save-provider",
                                  ),
                                )
                              }
                            >
                              {tr("providerSaved")}
                            </Button>
                          )}
                      </>
                    )}
                    {confirmBack && (
                      <div className="mt-3 rounded-lg border p-3 text-xs">
                        <p>{tr("discardBack")}</p>
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmBack(false)}
                          >
                            {tr("keepEditing")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => go(index - 1)}
                          >
                            {tr("discardAndBack")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                  <motion.div
                    layout={reduceMotion ? false : "position"}
                    className={`flex min-w-0 items-center justify-end gap-2 px-3 py-1 ${saveBubble || viewport.width < 640 ? "border-t border-orange-200/60 dark:border-amber-400/20" : "self-end"}`}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`${saveBubble ? "hidden" : "hidden sm:inline-flex"} h-8 px-2 text-xs`}
                      onClick={close}
                    >
                      {tr("exit")}
                    </Button>
                    {summary ? (
                      <Button
                        size="sm"
                        className="h-8 min-w-20 bg-orange-600 text-xs font-semibold text-white hover:bg-orange-700 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
                        onClick={close}
                      >
                        {tr("done")}
                      </Button>
                    ) : (
                      <div className="flex shrink-0 gap-1 [&>button]:h-8 [&>button]:px-2 [&>button]:text-xs">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={index === 0}
                          onClick={back}
                        >
                          {tr("previous")}
                        </Button>
                        {optional && !ready && (
                          <Button variant="ghost" size="sm" onClick={next}>
                            {tr(
                              step.id === "fetch-models"
                                ? "manualModels"
                                : "skipStep",
                            )}
                          </Button>
                        )}
                        {!saveBubble && (
                          <Button
                            size="sm"
                            className="min-w-20 bg-orange-600 font-semibold text-white hover:bg-orange-700 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
                            disabled={
                              !ready ||
                              Boolean(formClosed) ||
                              Boolean(routingClosed)
                            }
                            onClick={next}
                          >
                            {tr(
                              index === steps.length - 1
                                ? "viewResult"
                                : "next",
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </motion.div>
                </>
              )}
            </motion.div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function CodexGuideReplay() {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" onClick={() => startCodexGuide()}>
      <Compass className="h-4 w-4 shrink-0" />
      {t("codexGuide.replay")}
    </Button>
  );
}
