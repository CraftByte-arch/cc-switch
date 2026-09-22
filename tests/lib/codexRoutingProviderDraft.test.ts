import { describe, expect, it } from "vitest";
import type { CodexCatalogModel, Provider } from "@/types";
import {
  applyRoutingProviderEdit,
  mergeRoutingProviderEdit,
  splitRoutingProviderPersist,
} from "@/utils/codexRoutingProviderDraft";

function station(): Provider {
  return {
    id: "station",
    name: "A站",
    settingsConfig: {
      auth: { OPENAI_API_KEY: "k" },
      config: "",
      modelCatalog: {
        customVersion: 1,
        models: [
          { model: "old", displayName: "旧模型", extra: "keep" },
          { model: "keep" },
        ],
      },
    },
  };
}

describe("routing provider drafts", () => {
  it("applies name and catalog patches without dropping hidden metadata", () => {
    const original = station();
    const renamed = applyRoutingProviderEdit(original, {
      providerId: "station",
      name: "新站",
      models: [
        { model: "new", displayName: "新模型", extra: "keep" },
        { model: "keep" },
      ] as CodexCatalogModel[],
      rename: { from: "old", to: "new" },
    });
    expect(renamed.name).toBe("新站");
    expect(renamed.settingsConfig.modelCatalog.customVersion).toBe(1);
    expect(renamed.settingsConfig.modelCatalog.models[0]).toEqual({
      model: "new",
      displayName: "新模型",
      extra: "keep",
    });
    expect(original.name).toBe("A站");
  });

  it("merges successive edits against the original snapshot", () => {
    const original = station();
    const first = applyRoutingProviderEdit(original, {
      providerId: "station",
      expectedName: "A站",
      name: "中转站",
    });
    const firstEdit = mergeRoutingProviderEdit(
      original,
      undefined,
      { providerId: "station", name: "中转站" },
      first,
    );
    const second = applyRoutingProviderEdit(first, {
      providerId: "station",
      models: [
        { model: "new", extra: "keep" },
        { model: "keep" },
      ] as CodexCatalogModel[],
      rename: { from: "old", to: "new" },
    });
    const merged = mergeRoutingProviderEdit(
      original,
      firstEdit,
      {
        providerId: "station",
        models: second.settingsConfig.modelCatalog.models,
        rename: { from: "old", to: "new" },
      },
      second,
    );
    expect(merged).toEqual({
      providerId: "station",
      expectedName: "A站",
      name: "中转站",
      expectedCatalog: original.settingsConfig.modelCatalog,
      models: [
        { model: "new", extra: "keep" },
        { model: "keep" },
      ] as CodexCatalogModel[],
      rename: { from: "old", to: "new" },
    });
  });

  it("keeps deleted live models in the first persist so routing can move first", () => {
    const original = station();
    const edit = {
      providerId: "station",
      expectedCatalog: original.settingsConfig.modelCatalog,
      models: [{ model: "keep" }, { model: "added" }],
    };
    const split = splitRoutingProviderPersist(edit, original);
    expect(split.upsert.models?.map((row) => row.model)).toEqual([
      "keep",
      "added",
      "old",
    ]);
    expect(split.remaining?.models?.map((row) => row.model)).toEqual([
      "keep",
      "added",
    ]);
  });
});
