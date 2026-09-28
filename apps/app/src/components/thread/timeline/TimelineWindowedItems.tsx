import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import {
  defaultRangeExtractor,
  observeElementRect,
  elementScroll,
  useVirtualizer,
  type Range,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  DEFAULT_WINDOWING_MIN_ITEM_COUNT,
  recordTimelineMeasurement,
  type TimelineWindowedItemsProps,
} from "./TimelineWindowedItemsLoader.js";

const TIMELINE_WINDOW_OVERSCAN_ITEMS = 2;
const TIMELINE_WINDOW_MAX_INTERACTION_PINS = 24;

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();
const GET_NO_SCROLL_ELEMENT = () => null;
const NOOP_ITEM_REF = () => {};

const observeTimelineScrollRect: typeof observeElementRect = (
  instance,
  callback,
) => {
  if (typeof ResizeObserver === "undefined")
    return observeElementRect(instance, callback);
  const element = instance.scrollElement;
  if (element === null) return;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== element) continue;
      const box = entry.borderBoxSize[0];
      callback({
        width: Math.round(box?.inlineSize ?? entry.contentRect.width),
        height: Math.round(box?.blockSize ?? entry.contentRect.height),
      });
    }
  });
  observer.observe(element, { box: "border-box" });
  return () => observer.disconnect();
};

function measureBorderBox(
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
): number {
  const observedHeight = entry?.borderBoxSize[0]?.blockSize;
  return observedHeight ?? element.getBoundingClientRect().height;
}

function findOwnedWindowKey(
  target: EventTarget | null,
  container: HTMLElement,
  indexByKey: ReadonlyMap<string, number>,
): string | null {
  let element = target instanceof Element ? target : null;
  while (element !== null && element !== container) {
    const key = element.getAttribute("data-timeline-window-key");
    if (key !== null && indexByKey.has(key)) return key;
    element = element.parentElement;
  }
  return null;
}

export function TimelineWindowedItems({
  alwaysMountedKeys = EMPTY_KEY_SET,
  estimateItemHeight,
  gap,
  getScrollElement,
  itemKeys,
  initialScrollAnchor,
  measurements,
  minItemCount = DEFAULT_WINDOWING_MIN_ITEM_COUNT,
  renderItem,
}: TimelineWindowedItemsProps) {
  const bottomAnchor = useBottomAnchoredScroll();
  const configured =
    itemKeys.length >= minItemCount && getScrollElement !== null;
  const [scrollRootUsable, setScrollRootUsable] = useState(true);
  const [, refreshScrollRoot] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [interactionPins, setInteractionPins] = useState<readonly string[]>([]);
  const containerElementRef = useRef<HTMLDivElement>(null);
  const windowingEnabled = configured && scrollRootUsable;
  const resolvedGetScrollElement = getScrollElement ?? GET_NO_SCROLL_ELEMENT;

  const indexByKey = useMemo(
    () => new Map(itemKeys.map((key, index) => [key, index])),
    [itemKeys],
  );
  const forcedIndexes = useMemo(() => {
    const indexes = new Set<number>();
    for (const key of alwaysMountedKeys) {
      const index = indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    }
    for (const key of interactionPins) {
      const index = indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    }
    return indexes;
  }, [alwaysMountedKeys, indexByKey, interactionPins]);

  const getItemKey = useCallback(
    (index: number) => itemKeys[index] ?? index,
    [itemKeys],
  );
  const estimateSize = useCallback(
    (index: number) => {
      const key = itemKeys[index];
      return key === undefined
        ? Math.max(1, estimateItemHeight(index))
        : (measurements.get(key) ?? Math.max(1, estimateItemHeight(index)));
    },
    [estimateItemHeight, itemKeys, measurements],
  );
  const measureElement = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
    ): number => {
      const index = Number(element.dataset.index);
      if (entry === undefined && typeof ResizeObserver !== "undefined") {
        return estimateSize(index);
      }
      const height = measureBorderBox(element, entry);
      const key = Number.isInteger(index) ? itemKeys[index] : undefined;
      if (
        key !== undefined &&
        height > 0 &&
        element.dataset.timelineWindowedRealized === "true"
      ) {
        recordTimelineMeasurement(measurements, key, height);
      }
      return height > 0 ? height : estimateSize(index);
    },
    [estimateSize, itemKeys, measurements],
  );
  const virtualizerRef = useRef<Virtualizer<
    HTMLElement,
    HTMLDivElement
  > | null>(null);
  const rangeExtractor = (range: Range) => {
    const instance = virtualizerRef.current;
    if (
      instance &&
      bottomAnchor?.isAtBottom &&
      resolvedGetScrollElement() === bottomAnchor.getScrollElement()
    ) {
      const measured = instance.measurementsCache;
      const last = measured.at(-1);
      if (last) {
        const viewportStart =
          last.end - (instance.scrollRect?.height ?? window.innerHeight);
        let startIndex = last.index;
        while (startIndex > 0 && measured[startIndex - 1]!.end >= viewportStart)
          startIndex -= 1;
        range = { ...range, startIndex, endIndex: last.index };
      }
    }
    const indexes = new Set(defaultRangeExtractor(range));
    for (const index of forcedIndexes) indexes.add(index);
    return [...indexes].sort((left, right) => left - right);
  };
  const initialOffset = useCallback(() => {
    if (initialScrollAnchor === undefined)
      return resolvedGetScrollElement()?.scrollTop ?? 0;
    const index = indexByKey.get(initialScrollAnchor.key);
    if (index === undefined) return 0;
    let offset = 0;
    for (let item = 0; item < index; item += 1)
      offset += estimateSize(item) + gap;
    if (initialScrollAnchor.align === "end")
      offset +=
        estimateSize(index) -
        (typeof window === "undefined" ? 0 : window.innerHeight);
    return Math.max(0, offset);
  }, [
    estimateSize,
    gap,
    indexByKey,
    initialScrollAnchor,
    resolvedGetScrollElement,
  ]);

  const initialScrollWritePendingRef = useRef(false);
  const observeScrollRect = useCallback<typeof observeElementRect>(
    (instance, callback) => {
      initialScrollWritePendingRef.current = true;
      return observeTimelineScrollRect(instance, callback);
    },
    [],
  );
  const scrollToFn = useCallback<typeof elementScroll>(
    (offset, options, instance) => {
      const isInitialWrite = initialScrollWritePendingRef.current;
      initialScrollWritePendingRef.current = false;
      if (
        isInitialWrite &&
        options.adjustments === undefined &&
        options.behavior === undefined
      )
        return;
      elementScroll(offset, options, instance);
    },
    [],
  );

  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: itemKeys.length,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    enabled: windowingEnabled,
    estimateSize,
    gap,
    getItemKey,
    getScrollElement: resolvedGetScrollElement,
    initialOffset,
    initialRect: {
      width: 0,
      height: typeof window === "undefined" ? 0 : window.innerHeight,
    },
    measureElement,
    observeElementRect: observeScrollRect,
    scrollToFn,
    overscan: TIMELINE_WINDOW_OVERSCAN_ITEMS,
    rangeExtractor,
    scrollMargin,
    useFlushSync: false,
    useAnimationFrameWithResizeObserver: true,
  });
  virtualizerRef.current = virtualizer;
  const containerRef = useComposedRefs(
    containerElementRef,
    virtualizer.containerRef,
  );

  const refreshGeometryRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!configured) return;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    const updateMargin = (margin: number) => {
      setScrollMargin((previous) =>
        Math.abs(previous - margin) < 0.5 ? previous : margin,
      );
    };
    const connect = () => {
      const scrollElement = resolvedGetScrollElement();
      const container = containerElementRef.current;
      if (scrollElement === null || container === null) {
        frame = requestAnimationFrame(connect);
        return;
      }
      refreshScrollRoot((revision) => revision + 1);
      if (
        typeof IntersectionObserver === "undefined" ||
        typeof ResizeObserver === "undefined"
      ) {
        const measure = () => {
          setScrollRootUsable(scrollElement.clientHeight > 0);
          updateMargin(
            container.getBoundingClientRect().top -
              scrollElement.getBoundingClientRect().top +
              scrollElement.scrollTop -
              scrollElement.clientTop,
          );
        };
        refreshGeometryRef.current = measure;
        measure();
        return;
      }
      const scrollContent = scrollElement.firstElementChild ?? container;
      const positionTargets = new Set([container, scrollContent]);
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          let listEntry: IntersectionObserverEntry | undefined;
          let contentEntry: IntersectionObserverEntry | undefined;
          for (const entry of entries) {
            if (entry.target === container) listEntry = entry;
            if (entry.target === scrollContent) contentEntry = entry;
          }
          if (
            listEntry &&
            contentEntry &&
            listEntry.time === contentEntry.time
          ) {
            updateMargin(
              listEntry.boundingClientRect.top -
                contentEntry.boundingClientRect.top,
            );
          }
        },
        { root: scrollElement },
      );
      const observePosition = () => {
        for (const target of positionTargets) {
          intersectionObserver?.unobserve(target);
          intersectionObserver?.observe(target);
        }
      };
      refreshGeometryRef.current = observePosition;
      observePosition();
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === scrollElement)
            setScrollRootUsable(entry.contentRect.height > 0);
        }
        observePosition();
      });
      resizeObserver.observe(scrollElement);
      if (container.parentElement !== null)
        resizeObserver.observe(container.parentElement);
    };
    connect();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      refreshGeometryRef.current = null;
    };
  }, [configured, resolvedGetScrollElement]);

  useLayoutEffect(() => {
    refreshGeometryRef.current?.();
  });

  const retainInteractedItem = useCallback(
    (event: SyntheticEvent<HTMLDivElement>) => {
      const container = containerElementRef.current;
      if (container === null) return;
      const key = findOwnedWindowKey(event.target, container, indexByKey);
      if (key === null) return;
      setInteractionPins((previous) => {
        const next = previous.filter((candidate) => candidate !== key);
        next.push(key);
        return next.slice(-TIMELINE_WINDOW_MAX_INTERACTION_PINS);
      });
    },
    [indexByKey],
  );

  const virtualItemsByIndex = new Map(
    virtualizer.getVirtualItems().map((item) => [item.index, item]),
  );
  for (const index of forcedIndexes) {
    const item = virtualizer.measurementsCache[index];
    if (item !== undefined) virtualItemsByIndex.set(index, item);
  }
  const virtualItems = [...virtualItemsByIndex.values()].sort(
    (left, right) => left.index - right.index,
  );
  const renderWindow = windowingEnabled && virtualizer.range !== null;
  const indexes = renderWindow
    ? virtualItems.map((item) => item.index)
    : itemKeys.map((_, index) => index);
  useEffect(() => {
    if (renderWindow) return;
    const container = containerElementRef.current;
    if (container === null) return;
    const items = [...container.children].filter(
      (element): element is HTMLDivElement =>
        element instanceof HTMLDivElement &&
        element.dataset.index !== undefined,
    );
    const recordHeight = (element: HTMLDivElement, height: number) => {
      const index = Number(element.dataset.index);
      const key = Number.isInteger(index) ? itemKeys[index] : undefined;
      if (key !== undefined && height > 0) {
        recordTimelineMeasurement(measurements, key, height);
      }
    };
    if (typeof ResizeObserver === "undefined") {
      const frame = requestAnimationFrame(() => {
        for (const item of items) {
          recordHeight(item, item.getBoundingClientRect().height);
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLDivElement) {
          recordHeight(entry.target, measureBorderBox(entry.target, entry));
        }
      }
    });
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, [itemKeys, measurements, renderWindow]);
  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={renderWindow ? undefined : { display: "contents" }}
      data-timeline-items=""
      data-timeline-virtual-spacer={renderWindow ? "" : undefined}
      onClickCapture={retainInteractedItem}
      onFocusCapture={retainInteractedItem}
    >
      {indexes.map((index) =>
        renderItem(index, {
          isRealized: true,
          itemIndex: index,
          itemRef: renderWindow ? virtualizer.measureElement : NOOP_ITEM_REF,
          itemStyle: renderWindow
            ? { position: "absolute", left: 0, width: "100%" }
            : undefined,
          windowingEnabled: renderWindow,
        }),
      )}
    </div>
  );
}
