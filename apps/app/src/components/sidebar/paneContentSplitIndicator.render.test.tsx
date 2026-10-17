// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { LayoutNode, PaneContent, SplitLayout } from "@/lib/split-layout";
import { usePaneContentSplitIndicator } from "./paneContentSplitIndicator";

function content(threadId: string): PaneContent {
  return { kind: "thread", projectId: "p1", threadId };
}

function pane(paneId: string, threadId: string): LayoutNode {
  return { type: "pane", paneId, content: content(threadId) };
}

function singlePane(threadId: string): SplitLayout {
  return { root: pane("pane-1", threadId), focusedPaneId: "pane-1" };
}

function twoPanes(left: string, right: string, focused: string): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [pane("pane-1", left), pane("pane-2", right)],
    },
    focusedPaneId: focused,
  };
}

function renderIndicator(threadId: string, layout: SplitLayout) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  const rowContent = content(threadId);
  let renders = 0;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    () => {
      renders += 1;
      return usePaneContentSplitIndicator(rowContent, true);
    },
    { wrapper },
  );
  return { store, hook, renders: () => renders };
}

afterEach(() => {
  window.sessionStorage.clear();
  cleanup();
});

describe("usePaneContentSplitIndicator", () => {
  it("does not re-render a row when navigation changes another thread's pane", () => {
    const { store, hook, renders } = renderIndicator("t9", singlePane("t1"));
    const before = renders();

    act(() => store.set(splitLayoutAtom, singlePane("t2")));
    act(() => store.set(splitLayoutAtom, twoPanes("t2", "t3", "pane-1")));
    act(() => store.set(splitLayoutAtom, twoPanes("t2", "t3", "pane-2")));

    expect(renders()).toBe(before);
    expect(hook.result.current.isOpenInSplit).toBe(false);
  });

  it("re-renders a row when its own pane's split indicator changes", () => {
    const { store, hook } = renderIndicator("t2", singlePane("t2"));
    expect(hook.result.current.isOpenInSplit).toBe(false);

    act(() => store.set(splitLayoutAtom, twoPanes("t1", "t2", "pane-1")));
    expect(
      hook.result.current.miniMap?.map((slot) => [slot.isMe, slot.isFocused]),
    ).toEqual([
      [false, true],
      [true, false],
    ]);

    act(() => store.set(splitLayoutAtom, twoPanes("t1", "t2", "pane-2")));
    expect(
      hook.result.current.miniMap?.map((slot) => [slot.isMe, slot.isFocused]),
    ).toEqual([
      [false, false],
      [true, true],
    ]);
  });
});
