// @vitest-environment jsdom

import { afterEach, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import {
  applyPluginCss,
  retainPluginCss,
  resetPluginCssForTest,
} from "./plugin-css";

const slowScope =
  ':where([data-bb-plugin="example"], [data-bb-plugin-root]:not([data-bb-plugin]))';

function loadSheet(css?: string) {
  applyPluginCss("example", "/example.css");
  retainPluginCss("example");
  const link = document.querySelector<HTMLLinkElement>(
    'link[data-bb-plugin-css="example"]',
  )!;
  const style = document.createElement("style");
  style.textContent =
    css ??
    `${slowScope} .item { color: rgb(255, 0, 0); } ${slowScope}.item { color: rgb(255, 0, 0); }`;
  document.head.append(style);
  Object.defineProperty(link, "sheet", { value: style.sheet });
  link.dispatchEvent(new Event("load"));
  return style.sheet!;
}

afterEach(() => {
  resetPluginCssForTest();
  document.head.querySelectorAll("style").forEach((style) => style.remove());
  document.body.replaceChildren();
});

it("rejects unrelated plugin roots with a distinct selector while preserving root and descendant styles", () => {
  document.body.innerHTML =
    '<div data-bb-plugin-root data-bb-plugin="example" class="item"><span class="item">owned</span></div><div data-bb-plugin-root data-bb-plugin="other"><span class="item">unrelated</span></div>';
  const sheet = loadSheet();
  const owned = document.querySelector('[data-bb-plugin="example"]')!;
  expect(owned.hasAttribute("data-bb-plugin-scope-example")).toBe(true);
  expect(sheet.cssRules[0]!.cssText).not.toContain("data-bb-plugin-root");
  expect(getComputedStyle(owned).color).toBe("rgb(255, 0, 0)");
  expect(getComputedStyle(owned.firstElementChild!).color).toBe(
    "rgb(255, 0, 0)",
  );
  expect(
    getComputedStyle(document.querySelector('[data-bb-plugin="other"] .item')!)
      .color,
  ).not.toBe("rgb(255, 0, 0)");
});

it("preserves styles for later named and legacy anonymous portal roots", async () => {
  loadSheet();
  document.body.innerHTML =
    '<div data-bb-plugin-root data-bb-plugin="example" class="item">named</div><div data-bb-plugin-root class="item">legacy</div>';
  await waitFor(() => {
    for (const root of document.body.children) {
      expect(root.hasAttribute("data-bb-plugin-scope-example")).toBe(true);
      expect(getComputedStyle(root).color).toBe("rgb(255, 0, 0)");
    }
  });
  const legacy = document.body.lastElementChild!;
  legacy.setAttribute("data-bb-plugin", "other");
  await waitFor(() =>
    expect(legacy.hasAttribute("data-bb-plugin-scope-example")).toBe(false),
  );
});

it("preserves utility specificity against later application styles", () => {
  document.body.innerHTML = '<div data-bb-plugin-root data-bb-plugin="example"><span class="item">ordinary</span></div>';
  loadSheet(`${slowScope} .item { color: rgb(255, 0, 0); } .item { color: rgb(0, 0, 255); }`);
  expect(getComputedStyle(document.querySelector("span")!).color).toBe("rgb(0, 0, 255)");
});

it("styles descendants added to existing plugin roots and stops styling moved content", async () => {
  document.body.innerHTML =
    '<div data-bb-plugin-root data-bb-plugin="example"></div><div id="outside"></div>';
  loadSheet();
  const item = document.createElement("span");
  item.className = "item";
  document.querySelector("[data-bb-plugin-root]")!.append(item);
  await waitFor(() =>
    expect(getComputedStyle(item).color).toBe("rgb(255, 0, 0)"),
  );
  document.querySelector("#outside")!.append(item);
  await waitFor(() =>
    expect(getComputedStyle(item).color).not.toBe("rgb(255, 0, 0)"),
  );
});
