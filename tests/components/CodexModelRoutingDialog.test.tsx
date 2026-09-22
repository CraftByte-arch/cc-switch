import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import { CodexModelRoutingDialog } from "@/components/proxy/CodexModelRoutingDialog";

function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

function openSortPane(count: number) {
  fireEvent.click(screen.getByRole("tab", { name: `模型排序 · ${count}` }));
}

function selectedNames() {
  return Array.from(document.querySelectorAll(".routing-selected-name")).map(
    (row) => row.textContent,
  );
}

const mocks = vi.hoisted(() => ({
  nativeProvider: undefined as Provider | undefined,
  nativeError: false,
  nativeBusy: false,
  nativeEnabled: true,
  nativeQueryEnabled: vi.fn(),
  nativeRevision: "revision-1",
  savedModels: [] as Array<{ providerId: string; model: string }>,
  nativeRefetch: vi.fn(),
  mutateAsync: vi.fn(),
  editAsync: vi.fn(),
  refetch: vi.fn(),
  capabilitiesRefetch: vi.fn(),
}));

vi.mock("@/lib/query/codexModelRouting", () => ({
  codexModelRoutingKey: ["codexModelRouting"],
  useEditCodexRoutingProvider: (
    onSaved?: (result: any, edit: any) => void,
  ) => ({
    isPending: false,
    mutateAsync: async (edit: any) => {
      const result = await mocks.editAsync(edit);
      onSaved?.(result, edit);
      return result;
    },
  }),
  useCodexNativeRoutingProvider: (enabled: boolean) => {
    mocks.nativeQueryEnabled(enabled);
    return {
      data: {
        status: mocks.nativeError
          ? "unavailable"
          : mocks.nativeProvider
            ? "ready"
            : "signedOut",
        provider: mocks.nativeError ? null : (mocks.nativeProvider ?? null),
        syncedAt: mocks.nativeProvider ? 1234567890 : null,
        catalogRevision: mocks.nativeRevision,
        cached: false,
        error: mocks.nativeError ? "登录检测失败" : null,
      },
      isLoading: false,
      isSyncing: mocks.nativeBusy,
      syncError: null,
      isError: mocks.nativeError,
      refresh: mocks.nativeRefetch,
      refetch: mocks.nativeRefetch,
    };
  },
  useCodexModelRouting: () => ({
    data: {
      enabled: false,
      providerName: "CC Switch Router",
      smartModelNames: true,
      nativeSubscriptionEnabled: mocks.nativeEnabled,
      models: mocks.savedModels,
    },
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  }),
  useCodexModelRoutingCapabilities: () => ({
    data: [
      { providerId: "station-a", model: "gpt-5.4", contextWindow: 128000 },
      { providerId: "station-b", model: "gpt-5.4", contextWindow: 1000000 },
    ],
    isLoading: false,
    isError: false,
    refetch: mocks.capabilitiesRefetch,
  }),
  useSaveCodexModelRouting: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));

function provider(id: string): Provider {
  return {
    id,
    name: "A站",
    settingsConfig: {
      auth: { OPENAI_API_KEY: "test" },
      config: "",
      modelCatalog: {
        models: [{ model: "gpt-5.4", reasoningLevels: ["low", "high"] }],
      },
    },
  };
}

describe("CodexModelRoutingDialog", () => {
  beforeEach(() => {
    i18n.addResourceBundle(
      "zh",
      "translation",
      { codexRouting: zh.codexRouting, common: zh.common },
      true,
      true,
    );
    mocks.nativeProvider = undefined;
    mocks.nativeError = false;
    mocks.nativeBusy = false;
    mocks.nativeEnabled = true;
    mocks.nativeQueryEnabled.mockClear();
    mocks.nativeRevision = "revision-1";
    mocks.savedModels = [];
    mocks.nativeRefetch.mockReset().mockResolvedValue(undefined);
    mocks.mutateAsync.mockReset();
    mocks.editAsync.mockReset().mockResolvedValue({
      provider: {
        id: "station-a",
        name: "A站",
        settingsConfig: {
          auth: {},
          config: "",
          modelCatalog: { models: [] },
        },
      },
      config: {
        enabled: false,
        providerName: "CC Switch Router",
        smartModelNames: true,
        models: mocks.savedModels,
      },
      affectsLive: false,
    });
    mocks.refetch.mockReset();
    mocks.capabilitiesRefetch.mockReset();
  });

  it("offers the current native login alongside relay models without an account editor", async () => {
    mocks.nativeProvider = {
      id: "cc-switch-current-codex-login",
      name: "ChatGPT · Current login",
      category: "official",
      settingsConfig: {
        auth: {},
        config: "",
        nativeAccountKey: "test-account",
        modelCatalog: { models: [{ model: "gpt-official" }] },
      },
    };
    mocks.mutateAsync.mockImplementation(async (config) => ({
      config,
      catalogChanged: true,
    }));
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={() => undefined}
        onEditProvider={vi.fn()}
      />,
    );
    expect(screen.getByText(/已同步官方目录/)).toBeInTheDocument();
    const official = screen.getByRole("button", {
      name: `${zh.codexRouting.nativeName} / gpt-official`,
    });
    fireEvent.click(official);
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    expect(official).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "A站 / gpt-5.4" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", {
        name: `编辑供应商 ${zh.codexRouting.nativeName}`,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存路由配置" }));
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [
            {
              providerId: "cc-switch-current-codex-login",
              model: "gpt-official",
            },
            { providerId: "station-a", model: "gpt-5.4" },
          ],
        }),
      ),
    );
  });

  it("keeps relay configuration usable when native model discovery fails", () => {
    mocks.nativeError = true;
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={() => undefined}
        onEditProvider={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("登录检测失败");
    fireEvent.click(screen.getByRole("button", { name: "重新检测并同步" }));
    expect(mocks.nativeRefetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    expect(screen.getByRole("button", { name: "保存路由配置" })).toBeEnabled();
  });

  function setNative() {
    mocks.nativeProvider = {
      id: "cc-switch-current-codex-login",
      name: "Official",
      category: "official",
      settingsConfig: {
        auth: {},
        config: "",
        modelCatalog: {
          models: [
            {
              model: "gpt-6-astra",
              displayName: "6 Astra",
              contextWindow: 1000000,
              reasoningLevels: ["high"],
            },
          ],
        },
      },
    };
  }

  it("customizes or hides only the native prefix and retains typed text", () => {
    setNative();
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={() => undefined}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "官方订阅 / 6 Astra" }));
    fireEvent.click(screen.getByRole("button", { name: "前缀：官方" }));
    expect(selectedNames()).toEqual(["官方 · 6 Astra"]);
    fireEvent.change(screen.getByLabelText("前缀名称"), {
      target: { value: "订阅" },
    });
    expect(selectedNames()).toEqual(["订阅 · 6 Astra"]);
    fireEvent.click(screen.getByRole("switch", { name: "显示官方模型前缀" }));
    expect(screen.queryByLabelText("前缀名称")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "无前缀" })).toBeInTheDocument();
    expect(selectedNames()).toEqual(["6 Astra"]);
    fireEvent.click(screen.getByRole("switch", { name: "智能模型名称显示" }));
    expect(selectedNames()).toEqual(["6 Astra"]);
    fireEvent.click(screen.getByRole("switch", { name: "显示官方模型前缀" }));
    expect(screen.getByLabelText("前缀名称")).toHaveValue("订阅");
    expect(selectedNames()).toEqual(["订阅 · 6 Astra"]);
    expect(screen.getAllByLabelText("目录上下文：1M")).toHaveLength(2);
  });

  it("keeps draft changes during discovery and never auto-selects a newly discovered model", () => {
    setNative();
    const props = {
      open: true,
      active: false,
      providers: {},
      onOpenChange: vi.fn(),
      onEditProvider: vi.fn(),
    };
    const { rerender } = render(<CodexModelRoutingDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "官方订阅 / 6 Astra" }));
    fireEvent.click(screen.getByRole("button", { name: "前缀：官方" }));
    fireEvent.change(screen.getByLabelText("前缀名称"), {
      target: { value: "我的订阅" },
    });
    mocks.nativeProvider = {
      ...mocks.nativeProvider!,
      settingsConfig: {
        ...mocks.nativeProvider!.settingsConfig,
        modelCatalog: {
          models: [
            { model: "gpt-6-astra", displayName: "6 Astra" },
            { model: "gpt-5.6-sol", displayName: "5.6 Sol" },
          ],
        },
      },
    };
    mocks.nativeRevision = "revision-2";
    rerender(<CodexModelRoutingDialog {...props} />);
    expect(screen.getByLabelText("前缀名称")).toHaveValue("我的订阅");
    expect(
      screen.getByRole("button", { name: "官方订阅 / 6 Astra" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "官方订阅 / 5.6 Sol" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps expired official selections without blocking an unrelated draft save", async () => {
    mocks.savedModels = [
      { providerId: "cc-switch-current-codex-login", model: "gpt-6-astra" },
    ];
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{}}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "登录 ChatGPT" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(zh.codexRouting.selectionNeedsAttentionDraft),
    ).toBeInTheDocument();
    openSortPane(1);
    expect(
      screen.getByText(zh.codexRouting.nativeNeedsLogin),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除 gpt-6-astra" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存路由配置" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Provider 显示名称"), {
      target: { value: "My router" },
    });
    expect(screen.getByRole("button", { name: "保存路由配置" })).toBeEnabled();
    mocks.mutateAsync.mockImplementation(async (config) => ({
      config,
      catalogChanged: false,
    }));
    fireEvent.click(screen.getByRole("button", { name: "保存路由配置" }));
    expect(
      screen.getByRole("dialog", { name: "官方登录已过期" }),
    ).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "移除官方模型并关闭订阅" }),
    );
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerName: "My router",
          nativeSubscriptionEnabled: false,
          models: [],
        }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "官方订阅 / 6 Astra" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["revision-1", "nativeNoChanges"],
    ["revision-2", "nativeRefreshed"],
  ] as const)(
    "reports a completed manual refresh (%s) without selecting or saving models",
    async (revision, message) => {
      setNative();
      mocks.nativeRefetch.mockResolvedValue({
        status: "ready",
        provider: mocks.nativeProvider,
        syncedAt: 1234567891,
        catalogRevision: revision,
        cached: false,
        error: null,
      });
      render(
        <CodexModelRoutingDialog
          open
          active={false}
          providers={{}}
          onOpenChange={vi.fn()}
          onEditProvider={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "刷新官方模型" }));
      expect(
        await screen.findByText(zh.codexRouting[message]),
      ).toBeInTheDocument();
      expect(mocks.nativeRefetch).toHaveBeenCalledOnce();
      expect(mocks.mutateAsync).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "官方订阅 / 6 Astra" }),
      ).toHaveAttribute("aria-pressed", "false");
    },
  );

  it("explains why saving native selections is disabled during sync and keeps the draft", () => {
    setNative();
    const props = {
      open: true,
      active: false,
      providers: {},
      onOpenChange: vi.fn(),
      onEditProvider: vi.fn(),
    };
    const { rerender } = render(<CodexModelRoutingDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "官方订阅 / 6 Astra" }));
    mocks.nativeBusy = true;
    rerender(<CodexModelRoutingDialog {...props} />);
    expect(
      screen.getByText(zh.codexRouting.nativeSyncBeforeSave),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存路由配置" })).toBeDisabled();
    mocks.nativeBusy = false;
    rerender(<CodexModelRoutingDialog {...props} />);
    expect(
      screen.getByRole("button", { name: "官方订阅 / 6 Astra" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "保存路由配置" })).toBeEnabled();
  });

  it("keeps selection, search and naming drafts when switching compact tabs", () => {
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    expect(
      screen.queryByRole("heading", { name: "可选模型" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Provider 显示名称"), {
      target: { value: "My router" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "搜索供应商或模型" }),
      { target: { value: "not-found" } },
    );
    expect(
      screen.getByText(zh.codexRouting.layout.noSearchResults),
    ).toBeInTheDocument();
    const selectedTab = screen.getByRole("tab", { name: "模型排序 · 1" });
    fireEvent.click(selectedTab);
    expect(selectedTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "模型排序 · 1" }),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.queryByRole("heading", { name: "模型排序 · 1" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".routing-selected-canvas")).not.toBeNull();
    expect(document.querySelector(".routing-toolbar-sort")).not.toHaveAttribute(
      "hidden",
    );
    expect(
      screen.getByRole("radiogroup", { name: "排序方式" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除 gpt-5.4" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(selectedTab, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "可选模型" })).toHaveFocus();
    expect(
      screen.getByRole("textbox", { name: "搜索供应商或模型" }),
    ).toHaveValue("not-found");
    expect(screen.getByLabelText("Provider 显示名称")).toHaveValue("My router");
    fireEvent.change(
      screen.getByRole("textbox", { name: "搜索供应商或模型" }),
      { target: { value: "" } },
    );
    expect(
      screen.getByRole("button", { name: "A站 / gpt-5.4" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows complete capabilities inline and keeps editing separate from selection", async () => {
    const relay = provider("station-a");
    const onOpenChange = vi.fn();
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={onOpenChange}
        onEditProvider={vi.fn()}
      />,
    );
    expect(screen.getByText("128K")).toBeInTheDocument();
    expect(screen.getByText("low·high")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /模型详情/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "编辑 A站 / gpt-5.4 的模型设置" }),
    );
    const editor = screen.getByRole("dialog");
    expect(
      within(editor).getByRole("textbox", { name: "实际请求模型" }),
    ).toHaveValue("gpt-5.4");
    expect(
      screen.getByRole("button", { name: "A站 / gpt-5.4", hidden: true }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("rebases a renamed model without losing draft order or routing settings", async () => {
    const relay = provider("station-a");
    const second = { ...provider("station-b"), name: "B站" };
    mocks.savedModels = [{ providerId: relay.id, model: "gpt-5.4" }];
    mocks.mutateAsync.mockImplementation(async (config) => ({
      config,
      catalogChanged: false,
    }));
    const props = {
      open: true,
      active: false,
      onOpenChange: vi.fn(),
      onEditProvider: vi.fn(),
    };
    render(
      <CodexModelRoutingDialog
        {...props}
        providers={{ [relay.id]: relay, [second.id]: second }}
      />,
    );
    // Select in a different order from the saved configuration.
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    fireEvent.click(screen.getByRole("button", { name: "B站 / gpt-5.4" }));
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    fireEvent.change(screen.getByLabelText("Provider 显示名称"), {
      target: { value: "Draft router" },
    });
    const updated = structuredClone(relay);
    updated.settingsConfig.modelCatalog.models[0].model = "renamed";
    mocks.editAsync.mockResolvedValue({
      provider: updated,
      config: {
        enabled: false,
        providerName: "CC Switch Router",
        smartModelNames: true,
        nativeSubscriptionEnabled: true,
        models: [{ providerId: relay.id, model: "gpt-5.4" }],
      },
      affectsLive: false,
    });
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "编辑 A站 / gpt-5.4 的模型设置",
      })[0],
    );
    fireEvent.change(screen.getByLabelText("实际请求模型"), {
      target: { value: "renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.editAsync).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "A站 / renamed" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Provider 显示名称")).toHaveValue(
      "Draft router",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存路由配置" }));
    await waitFor(() => expect(mocks.editAsync).toHaveBeenCalledOnce());
    expect(mocks.editAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: relay.id,
        rename: { from: "gpt-5.4", to: "renamed" },
      }),
    );
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerName: "Draft router",
          models: [
            { providerId: second.id, model: "gpt-5.4" },
            { providerId: relay.id, model: "renamed" },
          ],
        }),
      ),
    );
  });

  it("shows cancel for unsaved drafts and restores provider plus routing edits", async () => {
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    fireEvent.change(screen.getByLabelText("Provider 显示名称"), {
      target: { value: "Draft router" },
    });
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "编辑 A站 / gpt-5.4 的模型设置",
      })[0],
    );
    fireEvent.change(screen.getByLabelText("实际请求模型"), {
      target: { value: "renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "A站 / renamed" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByLabelText("Provider 显示名称")).toHaveValue(
      "CC Switch Router",
    );
    expect(
      screen.getByRole("button", { name: "A站 / gpt-5.4" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("button", { name: "A站 / renamed" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消" }),
    ).not.toBeInTheDocument();
    expect(mocks.editAsync).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("smart sorts the draft without moving the default, and can set default independently", async () => {
    const a = provider("station-a");
    const b = { ...provider("station-b"), name: "B站" };
    a.settingsConfig.modelCatalog.models = [
      { model: "default", displayName: "Default" },
      { model: "ten", displayName: "Model 10" },
      { model: "two", displayName: "Model 2" },
    ];
    b.settingsConfig.modelCatalog.models = [
      { model: "two", displayName: "Model 2" },
    ];
    mocks.savedModels = [
      { providerId: a.id, model: "ten" },
      { providerId: b.id, model: "two" },
      { providerId: a.id, model: "two" },
      { providerId: a.id, model: "default" },
    ];
    mocks.mutateAsync.mockImplementation(async (config) => ({
      config,
      catalogChanged: false,
    }));
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [a.id]: a, [b.id]: b }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    openSortPane(4);
    expect(selectedNames()[0]).toContain("Model 10");
    fireEvent.click(screen.getByRole("radio", { name: "供应商名称" }));
    await waitFor(() =>
      expect(selectedNames()).toEqual([
        "Default",
        "A站 · Model 2",
        "Model 10",
        "B站 · Model 2",
      ]),
    );
    expect(
      screen.getByRole("radiogroup", { name: "排序方式" }),
    ).toHaveAttribute("data-value", "provider");
    expect(
      document.querySelector('.routing-selected-row[data-default="true"]'),
    ).toHaveTextContent("Model 10");
    const defaultRow = Array.from(
      document.querySelectorAll(".routing-selected-row"),
    ).find((row) => row.textContent?.includes("Default"));
    fireEvent.click(
      within(defaultRow as HTMLElement).getByRole("button", {
        name: "设为默认模型",
      }),
    );
    expect(
      document.querySelector('.routing-selected-row[data-default="true"]'),
    ).toHaveTextContent("Default");
    expect(
      within(defaultRow as HTMLElement).getByRole("button", {
        name: "默认模型",
      }),
    ).toBeDisabled();
    expect(selectedNames()).toEqual([
      "Default",
      "A站 · Model 2",
      "Model 10",
      "B站 · Model 2",
    ]);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存路由配置" }));
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultModel: { providerId: a.id, model: "default" },
          models: [
            { providerId: a.id, model: "default" },
            { providerId: a.id, model: "two" },
            { providerId: a.id, model: "ten" },
            { providerId: b.id, model: "two" },
          ],
        }),
      ),
    );
  });

  it("places add-model as a card after the provider's models", () => {
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    const add = screen.getByRole("button", { name: "为 A站 添加模型" });
    expect(add).toHaveClass("routing-add-model");
    const options = add.closest(".routing-model-options");
    expect(options?.lastElementChild).toBe(add);
    expect(screen.getByText("low·high")).toBeInTheDocument();
  });

  it("focuses the provider name when it blocks saving", () => {
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{}}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Provider 显示名称"), {
      target: { value: "" },
    });
    expect(
      screen.getByText(zh.codexRouting.layout.nameRequired),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存路由配置" }),
    ).toHaveAttribute("aria-describedby", "routing-save-reason");
    expect(
      screen.queryByRole("button", { name: "设置", exact: true }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查设置" }));
    expect(screen.getByLabelText("Provider 显示名称")).toHaveFocus();
  });

  it("edits the official prefix directly in its group while signed out, with an explicit example", () => {
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{}}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "名称设置" }),
    ).not.toBeInTheDocument();
    const official = screen.getByRole("region", { name: "官方订阅" });
    fireEvent.click(
      within(official).getByRole("button", { name: "前缀：官方" }),
    );
    expect(within(official).getByLabelText("前缀名称")).toHaveValue("官方");
    expect(
      within(official).getByText("菜单效果（示例）：官方 · 6 Astra"),
    ).toBeInTheDocument();
    fireEvent.change(within(official).getByLabelText("前缀名称"), {
      target: { value: "我的账号" },
    });
    expect(
      within(official).getByRole("button", { name: "前缀：我的账号" }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(
      within(official).getByRole("button", { name: "前缀：我的账号" }),
    );
    expect(screen.queryByLabelText("前缀名称")).not.toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("routes prefix validation back to the official section rather than global settings", () => {
    setNative();
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{}}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "前缀：官方" }));
    fireEvent.change(screen.getByLabelText("前缀名称"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "前缀：—" }));
    fireEvent.click(screen.getByRole("tab", { name: "模型排序 · 0" }));
    fireEvent.click(screen.getByRole("button", { name: "修改官方前缀" }));
    expect(screen.getByRole("tab", { name: "可选模型" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("前缀名称")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "设置", exact: true }),
    ).not.toBeInTheDocument();
  });

  it("keeps saved subscription-off mode dormant and relay-only saves usable", async () => {
    setNative();
    mocks.nativeEnabled = false;
    mocks.mutateAsync.mockImplementation(async (config) => ({
      config,
      catalogChanged: false,
    }));
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    expect(mocks.nativeQueryEnabled).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByRole("button", { name: "官方订阅 / 6 Astra" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新官方模型" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登录 ChatGPT" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A站 / gpt-5.4" }));
    fireEvent.click(screen.getByRole("button", { name: "保存路由配置" }));
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          nativeSubscriptionEnabled: false,
          models: [{ providerId: "station-a", model: "gpt-5.4" }],
        }),
      ),
    );
  });

  it("confirms removal of official selections without saving or touching relay order", () => {
    setNative();
    const native = {
      providerId: "cc-switch-current-codex-login",
      model: "gpt-6-astra",
    };
    mocks.savedModels = [native, { providerId: "station-a", model: "gpt-5.4" }];
    const relay = provider("station-a");
    render(
      <CodexModelRoutingDialog
        open
        active
        providers={{ [relay.id]: relay }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "启用官方订阅" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("关闭官方订阅？");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.getByRole("button", { name: "移除 gpt-6-astra", hidden: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "启用官方订阅" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭并移除官方模型" }));
    expect(
      screen.queryByRole("button", { name: "移除 gpt-6-astra", hidden: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除 gpt-5.4", hidden: true }),
    ).toBeInTheDocument();
    expect(mocks.nativeQueryEnabled).toHaveBeenLastCalledWith(false);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "启用官方订阅" }));
    expect(mocks.nativeQueryEnabled).toHaveBeenLastCalledWith(true);
    expect(
      screen.getByRole("button", { name: "官方订阅 / 6 Astra" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("warns about visible-name conflicts and disables the second selection", () => {
    const first = provider("station-a");
    const second = provider("station-b");
    const onEditProvider = vi.fn();

    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [first.id]: first, [second.id]: second }}
        onOpenChange={() => undefined}
        onEditProvider={onEditProvider}
      />,
    );

    expect(
      screen.getByText("检测到 1 组相同的供应商名称和模型显示名称"),
    ).toBeInTheDocument();

    const modelButtons = screen.getAllByRole("button", {
      name: "A站 / gpt-5.4",
    });
    expect(screen.getByLabelText("生效上下文：128K")).toBeInTheDocument();
    expect(screen.getByLabelText("生效上下文：1M")).toBeInTheDocument();
    fireEvent.click(modelButtons[0]);
    const updatedModelButtons = screen.getAllByRole("button", {
      name: "A站 / gpt-5.4",
    });
    expect(updatedModelButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(updatedModelButtons[1]).toBeDisabled();
    expect(screen.getAllByLabelText("生效上下文：128K")).toHaveLength(2);

    const smartNames = screen.getByRole("switch", {
      name: "智能模型名称显示",
    });
    expect(smartNames).toBeChecked();
    expect(selectedNames()).toEqual(["gpt-5.4"]);
    fireEvent.click(smartNames);
    expect(smartNames).not.toBeChecked();
    expect(selectedNames()).toEqual(["A站 · gpt-5.4"]);

    const editButtons = screen.getAllByRole("button", {
      name: "进入 A站 的详细设置",
    });
    fireEvent.click(editButtons[1]);
    expect(onEditProvider).toHaveBeenCalledWith(second);
  });

  it("optimizes a provider's menu names from model ids without saving", async () => {
    const relay = provider("station-a");
    relay.settingsConfig.modelCatalog.models = [
      { model: "grok-4.7" },
      { model: "deepseek-4.1-flash", displayName: "已自定义" },
    ];
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [relay.id]: relay }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "优化 A站 / grok-4.7 的显示名" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "优化 A站 / 已自定义 的显示名" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "优化 A站 的模型显示名" }),
    );
    expect(
      await screen.findByRole("button", { name: "A站 / Grok 4.7" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "A站 / Deepseek 4.1 Flash" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "优化 A站 / Grok 4.7 的显示名" }),
    ).not.toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.editAsync).not.toHaveBeenCalled();
  });

  it("optimizes every relay provider from the list header", async () => {
    const a = provider("station-a");
    const b = { ...provider("station-b"), name: "B站" };
    a.settingsConfig.modelCatalog.models = [{ model: "grok-4.7" }];
    b.settingsConfig.modelCatalog.models = [{ model: "deepseek-4.1-flash" }];
    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [a.id]: a, [b.id]: b }}
        onOpenChange={vi.fn()}
        onEditProvider={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "优化全部显示名" }));
    expect(
      await screen.findByRole("button", { name: "A站 / Grok 4.7" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "B站 / Deepseek 4.1 Flash" }),
    ).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
