// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useElementWidth } from "./useElementWidth";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("uses resize entries without reading layout during mount or resize", () => {
  let resizeCallback: ResizeObserverCallback | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  function WidthProbe() {
    const { ref, width } = useElementWidth();
    return (
      <div ref={ref} data-testid="width-probe">
        {width}
      </div>
    );
  }

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => {
      throw new Error("forced layout");
    },
  );
  const view = render(<WidthProbe />);
  const element = view.getByTestId("width-probe");
  const resized = (inlineSize: number): ResizeObserverEntry => ({
    target: element,
    contentRect: new DOMRect(0, 0, inlineSize, 20),
    borderBoxSize: [{ inlineSize, blockSize: 20 }],
    contentBoxSize: [{ inlineSize, blockSize: 20 }],
    devicePixelContentBoxSize: [],
  });

  act(() => resizeCallback?.([resized(320)], {} as ResizeObserver));
  expect(element.textContent).toBe("320");
  act(() => resizeCallback?.([resized(280)], {} as ResizeObserver));
  expect(element.textContent).toBe("280");
});
