export type CodexGuideMode = "provider" | "routing";

export type CodexGuideStep = {
  id: string;
  /** Preferred element. Falls back when it is not on screen yet. */
  target: string;
  fallback?: string;
  modes: CodexGuideMode[];
};

/** Which detail surface this step should be showing. */
export type CodexGuidePlace =
  | "main"
  | "add"
  | "routing-available"
  | "routing-selected";

export const CODEX_GUIDE_EVENT = "cc-switch:codex-guide";

export function codexGuidePlace(stepId: string): CodexGuidePlace {
  if (
    [
      "provider-preset",
      "provider-name",
      "api-key",
      "api-url",
      "fetch-models",
      "model-mapping",
      "save-provider",
    ].includes(stepId)
  )
    return "add";
  if (["routing-sources", "select-models"].includes(stepId))
    return "routing-available";
  if (["sort-models", "default-model", "save-routing"].includes(stepId))
    return "routing-selected";
  return "main";
}

export function isCodexGuideMappingStep(stepId: string | null): boolean {
  return stepId === "fetch-models" || stepId === "model-mapping";
}

export type CodexGuideDetail = {
  place: CodexGuidePlace;
  stepId: string | null;
  providerId?: string;
};

let currentDetail: CodexGuideDetail = { place: "main", stepId: null };

/** Latest place, including for panels that mount after the event was sent. */
export function getCodexGuideDetail(): CodexGuideDetail {
  return currentDetail;
}

export function publishCodexGuidePlace(
  place: CodexGuidePlace,
  stepId: string | null = null,
  providerId?: string,
): void {
  currentDetail = { place, stepId, providerId };
  for (const listener of detailListeners) listener();
  window.dispatchEvent(
    new CustomEvent<CodexGuideDetail>(CODEX_GUIDE_EVENT, {
      detail: currentDetail,
    }),
  );
}

const detailListeners = new Set<() => void>();
export function subscribeCodexGuideDetail(listener: () => void) {
  detailListeners.add(listener);
  return () => {
    detailListeners.delete(listener);
  };
}

// Only readiness flags and counts, never form values, credentials or URLs.
export type CodexGuideSignals = {
  providerSaved: boolean;
  savedProviderId: string;
  providerOpen: boolean;
  nameReady: boolean;
  keyReady: boolean;
  urlReady: boolean;
  official: boolean;
  mappingCount: number;
  fetchState: "idle" | "loading" | "success" | "error";
  fetchedCount: number;
  routingOpen: boolean;
  selectedCount: number;
  routingSaved: boolean;
  defaultReady: boolean;
  routeEnabled: boolean;
  proxyEnabled: boolean;
  repaired: boolean;
  restarted: boolean;
};
let signals: CodexGuideSignals = {
  providerSaved: false,
  savedProviderId: "",
  providerOpen: false,
  nameReady: false,
  keyReady: false,
  urlReady: false,
  official: false,
  mappingCount: 0,
  fetchState: "idle",
  fetchedCount: 0,
  routingOpen: false,
  selectedCount: 0,
  routingSaved: false,
  defaultReady: false,
  routeEnabled: false,
  proxyEnabled: false,
  repaired: false,
  restarted: false,
};
const signalListeners = new Set<() => void>();
export const getCodexGuideSignals = () => signals;
export function updateCodexGuideSignals(patch: Partial<CodexGuideSignals>) {
  if (
    Object.entries(patch).every(
      ([key, value]) => signals[key as keyof CodexGuideSignals] === value,
    )
  )
    return;
  signals = { ...signals, ...patch };
  for (const listener of signalListeners) listener();
}
export function subscribeCodexGuideSignals(listener: () => void) {
  signalListeners.add(listener);
  return () => {
    signalListeners.delete(listener);
  };
}

export type CodexGuideProgress = {
  mode: CodexGuideMode;
  stepId: string;
  providerId?: string;
};
const PROGRESS_KEY = "cc-switch.codexGuide.progress.v2";
export function readCodexGuideProgress(): CodexGuideProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null");
    if (
      !value ||
      !["provider", "routing"].includes(value.mode) ||
      !codexGuideSteps(value.mode).some((step) => step.id === value.stepId)
    )
      return null;
    return {
      mode: value.mode,
      stepId: value.stepId,
      providerId:
        typeof value.providerId === "string" ? value.providerId : undefined,
    };
  } catch {
    return null;
  }
}
export function saveCodexGuideProgress(progress: CodexGuideProgress | null) {
  try {
    if (progress) localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* The guide remains usable with storage disabled. */
  }
}

/** One stable guide-bar height per viewport, independent of step content. */
export function codexGuideBarHeight(
  viewport: { width: number; height: number },
  minimized = false,
): number {
  if (minimized) return 44;
  return Math.min(
    viewport.width >= 640 ? 88 : 132,
    Math.max(80, viewport.height - 180),
  );
}

export type CodexGuideRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Only the two real save buttons get an anchored bubble. All other steps stay put. */
export function codexGuideSurface(
  viewport: { width: number; height: number },
  minimized: boolean,
  saveTarget: CodexGuideRect | null,
): CodexGuideRect & {
  placement: "bar" | "above" | "below";
  arrowLeft?: number;
} {
  const margin = 12;
  const barHeight = codexGuideBarHeight(viewport, minimized);
  if (minimized || !saveTarget)
    return {
      top: viewport.height - barHeight - margin,
      left: margin,
      width: Math.max(0, viewport.width - margin * 2),
      height: barHeight,
      placement: "bar",
    };
  const width = Math.min(304, viewport.width - margin * 2);
  const height = Math.min(148, viewport.height - margin * 2);
  const left = Math.max(
    margin,
    Math.min(
      saveTarget.left + saveTarget.width - width,
      viewport.width - width - margin,
    ),
  );
  const above = saveTarget.top - margin - height;
  const below = saveTarget.top + saveTarget.height + margin;
  // Footer save buttons normally have room above. For unusually high anchors,
  // prefer below rather than covering the actual action.
  const placement =
    above >= margin || below + height > viewport.height - margin
      ? "above"
      : "below";
  const top = Math.max(
    margin,
    Math.min(
      placement === "above" ? above : below,
      viewport.height - height - margin,
    ),
  );
  return {
    top,
    left,
    width,
    height,
    placement,
    arrowLeft: Math.max(
      16,
      Math.min(width - 16, saveTarget.left + saveTarget.width / 2 - left),
    ),
  };
}

const SEEN_KEY = "cc-switch.codexGuide.v1";

export const CODEX_GUIDE_STEPS: CodexGuideStep[] = [
  {
    id: "add-provider",
    target: "codex-add-provider",
    modes: ["provider", "routing"],
  },
  {
    id: "provider-preset",
    target: "codex-provider-preset",
    modes: ["provider", "routing"],
  },
  {
    id: "provider-name",
    target: "codex-provider-name",
    modes: ["provider", "routing"],
  },
  {
    id: "api-key",
    target: "codex-api-key",
    fallback: "codex-provider-auth",
    modes: ["provider", "routing"],
  },
  {
    id: "api-url",
    target: "codex-api-url",
    fallback: "codex-provider-auth",
    modes: ["provider", "routing"],
  },
  {
    id: "fetch-models",
    target: "codex-fetch-models",
    fallback: "codex-provider-auth",
    modes: ["provider", "routing"],
  },
  {
    id: "model-mapping",
    target: "codex-model-mapping",
    fallback: "codex-provider-auth",
    modes: ["provider", "routing"],
  },
  {
    id: "save-provider",
    target: "codex-save-provider",
    fallback: "codex-provider-card",
    modes: ["provider", "routing"],
  },
  {
    id: "enable-provider",
    target: "codex-provider-card",
    modes: ["provider"],
  },
  {
    id: "enter-routing",
    target: "codex-routing-manage",
    fallback: "codex-routing-card",
    modes: ["routing"],
  },
  {
    id: "routing-sources",
    target: "codex-routing-models",
    fallback: "codex-routing-available-tab",
    modes: ["routing"],
  },
  {
    id: "select-models",
    target: "codex-routing-model",
    fallback: "codex-routing-models",
    modes: ["routing"],
  },
  {
    id: "sort-models",
    target: "codex-routing-order",
    fallback: "codex-routing-sort",
    modes: ["routing"],
  },
  {
    id: "default-model",
    target: "codex-routing-default",
    fallback: "codex-routing-order",
    modes: ["routing"],
  },
  {
    id: "save-routing",
    target: "codex-routing-save",
    modes: ["routing"],
  },
  {
    id: "enable-config",
    target: "codex-routing-switch",
    modes: ["routing"],
  },
  {
    id: "enable-proxy",
    target: "codex-proxy-toggle",
    fallback: "codex-routing-card",
    modes: ["routing"],
  },
  {
    id: "repair-sessions",
    target: "codex-repair",
    fallback: "codex-maintenance",
    modes: ["routing"],
  },
  {
    id: "restart",
    target: "codex-restart",
    fallback: "codex-maintenance",
    modes: ["routing"],
  },
];

export function codexGuideSteps(mode: CodexGuideMode): CodexGuideStep[] {
  return CODEX_GUIDE_STEPS.filter((step) => step.modes.includes(mode));
}

export function hasSeenCodexGuide(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markCodexGuideSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode can reject storage; the tour can still be closed.
  }
}

type StartListener = (mode?: CodexGuideMode) => void;

const listeners = new Set<StartListener>();

export function startCodexGuide(mode?: CodexGuideMode): void {
  for (const listener of listeners) listener(mode);
}

export function subscribeCodexGuide(listener: StartListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
