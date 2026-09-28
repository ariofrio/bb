const SCOPE_ATTRIBUTE_PREFIX = "data-bb-plugin-scope-";
const STYLED_ATTRIBUTE_PREFIX = "data-bb-plugin-styled-";
const EMPTY_PLUGIN_IDS: ReadonlySet<string> = new Set();
let styledPluginIdsByElement = new WeakMap<Element, ReadonlySet<string>>();
const ROOT_SELECTOR = "[data-bb-plugin], [data-bb-plugin-root]";
const pluginIds = new Set<string>();
let observer: MutationObserver | null = null;

export function pluginScopeProps(pluginId: string): Record<string, string> {
  return { [`${SCOPE_ATTRIBUTE_PREFIX}${pluginId}`]: "" };
}

function rootPluginIds(root: Element): ReadonlySet<string> {
  const pluginId = root.getAttribute("data-bb-plugin");
  if (pluginId !== null) return new Set([pluginId]);
  return root.hasAttribute("data-bb-plugin-root") ? pluginIds : EMPTY_PLUGIN_IDS;
}

function inheritedPluginIds(root: Element): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    for (const id of rootPluginIds(parent)) ids.add(id);
  }
  return ids;
}

function markStyledSubtree(root: Element, inherited: ReadonlySet<string>): void {
  const own = rootPluginIds(root);
  const styled = own.size > 0 ? new Set([...inherited, ...own]) : inherited;
  const previous = styledPluginIdsByElement.get(root) ?? EMPTY_PLUGIN_IDS;
  for (const id of previous) {
    if (!styled.has(id)) root.removeAttribute(`${STYLED_ATTRIBUTE_PREFIX}${id}`);
  }
  for (const id of styled) {
    if (!previous.has(id))
      root.setAttribute(`${STYLED_ATTRIBUTE_PREFIX}${id}`, "");
  }
  styledPluginIdsByElement.set(root, styled);
  for (const child of root.children) markStyledSubtree(child, styled);
}

function gateSelector(selector: string, pluginId: string): string {
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
    .map((part) => `${part.trim()}:where([${STYLED_ATTRIBUTE_PREFIX}${pluginId}])`)
    .join(", ");
}

function markRoot(root: Element): void {
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
  markStyledSubtree(document.documentElement, EMPTY_PLUGIN_IDS);
  if (observer !== null) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) {
        markRoot(record.target);
        markStyledSubtree(record.target, inheritedPluginIds(record.target));
      } else {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.isConnected) {
            markStyledSubtree(node, inheritedPluginIds(node));
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
      rule.selectorText = gateSelector(
        rule.selectorText.replaceAll(from, to),
        pluginId,
      );
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
  styledPluginIdsByElement = new WeakMap();
}
