import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import type { Provider } from "@/types";
import {
  CodexRoutingProviderEditor,
  type RoutingProviderEditorTarget,
} from "@/components/proxy/CodexRoutingProviderEditor";
const fetchModels = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/model-fetch", () => ({ fetchModelsForConfig: fetchModels }));
function provider(): Provider {
  return {
    id: "station",
    name: "测试站",
    settingsConfig: {
      auth: { OPENAI_API_KEY: "fixture-key" },
      config:
        'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://fixture.example/v1"',
      modelCatalog: {
        models: [
          {
            model: "old",
            displayName: "模型一",
            contextWindow: 128000,
            reasoningLevels: ["low", "high"],
            defaultReasoningLevel: "high",
            supportsParallelToolCalls: true,
            baseInstructions: "Fixture identity",
            inputModalities: ["text", "image"],
          },
          { model: "other", contextWindow: 256000 },
        ],
      },
    },
    meta: { customUserAgent: "fixture-agent", isFullUrl: true },
  };
}
function mount(
  mode: RoutingProviderEditorTarget["mode"],
  options: { model?: boolean; last?: boolean; error?: boolean } = {},
) {
  const station = provider();
  const onSave = options.error
    ? vi.fn().mockRejectedValue(new Error("保存失败"))
    : vi.fn().mockResolvedValue({
        provider: station,
        config: { models: [] },
        affectsLive: false,
      });
  const onClose = vi.fn();
  const model = options.model
    ? station.settingsConfig.modelCatalog.models[0]
    : undefined;
  render(
    <CodexRoutingProviderEditor
      target={{ provider: station, mode, model }}
      referenced={Boolean(model)}
      lastLiveModel={Boolean(options.last)}
      pending={false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { station, onSave, onClose };
}
describe("router provider quick editor", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    i18n.addResourceBundle(
      "zh",
      "translation",
      {
        codexRouting: zh.codexRouting,
        codexConfig: zh.codexConfig,
        common: zh.common,
        providerForm: zh.providerForm,
      },
      true,
      true,
    );
    fetchModels.mockReset().mockResolvedValue([
      { id: "old", ownedBy: null },
      { id: "new", ownedBy: null },
      { id: "new", ownedBy: null },
    ]);
  });
  it("renames only the provider name without sending credentials or route drafts", async () => {
    const { onSave, onClose } = mount("name");
    fireEvent.change(screen.getByLabelText("供应商名称"), {
      target: { value: "新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({
      providerId: "station",
      expectedName: "测试站",
      name: "新名称",
    });
  });
  it("shares all model fields and preserves hidden metadata when changing context or ID", async () => {
    const { station, onSave } = mount("model", { model: true });
    fireEvent.change(screen.getByLabelText("实际请求模型"), {
      target: { value: "renamed" },
    });
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "200000" },
    });
    expect(
      screen.getByText(zh.codexRouting.quick.renameHint),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual({
      providerId: "station",
      expectedCatalog: station.settingsConfig.modelCatalog,
      rename: { from: "old", to: "renamed" },
      models: [
        {
          ...station.settingsConfig.modelCatalog.models[0],
          model: "renamed",
          contextWindow: 200000,
        },
        station.settingsConfig.modelCatalog.models[1],
      ],
    });
  });
  it("allows editing the reasoning list with the shared default-level editor", async () => {
    const { onSave } = mount("model", { model: true });
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "max" }));
    fireEvent.keyDown(
      screen.getByPlaceholderText(zh.codexConfig.reasoningLevelsSearch),
      { key: "Escape" },
    );
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].models[0].reasoningLevels).toEqual([
      "low",
      "high",
      "max",
    ]);
    expect(onSave.mock.calls[0][0].models[0].defaultReasoningLevel).toBe(
      "high",
    );
  });
  it("fetches with this provider and only adds explicitly checked new models", async () => {
    const { station, onSave } = mount("fetch");
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeDisabled();
    expect(boxes[0]).toBeChecked();
    expect(
      screen.getByRole("button", { name: "添加所选模型（0）" }),
    ).toBeDisabled();
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "添加所选模型（1）" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(fetchModels).toHaveBeenCalledWith(
      "https://fixture.example/v1",
      "fixture-key",
      true,
      undefined,
      "fixture-agent",
    );
    expect(onSave.mock.calls[0][0].models).toEqual([
      ...station.settingsConfig.modelCatalog.models,
      { model: "new" },
    ]);
  });
  it("requires explicit deletion confirmation and blocks deleting the only active route", () => {
    const { onSave } = mount("model", { model: true, last: true });
    fireEvent.click(screen.getByRole("button", { name: "删除模型映射" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      zh.codexRouting.quick.lastModel,
    );
    expect(screen.getByRole("button", { name: "确认删除映射" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("deletes only the targeted mapping after explaining route-reference removal", async () => {
    const { station, onSave } = mount("model", { model: true });
    fireEvent.click(screen.getByRole("button", { name: "删除模型映射" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      zh.codexRouting.quick.deleteReferenced,
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除映射" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].models).toEqual([
      station.settingsConfig.modelCatalog.models[1],
    ]);
  });
  it("keeps failed edits open and validates duplicate IDs before saving", async () => {
    const { onSave, onClose } = mount("model", { model: true, error: true });
    fireEvent.change(screen.getByLabelText("实际请求模型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      zh.codexRouting.quick.duplicateModel,
    );
    fireEvent.change(screen.getByLabelText("实际请求模型"), {
      target: { value: "new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("dialog")).getByLabelText("实际请求模型"),
    ).toHaveValue("new");
  });
});
