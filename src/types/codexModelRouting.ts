import type { Provider, CodexCatalogModel } from "@/types";

export interface CodexModelSelection {
  providerId: string;
  model: string;
}

export interface CodexModelRoutingConfig {
  enabled: boolean;
  providerName: string;
  smartModelNames: boolean;
  nativeSubscriptionEnabled?: boolean;
  showNativeModelPrefix?: boolean;
  nativeModelPrefix?: string;
  nativeCatalogRevision?: string | null;
  /** Server-owned, credentials-free snapshot. Never edited by the form. */
  nativeCatalog?: {
    accountKey: string;
    syncedAt: number;
    models: unknown[];
  } | null;
  /** Independent of list order. Falls back to the first selected model. */
  defaultModel?: CodexModelSelection;
  models: CodexModelSelection[];
}

export interface CodexModelRoutingCapability {
  providerId: string;
  model: string;
  contextWindow: number | null;
}

export interface ModelRoutingSaveResult {
  config: CodexModelRoutingConfig;
  catalogChanged: boolean;
}

export interface CodexNativeRoutingStatus {
  status:
    | "ready"
    | "signedOut"
    | "loginRequired"
    | "unavailable"
    | "syncFailed";
  provider: Provider | null;
  syncedAt: number | null;
  catalogRevision: string | null;
  cached: boolean;
  error: string | null;
}

export interface CodexNativeLoginStatus {
  id: string;
  status: "waiting" | "succeeded" | "failed" | "cancelled";
  error: string | null;
}

/** Field-scoped patch + optimistic concurrency checks. No credentials are sent. */
export interface CodexRoutingProviderEdit {
  providerId: string;
  expectedName?: string;
  name?: string;
  expectedCatalog?: unknown;
  models?: CodexCatalogModel[];
  rename?: { from: string; to: string };
}
export interface CodexRoutingProviderEditResult {
  provider: Provider;
  config: CodexModelRoutingConfig;
  affectsLive: boolean;
}
