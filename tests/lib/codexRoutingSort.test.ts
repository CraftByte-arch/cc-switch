import { describe, expect, it } from "vitest";
import {
  resolveRoutingDefault,
  sortRoutingModels,
  withRoutedModels,
} from "@/utils/codexRoutingSort";
import type { CodexModelSelection } from "@/types/codexModelRouting";
const pinned = { providerId: "z", model: "default" };
const a10 = { providerId: "a", model: "Model 10" };
const b2 = { providerId: "b", model: "Model 2" };
const a2 = { providerId: "a", model: "Model 2" };
const names = (entry: CodexModelSelection) => ({
  provider: entry.providerId,
  model: entry.model,
});
describe("routing smart sort", () => {
  it("groups by supplier and sorts models naturally without pinning the default", () => {
    const models = [pinned, a10, b2, a2];
    expect(sortRoutingModels(models, "provider", names)).toEqual([
      a2,
      a10,
      b2,
      pinned,
    ]);
    expect(models).toEqual([pinned, a10, b2, a2]);
  });
  it("groups identical model names by supplier with natural numeric ordering", () => {
    expect(sortRoutingModels([pinned, a10, b2, a2], "model", names)).toEqual([
      pinned,
      a2,
      b2,
      a10,
    ]);
  });
  it("keeps manual and already-sorted arrays unchanged", () => {
    const models = [a2, a10, b2, pinned];
    expect(sortRoutingModels(models, "manual", names)).toBe(models);
    expect(sortRoutingModels(models, "provider", names)).toBe(models);
    expect(sortRoutingModels([], "provider", names)).toEqual([]);
    expect(sortRoutingModels([pinned], "provider", names)).toEqual([pinned]);
  });
  it("uses friendly labels and separates suppliers with the same name by ID", () => {
    const describe = (entry: CodexModelSelection) => ({
      provider: "Shared",
      model: entry === a10 ? "Alpha" : "Zulu",
    });
    expect(
      sortRoutingModels([pinned, b2, a2, a10], "provider", describe),
    ).toEqual([a10, a2, b2, pinned]);
  });
  it("keeps an explicit default after the list is reordered or trimmed", () => {
    expect(resolveRoutingDefault([a10, pinned, a2], pinned)).toEqual(pinned);
    expect(
      withRoutedModels({ models: [pinned, a10], defaultModel: pinned }, [
        a10,
        a2,
      ]),
    ).toEqual({
      models: [a10, a2],
      defaultModel: a10,
    });
  });
});
