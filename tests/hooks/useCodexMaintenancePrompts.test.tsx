import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAddProviderMutation,
  useDeleteProviderMutation,
  useUpdateProviderMutation,
  useSwitchProviderMutation,
} from "@/lib/query/mutations";
import {
  useSaveCodexModelRouting,
  useSetCodexModelRoutingEnabled,
} from "@/lib/query/codexModelRouting";
import { CODEX_MAINTENANCE_EVENT } from "@/lib/codexMaintenance";
const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  switch: vi.fn(),
  updateTrayMenu: vi.fn(),
  save: vi.fn(),
  setEnabled: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  providersApi: mocks,
  sessionsApi: {},
  settingsApi: {},
}));
vi.mock("@/lib/api/codexModelRouting", () => ({ codexModelRoutingApi: mocks }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const listener = vi.fn();
const provider = { id: "used", name: "Used", settingsConfig: {} };
const routing = {
  enabled: true,
  providerName: "Router",
  smartModelNames: true,
  models: [{ providerId: "used", model: "x" }],
};
function setup(active: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["providers", "codex"], {
    currentProviderId: "default",
    providers: { used: provider },
  });
  client.setQueryData(["codexModelRouting"], routing);
  client.setQueryData(["proxyTakeoverStatus"], { codex: active });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}
beforeEach(() => {
  listener.mockClear();
  for (const mock of Object.values(mocks))
    mock.mockReset().mockResolvedValue(true);
  mocks.switch.mockResolvedValue({});
  window.addEventListener(CODEX_MAINTENANCE_EVENT, listener);
});
afterEach(() => window.removeEventListener(CODEX_MAINTENANCE_EVENT, listener));
describe("Codex restart prompts occur only after successful live changes", () => {
  it.each([true, false])("first provider auto-enable=%s", async (first) => {
    const { client, wrapper } = setup(false);
    if (first)
      client.setQueryData(["providers", "codex"], {
        currentProviderId: "",
        providers: {},
      });
    const { result } = renderHook(() => useAddProviderMutation("codex"), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ name: "New", settingsConfig: {} });
    });
    expect(listener).toHaveBeenCalledTimes(first ? 1 : 0);
  });
  it.each(["used", "default"])(
    "deleting %s only prompts when used by active routing",
    async (id) => {
      const { wrapper } = setup(true);
      const { result } = renderHook(() => useDeleteProviderMutation("codex"), {
        wrapper,
      });
      await act(async () => {
        await result.current.mutateAsync(id);
      });
      expect(listener).toHaveBeenCalledTimes(id === "used" ? 1 : 0);
    },
  );
  it.each([
    [false, "default", true],
    [false, "used", false],
    [true, "used", true],
    [true, "default", false],
  ] as const)(
    "update active=%s provider=%s prompts=%s",
    async (active, id, prompt) => {
      const { wrapper } = setup(active);
      const { result } = renderHook(() => useUpdateProviderMutation("codex"), {
        wrapper,
      });
      await act(async () => {
        await result.current.mutateAsync({ provider: { ...provider, id } });
      });
      expect(listener).toHaveBeenCalledTimes(prompt ? 1 : 0);
    },
  );
  it("does not prompt after failed updates", async () => {
    mocks.update.mockRejectedValueOnce(new Error("failed"));
    const { wrapper } = setup(true);
    const { result } = renderHook(() => useUpdateProviderMutation("codex"), {
      wrapper,
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ provider })).rejects.toThrow();
    });
    expect(listener).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "switching while routing=%s only prompts for a live switch",
    async (active) => {
      const { wrapper } = setup(active);
      const { result } = renderHook(() => useSwitchProviderMutation("codex"), {
        wrapper,
      });
      await act(async () => {
        await result.current.mutateAsync("used");
      });
      expect(listener).toHaveBeenCalledTimes(active ? 0 : 1);
    },
  );
  it.each([false, true])("routing save while active=%s", async (active) => {
    const next = { ...routing, providerName: "New Router" };
    mocks.save.mockResolvedValueOnce({ config: next, catalogChanged: false });
    const { wrapper } = setup(active);
    const { result } = renderHook(() => useSaveCodexModelRouting(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(next);
    });
    expect(listener).toHaveBeenCalledTimes(active ? 1 : 0);
  });
  it("does not prompt for an unchanged routing save", async () => {
    mocks.save.mockResolvedValueOnce({
      config: routing,
      catalogChanged: false,
    });
    const { wrapper } = setup(true);
    const { result } = renderHook(() => useSaveCodexModelRouting(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(routing);
    });
    expect(listener).not.toHaveBeenCalled();
  });
  it("prompts for successful routing toggles but not failed ones", async () => {
    const { wrapper } = setup(true);
    const { result } = renderHook(() => useSetCodexModelRoutingEnabled(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(false);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    mocks.setEnabled.mockRejectedValueOnce(new Error("failed"));
    await act(async () => {
      await expect(result.current.mutateAsync(true)).rejects.toThrow();
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
