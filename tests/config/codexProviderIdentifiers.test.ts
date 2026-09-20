import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { getCodexCustomTemplate } from "@/config/codexTemplates";

describe("Codex default Provider IDs", () => {
  it("every non-official built-in preset uses the shared custom ID", () => {
    for (const preset of codexProviderPresets.filter((p) => !p.isOfficial)) {
      const config = parse(preset.config);
      expect(config.model_provider, preset.name).toBe("custom");
      expect(config.model_providers, preset.name).toHaveProperty("custom");
    }
  });
  it("the custom-provider template also uses custom", () => {
    expect(parse(getCodexCustomTemplate().config).model_provider).toBe(
      "custom",
    );
  });
  it("does not forcibly rewrite the official login preset", () => {
    const preset = codexProviderPresets.find((p) => p.isOfficial)!;
    expect(parse(preset.config).model_provider).toBeUndefined();
  });
});
