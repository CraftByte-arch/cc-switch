import {
  requestCodexMaintenance,
  codexRoutingOwnsLive,
} from "@/lib/codexMaintenance";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codexModelRoutingApi } from "@/lib/api/codexModelRouting";
import { proxyKeys } from "./proxy";

export const codexModelRoutingKey = ["codexModelRouting"] as const;
export const codexModelRoutingCapabilitiesKey = [
  "codexModelRoutingCapabilities",
] as const;

export const codexNativeRoutingKey = ["codexNativeRoutingProvider"] as const;
export function useCodexNativeRoutingProvider(enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: codexNativeRoutingKey,
    queryFn: () => codexModelRoutingApi.getNativeProvider(false),
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 60_000 : false,
  });
  const refresh = useMutation({
    onMutate: () => client.cancelQueries({ queryKey: codexNativeRoutingKey }),
    mutationFn: () => codexModelRoutingApi.getNativeProvider(true),
    onSuccess: (data) => client.setQueryData(codexNativeRoutingKey, data),
  });
  return {
    ...query,
    refresh: refresh.mutateAsync,
    isSyncing: query.isFetching || refresh.isPending,
    syncError: refresh.error ?? query.error,
  };
}

export function useCodexModelRouting(enabled = true) {
  return useQuery({
    queryKey: codexModelRoutingKey,
    queryFn: codexModelRoutingApi.get,
    enabled,
  });
}

export function useCodexModelRoutingCapabilities(enabled = true) {
  return useQuery({
    queryKey: codexModelRoutingCapabilitiesKey,
    queryFn: codexModelRoutingApi.getCapabilities,
    enabled,
  });
}

export function useSaveCodexModelRouting(options?: {
  requestRestart?: boolean;
}) {
  const client = useQueryClient();
  return useMutation({
    onMutate: (config) => ({
      promptRestart:
        (options?.requestRestart ?? true) &&
        codexRoutingOwnsLive(client) &&
        JSON.stringify(client.getQueryData(codexModelRoutingKey)) !==
          JSON.stringify(config),
    }),
    mutationFn: codexModelRoutingApi.save,
    onSuccess: (result, _config, context) => {
      if (context?.promptRestart) requestCodexMaintenance();
      client.setQueryData(codexModelRoutingKey, result.config);
      client.invalidateQueries({ queryKey: proxyKeys.status });
    },
  });
}

export function useSetCodexModelRoutingEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: codexModelRoutingApi.setEnabled,
    onSuccess: () => requestCodexMaintenance(),
    onSettled: () => {
      client.invalidateQueries({ queryKey: codexModelRoutingKey });
      client.invalidateQueries({ queryKey: proxyKeys.status });
      client.invalidateQueries({ queryKey: proxyKeys.takeoverStatus });
      client.invalidateQueries({ queryKey: proxyKeys.appConfig("codex") });
      client.invalidateQueries({ queryKey: ["providers", "codex"] });
      client.invalidateQueries({
        queryKey: codexModelRoutingCapabilitiesKey,
      });
    },
  });
}

/** Persist a provider catalog/name edit. The routing dialog batches these until save. */
export function useEditCodexRoutingProvider(
  onSaved?: (
    result: import("@/types/codexModelRouting").CodexRoutingProviderEditResult,
    edit: import("@/types/codexModelRouting").CodexRoutingProviderEdit,
  ) => void,
  options?: { requestRestart?: boolean },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: codexModelRoutingApi.editProvider,
    onSuccess: async (result, edit) => {
      onSaved?.(result, edit);
      client.setQueryData(codexModelRoutingKey, result.config);
      client.setQueryData<import("./queries").ProvidersQueryData>(
        ["providers", "codex"],
        (old) =>
          old
            ? {
                ...old,
                providers: {
                  ...old.providers,
                  [result.provider.id]: result.provider,
                },
              }
            : old,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["providers", "codex"] }),
        client.invalidateQueries({
          queryKey: codexModelRoutingCapabilitiesKey,
        }),
      ]);
      if ((options?.requestRestart ?? true) && result.affectsLive) {
        requestCodexMaintenance();
      }
    },
  });
}
