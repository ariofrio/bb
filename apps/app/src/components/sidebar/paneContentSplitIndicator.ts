import { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
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

export function indicatorSplitLayoutAtom(
  enabled: boolean,
  isCompact: boolean,
): typeof NULL_LAYOUT_ATOM | typeof splitLayoutAtom {
  return enabled && !isCompact ? splitLayoutAtom : NULL_LAYOUT_ATOM;
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

export function resolvePaneContentSplitIndicator({
  content,
  enabled,
  isCompact,
  layout,
}: {
  content: PaneContent;
  enabled: boolean;
  isCompact: boolean;
  layout: SplitLayout | null;
}): PaneContentSplitIndicator {
  if (!enabled || layout === null || isCompact || countPanes(layout.root) < 2) {
    return NO_INDICATOR;
  }
  const pane = findPaneByContent(layout.root, content);
  if (pane === null) {
    return NO_INDICATOR;
  }
  return buildSplitIndicator(layout, new Set([pane.paneId]));
}

function sameMiniMapSlot(a: MiniMapSlot, b: MiniMapSlot): boolean {
  return (
    a.paneId === b.paneId &&
    a.isMe === b.isMe &&
    a.isFocused === b.isFocused &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.w === b.rect.w &&
    a.rect.h === b.rect.h
  );
}

function sameSplitIndicator(
  a: PaneContentSplitIndicator,
  b: PaneContentSplitIndicator,
): boolean {
  if (a === b) return true;
  if (a.isOpenInSplit !== b.isOpenInSplit) return false;
  if (a.miniMap === null || b.miniMap === null) return a.miniMap === b.miniMap;
  return (
    a.miniMap.length === b.miniMap.length &&
    a.miniMap.every((slot, index) => {
      const other = b.miniMap?.[index];
      return other !== undefined && sameMiniMapSlot(slot, other);
    })
  );
}

export function usePaneContentSplitIndicator(
  content: PaneContent,
  enabled: boolean,
): PaneContentSplitIndicator {
  const isCompact = useIsCompactViewport();
  const indicatorAtom = useMemo(
    () =>
      selectAtom(
        indicatorSplitLayoutAtom(enabled, isCompact),
        (layout) =>
          resolvePaneContentSplitIndicator({
            content,
            enabled,
            isCompact,
            layout,
          }),
        sameSplitIndicator,
      ),
    [content, enabled, isCompact],
  );
  return useAtomValue(indicatorAtom);
}
