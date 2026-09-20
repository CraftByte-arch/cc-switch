import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCommonConfigSnippet } from "@/lib/api/config";
import { CODEX_MAINTENANCE_EVENT } from "@/lib/codexMaintenance";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const listener = vi.fn();
beforeEach(() => {
  listener.mockReset();
  invoke.mockReset();
  window.addEventListener(CODEX_MAINTENANCE_EVENT, listener);
});
afterEach(() => window.removeEventListener(CODEX_MAINTENANCE_EVENT, listener));
describe("common Codex config restart prompt", () => {
  it.each([true, false])("live changed=%s", async (changed) => {
    invoke.mockResolvedValue(changed);
    await setCommonConfigSnippet("codex", "model = 'fixture'");
    expect(listener).toHaveBeenCalledTimes(changed ? 1 : 0);
  });
  it("never prompts after a failed save", async () => {
    invoke.mockRejectedValue(new Error("failed"));
    await expect(setCommonConfigSnippet("codex", "invalid")).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
  it("does not prompt for other apps", async () => {
    invoke.mockResolvedValue(true);
    await setCommonConfigSnippet("claude", "{}");
    expect(listener).not.toHaveBeenCalled();
  });
});
