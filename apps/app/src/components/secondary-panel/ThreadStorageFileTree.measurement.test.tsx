// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import "@pierre/trees/web-components";
import { FileTree as FileTreeModel } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
import { cleanup, render } from "@testing-library/react";

let observed: Element | undefined;
let callback: ResizeObserverCallback;
const disconnect = vi.fn();
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("measures the file-tree scrollbar after layout and releases detached measurements", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: ResizeObserverCallback) {
        callback = fn;
      }
      observe(element: Element) {
        observed = element;
      }
      disconnect = disconnect;
    },
  );
  const offsetRead = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
  const clientRead = vi.spyOn(Element.prototype, "clientWidth", "get");
  const host = document.createElement("file-tree-container");
  document.body.append(host);
  expect(offsetRead).not.toHaveBeenCalled();
  expect(clientRead).not.toHaveBeenCalled();
  expect(observed).toBeDefined();
  callback(
    [
      {
        target: observed!,
        borderBoxSize: [{ inlineSize: 100, blockSize: 100 }],
        contentRect: new DOMRect(0, 0, 85, 100),
        contentBoxSize: [{ inlineSize: 85, blockSize: 100 }],
        devicePixelContentBoxSize: [{ inlineSize: 85, blockSize: 100 }],
      },
    ],
    {} as ResizeObserver,
  );
  expect(
    host.shadowRoot?.querySelector("[data-file-tree-scrollbar-gutter-measured]")
      ?.textContent,
  ).toContain("15px");
  expect(
    host.shadowRoot?.querySelector("[data-file-tree-scrollbar-measure]"),
  ).toBeNull();
  const second = document.createElement("file-tree-container");
  document.body.append(second);
  disconnect.mockClear();
  second.remove();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it("waits for observed file-tree viewport dimensions on mount", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
  const model = new FileTreeModel({ paths: ["example.ts"], search: false });
  const view = render(<FileTree model={model} />);
  expect(measure).not.toHaveBeenCalled();
  view.unmount();
});
