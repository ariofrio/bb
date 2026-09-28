const SCOPE_ATTRIBUTE_PREFIX = "data-bb-plugin-scope-";
const STYLED_ATTRIBUTE = "data-bb-plugin-styled";
const ROOT_SELECTOR = "[data-bb-plugin], [data-bb-plugin-root]";
const pluginIds = new Set<string>();
let observer: MutationObserver | null = null;

export function pluginScopeProps(pluginId: string): Record<string, string> {
  return { [`${SCOPE_ATTRIBUTE_PREFIX}${pluginId}`]: "" };
}

function markStyledSubtree(root: Element, inherited: boolean): void {
  const styled = inherited || root.matches(ROOT_SELECTOR);
  root.toggleAttribute(STYLED_ATTRIBUTE, styled);
  for (const child of root.children) markStyledSubtree(child, styled);
}

function gateSelector(selector: string): string {
  if (selector.includes("::")) return selector;
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(selector.slice(start));
  return selectors
    .map((part) => `:where([${STYLED_ATTRIBUTE}]):is(${part.trim()})`)
    .join(", ");
}

function markRoot(root: Element): void {
  if (!root.hasAttribute(STYLED_ATTRIBUTE)) markStyledSubtree(root, false);
  const pluginId = root.getAttribute("data-bb-plugin");
  const ids =
    pluginId !== null
      ? [pluginId]
      : root.hasAttribute("data-bb-plugin-root")
        ? pluginIds
        : [];
  const attributes = new Set(
    [...ids].map((id) => `${SCOPE_ATTRIBUTE_PREFIX}${id}`),
  );
  for (const name of root.getAttributeNames()) {
    if (name.startsWith(SCOPE_ATTRIBUTE_PREFIX) && !attributes.has(name))
      root.removeAttribute(name);
  }
  for (const name of attributes) {
    if (!root.hasAttribute(name)) root.setAttribute(name, "");
  }
}

function markRoots(root: ParentNode): void {
  if (root instanceof Element && root.matches(ROOT_SELECTOR)) markRoot(root);
  for (const element of root.querySelectorAll(ROOT_SELECTOR)) markRoot(element);
}

function trackRoots(pluginId: string): void {
  pluginIds.add(pluginId);
  markRoots(document);
  if (observer !== null) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) {
        markRoot(record.target);
        markStyledSubtree(
          record.target,
          record.target.parentElement?.closest(ROOT_SELECTOR) != null,
        );
      } else {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            markStyledSubtree(
              node,
              node.parentElement?.closest(ROOT_SELECTOR) != null,
            );
            markRoots(node);
          }
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-bb-plugin", "data-bb-plugin-root"],
  });
}

export function optimizePluginCssScope(
  pluginId: string,
  sheet: CSSStyleSheet,
): void {
  const from = `:where([data-bb-plugin="${pluginId}"], [data-bb-plugin-root]:not([data-bb-plugin]))`;
  const to = `:where([${SCOPE_ATTRIBUTE_PREFIX}${pluginId}])`;
  const rewrite = (
    rule: CSSRule & { selectorText?: string; cssRules?: CSSRuleList },
  ): void => {
    if (rule.selectorText?.includes(from))
      rule.selectorText = gateSelector(rule.selectorText.replaceAll(from, to));
    if (rule.cssRules !== undefined) {
      for (const child of rule.cssRules) rewrite(child);
    }
  };
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return;
  }
  trackRoots(pluginId);
  for (const rule of rules) rewrite(rule);
}

export function resetPluginCssScopesForTest(): void {
  observer?.disconnect();
  observer = null;
  pluginIds.clear();
}
