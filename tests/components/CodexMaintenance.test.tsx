import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import {
  CodexMaintenanceActions,
  CodexMaintenanceDialog,
} from "@/components/proxy/CodexMaintenance";
import type {
  CodexRepairPreview,
  CodexRepairProgress,
} from "@/lib/api/codexMaintenance";
import { requestCodexMaintenance } from "@/lib/codexMaintenance";
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  run: vi.fn(),
  backups: vi.fn(),
  cleanup: vi.fn(),
  preview: vi.fn(),
  onProgress: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@/lib/api/codexMaintenance", () => ({ codexMaintenanceApi: mocks }));
const stats = {
  count: 4,
  bytes: 2048,
  protectedCount: 1,
  skippedEntries: 1,
  path: "/fixture/repair-backups",
  snapshot: "confirmed-snapshot",
};
const repairPreview: CodexRepairPreview = {
  provider: "custom",
  scannedFiles: 1000,
  changedFiles: 2,
  changedThreads: 3,
  databaseCount: 1,
  skippedFiles: 0,
  estimatedBackupBytes: 4096,
  warnings: [],
};
let progressHandler: (event: CodexRepairProgress) => void;
const supported = {
  supported: true,
  appName: "Codex",
  repairTarget: "custom",
  repairError: null,
};
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <CodexMaintenanceActions />
      <CodexMaintenanceDialog />
    </QueryClientProvider>,
  );
  return { client, ...rendered };
}
function buttons() {
  return within(screen.getByRole("dialog"));
}
async function clickReady(name: string) {
  const button = buttons().getByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => {
    fireEvent.click(button);
  });
}
beforeEach(() => {
  i18n.addResourceBundle(
    "zh",
    "translation",
    { codexMaintenance: zh.codexMaintenance, common: zh.common },
    true,
    true,
  );
  mocks.preview.mockReset().mockResolvedValue(repairPreview);
  mocks.unlisten.mockReset();
  mocks.onProgress.mockReset().mockImplementation(async (handler) => {
    progressHandler = handler;
    return mocks.unlisten;
  });
  mocks.status.mockReset().mockResolvedValue(supported);
  mocks.run.mockReset().mockResolvedValue({ restarted: true, repair: null });
  mocks.backups.mockReset().mockResolvedValue(stats);
  mocks.cleanup
    .mockReset()
    .mockResolvedValue({ deletedCount: 4, deletedBytes: 2048, warnings: [] });
});

describe("Codex maintenance confirmations have distinct scopes", () => {
  it("offers preview plus three choices after a config change; Later performs no action", async () => {
    mount();
    act(() => requestCodexMaintenance());
    expect(
      await screen.findByText(zh.codexMaintenance.changedTitle),
    ).toBeInTheDocument();
    expect(buttons().getAllByRole("button")).toHaveLength(3);
    fireEvent.click(
      buttons().getByRole("button", { name: zh.codexMaintenance.later }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("manual restart offers only Cancel and Restart, with no repair copy", async () => {
    mount();
    act(() => requestCodexMaintenance("restart"));
    expect(buttons().getAllByRole("button")).toHaveLength(2);
    expect(
      buttons().queryByRole("button", {
        name: zh.codexMaintenance.repairAndRestart,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(zh.codexMaintenance.repairDescription),
    ).not.toBeInTheDocument();
    await clickReady(zh.codexMaintenance.restart);
    await waitFor(() =>
      expect(mocks.run).toHaveBeenCalledWith(
        "restart",
        undefined,
        expect.any(String),
      ),
    );
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("manual repair offers Cancel, Preview and Repair and restart", async () => {
    mocks.run.mockResolvedValueOnce({
      restarted: true,
      repair: {
        provider: "custom",
        changedFiles: 2,
        changedThreads: 3,
        backupPath: "/safe/backup",
        prunedBackups: 1,
        warnings: [],
        skippedFiles: 0,
      },
    });
    mount();
    act(() => requestCodexMaintenance("repair"));
    expect(buttons().getAllByRole("button")).toHaveLength(3);
    expect(
      buttons().queryByRole("button", {
        name: zh.codexMaintenance.restartOnly,
      }),
    ).not.toBeInTheDocument();
    await clickReady(zh.codexMaintenance.repairAndRestart);
    expect(await screen.findByRole("status")).toHaveTextContent("/safe/backup");
    expect(screen.getByRole("status")).toHaveTextContent("自动清理 1");
    expect(mocks.run).toHaveBeenCalledWith(
      "repair_and_restart",
      "custom",
      expect.any(String),
    );
  });
  it("passes the actual official target, never silently forces custom", async () => {
    mocks.status.mockResolvedValue({
      ...supported,
      repairTarget: "cc-switch-official",
    });
    mount();
    act(() => requestCodexMaintenance());
    await clickReady(zh.codexMaintenance.checkAndRestart);
    expect(mocks.run).toHaveBeenCalledWith(
      "check_and_restart",
      "cc-switch-official",
      expect.any(String),
    );
  });
  it("invalid target blocks repair but does not block restart", async () => {
    mocks.status.mockResolvedValue({
      ...supported,
      repairTarget: null,
      repairError: "invalid config",
    });
    mount();
    act(() => requestCodexMaintenance());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid config",
    );
    expect(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.checkAndRestart,
      }),
    ).toBeDisabled();
    expect(
      buttons().getByRole("button", { name: zh.codexMaintenance.restartOnly }),
    ).toBeEnabled();
  });
  it("keeps errors visible and does not issue a second restart", async () => {
    mocks.run.mockRejectedValueOnce(new Error("repair failed; backed up"));
    mount();
    act(() => requestCodexMaintenance());
    await clickReady(zh.codexMaintenance.checkAndRestart);
    expect(await screen.findByRole("alert")).toHaveTextContent("repair failed");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.refreshTarget,
      }),
    ).toBeEnabled();
  });
  it("prevents duplicates, reason changes and dismissal while pending", async () => {
    let resolve!: (value: { restarted: boolean; repair: null }) => void;
    mocks.run.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    mount();
    act(() => requestCodexMaintenance());
    await clickReady(zh.codexMaintenance.restartOnly);
    fireEvent.click(
      buttons().getByRole("button", { name: zh.codexMaintenance.restartOnly }),
    );
    act(() => requestCodexMaintenance("cleanup"));
    expect(
      buttons().getByRole("button", { name: zh.codexMaintenance.later }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    await act(async () => resolve({ restarted: true, repair: null }));
  });
  it("disables lifecycle actions on unsupported systems", async () => {
    mocks.status.mockResolvedValue({ ...supported, supported: false });
    mount();
    act(() => requestCodexMaintenance());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      zh.codexMaintenance.unsupported,
    );
    expect(
      buttons().getByRole("button", { name: zh.codexMaintenance.restartOnly }),
    ).toBeDisabled();
  });
});

describe("manual repair-backup cleanup", () => {
  it("loads scope and size but never deletes before confirmation", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: zh.codexMaintenance.cleanup }),
    );
    expect(
      await screen.findByText(/4 份备份，占用 2.0 KB/),
    ).toBeInTheDocument();
    expect(screen.getByText(stats.path)).toBeInTheDocument();
    expect(screen.getByText(/其中 1 份/)).toBeInTheDocument();
    expect(screen.getByText(/另有 1 项/)).toBeInTheDocument();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    fireEvent.click(buttons().getByRole("button", { name: zh.common.cancel }));
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("cleans only the confirmed snapshot and works on non-macOS without restarting", async () => {
    mocks.status.mockResolvedValue({ ...supported, supported: false });
    mount();
    act(() => requestCodexMaintenance("cleanup"));
    await clickReady(zh.codexMaintenance.cleanupConfirm);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已清理 4 份备份，释放 2.0 KB",
    );
    expect(mocks.cleanup).toHaveBeenCalledWith(stats.snapshot);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("disables cleanup when empty", async () => {
    mocks.backups.mockResolvedValue({ ...stats, count: 0, bytes: 0 });
    mount();
    act(() => requestCodexMaintenance("cleanup"));
    expect(
      await screen.findByText(zh.codexMaintenance.noBackups),
    ).toBeInTheDocument();
    expect(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.cleanupConfirm,
      }),
    ).toBeDisabled();
  });
  it("disables cleanup after a listing failure", async () => {
    mocks.backups.mockRejectedValue(new Error("unsafe directory"));
    mount();
    act(() => requestCodexMaintenance("cleanup"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "unsafe directory",
    );
    expect(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.cleanupConfirm,
      }),
    ).toBeDisabled();
  });
  it("requires explicit refresh after stale-snapshot failure", async () => {
    mocks.cleanup.mockRejectedValueOnce(new Error("备份列表已变化"));
    mount();
    act(() => requestCodexMaintenance("cleanup"));
    await clickReady(zh.codexMaintenance.cleanupConfirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "备份列表已变化",
    );
    mocks.backups.mockResolvedValue({ ...stats, snapshot: "new-snapshot" });
    fireEvent.click(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.refreshBackups,
      }),
    );
    await clickReady(zh.codexMaintenance.cleanupConfirm);
    await waitFor(() =>
      expect(mocks.cleanup).toHaveBeenLastCalledWith("new-snapshot"),
    );
  });
  it("prevents duplicate cleanup and cancellation while deleting", async () => {
    let resolve!: (value: {
      deletedCount: number;
      deletedBytes: number;
      warnings: string[];
    }) => void;
    mocks.cleanup.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    mount();
    act(() => requestCodexMaintenance("cleanup"));
    await clickReady(zh.codexMaintenance.cleanupConfirm);
    fireEvent.click(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.cleanupConfirm,
      }),
    );
    expect(
      buttons().getByRole("button", { name: zh.common.cancel }),
    ).toBeDisabled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({ deletedCount: 4, deletedBytes: 2048, warnings: [] }),
    );
  });
  it("reports partial cleanup warnings rather than pretending everything was removed", async () => {
    mocks.cleanup.mockResolvedValue({
      deletedCount: 1,
      deletedBytes: 1024,
      warnings: ["backup locked; skipped"],
    });
    mount();
    act(() => requestCodexMaintenance("cleanup"));
    await clickReady(zh.codexMaintenance.cleanupConfirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "backup locked; skipped",
    );
    expect(screen.getByRole("status")).toHaveTextContent("已清理 1 份备份");
  });
});

describe("repair preview and live progress", () => {
  it("previews without invoking lifecycle/cleanup and shows exact counts and backup estimate", async () => {
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    const preview = screen.getByTestId("codex-repair-preview");
    expect(preview).toHaveTextContent("1000 个会话文件、1 个数据库");
    expect(preview).toHaveTextContent("2 个文件、3 条索引记录");
    expect(preview).toHaveTextContent("4.0 KB");
    expect(preview).toHaveTextContent(zh.codexMaintenance.previewReadOnly);
    expect(mocks.preview).toHaveBeenCalledWith("custom", expect.any(String));
    expect(mocks.onProgress.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.preview.mock.invocationCallOrder[0],
    );
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("uses real stage counts, elapsed time and ignores other or late run events", async () => {
    let resolve!: (value: CodexRepairPreview) => void;
    mocks.preview.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    const runId = mocks.preview.mock.calls[0][1];
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    const event: CodexRepairProgress = {
      runId,
      phase: "scan_files",
      completed: 250,
      total: 1000,
      unit: "files",
      item: "rollout-fixture.jsonl",
    };
    act(() =>
      progressHandler({ ...event, runId: "another-run", phase: "write_files" }),
    );
    expect(screen.queryByText("rollout-fixture.jsonl")).not.toBeInTheDocument();
    act(() => progressHandler(event));
    expect(screen.getByRole("status")).toHaveTextContent("250 / 1000 个文件");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "25");
    expect(screen.getByRole("status")).toHaveTextContent(
      "rollout-fixture.jsonl",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      zh.codexMaintenance.stageHint,
    );
    expect(
      buttons().getByRole("button", { name: zh.common.cancel }),
    ).toBeDisabled();
    await waitFor(
      () => expect(screen.getByRole("status")).toHaveTextContent("已用时 1 秒"),
      { timeout: 2500 },
    );
    await act(async () => resolve(repairPreview));
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    act(() => progressHandler(event));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows lifecycle steps only after the scan and advances them with real phases", async () => {
    let resolve!: (value: unknown) => void;
    mocks.run.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    mount();
    act(() => requestCodexMaintenance());
    await clickReady(zh.codexMaintenance.checkAndRestart);
    const runId = mocks.run.mock.calls[0][2];

    act(() =>
      progressHandler({
        runId,
        phase: "scan_files",
        completed: 10,
        total: 100,
        unit: "files",
        item: "rollout.jsonl",
      }),
    );
    expect(
      screen.queryByTestId("codex-maintenance-steps"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "10");

    act(() =>
      progressHandler({
        runId,
        phase: "stopping",
        completed: 0,
        total: null,
        unit: "steps",
        item: null,
      }),
    );
    expect(screen.getByTestId("codex-maintenance-steps")).toHaveTextContent(
      zh.codexMaintenance.steps.stop,
    );
    expect(screen.getByTestId("codex-maintenance-steps")).toHaveTextContent(
      zh.codexMaintenance.steps.repair,
    );
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");

    act(() =>
      progressHandler({
        runId,
        phase: "restarting",
        completed: 0,
        total: null,
        unit: "steps",
        item: null,
      }),
    );
    const steps = screen.getByTestId("codex-maintenance-steps");
    expect(steps).toHaveTextContent(zh.codexMaintenance.steps.restart);
    expect(steps.querySelectorAll("svg")).toHaveLength(2);

    await act(async () => resolve({ restarted: true, repair: null }));
  });

  it("shows byte progress during repair and removes listener on completion", async () => {
    let resolve!: (value: unknown) => void;
    mocks.run.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.repairAndRestart);
    act(() =>
      progressHandler({
        runId: mocks.run.mock.calls[0][2],
        phase: "backup_files",
        completed: 1024,
        total: 4096,
        unit: "bytes",
        item: "fixture.jsonl",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("1.0 KB / 4.0 KB");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "25");
    await act(async () => resolve({ restarted: true, repair: null }));
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("keeps manual no-op repair disabled while config changes use check-and-restart", async () => {
    mocks.preview.mockResolvedValue({
      ...repairPreview,
      changedFiles: 0,
      changedThreads: 0,
      estimatedBackupBytes: 0,
    });
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    expect(screen.getByTestId("codex-repair-preview")).toHaveTextContent(
      zh.codexMaintenance.noChangesTitle,
    );
    expect(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.repairAndRestart,
      }),
    ).toBeDisabled();
    fireEvent.click(buttons().getByRole("button", { name: zh.common.cancel }));

    act(() => requestCodexMaintenance());
    await waitFor(() =>
      expect(
        buttons().getByRole("button", {
          name: zh.codexMaintenance.checkAndRestart,
        }),
      ).toBeEnabled(),
    );
    await clickReady(zh.codexMaintenance.checkAndRestart);
    expect(mocks.run).toHaveBeenCalledWith(
      "check_and_restart",
      "custom",
      expect.any(String),
    );
  });

  it("does not call a no-op result a restart and reports skipped metadata", async () => {
    mocks.run.mockResolvedValue({
      restarted: false,
      repair: {
        provider: "custom",
        changedFiles: 0,
        changedThreads: 0,
        skippedFiles: 2,
        warnings: ["unrecognized header"],
        backupPath: null,
        prunedBackups: 0,
      },
    });
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.repairAndRestart);
    expect(screen.getByRole("heading")).toHaveTextContent(
      zh.codexMaintenance.noChangesTitle,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "有 2 个文件的首条元数据无法识别",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "尚未确认是否需要修复",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      zh.codexMaintenance.noChangesDescription,
    );
    expect(
      screen.queryByText(zh.codexMaintenance.restarted),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("unrecognized header");
  });

  it("does not claim skipped files are healthy in preview either", async () => {
    mocks.preview.mockResolvedValue({
      ...repairPreview,
      changedFiles: 0,
      changedThreads: 0,
      skippedFiles: 1,
      warnings: ["skipped fixture.jsonl"],
    });
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    expect(screen.getByTestId("codex-repair-preview")).toHaveTextContent(
      "尚未确认是否需要修复",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "skipped fixture.jsonl",
    );
  });

  it("allows preview on unsupported lifecycle platforms", async () => {
    mocks.status.mockResolvedValue({ ...supported, supported: false });
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    expect(screen.getByTestId("codex-repair-preview")).toBeInTheDocument();
    expect(
      buttons().getByRole("button", {
        name: zh.codexMaintenance.repairAndRestart,
      }),
    ).toBeDisabled();
  });

  it("keeps a preview error visible, unsubscribes and supports retry", async () => {
    mocks.preview.mockRejectedValueOnce(new Error("preview failed"));
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    expect(screen.getByRole("alert")).toHaveTextContent("preview failed");
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    await clickReady(zh.codexMaintenance.preview);
    expect(screen.getByTestId("codex-repair-preview")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it("does not execute without a progress subscription", async () => {
    mocks.onProgress.mockRejectedValueOnce(new Error("listener unavailable"));
    mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    expect(screen.getByRole("alert")).toHaveTextContent("listener unavailable");
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(
      buttons().getByRole("button", { name: zh.common.cancel }),
    ).toBeEnabled();
  });

  it("unsubscribes when unmounted during a preview", async () => {
    mocks.preview.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    unmount();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("cleans up a listener that arrives after unmount without invoking preview", async () => {
    let resolve!: (value: () => void) => void;
    mocks.onProgress.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { unmount } = mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    unmount();
    await act(async () => resolve(mocks.unlisten));
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("hides a stale preview if the effective provider changes", async () => {
    const { client } = mount();
    act(() => requestCodexMaintenance("repair"));
    await clickReady(zh.codexMaintenance.preview);
    act(() =>
      client.setQueryData(["codexMaintenanceStatus"], {
        ...supported,
        repairTarget: "openai",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("codex-repair-preview"),
      ).not.toBeInTheDocument(),
    );
    await clickReady(zh.codexMaintenance.repairAndRestart);
    expect(mocks.run).toHaveBeenCalledWith(
      "repair_and_restart",
      "openai",
      expect.any(String),
    );
  });
});
