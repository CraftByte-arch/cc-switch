import { describe, expect, it } from "vitest";
import type { CodexCatalogModel, Provider } from "@/types";
import {
  formatContextWindow,
  nativeModelLabel,
  routedModelLabel,
  CODEX_NATIVE_ROUTE_ID,
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

  it("normalizes snake-case catalog capabilities", () => {
    const [model] = modelRoutingOptions(
      provider("station-a", "A站", [
        {
          model: "gpt-5.4",
          display_name: "GPT 5.4 Fast",
          context_window: 262144,
          reasoning_levels: ["low", "high"],
        },
      ]),
    );

    expect(model.displayName).toBe("GPT 5.4 Fast");
    expect(model.contextWindow).toBe(262144);
    expect(model.reasoningLevels).toEqual(["low", "high"]);
  });

  it("formats numeric GPT official names before applying a prefix, without changing relay labels", () => {
    const config = {
      enabled: false,
      providerName: "Router",
      smartModelNames: true,
      models: [],
    };
    for (const [raw, friendly] of [
      ["GPT-6-Astra", "6 Astra"],
      ["GPT-5.6-Sol", "5.6 Sol"],
      ["GPT-5.4-Mini", "5.4 Mini"],
      ["Custom Label", "Custom Label"],
    ]) {
      expect(nativeModelLabel(raw)).toBe(friendly);
      expect(
        routedModelLabel(config, CODEX_NATIVE_ROUTE_ID, "Official", raw, false),
      ).toBe(`官方 · ${friendly}`);
      expect(
        routedModelLabel(
          { ...config, showNativeModelPrefix: false },
          CODEX_NATIVE_ROUTE_ID,
          "Official",
          raw,
          true,
        ),
      ).toBe(friendly);
      expect(
        routedModelLabel(
          { ...config, nativeModelPrefix: " My account " },
          CODEX_NATIVE_ROUTE_ID,
          "Official",
          raw,
          false,
        ),
      ).toBe(`My account · ${friendly}`);
      expect(routedModelLabel(config, "relay", "Relay", raw, false)).toBe(raw);
      expect(routedModelLabel(config, "relay", "Relay", raw, true)).toBe(
        `Relay · ${raw}`,
      );
    }
  });

  it("formats effective context windows compactly", () => {
    expect(formatContextWindow(64_000)).toBe("64K");
    expect(formatContextWindow(128_000)).toBe("128K");
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(278_528)).toBe("272K");
    expect(formatContextWindow(262_144)).toBe("256K");
    expect(formatContextWindow(1_048_576)).toBe("1M");
    expect(formatContextWindow(250_001)).toBe("250,001");
    expect(formatContextWindow(null)).toBe("");
  });
});
