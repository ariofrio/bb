// @vitest-environment jsdom

import { Profiler, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeferredContent } from "./deferred-content";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("realizes content after the urgent mount and resets for a new owner", () => {
  const commits: Array<{ phase: string; text: string | null }> = [];
  const view = (key: string, children: ReactNode) => (
    <Profiler
      id="content"
      onRender={(_, phase) =>
        commits.push({ phase, text: document.body.textContent })
      }
    >
      <DeferredContent key={key}>{children}</DeferredContent>
    </Profiler>
  );
  const rendered = render(view("a", <span>Thread A</span>));
  expect(commits[0]?.text).not.toContain("Thread A");
  expect(rendered.getByText("Thread A")).toBeTruthy();
  commits.length = 0;
  rendered.rerender(view("b", <span>Thread B</span>));
  expect(commits[0]?.text).not.toContain("Thread A");
  expect(commits[0]?.text).not.toContain("Thread B");
  expect(rendered.getByText("Thread B")).toBeTruthy();
});

it.each([false, true])("includes content in static rendering (afterPaint=%s)", (afterPaint) => {
  expect(
    renderToStaticMarkup(
      <DeferredContent afterPaint={afterPaint}>
        <span>Full content</span>
      </DeferredContent>,
    ),
  ).toContain("Full content");
});

it("lets the initial view paint before realizing a secondary panel", () => {
  vi.useFakeTimers();
  const rendered = render(
    <DeferredContent afterPaint>
      <span>Panel</span>
    </DeferredContent>,
  );
  expect(rendered.queryByText("Panel")).toBeNull();
  act(() => vi.advanceTimersToNextFrame());
  expect(rendered.queryByText("Panel")).toBeNull();
  act(() => vi.advanceTimersToNextFrame());
  expect(rendered.getByText("Panel")).toBeTruthy();
});
