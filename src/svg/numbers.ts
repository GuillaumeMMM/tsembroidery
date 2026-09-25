/** Pattern units are 0.1 mm. */
export const UNITS_PER_MM = 10;

const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
const EXACT_NUMBER = new RegExp(`^${NUMBER}$`);
const LENGTH = new RegExp(`^(${NUMBER})\\s*([a-zA-Z%]*)$`);

const SVG_UNITS_TO_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

/** Throws on malformed input. */
export function parseNumberList(value: string, context: string): number[] {
  const text = value.trim();
  if (text === "") return [];
  return text.split(/\s*,\s*|\s+/).map((token) => {
    const number = Number(token);
    if (!EXACT_NUMBER.test(token) || !Number.isFinite(number)) {
      throw new Error(`Invalid SVG ${context} number "${token}"`);
    }
    return number;
  });
}

export function scanNumbers(value: string): number[] {
  return (value.match(new RegExp(NUMBER, "g")) ?? [])
    .map(Number)
    .filter(Number.isFinite);
}

/** Absolute lengths only; `%` and unknown units give null. */
export function parseSvgLength(value: string | null | undefined): number | null {
  const match = value?.trim().match(LENGTH);
  if (!match) return null;
  const number = Number(match[1]);
  const factor = SVG_UNITS_TO_PX[(match[2] || "px").toLowerCase()];
  return Number.isFinite(number) && factor !== undefined ? number * factor : null;
}
