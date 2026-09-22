import { describe, expect, it } from "vitest";
import { optimizeCodexModelDisplayName } from "@/utils/codexCatalog";

describe("optimizeCodexModelDisplayName", () => {
  it("turns hyphens into spaces and capitalizes each word", () => {
    expect(optimizeCodexModelDisplayName("deepseek-4.1-flash")).toBe(
      "Deepseek 4.1 Flash",
    );
    expect(optimizeCodexModelDisplayName("grok-4.7")).toBe("Grok 4.7");
    expect(optimizeCodexModelDisplayName("grok-imagine-image-2.0")).toBe(
      "Grok Imagine Image 2.0",
    );
  });

  it("leaves an already optimized name unchanged", () => {
    expect(optimizeCodexModelDisplayName("Grok 4.7")).toBe("Grok 4.7");
  });
});
