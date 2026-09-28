// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not resolve panel direction until the resize handle is used", () => {
  const readStyle = vi.spyOn(window, "getComputedStyle");
  const { container } = render(
    <PanelGroup direction="horizontal">
      <Panel defaultSize={50}>Conversation</Panel>
      <PanelResizeHandle />
      <Panel defaultSize={50}>Browser</Panel>
    </PanelGroup>,
  );
  const group = container.querySelector("[data-panel-group]");
  expect(group).not.toBeNull();
  expect(
    readStyle.mock.calls.filter(([element]) => element === group),
  ).toHaveLength(0);
});
