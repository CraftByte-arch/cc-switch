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

export function useSaveCodexModelRouting() {
  const client = useQueryClient();
  return useMutation({
    onMutate: (config) => ({
      promptRestart:
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
