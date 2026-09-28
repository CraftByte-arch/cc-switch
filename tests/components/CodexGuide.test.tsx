import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { CodexGuide, CodexGuideReplay } from "@/components/codex/CodexGuide";
import {
  CODEX_GUIDE_EVENT,
  getCodexGuideDetail,
  getCodexGuideSignals,
  markCodexGuideSeen,
  publishCodexGuidePlace,
  readCodexGuideProgress,
  saveCodexGuideProgress,
  updateCodexGuideSignals,
  type CodexGuideDetail,
} from "@/lib/codexGuide";
import type { Provider } from "@/types";

const providers: Record<string, Provider> = {
  one: { id: "one", name: "已有供应商", settingsConfig: {} },
};
const defaultSignals = { ...getCodexGuideSignals() };
const places: CodexGuideDetail[] = [];
// Simulate the same navigation contract as App: exit does not close the form.
function Harness({
  existing = false,
  current = "",
  mappingRows,
}: {
  existing?: boolean;
  current?: string;
  mappingRows?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onPlace = (event: Event) => {
      const detail = (event as CustomEvent<CodexGuideDetail>).detail;
      places.push(detail);
      if (!detail.stepId) return;
      setOpen(detail.place === "add");
      updateCodexGuideSignals({
        providerOpen: detail.place === "add",
        routingOpen: detail.place.startsWith("routing-"),
      });
    };
    window.addEventListener(CODEX_GUIDE_EVENT, onPlace);
    return () => window.removeEventListener(CODEX_GUIDE_EVENT, onPlace);
  }, []);
  return (
    <>
      <CodexGuideReplay />
      <button
        data-tour="codex-add-provider"
        onClick={() => {
          setOpen(true);
          updateCodexGuideSignals({ providerOpen: true });
        }}
      >
        添加供应商
      </button>
      <button
        data-tour="codex-routing-manage"
        onClick={() => updateCodexGuideSignals({ routingOpen: true })}
      >
        管理模型
      </button>
      <button data-tour="codex-routing-save">实际保存路由按钮</button>
      {open && (
        <div data-codex-guide-panel>
          <div data-tour="codex-provider-preset">预设区域</div>
          {mappingRows !== undefined && (
            <div data-tour="codex-model-mapping">
              <span>模型映射说明</span>
              {Array.from({ length: mappingRows }, (_, index) => (
                <div key={index} data-tour="codex-mapping-row">
                  映射行 {index + 1}
                </div>
              ))}
            </div>
          )}
          <button data-tour="codex-save-provider">实际添加按钮</button>
          <label data-tour="codex-api-key">
            真实密钥输入
            <input aria-label="真实密钥输入" />
          </label>
        </div>
      )}
      <CodexGuide
        active
        providers={existing ? providers : {}}
        currentProviderId={current}
      />
    </>
  );
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const start = (mode?: "provider") => {
  click("新手引导");
  if (mode === "provider")
    fireEvent.click(screen.getByRole("radio", { name: /仅启用供应商/ }));
  click("开始引导");
};
const signal = (patch: Parameters<typeof updateCodexGuideSignals>[0]) =>
  act(() => updateCodexGuideSignals(patch));

beforeEach(() => {
  i18n.addResourceBundle(
    "zh",
    "translation",
    { codexGuide: zh.codexGuide },
    true,
    true,
  );
  localStorage.clear();
  markCodexGuideSeen();
  saveCodexGuideProgress(null);
  updateCodexGuideSignals(defaultSignals);
  publishCodexGuidePlace("main", null);
  places.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("interactive Codex setup guide", () => {
  it("defaults to full routing, explains both sources and resets ordinary replay to routing", () => {
    render(<Harness />);
    click("新手引导");
    const routes = screen.getAllByRole("radio");
    expect(routes[0]).toHaveAttribute("aria-checked", "true");
    expect(routes[0]).toHaveTextContent("聚合中转");
    expect(routes[0]).toHaveTextContent("多个供应商 + 官方订阅");
    expect(routes[0]).toHaveTextContent("无需每次重启");
    expect(screen.getByText(zh.codexGuide.setupNote)).toBeInTheDocument();
    fireEvent.click(routes[1]);
    click("关闭引导");
    click("新手引导");
    expect(screen.getAllByRole("radio")[0]).toHaveAttribute(
      "aria-checked",
      "true",
    );
    click("开始引导");
    expect(readCodexGuideProgress()?.mode).toBe("routing");
  });

  it("highlights the target with a numbered high-contrast outline without blocking controls", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.tour
          ? {
              top: 100,
              left: 100,
              bottom: 140,
              right: 260,
              width: 160,
              height: 40,
              x: 100,
              y: 100,
              toJSON: () => ({}),
            }
          : {
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              width: 0,
              height: 0,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            };
      },
    );
    render(<Harness />);
    start();
    const highlight = screen.getByTestId("codex-guide-highlight");
    expect(highlight).toHaveClass(
      "pointer-events-none",
      "border-[3px]",
      "border-orange-600",
      "dark:border-amber-400",
    );
    expect(highlight).toHaveTextContent("1");
    expect(screen.getByLabelText(zh.codexGuide.targetHint)).toBeVisible();
    click("收起");
    expect(
      screen.queryByTestId("codex-guide-highlight"),
    ).not.toBeInTheDocument();
  });

  it("keeps the same bottom bar across main, preset, inputs and optional steps", () => {
    const { unmount } = render(<Harness />);
    start();
    const assertStable = () => {
      expect(screen.getByRole("complementary")).toHaveAttribute(
        "data-guide-layout",
        "bar",
      );
      expect(screen.getByRole("complementary")).toHaveStyle({
        top: `${window.innerHeight - 100}px`,
        left: "12px",
        width: `${window.innerWidth - 24}px`,
        height: "88px",
      });
      expect(
        document.documentElement.style.getPropertyValue(
          "--codex-guide-dock-height",
        ),
      ).toBe("");
      expect(screen.getByRole("button", { name: "下一步" })).toHaveClass(
        "min-w-20",
        "bg-orange-600",
        "dark:bg-amber-400",
      );
      expect(screen.getByText(zh.codexGuide.guideLabel)).toBeVisible();
    };
    assertStable();
    click("添加供应商");
    assertStable();
    click("下一步");
    assertStable();
    signal({ nameReady: true });
    click("下一步");
    assertStable();
    signal({ keyReady: true });
    click("下一步");
    assertStable();
    signal({ urlReady: true });
    click("下一步");
    signal({ fetchState: "error" });
    assertStable();
    click("手动填写");
    assertStable();
    expect(getCodexGuideDetail().stepId).toBe("model-mapping");
    click("收起");
    expect(screen.getByRole("complementary")).toHaveStyle({
      top: `${window.innerHeight - 56}px`,
      left: "12px",
      width: `${window.innerWidth - 24}px`,
      height: "44px",
    });
    expect(
      document.documentElement.style.getPropertyValue(
        "--codex-guide-dock-height",
      ),
    ).toBe("");
    click("展开");
    assertStable();
    click("关闭引导");
    expect(
      document.documentElement.style.getPropertyValue(
        "--codex-guide-dock-height",
      ),
    ).toBe("");
    expect(screen.getByLabelText("真实密钥输入")).toBeVisible();
    click("新手引导");
    click("继续上次引导");
    assertStable();
    unmount();
    expect(
      document.documentElement.style.getPropertyValue(
        "--codex-guide-dock-height",
      ),
    ).toBe("");
  });

  it.each(["provider", "routing"] as const)(
    "moves the same surface to the real %s save button and returns only after success",
    (kind) => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const visible =
          this.dataset.tour === "codex-save-provider" ||
          this.dataset.tour === "codex-routing-save";
        const top = visible ? window.innerHeight - 64 : 0;
        const left = visible ? window.innerWidth - 100 : 0;
        const width = visible ? 80 : 0,
          height = visible ? 32 : 0;
        return {
          top,
          left,
          width,
          height,
          bottom: top + height,
          right: left + width,
          x: left,
          y: top,
          toJSON: () => ({}),
        };
      });
      render(<Harness existing={kind === "routing"} />);
      click("新手引导");
      if (kind === "routing")
        fireEvent.change(screen.getByRole("combobox"), {
          target: { value: "one" },
        });
      click("开始引导");
      const originalSurface = screen.getByRole("complementary");
      expect(originalSurface).toHaveAttribute("data-guide-layout", "bar");
      if (kind === "provider") {
        signal({
          nameReady: true,
          keyReady: true,
          urlReady: true,
          fetchState: "success",
          mappingCount: 1,
        });
        for (let i = 0; i < 7; i++) click("下一步");
      } else {
        signal({ selectedCount: 1, defaultReady: true });
        for (let i = 0; i < 5; i++) click("下一步");
      }
      expect(getCodexGuideDetail().stepId).toBe(
        kind === "provider" ? "save-provider" : "save-routing",
      );
      expect(screen.getByRole("complementary")).toBe(originalSurface);
      expect(originalSurface).toHaveAttribute("data-guide-layout", "save");
      expect(originalSurface).toHaveStyle({ width: "304px", height: "148px" });
      expect(
        screen.queryByRole("button", { name: "下一步" }),
      ).not.toBeInTheDocument();
      // Clicking alone (or a failed save) must not advance or return the guide.
      click(kind === "provider" ? "实际添加按钮" : "实际保存路由按钮");
      expect(originalSurface).toHaveAttribute("data-guide-layout", "save");
      signal(
        kind === "provider"
          ? {
              providerSaved: true,
              savedProviderId: "saved",
              providerOpen: false,
            }
          : { routingSaved: true },
      );
      expect(screen.getByRole("complementary")).toBe(originalSurface);
      expect(originalSurface).toHaveAttribute("data-guide-layout", "bar");
      expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    },
  );

  it("highlights every mapping row with padding, follows row changes, and clips to the scroll container", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        let top = 0,
          left = 0,
          width = 0,
          height = 0;
        if (this.dataset.tour === "codex-model-mapping") {
          top = 100;
          left = 100;
          width = 500;
          height =
            60 +
            this.querySelectorAll('[data-tour="codex-mapping-row"]').length *
              40;
        } else if (this.hasAttribute("data-codex-guide-panel")) {
          top = 80;
          left = 80;
          width = 600;
          height = 260;
        }
        return {
          top,
          left,
          width,
          height,
          bottom: top + height,
          right: left + width,
          x: left,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
    const { rerender } = render(<Harness mappingRows={3} />);
    click("添加供应商");
    saveCodexGuideProgress({ mode: "routing", stepId: "model-mapping" });
    click("新手引导");
    click("继续上次引导");
    const highlight = screen.getByTestId("codex-guide-highlight");
    expect(highlight).toHaveStyle({
      top: "94px",
      left: "94px",
      width: "512px",
      height: "192px",
    });
    const mapping = document.querySelector<HTMLElement>(
      '[data-tour="codex-model-mapping"]',
    )!;
    mapping.scrollIntoView = vi.fn();
    rerender(<Harness mappingRows={4} />);
    await waitFor(() => expect(highlight).toHaveStyle({ height: "232px" }));
    rerender(<Harness mappingRows={1} />);
    await waitFor(() => expect(highlight).toHaveStyle({ height: "112px" }));
    expect(mapping.scrollIntoView).not.toHaveBeenCalled();
    const panel = document.querySelector<HTMLElement>(
      "[data-codex-guide-panel]",
    )!;
    panel.style.overflowY = "auto";
    rerender(<Harness mappingRows={8} />);
    await waitFor(() =>
      expect(highlight).toHaveStyle({ top: "94px", height: "246px" }),
    );
    expect(screen.getByRole("complementary")).toHaveAttribute(
      "data-guide-layout",
      "bar",
    );
  });

  it("waits for an explicit start and leaves step one on the main page", () => {
    render(<Harness />);
    click("新手引导");
    fireEvent.click(screen.getByRole("radio", { name: /聚合路由/ }));
    expect(places).toEqual([]);
    click("开始引导");
    expect(getCodexGuideDetail()).toMatchObject({
      stepId: "add-provider",
      place: "main",
    });
    expect(screen.queryByLabelText("真实密钥输入")).not.toBeInTheDocument();
    click("下一步");
    expect(getCodexGuideDetail()).toMatchObject({
      stepId: "provider-preset",
      place: "add",
    });
  });

  it.each(["provider", "routing"] as const)(
    "follows the real Add provider button in %s mode and stops at the form introduction",
    (mode) => {
      render(<Harness />);
      start(mode === "provider" ? "provider" : undefined);
      click("添加供应商");
      expect(getCodexGuideDetail()).toMatchObject({
        place: "add",
        stepId: "provider-preset",
      });
      expect(screen.getByLabelText("真实密钥输入")).toBeVisible();
      expect(readCodexGuideProgress()?.stepId).toBe("provider-preset");
      // Prefilled/ready fields must not cause a chain of automatic steps.
      signal({
        nameReady: true,
        keyReady: true,
        urlReady: true,
        mappingCount: 1,
      });
      expect(getCodexGuideDetail().stepId).toBe("provider-preset");
      click("下一步");
      expect(getCodexGuideDetail().stepId).toBe("provider-name");
    },
  );

  it("can go back after a real page-opening action without bouncing forward", () => {
    render(<Harness />);
    start();
    click("添加供应商");
    click("上一步");
    click("放弃并返回");
    expect(getCodexGuideDetail().stepId).toBe("add-provider");
    expect(screen.queryByLabelText("真实密钥输入")).not.toBeInTheDocument();
    click("添加供应商");
    expect(getCodexGuideDetail().stepId).toBe("provider-preset");
  });

  it("follows Manage models into routing details but does not skip source selection", () => {
    render(<Harness existing />);
    click("新手引导");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "one" },
    });
    click("开始引导");
    expect(getCodexGuideDetail().stepId).toBe("enter-routing");
    click("管理模型");
    expect(getCodexGuideDetail()).toMatchObject({
      place: "routing-available",
      stepId: "routing-sources",
    });
    signal({ selectedCount: 3, defaultReady: true, routingSaved: true });
    expect(getCodexGuideDetail().stepId).toBe("routing-sources");
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("select-models");
  });

  it("does not restart or navigate a closed guide when a page opens", () => {
    render(<Harness />);
    start();
    click("关闭引导");
    click("添加供应商");
    expect(getCodexGuideDetail().stepId).toBeNull();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByLabelText("真实密钥输入")).toBeVisible();
  });

  it("guides each form control and lets the real field remain editable", () => {
    render(<Harness />);
    start();
    click("下一步");
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("provider-name");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    signal({ nameReady: true });
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("api-key");
    fireEvent.change(screen.getByLabelText("真实密钥输入"), {
      target: { value: "private-test-key" },
    });
    signal({ keyReady: true });
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("api-url");
    signal({ urlReady: true });
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("fetch-models");
    signal({ fetchState: "error" });
    expect(screen.getByText(/获取失败，请检查/)).toBeInTheDocument();
    click("手动填写");
    expect(getCodexGuideDetail().stepId).toBe("model-mapping");
    signal({ mappingCount: 1 });
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("save-provider");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(JSON.stringify(readCodexGuideProgress())).not.toContain(
      "private-test-key",
    );
    expect(document.querySelector('[data-codex-guide="active"]')).toHaveClass(
      "pointer-events-none",
    );
  });

  it("Escape closes only the guide and keeps unsaved input for resume", () => {
    render(<Harness />);
    start();
    click("下一步");
    fireEvent.change(screen.getByLabelText("真实密钥输入"), {
      target: { value: "unsaved-value" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByLabelText("真实密钥输入")).toHaveValue("unsaved-value");
    expect(places.at(-1)?.stepId).toBeNull();
    click("新手引导");
    click("继续上次引导");
    expect(getCodexGuideDetail().stepId).toBe("provider-preset");
    expect(screen.getByLabelText("真实密钥输入")).toHaveValue("unsaved-value");
  });

  it("requires explicit discard when going back would close an unsaved form", () => {
    render(<Harness />);
    start();
    click("下一步");
    click("上一步");
    expect(screen.getByText(/返回上一页会关闭/)).toBeInTheDocument();
    expect(getCodexGuideDetail().stepId).toBe("provider-preset");
    click("继续编辑");
    click("上一步");
    click("放弃并返回");
    expect(getCodexGuideDetail().stepId).toBe("add-provider");
    expect(screen.queryByLabelText("真实密钥输入")).not.toBeInTheDocument();
  });

  it("uses an existing provider and never asks routing users to enable it first", () => {
    render(<Harness existing />);
    click("新手引导");
    fireEvent.click(screen.getByRole("radio", { name: /聚合路由/ }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "one" },
    });
    click("开始引导");
    expect(getCodexGuideDetail()).toMatchObject({
      stepId: "enter-routing",
      place: "main",
      providerId: "one",
    });
    click("下一步");
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("select-models");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    signal({ selectedCount: 1 });
    click("下一步");
    expect(getCodexGuideDetail()).toMatchObject({
      stepId: "sort-models",
      place: "routing-selected",
    });
    click("下一步");
    signal({ defaultReady: true });
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("save-routing");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    signal({ routingSaved: true });
    click("下一步");
    expect(getCodexGuideDetail().stepId).toBe("enable-config");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("finishes the provider-only flow at enable and checks actual current provider", () => {
    const { rerender } = render(<Harness existing />);
    click("新手引导");
    fireEvent.click(screen.getByRole("radio", { name: /仅启用供应商/ }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "one" },
    });
    click("开始引导");
    expect(getCodexGuideDetail().stepId).toBe("enable-provider");
    expect(screen.getByRole("button", { name: "查看结果" })).toBeDisabled();
    rerender(<Harness existing current="one" />);
    click("查看结果");
    expect(screen.getByText(/已确认启用状态/)).toBeInTheDocument();
    expect(readCodexGuideProgress()).toBeNull();
  });

  it("keeps close reachable for a missing target and can minimize the card", () => {
    render(<Harness />);
    start();
    expect(screen.getByRole("button", { name: "关闭引导" })).toBeVisible();
    click("收起");
    expect(screen.getByRole("button", { name: "展开" })).toBeVisible();
    click("关闭引导");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("yields to confirmation dialogs without consuming their Escape", async () => {
    render(<Harness />);
    start();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("data-state", "open");
    document.body.append(modal);
    await waitFor(() =>
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(getCodexGuideDetail().stepId).toBe("add-provider");
    modal.remove();
    await waitFor(() =>
      expect(screen.getByRole("complementary")).toBeInTheDocument(),
    );
  });
  it("asks before restarting a guide would discard the open form", () => {
    render(<Harness />);
    start();
    click("下一步");
    fireEvent.change(screen.getByLabelText("真实密钥输入"), {
      target: { value: "keep-this-draft" },
    });
    click("退出引导");
    click("新手引导");
    click("开始引导");
    expect(screen.getByText(/返回上一页会关闭/)).toBeInTheDocument();
    expect(screen.getByLabelText("真实密钥输入")).toHaveValue(
      "keep-this-draft",
    );
    click("继续编辑");
    click("关闭引导");
    expect(screen.getByLabelText("真实密钥输入")).toHaveValue(
      "keep-this-draft",
    );
  });

  it("tracks the actual saved provider without reopening a blank form", () => {
    render(<Harness />);
    start("provider");
    click("下一步");
    signal({
      providerOpen: false,
      providerSaved: true,
      savedProviderId: "saved-id",
    });
    click("供应商已保存，继续");
    expect(getCodexGuideDetail()).toMatchObject({
      place: "main",
      stepId: "save-provider",
      providerId: "saved-id",
    });
    click("下一步");
    expect(getCodexGuideDetail()).toMatchObject({
      place: "main",
      stepId: "enable-provider",
      providerId: "saved-id",
    });
    expect(screen.queryByLabelText("真实密钥输入")).not.toBeInTheDocument();
  });

  it("resumes after reload at provider setup without restoring sensitive form values", () => {
    saveCodexGuideProgress({ mode: "provider", stepId: "api-key" });
    render(<Harness />);
    click("新手引导");
    click("继续上次引导");
    expect(getCodexGuideDetail()).toMatchObject({
      place: "add",
      stepId: "provider-preset",
    });
    expect(screen.getByLabelText("真实密钥输入")).toHaveValue("");
  });
});
