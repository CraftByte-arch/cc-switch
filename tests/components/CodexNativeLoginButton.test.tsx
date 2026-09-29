import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { CodexNativeLoginButton } from "@/components/proxy/CodexNativeLoginButton";
const successToast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: successToast } }));
const api = vi.hoisted(() => ({
  startNativeLogin: vi.fn(),
  nativeLoginStatus: vi.fn(),
  cancelNativeLogin: vi.fn(),
}));
vi.mock("@/lib/api/codexModelRouting", () => ({ codexModelRoutingApi: api }));
describe("native browser login", () => {
  beforeEach(() => {
    successToast.mockReset();
    i18n.addResourceBundle(
      "zh",
      "translation",
      { codexRouting: zh.codexRouting, common: zh.common },
      true,
      true,
    );
    api.startNativeLogin
      .mockReset()
      .mockResolvedValue({ id: "test", status: "waiting", error: null });
    api.nativeLoginStatus
      .mockReset()
      .mockResolvedValue({ id: "test", status: "succeeded", error: null });
    api.cancelNativeLogin.mockReset().mockResolvedValue(undefined);
  });
  it("requests consent before starting login and refreshes only after success", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<CodexNativeLoginButton disabled={false} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
    expect(api.startNativeLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "替换现有 Codex 登录凭据",
    );
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
    expect(await screen.findByText("等待浏览器授权…")).toBeInTheDocument();
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce(), {
      timeout: 2000,
    });
    expect(api.startNativeLogin).toHaveBeenCalledOnce();
    expect(successToast).toHaveBeenCalledOnce();
    expect(successToast).toHaveBeenCalledWith(
      zh.codexRouting.subscription.loginSucceeded,
    );
  });
  it("cancels the login process on unmount without refreshing", async () => {
    api.nativeLoginStatus.mockResolvedValue({
      id: "test",
      status: "waiting",
      error: null,
    });
    const onComplete = vi.fn();
    const view = render(
      <CodexNativeLoginButton disabled={false} onComplete={onComplete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
    await screen.findByText("等待浏览器授权…");
    view.unmount();
    expect(api.cancelNativeLogin).toHaveBeenCalledWith("test");
    expect(onComplete).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });
  it("reports failed login without refreshing candidates", async () => {
    api.nativeLoginStatus.mockResolvedValue({
      id: "test",
      status: "failed",
      error: "Callback port unavailable",
    });
    const onComplete = vi.fn();
    render(<CodexNativeLoginButton disabled={false} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
    expect(
      await screen.findByRole("alert", {}, { timeout: 2000 }),
    ).toHaveTextContent("Callback port unavailable");
    expect(onComplete).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });
  it("explains an incompatible CLI and shows the executable actually used", async () => {
    const cli = { path: "/opt/homebrew/bin/codex", version: "0.128.0" };
    api.startNativeLogin.mockResolvedValue({
      id: "old-cli",
      status: "waiting",
      error: null,
      cli,
    });
    api.nativeLoginStatus.mockResolvedValue({
      id: "old-cli",
      status: "failed",
      error: "safe fallback",
      errorCode: "configIncompatible",
      cli,
    });
    const onComplete = vi.fn();
    render(<CodexNativeLoginButton disabled={false} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(alert).toHaveTextContent(
      zh.codexRouting.subscription.loginErrors.configIncompatible.title,
    );
    expect(alert).toHaveTextContent("更新下方路径对应的 CLI");
    expect(alert).not.toHaveTextContent("safe fallback");
    const details = screen
      .getByText("查看登录程序：Codex CLI 0.128.0")
      .closest("details");
    expect(details).toHaveTextContent(cli.path);
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "重新登录" })).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });

  it.each([
    "cliNotFound",
    "configInvalid",
    "storageUnsupported",
    "launchFailed",
    "portInUse",
    "policyRestricted",
    "network",
    "timeout",
    "processFailed",
    "unknown",
  ] as const)(
    "shows actionable %s failures even before polling starts",
    async (code) => {
      api.startNativeLogin.mockResolvedValue({
        id: "failed-start",
        status: "failed",
        error: "safe fallback",
        errorCode: code,
      });
      const view = render(
        <CodexNativeLoginButton disabled={false} onComplete={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
      fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        zh.codexRouting.subscription.loginErrors[code].title,
      );
      expect(alert).toHaveTextContent(
        zh.codexRouting.subscription.loginErrors[code].hint,
      );
      expect(api.nativeLoginStatus).not.toHaveBeenCalled();
      view.unmount();
      expect(api.cancelNativeLogin).not.toHaveBeenCalled();
    },
  );

  it("clears outdated diagnostics and CLI metadata when retrying", async () => {
    api.startNativeLogin.mockResolvedValueOnce({
      id: "old",
      status: "failed",
      error: "old failure",
      errorCode: "configIncompatible",
      cli: { path: "/old/codex", version: "0.128.0" },
    });
    render(<CodexNativeLoginButton disabled={false} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "登录 ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
    await screen.findByRole("alert");
    api.startNativeLogin.mockRejectedValueOnce(
      new Error("Could not start a new login"),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not start a new login",
      ),
    );
    expect(screen.queryByText("/old/codex")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("与配置不兼容");
  });
});
