import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import { CodexModelRoutingDialog } from "@/components/proxy/CodexModelRoutingDialog";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/lib/query/codexModelRouting", () => ({
  useCodexModelRouting: () => ({
    data: {
      enabled: false,
      providerName: "CC Switch Router",
      models: [],
    },
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  }),
  useSaveCodexModelRouting: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));

function provider(id: string): Provider {
  return {
    id,
    name: "A站",
    settingsConfig: {
      auth: { OPENAI_API_KEY: "test" },
      config: "",
      modelCatalog: {
        models: [{ model: "gpt-5.4", reasoningLevels: ["low", "high"] }],
      },
    },
  };
}

describe("CodexModelRoutingDialog", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.refetch.mockReset();
  });

  it("warns about visible-name conflicts and disables the second selection", () => {
    const first = provider("station-a");
    const second = provider("station-b");
    const onEditProvider = vi.fn();

    render(
      <CodexModelRoutingDialog
        open
        active={false}
        providers={{ [first.id]: first, [second.id]: second }}
        onOpenChange={() => undefined}
        onEditProvider={onEditProvider}
      />,
    );

    expect(
      screen.getByText("检测到 1 组相同的供应商名称和模型显示名称"),
    ).toBeInTheDocument();

    const modelButtons = screen.getAllByRole("button", {
      name: "A站 / gpt-5.4",
    });
    fireEvent.click(modelButtons[0]);
    const updatedModelButtons = screen.getAllByRole("button", {
      name: "A站 / gpt-5.4",
    });
    expect(updatedModelButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(updatedModelButtons[1]).toBeDisabled();

    const editButtons = screen.getAllByRole("button", {
      name: "编辑供应商 A站",
    });
    fireEvent.click(editButtons[1]);
    expect(onEditProvider).toHaveBeenCalledWith(second);
  });
});
