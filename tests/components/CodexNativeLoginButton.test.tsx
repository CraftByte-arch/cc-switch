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
});
