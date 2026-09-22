import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { CodexModelRoutingCard } from "@/components/proxy/CodexModelRoutingCard";

const state = vi.hoisted(() => ({ active: true }));
vi.mock("@/lib/query/codexModelRouting", () => ({
  useCodexModelRouting: () => ({
    data: {
      enabled: state.active,
      providerName: "My Router",
      models: [{ providerId: "a", model: "m" }],
    },
  }),
  useSetCodexModelRoutingEnabled: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock("@/lib/query/proxy", () => ({
  useProxyTakeoverStatus: () => ({ data: { codex: state.active } }),
  useProxyStatusQuery: () => ({ data: { running: state.active } }),
}));
vi.mock("@/components/proxy/CodexModelRoutingDialog", () => ({
  CodexModelRoutingDialog: () => null,
}));

describe("routing card naming", () => {
  beforeEach(() => {
    i18n.addResourceBundle(
      "zh",
      "translation",
      { codexRouting: zh.codexRouting },
      true,
      true,
    );
  });
  it.each([true, false])(
    "identifies the aggregate name when active=%s",
    (active) => {
      state.active = active;
      render(<CodexModelRoutingCard providers={{}} onEditProvider={vi.fn()} />);
      expect(
        screen.getByRole("heading", { name: "Codex 聚合模型路由" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("聚合路由名称：My Router · 1 个模型"),
      ).toBeInTheDocument();
      expect(screen.getByRole("switch")).toHaveAttribute(
        "aria-checked",
        String(active),
      );
    },
  );
});
