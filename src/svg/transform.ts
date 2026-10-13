import { parseNumberList } from "./numbers.js";

/** Row-major 3x3 matrices applied to row vectors, as in pyembroidery. */
export type Matrix = number[];

export function getIdentity(): Matrix {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function getScale(sx: number, sy: number | null = null): Matrix {
  const y = sy === null ? sx : sy;
  return [sx, 0, 0, 0, y, 0, 0, 0, 1];
}

export function getTranslate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 0, 1, 0, tx, ty, 1];
}

export function getRotate(theta: number): Matrix {
  const tau = Math.PI * 2;
  theta *= tau / 360;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [ct, st, 0, -st, ct, 0, 0, 0, 1];
}

export function matrixMultiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

const TRANSFORM = /\s*,?\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/y;

const ARGUMENT_COUNTS: Record<string, number[]> = {
  matrix: [6],
  translate: [1, 2],
  scale: [1, 2],
  rotate: [1, 3],
  skewX: [1],
  skewY: [1],
};

export function svgMatrix(a: number, b: number, c: number, d: number, e: number, f: number): Matrix {
  return [a, b, 0, c, d, 0, e, f, 1];
}

/** Applies `inner`, then `outer`. */
export function composeSvgMatrix(outer: Matrix, inner: Matrix): Matrix {
  return matrixMultiply(inner, outer);
}

export function invertMatrix(m: Matrix): Matrix {
  const [a, b, , c, d, , e, f] = m;
  const determinant = a * d - b * c;
  return svgMatrix(
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  );
}

function transformMatrix(name: string, v: number[]): Matrix {
  switch (name) {
    case "matrix":
      return svgMatrix(v[0], v[1], v[2], v[3], v[4], v[5]);
    case "translate":
      return getTranslate(v[0], v[1] ?? 0);
    case "scale":
      return getScale(v[0], v[1] ?? v[0]);
    case "rotate":
      return v.length === 1
        ? getRotate(v[0])
        : matrixMultiply(matrixMultiply(getTranslate(-v[1], -v[2]), getRotate(v[0])), getTranslate(v[1], v[2]));
    case "skewX":
      return svgMatrix(1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0);
    default: // skewY
      return svgMatrix(1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0);
  }
}

export function parseSvgTransform(value: string | null | undefined): Matrix {
  const source = value?.trim() ?? "";
  let result = getIdentity();
  if (source === "" || source === "none") return result;

  TRANSFORM.lastIndex = 0;
  while (TRANSFORM.lastIndex < source.length) {
    const offset = TRANSFORM.lastIndex;
    const match = TRANSFORM.exec(source);
    if (match === null) {
      throw new Error(`Invalid SVG transform syntax near "${source.slice(offset).trim()}"`);
    }
    const [, name, args] = match;
    const values = parseNumberList(args, "transform");
    if (!ARGUMENT_COUNTS[name].includes(values.length)) {
      throw new Error(`SVG ${name}() requires ${ARGUMENT_COUNTS[name].join(" or ")} numbers`);
    }
    result = composeSvgMatrix(result, transformMatrix(name, values));
  }
  return result;
}
