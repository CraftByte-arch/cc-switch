import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export type CodexMaintenanceAction =
  | "restart"
  | "repair_and_restart"
  | "check_and_restart";
export interface CodexMaintenanceResult {
  restarted: boolean;
  repair: {
    provider: string;
    changedFiles: number;
    changedThreads: number;
    backupPath: string | null;
    prunedBackups: number;
    warnings: string[];
    skippedFiles: number;
  } | null;
}
export interface CodexRepairPreview {
  provider: string;
  scannedFiles: number;
  changedFiles: number;
  changedThreads: number;
  databaseCount: number;
  skippedFiles: number;
  estimatedBackupBytes: number;
  warnings: string[];
}
export interface CodexRepairProgress {
  runId: string;
  phase: string;
  completed: number;
  total: number | null;
  unit: "files" | "bytes" | "pages" | "databases" | "steps";
  item: string | null;
}
export interface CodexRepairBackups {
  count: number;
  bytes: number;
  protectedCount: number;
  skippedEntries: number;
  path: string;
  snapshot: string;
}
export interface CodexBackupCleanupResult {
  deletedCount: number;
  deletedBytes: number;
  warnings: string[];
}
export const codexMaintenanceApi = {
  status: () =>
    invoke<{
      supported: boolean;
      appName: string;
      repairTarget: string | null;
      repairError: string | null;
    }>("get_codex_maintenance_status"),
  onProgress: (handler: (event: CodexRepairProgress) => void) =>
    listen<CodexRepairProgress>("codex-maintenance-progress", (event) =>
      handler(event.payload),
    ),
  preview: (expectedProvider: string, runId: string) =>
    invoke<CodexRepairPreview>("preview_codex_repair", {
      expectedProvider,
      runId,
    }),
  run: (
    action: CodexMaintenanceAction,
    expectedProvider: string | undefined,
    runId: string,
  ) =>
    invoke<CodexMaintenanceResult>("run_codex_maintenance", {
      action,
      expectedProvider,
      runId,
    }),
  backups: () => invoke<CodexRepairBackups>("get_codex_repair_backups"),
  cleanup: (expectedSnapshot: string) =>
    invoke<CodexBackupCleanupResult>("cleanup_codex_repair_backups", {
      expectedSnapshot,
    }),
};
