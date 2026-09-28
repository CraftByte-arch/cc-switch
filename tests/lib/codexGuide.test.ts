import { describe, expect, it } from "vitest";
import {
  CODEX_GUIDE_STEPS,
  codexGuidePlace,
  codexGuideSteps,
  codexGuideBarHeight,
  codexGuideSurface,
  isCodexGuideMappingStep,
  readCodexGuideProgress,
  saveCodexGuideProgress,
} from "@/lib/codexGuide";

describe("codex guide steps", () => {
  it("stops the provider tour at enabling the provider", () => {
    expect(codexGuideSteps("provider").map((step) => step.id)).toEqual([
      "add-provider",
      "provider-preset",
      "provider-name",
      "api-key",
      "api-url",
      "fetch-models",
      "model-mapping",
      "save-provider",
      "enable-provider",
    ]);
  });

  it("includes provider setup and routing in the routing tour", () => {
    expect(codexGuideSteps("routing").map((step) => step.id)).toEqual([
      "add-provider",
      "provider-preset",
      "provider-name",
      "api-key",
      "api-url",
      "fetch-models",
      "model-mapping",
      "save-provider",
      "enter-routing",
      "routing-sources",
      "select-models",
      "sort-models",
      "default-model",
      "save-routing",
      "enable-config",
      "enable-proxy",
      "repair-sessions",
      "restart",
    ]);
  });

  it("keeps the first step on the main page and opens details later", () => {
    expect(
      CODEX_GUIDE_STEPS.find((step) => step.id === "add-provider")?.target,
    ).toBe("codex-add-provider");
    expect(codexGuidePlace("add-provider")).toBe("main");
    expect(codexGuidePlace("model-mapping")).toBe("add");
    expect(codexGuidePlace("enable-provider")).toBe("main");
    expect(codexGuidePlace("enter-routing")).toBe("main");
    expect(codexGuidePlace("routing-sources")).toBe("routing-available");
    expect(codexGuidePlace("select-models")).toBe("routing-available");
    expect(codexGuidePlace("sort-models")).toBe("routing-selected");
    expect(codexGuidePlace("enable-config")).toBe("main");
    expect(codexGuidePlace("enable-proxy")).toBe("main");
    expect(codexGuidePlace("repair-sessions")).toBe("main");
    expect(codexGuidePlace("restart")).toBe("main");
  });

  it("expands advanced options for discovery as well as mapping", () => {
    expect(isCodexGuideMappingStep("fetch-models")).toBe(true);
    expect(isCodexGuideMappingStep("model-mapping")).toBe(true);
    expect(isCodexGuideMappingStep("api-key")).toBe(false);
  });

  it("handles corrupt or incompatible stored progress without breaking replay", () => {
    localStorage.setItem("cc-switch.codexGuide.progress.v2", "broken-json");
    expect(readCodexGuideProgress()).toBeNull();
    localStorage.setItem(
      "cc-switch.codexGuide.progress.v2",
      JSON.stringify({ mode: "provider", stepId: "select-models" }),
    );
    expect(readCodexGuideProgress()).toBeNull();
    saveCodexGuideProgress({
      mode: "routing",
      stepId: "sort-models",
      providerId: "provider",
    });
    expect(readCodexGuideProgress()).toEqual({
      mode: "routing",
      stepId: "sort-models",
      providerId: "provider",
    });
    saveCodexGuideProgress(null);
    expect(readCodexGuideProgress()).toBeNull();
  });

  it.each([
    [900, 600, false, 88],
    [760, 540, false, 88],
    [1280, 800, false, 88],
    [375, 667, false, 132],
    [320, 480, false, 132],
    [900, 600, true, 44],
    [375, 667, true, 44],
  ] as const)(
    "uses a stable bar height at %s × %s (minimized=%s)",
    (width, height, minimized, expected) => {
      expect(codexGuideBarHeight({ width, height }, minimized)).toBe(expected);
    },
  );
  it.each(["provider", "routing"])(
    "puts the %s save bubble above the footer without covering the button",
    () => {
      const button = { top: 548, left: 800, width: 80, height: 36 };
      const surface = codexGuideSurface(
        { width: 900, height: 600 },
        false,
        button,
      );
      expect(surface.placement).toBe("above");
      expect(surface.top + surface.height + 12).toBeLessThanOrEqual(button.top);
      expect(surface.left + surface.width).toBeLessThanOrEqual(888);
      expect(surface.arrowLeft! + surface.left).toBe(
        button.left + button.width / 2,
      );
    },
  );
  it("keeps narrow-screen bubbles inside the viewport and uses below when above is impossible", () => {
    const surface = codexGuideSurface({ width: 320, height: 480 }, false, {
      top: 20,
      left: 250,
      width: 60,
      height: 32,
    });
    expect(surface.placement).toBe("below");
    expect(surface.left).toBeGreaterThanOrEqual(12);
    expect(surface.left + surface.width).toBeLessThanOrEqual(308);
    expect(surface.top).toBeGreaterThanOrEqual(64);
  });
  it("only uses the small bubble when a real save target is supplied", () => {
    expect(
      codexGuideSurface({ width: 900, height: 600 }, false, null),
    ).toMatchObject({ placement: "bar", height: 88, top: 500 });
    expect(
      codexGuideSurface({ width: 900, height: 600 }, true, {
        top: 548,
        left: 800,
        width: 80,
        height: 32,
      }),
    ).toMatchObject({ placement: "bar", height: 44 });
  });
});
