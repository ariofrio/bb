// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "unified";
import { createMarkdownParseCache } from "./markdown-parse-cache";

function countParses(count: () => void): Plugin {
  return function () {
    const parse = this.parser!;
    this.parser = (source, file) => {
      count();
      return parse(source, file);
    };
  };
}

describe("markdown parse cache", () => {
  it("reuses parsing across mounts while isolating transformer mutations", () => {
    const cached = createMarkdownParseCache(1000);
    const count = vi.fn();
    const counter = countParses(count);
    const render = (suffix: string) =>
      renderToStaticMarkup(
        <ReactMarkdown
          remarkPlugins={[
            counter,
            [cached, "plain"],
            () => (tree) => {
              tree.children.push({
                type: "paragraph",
                children: [{ type: "text", value: suffix }],
              });
            },
          ]}
        >
          {"Hello"}
        </ReactMarkdown>,
      );
    expect(render("first")).toBe("<p>Hello</p>\n<p>first</p>");
    expect(render("second")).toBe("<p>Hello</p>\n<p>second</p>");
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("separates parser configurations and evicts the least recently used source", () => {
    const cached = createMarkdownParseCache(6);
    const count = vi.fn();
    const counter = countParses(count);
    const render = (source: string, gfm = false) =>
      renderToStaticMarkup(
        <ReactMarkdown
          remarkPlugins={[
            ...(gfm ? [remarkGfm] : []),
            counter,
            [cached, gfm ? "gfm" : "plain"],
          ]}
        >
          {source}
        </ReactMarkdown>,
      );
    expect(render("~~a~~")).toBe("<p>~~a~~</p>");
    expect(render("~~a~~", true)).toBe("<p><del>a</del></p>");
    render("a");
    render("a");
    expect(count).toHaveBeenCalledTimes(3);
    render("bbb");
    render("~~a~~", true);
    expect(count).toHaveBeenCalledTimes(5);
  });
});
