import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";

const Panels = ({ innerOpen }: { innerOpen: boolean }) => (
  <>
    <FullScreenPanel isOpen title="Outer" onClose={() => undefined}>
      outer
    </FullScreenPanel>
    <FullScreenPanel isOpen={innerOpen} title="Inner" onClose={() => undefined}>
      inner
    </FullScreenPanel>
  </>
);

describe("FullScreenPanel body scroll locking", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("opts into pane scrolling without changing the default page scroll behavior", () => {
    const { rerender } = render(
      <FullScreenPanel isOpen title="Test" onClose={() => undefined}>
        <span>Content</span>
      </FullScreenPanel>,
    );
    expect(
      screen.getByText("Content").parentElement?.parentElement,
    ).toHaveClass("overflow-y-auto");
    rerender(
      <FullScreenPanel
        isOpen
        title="Test"
        scrollMode="contained"
        contentClassName="h-full"
        onClose={() => undefined}
      >
        <span>Content</span>
      </FullScreenPanel>,
    );
    expect(
      screen.getByText("Content").parentElement?.parentElement,
    ).toHaveClass("overflow-hidden", "min-h-0");
    expect(screen.getByText("Content").parentElement).toHaveClass("h-full");
  });

  it("keeps the body locked when a nested panel closes", () => {
    document.body.style.overflow = "clip";
    const view = render(<Panels innerOpen />);

    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<Panels innerOpen={false} />);
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();
    expect(document.body.style.overflow).toBe("clip");
  });
});
