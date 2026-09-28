import type { Plugin, Processor } from "unified";

type ParsedMarkdown = ReturnType<NonNullable<Processor["parser"]>>;

export function createMarkdownParseCache(
  maxSourceLength: number,
): Plugin<[string]> {
  const cache = new Map<string, { tree: ParsedMarkdown; length: number }>();
  let sourceLength = 0;
  return function (configuration) {
    const parse = this.parser;
    if (parse === undefined) return;
    this.parser = (source, file) => {
      if (source.length === 0 || source.length > maxSourceLength)
        return parse(source, file);
      const key = JSON.stringify([configuration, source]);
      const cached = cache.get(key);
      if (cached !== undefined) {
        cache.delete(key);
        cache.set(key, cached);
        return structuredClone(cached.tree);
      }
      const tree = parse(source, file);
      cache.set(key, { tree: structuredClone(tree), length: source.length });
      sourceLength += source.length;
      while (sourceLength > maxSourceLength || cache.size > 256) {
        const oldest = cache.entries().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest[0]);
        sourceLength -= oldest[1].length;
      }
      return tree;
    };
  };
}

export const remarkCachedMarkdownParse = createMarkdownParseCache(524_288);
