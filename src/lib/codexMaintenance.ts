import type { QueryClient } from "@tanstack/react-query";
import type { CodexModelRoutingConfig } from "@/types/codexModelRouting";

export const CODEX_MAINTENANCE_EVENT = "cc-switch:codex-maintenance";
export type CodexMaintenanceReason =
  | "config-changed"
  | "restart"
  | "repair"
  | "cleanup";

// A single root-level dialog coalesces notifications from providers, routing,
// and takeover controls. Dispatch only AFTER the underlying save succeeded.
export function requestCodexMaintenance(
  reason: CodexMaintenanceReason = "config-changed",
) {
  window.dispatchEvent(
    new CustomEvent(CODEX_MAINTENANCE_EVENT, { detail: reason }),
  );
}

export function codexRoutingOwnsLive(client: QueryClient): boolean {
  const routing = client.getQueryData<CodexModelRoutingConfig>([
    "codexModelRouting",
  ]);
  const takeover = client.getQueryData<{ codex: boolean }>([
    "proxyTakeoverStatus",
  ]);
  return Boolean(routing?.enabled && takeover?.codex);
}

export function providerAffectsLiveCodex(
  client: QueryClient,
  id: string,
): boolean {
  if (codexRoutingOwnsLive(client)) {
    return Boolean(
      client
        .getQueryData<CodexModelRoutingConfig>(["codexModelRouting"])
        ?.models.some((entry) => entry.providerId === id),
    );
  }
  return (
    client.getQueryData<{ currentProviderId: string }>(["providers", "codex"])
      ?.currentProviderId === id
  );
}
