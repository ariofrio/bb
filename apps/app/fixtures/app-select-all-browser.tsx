import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppSelectAllController } from "../src/components/AppSelectAllController";
import "../src/app.css";

interface BrowserSelectionResults {
  chrome: string;
  editorPrevented: boolean;
  iframeHandled: boolean;
  main: string;
  mainPrevented: boolean;
  portal: string;
  portalPrevented: boolean;
  shadow: string;
  shadowDrag: string;
  shadowPrevented: boolean;
}

let desktopSelectAll: (() => boolean) | null = null;
Object.defineProperty(window, "bbDesktop", {
  configurable: true,
  value: {
    onSelectAll(listener: () => boolean) {
      desktopSelectAll = listener;
      return () => {};
    },
    platform: "macos",
  },
});

function dispatchPointerDown(target: Element): void {
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      composed: true,
    }),
  );
}

function dispatchSelectAll(target: Element): KeyboardEvent {
  const useMetaForMod = /Mac|iPhone|iPad|iPod/u.test(window.navigator.platform);
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "KeyA",
    composed: true,
    key: "a",
    ctrlKey: !useMetaForMod,
    metaKey: useMetaForMod,
  });
  target.dispatchEvent(event);
  return event;
}

function selectAllFrom(target: Element): { prevented: boolean; text: string } {
  dispatchPointerDown(target);
  const event = dispatchSelectAll(target);
  return {
    prevented: event.defaultPrevented,
    text: window.getSelection()?.toString() ?? "",
  };
}

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}

async function run(): Promise<void> {
  document.body.className = "bb-app-shell";
  const rootElement = document.querySelector("#root");
  if (!(rootElement instanceof HTMLElement)) {
    throw new Error("Missing fixture root");
  }

  createRoot(rootElement).render(createElement(AppSelectAllController));

  const main = document.querySelector("#main-scope");
  const chrome = document.querySelector("#chrome");
  const editor = document.querySelector("#editor");
  const preview = document.querySelector("#preview");
  const pluginPortal = document.querySelector("#plugin-portal");
  const shadowScope = document.querySelector("#shadow-scope");
  const shadowHost = document.querySelector("#shadow-host");
  if (
    !(main instanceof HTMLElement) ||
    !(chrome instanceof HTMLElement) ||
    !(editor instanceof HTMLTextAreaElement) ||
    !(preview instanceof HTMLIFrameElement) ||
    !(pluginPortal instanceof HTMLElement) ||
    !(shadowScope instanceof HTMLElement) ||
    !(shadowHost instanceof HTMLElement)
  ) {
    throw new Error("Missing selection fixture elements");
  }

  const shadowRoot = shadowHost.attachShadow({ mode: "open" });
  shadowRoot.innerHTML =
    "<span>SHADOW FIRST</span><button>SHADOW ACTION</button><span>SHADOW LAST</span>";

  await nextPaint();

  const shadowFirst = shadowRoot.querySelector("span")?.firstChild;
  const shadowLast = shadowRoot.querySelector("span:last-child")?.firstChild;
  if (
    !(shadowFirst instanceof Text) ||
    !(shadowLast instanceof Text) ||
    shadowFirst.parentElement === null
  ) {
    throw new Error("Missing shadow selection endpoints");
  }
  dispatchPointerDown(shadowFirst.parentElement);
  const selection = window.getSelection();
  selection?.setBaseAndExtent(
    shadowFirst,
    0,
    shadowLast,
    shadowLast.data.length,
  );
  const shadowDrag = selection?.toString() ?? "";
  selection?.removeAllRanges();

  const mainSelection = selectAllFrom(main);
  const chromeSelection = selectAllFrom(chrome);
  const portalSelection = selectAllFrom(pluginPortal);
  const shadowSelection = selectAllFrom(shadowScope);
  preview.focus();
  const iframeHandled = desktopSelectAll?.() ?? true;
  const results: BrowserSelectionResults = {
    main: mainSelection.text,
    mainPrevented: mainSelection.prevented,
    portal: portalSelection.text,
    portalPrevented: portalSelection.prevented,
    chrome: chromeSelection.text,
    editorPrevented: dispatchSelectAll(editor).defaultPrevented,
    iframeHandled,
    shadow: shadowSelection.text,
    shadowDrag,
    shadowPrevented: shadowSelection.prevented,
  };

  await fetch("/result", {
    body: JSON.stringify(results),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

void run().catch(async (error: unknown) => {
  await fetch("/error", {
    body: error instanceof Error ? error.stack : String(error),
    method: "POST",
  });
});
