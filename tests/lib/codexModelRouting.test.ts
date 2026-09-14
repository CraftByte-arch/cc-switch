import { describe, expect, it } from "vitest";
import type { CodexCatalogModel, Provider } from "@/types";
import {
  modelRoutingCombinationKey,
  modelRoutingModelLabel,
  modelRoutingOptions,
  modelRoutingSelectionKey,
  selectRoutedModel,
} from "@/utils/codexModelRouting";

function provider(
  id: string,
  name: string,
  models: Array<Record<string, unknown>> = [],
): Provider {
  return {
    id,
    name,
    settingsConfig: { modelCatalog: { models } },
  };
}

describe("codex model routing helpers", () => {
  it("uses provider id and model id as the selection identity", () => {
    const first = { providerId: "station-a", model: "gpt-5.4" };
    const second = { providerId: "station-b", model: "gpt-5.4" };

    expect(modelRoutingSelectionKey(first)).not.toBe(
      modelRoutingSelectionKey(second),
    );
    expect(selectRoutedModel([first], second)).toEqual([first, second]);
    expect(selectRoutedModel([first], first)).toEqual([first]);
  });

  it("uses the visible provider and model names for conflict detection", () => {
    const a = provider("station-a", "A站");
    const b = provider("station-b", "A站");
    const model: CodexCatalogModel = {
      model: "gpt-5.4",
      displayName: "GPT 5.4",
    };

    expect(modelRoutingModelLabel(model)).toBe("GPT 5.4");
    expect(modelRoutingCombinationKey(a, model)).toBe(
      modelRoutingCombinationKey(b, model),
    );
    expect(
      modelRoutingCombinationKey(provider("station-c", "B站"), model),
    ).not.toBe(modelRoutingCombinationKey(a, model));
  });

  it("normalizes snake-case display aliases from provider catalogs", () => {
    const [model] = modelRoutingOptions(
      provider("station-a", "A站", [
        {
          model: "gpt-5.4",
          display_name: "GPT 5.4 Fast",
          reasoning_levels: ["low", "high"],
        },
      ]),
    );

    expect(model.displayName).toBe("GPT 5.4 Fast");
    expect(model.reasoningLevels).toEqual(["low", "high"]);
  });
});
