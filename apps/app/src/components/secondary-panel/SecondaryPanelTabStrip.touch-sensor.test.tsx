// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SecondaryPanelTabStrip,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";

function makeTabs(count: number): SecondaryPanelTabStripProps["tabs"] {
  return Array.from({ length: count }, (_, index) => ({
    label: `file-${index}.ts`,
    isPinned: false,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab: { id: `tab-${index}`, kind: "new-tab" as const },
  }));
}

function touchMoveCalls(spy: {
  mock: { calls: readonly (readonly unknown[])[] };
}) {
  return spy.mock.calls.filter(([type]) => type === "touchmove");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SecondaryPanelTabStrip touch sensor scoping", () => {
  it("does not scroll the document when the active tab fits in its strip", () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(
      <SecondaryPanelTabStrip
        activeTabId="tab-0"
        tabs={makeTabs(2)}
        onReorderTab={vi.fn()}
        usesDesktopChrome={false}
        isPanelOpen
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals an overflowing active tab using observed bounds", () => {
    let resize: ResizeObserverCallback = () => {};
    let intersect: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    let active: Element;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe(element: Element) {
          active = element;
        }
        disconnect = disconnect;
      },
    );
    const { container, unmount } = render(
      <SecondaryPanelTabStrip
        activeTabId="tab-1"
        tabs={makeTabs(2)}
        onReorderTab={vi.fn()}
        usesDesktopChrome={false}
        isPanelOpen
      />,
    );
    const content = container.querySelector(
      "[data-secondary-panel-tab-content]",
    )!;
    const viewport = content.parentElement!;
    const scrollBy = vi.fn();
    viewport.scrollBy = scrollBy;
    act(() =>
      resize(
        observed.map((target) => ({
          target,
          borderBoxSize: [
            {
              inlineSize:
                target === content ? 300 : target === viewport ? 60 : 100,
              blockSize: 32,
            },
          ],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect: new DOMRect(),
        })),
        {} as ResizeObserver,
      ),
    );
    act(() =>
      intersect(
        [
          {
            target: active,
            boundingClientRect: new DOMRect(80, 0, 30, 32),
            rootBounds: new DOMRect(0, 0, 60, 32),
            intersectionRect: new DOMRect(),
            intersectionRatio: 0,
            isIntersecting: false,
            time: 0,
          },
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(scrollBy).toHaveBeenCalledWith({ left: 50, behavior: "auto" });
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("installs dnd-kit's window touchmove listener only while the panel is open with tabs to reorder, and removes it on close", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const baseProps: SecondaryPanelTabStripProps = {
      activeTabId: "tab-0",
      tabs: makeTabs(2),
      onReorderTab: vi.fn(),
      usesDesktopChrome: false,
      isPanelOpen: false,
    };

    const { rerender } = render(<SecondaryPanelTabStrip {...baseProps} />);
    expect(touchMoveCalls(addSpy)).toHaveLength(0);

    rerender(<SecondaryPanelTabStrip {...baseProps} isPanelOpen />);
    const installs = touchMoveCalls(addSpy);
    expect(installs).toHaveLength(1);
    expect(installs[0]?.[2]).toEqual({ capture: false, passive: false });

    rerender(<SecondaryPanelTabStrip {...baseProps} isPanelOpen={false} />);
    expect(touchMoveCalls(removeSpy)).toHaveLength(1);
    expect(touchMoveCalls(addSpy)).toHaveLength(1);

    rerender(
      <SecondaryPanelTabStrip {...baseProps} tabs={makeTabs(1)} isPanelOpen />,
    );
    expect(touchMoveCalls(addSpy)).toHaveLength(1);
  });
});
