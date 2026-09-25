export type Declaration = [property: string, value: string];

export interface CssRule {
  tag: string | null;
  id: string | null;
  classes: string[];
  specificity: number;
  order: number;
  declarations: Declaration[];
}

const SIMPLE_SELECTOR = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/;

export function parseDeclarations(text: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const part of text.split(";")) {
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const property = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).replace(/!important\s*$/i, "").trim();
    if (property && value) declarations.push([property, value]);
  }
  return declarations;
}

function parseSelector(text: string): Omit<CssRule, "order" | "declarations"> | null {
  const match = text.match(SIMPLE_SELECTOR);
  if (!match || text === "") return null;
  const tag = match[1] && match[1] !== "*" ? match[1].toLowerCase() : null;
  const parts = match[2].match(/[.#][\w-]+/g) ?? [];
  const ids = parts.filter((part) => part.startsWith("#")).map((part) => part.slice(1));
  if (ids.length > 1) return null;
  const classes = parts.filter((part) => part.startsWith(".")).map((part) => part.slice(1));
  return {
    tag,
    id: ids[0] ?? null,
    classes,
    specificity: ids.length * 100 + classes.length * 10 + (tag ? 1 : 0),
  };
}

/** Supports tag, .class and #id selectors (and compounds of them); skips the rest with a warning. */
export function parseStylesheet(source: string, warn: (message: string) => void): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let offset = 0;
  while (offset < text.length) {
    const open = text.indexOf("{", offset);
    if (open < 0) break;
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth > 0) {
      if (text[close] === "{") depth += 1;
      else if (text[close] === "}") depth -= 1;
      close += 1;
    }
    // Drop statements such as `@import ...;` that precede the block.
    const prelude = text.slice(offset, open).split(";").pop()!.trim();
    const body = text.slice(open + 1, close - 1);
    offset = close;

    if (prelude.startsWith("@")) {
      warn(`Skipped CSS at-rule ${prelude.split(/\s/)[0]}`);
      continue;
    }
    const declarations = parseDeclarations(body);
    for (const selectorText of prelude.split(",")) {
      const selector = parseSelector(selectorText.trim());
      if (selector === null) {
        warn(`Skipped unsupported CSS selector "${selectorText.trim()}"`);
        continue;
      }
      rules.push({ ...selector, order: rules.length, declarations });
    }
  }
  return rules;
}

/** Declarations of the rules matching `element`, lowest priority first. */
export function matchingDeclarations(element: Element, tag: string, rules: CssRule[]): Declaration[] {
  if (rules.length === 0) return [];
  const id = element.getAttribute("id");
  const classes = new Set((element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
  return rules
    .filter(
      (rule) =>
        (rule.tag === null || rule.tag === tag) &&
        (rule.id === null || rule.id === id) &&
        rule.classes.every((name) => classes.has(name))
    )
    .sort((a, b) => a.specificity - b.specificity || a.order - b.order)
    .flatMap((rule) => rule.declarations);
}
