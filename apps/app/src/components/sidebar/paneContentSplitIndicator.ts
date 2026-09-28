import { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  computePaneRects,
  countPanes,
  findPaneByContent,
  listPanes,
  type PaneContent,
  type PaneRect,
  type SplitLayout,
} from "@/lib/split-layout";

export interface MiniMapSlot {
  paneId: string;
  rect: PaneRect;
  isMe: boolean;
  isFocused: boolean;
}

interface PaneContentSplitIndicator {
  isOpenInSplit: boolean;
  miniMap: MiniMapSlot[] | null;
}

const NO_INDICATOR: PaneContentSplitIndicator = {
  isOpenInSplit: false,
  miniMap: null,
};

const NULL_LAYOUT_ATOM = atom<SplitLayout | null>(null);
const MULTI_PANE_LAYOUT_ATOM = atom((get) => {
  const layout = get(splitLayoutAtom);
  return layout !== null && countPanes(layout.root) > 1 ? layout : null;
});

function useSplitLayoutForIndicator(enabled: boolean): {
  layout: SplitLayout | null;
  isCompact: boolean;
} {
  const isCompact = useIsCompactViewport();
  const layout = useAtomValue(
    enabled && !isCompact ? MULTI_PANE_LAYOUT_ATOM : NULL_LAYOUT_ATOM,
  );
  return { layout, isCompact };
}

export interface ThreadSplitIndicatorTarget {
  id: string;
  projectId: string;
}

function buildSplitIndicator(
  layout: SplitLayout,
  matchingPaneIds: ReadonlySet<string>,
): PaneContentSplitIndicator {
  if (matchingPaneIds.size === 0) {
    return NO_INDICATOR;
  }
  const rects = computePaneRects(layout.root);
  const miniMap: MiniMapSlot[] = listPanes(layout.root).flatMap((entry) => {
    const rect = rects.get(entry.paneId);
    return rect === undefined
      ? []
      : [
          {
            paneId: entry.paneId,
            rect,
            isMe: matchingPaneIds.has(entry.paneId),
            isFocused: entry.paneId === layout.focusedPaneId,
          },
        ];
  });
  return {
    isOpenInSplit: true,
    miniMap,
  };
}

const NO_INDICATOR_ATOM = atom(NO_INDICATOR);

export function usePaneContentSplitIndicator(
  content: PaneContent,
  enabled: boolean,
): PaneContentSplitIndicator {
  const isCompact = useIsCompactViewport();
  const indicatorAtom = useMemo(
    () =>
      atom((get) => {
        const layout = get(MULTI_PANE_LAYOUT_ATOM);
        if (layout === null) return NO_INDICATOR;
        const pane = findPaneByContent(layout.root, content);
        return pane === null
          ? NO_INDICATOR
          : buildSplitIndicator(layout, new Set([pane.paneId]));
      }),
    [content],
  );
  return useAtomValue(
    enabled && !isCompact ? indicatorAtom : NO_INDICATOR_ATOM,
  );
}

export function useThreadGroupSplitIndicator(
  threads: readonly ThreadSplitIndicatorTarget[],
  enabled: boolean,
): PaneContentSplitIndicator {
  const { layout, isCompact } = useSplitLayoutForIndicator(enabled);

  return useMemo<PaneContentSplitIndicator>(() => {
    if (
      !enabled ||
      threads.length === 0 ||
      layout === null ||
      isCompact ||
      countPanes(layout.root) < 2
    ) {
      return NO_INDICATOR;
    }
    const threadKeys = new Set(
      threads.map((thread) => `${thread.projectId}\0${thread.id}`),
    );
    const matchingPaneIds = new Set<string>();
    for (const pane of listPanes(layout.root)) {
      if (
        pane.content.kind === "thread" &&
        threadKeys.has(`${pane.content.projectId}\0${pane.content.threadId}`)
      ) {
        matchingPaneIds.add(pane.paneId);
      }
    }
    return buildSplitIndicator(layout, matchingPaneIds);
  }, [enabled, isCompact, layout, threads]);
}
