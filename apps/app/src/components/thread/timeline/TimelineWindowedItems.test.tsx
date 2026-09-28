// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineWindowedItems } from "./TimelineWindowedItems.js";
import {
  TimelineWindowedItemsLoader,
  type TimelineWindowedItemRenderState,
} from "./TimelineWindowedItemsLoader.js";

const bottomAnchorState = vi.hoisted(() => ({ pinned: false, nested: false }));
vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: () =>
    bottomAnchorState.pinned
      ? {
          isAtBottom: true,
          getScrollElement: () =>
            bottomAnchorState.nested ? document.body : scrollElement,
        }
      : null,
}));

const ITEM_KEYS = Array.from({ length: 100 }, (_, index) => `row-${index}`);

let scrollElement: HTMLDivElement;
let itemHeights = new Map<number, number>();

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function resizeEntry(target: Element, height: number): ResizeObserverEntry {
  const size = { blockSize: height, inlineSize: 320 };
  return {
    target,
    borderBoxSize: [size],
    contentBoxSize: [size],
    contentRect: rect(0, height),
    devicePixelContentBoxSize: [size],
  };
}

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];
  readonly observed = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }
  disconnect(): void {
    this.observed.clear();
  }
  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
}

function observeScrollHeight(height: number) {
  act(() => {
    for (const observer of [...ResizeObserverStub.instances]) {
      if (observer.observed.has(scrollElement))
        observer.callback([resizeEntry(scrollElement, height)], observer);
    }
  });
}

function renderWindowedItems(options?: {
  alwaysMountedKeys?: ReadonlySet<string>;
  clientHeight?: number;
  measurements?: Map<string, number>;
  onReadViewport?: () => void;
  deferObservation?: boolean;
  initialScrollAnchor?: { key: string; align: "start" | "end" };
  onRender?: (index: number) => void;
}) {
  const measurements = options?.measurements ?? new Map<string, number>();
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: options?.clientHeight ?? 96,
  });
  Object.defineProperty(scrollElement, "offsetHeight", {
    configurable: true,
    get: () => {
      options?.onReadViewport?.();
      return options?.clientHeight ?? 96;
    },
  });
  const rendered = render(
    <TimelineWindowedItems
      alwaysMountedKeys={options?.alwaysMountedKeys}
      initialScrollAnchor={options?.initialScrollAnchor}
      estimateItemHeight={() => 32}
      gap={0}
      getScrollElement={() => scrollElement}
      itemKeys={ITEM_KEYS}
      measurements={measurements}
      renderItem={(index: number, state: TimelineWindowedItemRenderState) => {
        options?.onRender?.(index);
        return (
          <div
            key={ITEM_KEYS[index]}
            ref={state.itemRef}
            data-index={state.itemIndex}
            data-testid={`wrapper-${index}`}
            data-timeline-window-key={ITEM_KEYS[index]}
            data-timeline-windowed-realized={String(state.isRealized)}
            style={state.itemStyle}
          >
            {state.isRealized ? (
              <button type="button" data-testid={`content-${index}`}>
                row {index}
              </button>
            ) : null}
          </div>
        );
      }}
    />,
    { container: scrollElement },
  );
  if (!options?.deferObservation)
    observeScrollHeight(options?.clientHeight ?? 96);
  return { ...rendered, measurements };
}

beforeEach(() => {
  bottomAnchorState.pinned = false;
  bottomAnchorState.nested = false;
  ResizeObserverStub.instances = [];
  itemHeights = new Map();
  scrollElement = document.createElement("div");
  document.body.append(scrollElement);
  Object.defineProperty(scrollElement, "clientWidth", {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(scrollElement, "offsetWidth", {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(scrollElement, "scrollHeight", {
    configurable: true,
    value: 3_200,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) return rect(0, scrollElement.clientHeight);
      if (this.hasAttribute("data-timeline-virtual-spacer")) {
        return rect(
          -scrollElement.scrollTop,
          Number.parseFloat(this.style.height) || 0,
        );
      }
      const index = Number(this.dataset.index);
      if (Number.isInteger(index)) {
        return rect(
          index * 32 - scrollElement.scrollTop,
          itemHeights.get(index) ?? 32,
        );
      }
      return rect(0, Number.parseFloat(this.style.height) || 0);
    },
  );
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TimelineWindowedItems", () => {
  it("waits for observed geometry instead of measuring during a virtualized commit", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const readRect = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    readRect.mockClear();
    const readViewport = vi.fn();
    renderWindowedItems({
      onReadViewport: readViewport,
      deferObservation: true,
    });
    expect(readRect).not.toHaveBeenCalled();
    expect(readViewport).not.toHaveBeenCalled();
  });
  it("keeps the first commit windowed while the scroll root ref is pending", async () => {
    let attachedRoot: HTMLElement | null = null;
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(scrollElement, "offsetHeight", {
      configurable: true,
      value: 96,
    });
    render(
      <TimelineWindowedItems
        estimateItemHeight={() => 32}
        gap={0}
        getScrollElement={() => attachedRoot}
        itemKeys={ITEM_KEYS}
        measurements={new Map()}
        renderItem={(index, state) => (
          <div
            key={ITEM_KEYS[index]}
            ref={state.itemRef}
            data-index={state.itemIndex}
            data-testid={`pending-row-${index}`}
            style={state.itemStyle}
          />
        )}
      />,
      { container: scrollElement },
    );

    expect(screen.getAllByTestId(/^pending-row-/).length).toBeLessThan(60);
    attachedRoot = scrollElement;
    await waitFor(() =>
      expect(
        ResizeObserverStub.instances.some((observer) =>
          observer.observed.has(scrollElement),
        ),
      ).toBe(true),
    );
    observeScrollHeight(96);
    await waitFor(() =>
      expect(screen.getAllByTestId(/^pending-row-/).length).toBeLessThan(30),
    );
    expect(screen.queryByTestId("pending-row-99")).toBeNull();
  });

  it("starts rendering near a saved row before the scroll observer attaches", () => {
    const rendered: number[] = [];
    renderWindowedItems({
      initialScrollAnchor: { key: "row-80", align: "start" },
      onRender: (index) => rendered.push(index),
      deferObservation: true,
    });
    expect(rendered[0]).toBeGreaterThan(70);
  });

  it("does not synchronously measure every row while mounting an unwindowed timeline", () => {
    renderWindowedItems({ clientHeight: 0 });
    observeScrollHeight(0);

    const rectSpy = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const measuredRows = rectSpy.mock.instances.filter(
      (element) =>
        element instanceof HTMLElement &&
        element.hasAttribute("data-timeline-window-key"),
    );
    expect(measuredRows).toHaveLength(0);
  });

  it("captures exact heights before the scrollport becomes usable", () => {
    const measurements = new Map<string, number>();

    render(
      <TimelineWindowedItemsLoader
        estimateItemHeight={() => 100}
        gap={0}
        getScrollElement={() => scrollElement}
        itemKeys={ITEM_KEYS}
        measurements={measurements}
        renderItem={(index, state) => (
          <div
            key={ITEM_KEYS[index]}
            ref={state.itemRef}
            data-index={state.itemIndex}
          />
        )}
      />,
      { container: scrollElement },
    );

    observeScrollHeight(0);
    expect(measurements.size).toBe(0);
    const rowObserver = ResizeObserverStub.instances.find((observer) =>
      [...observer.observed].some((element) =>
        element.hasAttribute("data-index"),
      ),
    );
    expect(rowObserver).toBeDefined();
    const entries = [...rowObserver!.observed].map((target) =>
      resizeEntry(target, 32),
    );
    act(() => rowObserver!.callback(entries, rowObserver!));
    expect(measurements.get("row-0")).toBe(32);
    expect(measurements.get("row-99")).toBe(32);
  });

  it("keeps observed list positions consistent when scroll changes before delivery", async () => {
    const observers: {
      callback: IntersectionObserverCallback;
      targets: Set<Element>;
    }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        targets = new Set<Element>();
        constructor(readonly callback: IntersectionObserverCallback) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    );
    scrollElement.scrollTop = 420;
    renderWindowedItems();
    expect(screen.getByTestId("content-13")).toBeTruthy();
    act(() => {
      for (const observer of observers) {
        observer.callback(
          [...observer.targets].map((target) => ({
            target,
            boundingClientRect: rect(-100, 3200),
            rootBounds: rect(0, 96),
            intersectionRect: rect(0, 96),
            isIntersecting: true,
            intersectionRatio: 0.03,
            time: 0,
          })),
          observer as unknown as IntersectionObserver,
        );
      }
    });
    await waitFor(() => expect(screen.getByTestId("content-13")).toBeTruthy());
    expect(screen.queryByTestId("content-3")).toBeNull();
  });

  it("keeps nested scroll roots independent of the outer bottom anchor", () => {
    bottomAnchorState.pinned = true;
    bottomAnchorState.nested = true;
    renderWindowedItems();
    expect(screen.getByTestId("content-0")).toBeTruthy();
    expect(screen.queryByTestId("content-99")).toBeNull();
  });

  it("retains the bottom viewport while a shrinking row awaits scroll clamping", async () => {
    bottomAnchorState.pinned = true;
    scrollElement.scrollTop = 3424;
    const measurements = new Map([["row-95", 352]]);
    renderWindowedItems({ measurements });
    const row = screen.getByTestId("wrapper-95");
    const observer = ResizeObserverStub.instances.find((candidate) =>
      candidate.observed.has(row),
    )!;
    act(() => observer.callback([resizeEntry(row, 32)], observer));
    await waitFor(() => expect(measurements.get("row-95")).toBe(32));
    expect(screen.getByTestId("wrapper-95")).toBe(row);
    expect(screen.getByTestId("content-99")).toBeTruthy();
  });

  it("does not resize the virtual spacer during ResizeObserver delivery", async () => {
    renderWindowedItems();
    const row = screen.getByTestId("wrapper-0");
    const spacer = scrollElement.querySelector<HTMLElement>(
      "[data-timeline-virtual-spacer]",
    )!;
    const initialHeight = spacer.style.height;
    const observer = ResizeObserverStub.instances.find((candidate) =>
      candidate.observed.has(row),
    )!;
    expect(observer).toBeDefined();
    act(() => observer.callback([resizeEntry(row, 96)], observer));
    expect(spacer.style.height).toBe(initialHeight);
    await waitFor(() => expect(spacer.style.height).not.toBe(initialHeight));
  });

  it("preserves visible row identity when crossing the windowing threshold in either direction", async () => {
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      value: 1_000,
    });
    Object.defineProperty(scrollElement, "offsetHeight", {
      configurable: true,
      value: 1_000,
    });
    const measurements = new Map<string, number>();
    const getScrollElement = () => scrollElement;
    const list = (count: number) => (
      <TimelineWindowedItemsLoader
        estimateItemHeight={() => 100}
        gap={0}
        getScrollElement={getScrollElement}
        itemKeys={ITEM_KEYS.slice(0, count)}
        measurements={measurements}
        renderItem={(index, state) => (
          <div
            key={ITEM_KEYS[index]}
            ref={state.itemRef}
            data-index={state.itemIndex}
            data-timeline-windowed-realized={String(state.isRealized)}
            style={state.itemStyle}
          >
            <input data-testid={`input-${index}`} defaultValue="draft" />
          </div>
        )}
      />
    );
    const view = render(list(19), { container: scrollElement });
    const inputs = screen.getAllByTestId(/^input-/);
    fireEvent.change(inputs[0]!, { target: { value: "unsaved edit" } });
    const rowObserver = ResizeObserverStub.instances.find((observer) =>
      [...observer.observed].some((element) =>
        element.hasAttribute("data-index"),
      ),
    );
    expect(rowObserver).toBeDefined();
    act(() =>
      rowObserver!.callback(
        [...rowObserver!.observed].map((target) => resizeEntry(target, 32)),
        rowObserver!,
      ),
    );

    view.rerender(list(20));
    await waitFor(() =>
      expect(screen.getAllByTestId(/^input-/)).toHaveLength(20),
    );
    const windowedRowObserver = ResizeObserverStub.instances.find((observer) =>
      [...observer.observed].some(
        (element) => element.getAttribute("data-index") === "19",
      ),
    );
    expect(windowedRowObserver).toBeDefined();
    act(() =>
      windowedRowObserver!.callback(
        [...windowedRowObserver!.observed].map((target) =>
          resizeEntry(target, 32),
        ),
        windowedRowObserver!,
      ),
    );
    inputs.forEach((input, index) => {
      expect(screen.getByTestId(`input-${index}`)).toBe(input);
    });
    expect(screen.getByDisplayValue("unsaved edit")).toBe(inputs[0]);
    await waitFor(() =>
      expect(
        scrollElement.querySelector<HTMLElement>(
          "[data-timeline-virtual-spacer]",
        )?.style.height,
      ).toBe("640px"),
    );

    view.rerender(list(19));
    inputs.forEach((input, index) => {
      expect(screen.getByTestId(`input-${index}`)).toBe(input);
    });
    expect(screen.getByDisplayValue("unsaved edit")).toBe(inputs[0]);
    expect(
      scrollElement.querySelector("[data-timeline-virtual-spacer]"),
    ).toBeNull();
  });

  it("mounts only the visible TanStack range and removes offscreen wrappers", async () => {
    renderWindowedItems();

    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());
    expect(screen.getAllByTestId(/^wrapper-/).length).toBeLessThan(30);
    expect(screen.queryByTestId("wrapper-60")).toBeNull();
    expect(
      scrollElement.querySelector<HTMLElement>("[data-timeline-virtual-spacer]")
        ?.style.height,
    ).toBe("3200px");
  });

  it("changes ranges on scroll without retaining the old rich rows", async () => {
    renderWindowedItems();
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());

    scrollElement.scrollTop = 1_600;
    fireEvent.scroll(scrollElement);

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(screen.queryByTestId("wrapper-0")).toBeNull();
  });

  it("does not reapply the existing scroll offset during mount", () => {
    const scrollTo = vi.fn();
    scrollElement.scrollTo = scrollTo;
    scrollElement.scrollTop = 1600;
    renderWindowedItems();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollElement.scrollTop).toBe(1600);
  });

  it("preserves an existing scroll offset when a nested virtualizer mounts", async () => {
    scrollElement.scrollTop = 1_600;

    renderWindowedItems();

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(scrollElement.scrollTop).toBe(1_600);
  });

  it("keeps search and interacted rows mounted outside the visible range", async () => {
    renderWindowedItems({ alwaysMountedKeys: new Set(["row-80"]) });
    await waitFor(() => expect(screen.getByTestId("content-80")).toBeTruthy());
    fireEvent.click(screen.getByTestId("content-0"));

    scrollElement.scrollTop = 1_600;
    fireEvent.scroll(scrollElement);

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(screen.getByTestId("content-0")).toBeTruthy();
    expect(screen.getByTestId("content-80")).toBeTruthy();
  });

  it("keeps visible content mounted during a programmatic scroll jump", async () => {
    vi.useFakeTimers();
    renderWindowedItems();
    await act(async () => {});

    scrollElement.scrollTop = 1_600;
    fireEvent.scroll(scrollElement);
    await act(async () => {});

    expect(
      scrollElement.querySelectorAll(
        '[data-timeline-windowed-realized="false"]',
      ).length,
    ).toBe(0);
    const content = screen.getByTestId("content-50");
    expect(content).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("content-50")).toBe(content);
  });

  it("seeds its size model from measurements retained by the thread", async () => {
    const measurements = new Map<string, number>([["row-50", 64]]);
    renderWindowedItems({ measurements });
    await waitFor(() =>
      expect(
        scrollElement.querySelector<HTMLElement>(
          "[data-timeline-virtual-spacer]",
        )?.style.height,
      ).toBe("3232px"),
    );
  });

  it("renders everything when its scrollport has no usable geometry", async () => {
    renderWindowedItems({ clientHeight: 0 });
    observeScrollHeight(0);

    await waitFor(() =>
      expect(screen.getAllByTestId(/^content-/)).toHaveLength(100),
    );
  });
});
