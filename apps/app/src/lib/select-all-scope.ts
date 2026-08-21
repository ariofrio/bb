const SELECT_ALL_SCOPE_SELECTOR = "[data-select-all-scope]";
export const SELECT_ALL_HIGHLIGHT_NAME = "bb-select-all-scope";
const SELECT_ALL_SHADOW_POLICY_MARKER = "bb-select-all-shadow-policy";

const selectAllCopyTextProviders = new WeakMap<HTMLElement, () => string>();

export const SELECTION_CONTROL_SELECTORS = [
  "button",
  "select",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
] as const;

const SELECTION_CONTROL_SELECTOR = SELECTION_CONTROL_SELECTORS.join(", ");

export const SELECT_ALL_SHADOW_POLICY_CSS = `
/* ${SELECT_ALL_SHADOW_POLICY_MARKER} */
:where(${SELECTION_CONTROL_SELECTOR}):not(.select-text) {
  -webkit-user-select: none;
  user-select: none;
}

:where(.sr-only, [aria-hidden="true"]) {
  -webkit-user-select: none;
  user-select: none;
}

::highlight(${SELECT_ALL_HIGHLIGHT_NAME}) {
  background-color: Highlight;
  color: HighlightText;
}
`;

const NON_EDITING_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);
export function closestEventElement(
  target: EventTarget | null,
): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

/**
 * Whether native Select All has useful editor semantics for this target.
 * This is deliberately narrower than the app-command layer's generic
 * editable-target check: buttons and single-select controls stay attached to
 * their surrounding reading scope.
 */
export function isEditableTarget(target: Element | null): boolean {
  if (target === null) return false;
  if (target.closest("select[multiple]") !== null) return true;
  const input = target.closest<HTMLInputElement>("input");
  if (input !== null) return !NON_EDITING_INPUT_TYPES.has(input.type);
  return (
    target.closest(
      'textarea, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

function isEditableSelectionSubtree(element: Element): boolean {
  if (element.matches("select[multiple]")) return true;
  if (element instanceof HTMLInputElement) {
    return !NON_EDITING_INPUT_TYPES.has(element.type);
  }
  return element.matches(
    'textarea, [contenteditable]:not([contenteditable="false"])',
  );
}

export function findSelectAllScopes(
  composedPath: readonly EventTarget[],
): HTMLElement[] {
  const scopes: HTMLElement[] = [];
  for (const target of composedPath) {
    if (
      target instanceof HTMLElement &&
      target.matches(SELECT_ALL_SCOPE_SELECTOR)
    ) {
      scopes.push(target);
    }
  }
  return scopes;
}

export function registerSelectAllCopyText(
  scope: HTMLElement,
  getText: () => string,
): () => void {
  selectAllCopyTextProviders.set(scope, getText);
  return () => {
    if (selectAllCopyTextProviders.get(scope) === getText) {
      selectAllCopyTextProviders.delete(scope);
    }
  };
}

export function getSelectAllCopyText(scope: HTMLElement): string | null {
  return selectAllCopyTextProviders.get(scope)?.() ?? null;
}

export function clearSelectAllHighlight(): void {
  if (typeof CSS !== "undefined") {
    CSS.highlights?.delete(SELECT_ALL_HIGHLIGHT_NAME);
  }
}

function isSkippedSelectionSubtree(element: Element): boolean {
  return (
    (element.matches(SELECTION_CONTROL_SELECTOR) &&
      !element.classList.contains("select-text")) ||
    element.matches(
      'script, style, template, .sr-only, [hidden], [aria-hidden="true"]',
    )
  );
}

function ensureShadowSelectionPolicy(root: ShadowRoot): void {
  // Open shadow trees need their own control exclusions and highlight rule.
  // Install them once when Select All is explicitly invoked; pointer/focus
  // tracking must remain mutation-free on long reading surfaces.
  if (
    Array.from(root.querySelectorAll("style")).some(
      (style) =>
        style.hasAttribute("data-bb-select-all-shadow-policy") ||
        style.textContent?.includes(SELECT_ALL_SHADOW_POLICY_MARKER),
    )
  ) {
    return;
  }
  const style = root.ownerDocument.createElement("style");
  style.dataset.bbSelectAllShadowPolicy = "";
  style.textContent = SELECT_ALL_SHADOW_POLICY_CSS;
  root.append(style);
}

function getComposedChildren(node: Node): readonly Node[] {
  if (node instanceof HTMLSlotElement) {
    const assignedNodes = node.assignedNodes({ flatten: true });
    if (assignedNodes.length > 0) return assignedNodes;
  }
  if (node instanceof Element && node.shadowRoot !== null) {
    return Array.from(node.shadowRoot.childNodes);
  }
  return Array.from(node.childNodes);
}

function isRenderedTextNode(
  node: Text,
  visibilityByParent: WeakMap<Element, boolean>,
): boolean {
  const parent = node.parentElement;
  if (parent === null || typeof parent.checkVisibility !== "function") {
    return true;
  }
  const cached = visibilityByParent.get(parent);
  if (cached !== undefined) return cached;
  const rendered =
    parent.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    }) ||
    parent.ownerDocument.defaultView?.getComputedStyle(parent).display ===
      "contents";
  visibilityByParent.set(parent, rendered);
  return rendered;
}

function getComposedTextEndpoints(
  scope: HTMLElement,
  selectionRoot: Document | ShadowRoot,
  selectionAnchor: Element | null,
): {
  first: Text;
  last: Text;
  texts: Text[];
} | null {
  let segment = 0;
  let anchorSegment: number | null = null;
  const textBySegment = new Map<number, Text[]>();
  const visibilityByParent = new WeakMap<Element, boolean>();

  function visit(node: Node) {
    if (selectionAnchor !== null && node === selectionAnchor) {
      anchorSegment = segment;
    }
    if (node instanceof Text) {
      if (
        node.data.trim().length === 0 ||
        node.getRootNode() !== selectionRoot ||
        !isRenderedTextNode(node, visibilityByParent)
      )
        return;
      const segmentText = textBySegment.get(segment) ?? [];
      segmentText.push(node);
      textBySegment.set(segment, segmentText);
      return;
    }
    if (node !== scope && node instanceof Element) {
      if (isEditableSelectionSubtree(node)) {
        if (selectionAnchor !== null && node.contains(selectionAnchor)) {
          anchorSegment = segment;
        }
        segment += 1;
        return;
      }
      if (isSkippedSelectionSubtree(node)) {
        if (selectionAnchor !== null && node.contains(selectionAnchor)) {
          anchorSegment = segment;
        }
        return;
      }
    }
    for (const child of getComposedChildren(node)) visit(child);
  }

  visit(scope);
  if (selectionAnchor === null) {
    if (segment > 0) return null;
    const populatedSegments = Array.from(textBySegment.entries()).filter(
      ([, texts]) => texts.length > 0,
    );
    if (populatedSegments.length !== 1) return null;
    anchorSegment = populatedSegments[0]![0];
  }
  if (anchorSegment === null) return null;
  const selectedText = textBySegment.get(anchorSegment) ?? [];
  const first = selectedText[0] ?? null;
  const last = selectedText.at(-1) ?? null;
  return first === null || last === null
    ? null
    : { first, last, texts: selectedText };
}

const FALLBACK_TEXT_BLOCK_SELECTOR = [
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
].join(", ");

function serializeFallbackText(texts: readonly Text[]): string {
  const blockByElement = new WeakMap<Element, Element | null>();

  function findBlock(element: Element | null): Element | null {
    if (element === null) return null;
    const cached = blockByElement.get(element);
    if (cached !== undefined) return cached;
    const display =
      element.ownerDocument.defaultView?.getComputedStyle(element).display ??
      "";
    const isInline =
      display === "contents" ||
      display.startsWith("inline") ||
      display.startsWith("ruby");
    const block =
      display !== "" && !isInline
        ? element
        : display === "" && element.matches(FALLBACK_TEXT_BLOCK_SELECTOR)
          ? element
          : findBlock(element.parentElement);
    blockByElement.set(element, block);
    return block;
  }

  let previousBlock: Element | null = null;
  let previousText: Text | null = null;
  let serialized = "";
  for (const text of texts) {
    const block = findBlock(text.parentElement);
    let hasLineBreak = false;
    if (previousText !== null && block === previousBlock) {
      const between = text.ownerDocument.createRange();
      between.setStart(previousText, previousText.data.length);
      between.setEnd(text, 0);
      hasLineBreak = between.cloneContents().querySelector("br") !== null;
    }
    if (serialized.length > 0 && (block !== previousBlock || hasLineBreak)) {
      serialized += "\n";
    }
    serialized += text.data;
    previousBlock = block;
    previousText = text;
  }
  return serialized;
}

export function resolveSelectAllRoot(
  scope: HTMLElement,
  preferredRoot: Document | ShadowRoot,
): Document | ShadowRoot {
  const textRoots = new Set<Document | ShadowRoot>();
  const visibilityByParent = new WeakMap<Element, boolean>();

  function visit(node: Node): boolean {
    if (node instanceof Text) {
      if (
        node.data.trim().length === 0 ||
        !isRenderedTextNode(node, visibilityByParent)
      )
        return false;
      const root = node.getRootNode();
      if (root instanceof Document || root instanceof ShadowRoot) {
        textRoots.add(root);
        if (root === preferredRoot || textRoots.size > 1) return true;
      }
      return false;
    }
    if (node !== scope && node instanceof Element) {
      if (isEditableSelectionSubtree(node) || isSkippedSelectionSubtree(node)) {
        return false;
      }
    }
    for (const child of getComposedChildren(node)) {
      if (visit(child)) return true;
    }
    return false;
  }

  visit(scope);
  if (textRoots.has(preferredRoot) || textRoots.size !== 1) {
    return preferredRoot;
  }
  return textRoots.values().next().value ?? preferredRoot;
}

export function selectAllScopeContents(
  scope: HTMLElement,
  selectionRoot: Document | ShadowRoot,
  selectionAnchor: Element | null,
): {
  kind: "native" | "logical";
  fallbackCopyText: string | null;
} | null {
  clearSelectAllHighlight();
  const endpoints = getComposedTextEndpoints(
    scope,
    selectionRoot,
    selectionAnchor,
  );
  const selection = window.getSelection();
  if (endpoints === null || selection === null) return null;
  if (selectionRoot instanceof ShadowRoot) {
    ensureShadowSelectionPolicy(selectionRoot);
  }
  selection.removeAllRanges();
  selection.setBaseAndExtent(
    endpoints.first,
    0,
    endpoints.last,
    endpoints.last.data.length,
  );
  if (selection.toString().length > 0) {
    return { kind: "native", fallbackCopyText: null };
  }
  if (selectionRoot instanceof ShadowRoot) {
    if (
      typeof Highlight === "function" &&
      typeof CSS !== "undefined" &&
      CSS.highlights !== undefined
    ) {
      const ranges = endpoints.texts.map((textNode) => {
        const range = new Range();
        range.selectNodeContents(textNode);
        return range;
      });
      CSS.highlights.set(SELECT_ALL_HIGHLIGHT_NAME, new Highlight(...ranges));
    }
    return {
      kind: "logical",
      fallbackCopyText: serializeFallbackText(endpoints.texts),
    };
  }
  return null;
}
