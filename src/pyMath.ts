/**
 * Python language-semantics helpers.
 *
 * Python's `round()` is round-half-to-even ("banker's rounding") and
 * returns an int for a single-argument call. JavaScript's `Math.round`
 * is half-toward-+Infinity. pyembroidery relies on python's `round()` in
 * `EmbEncoder.interpolate_gap_stitches`, `EmbThread.color_distance_red_mean`
 * and `EmbPattern.move_center_to_origin`, so we restate that behavior here.
 */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // Exactly .5: pick the even neighbor.
  return floor % 2 === 0 ? floor : floor + 1;
}
