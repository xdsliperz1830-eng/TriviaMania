/**
 * The Brain Blitz app mark, as SVG.
 *
 * This is deliberately NOT the store key art (art/icon-512.png): that one is a
 * listing tile with a wordmark and an emoji, and at home-screen size — around
 * 48 CSS pixels — the words are unreadable and the emoji renders differently on
 * every platform. A launcher icon has to survive being tiny, so this is a flat
 * vector mark with one idea in it: a brain with a lightning bolt through it.
 *
 *   build({ scale })  -> full-bleed square artwork, mark scaled about the centre
 *   build({ simple }) -> bolt only, for 16/32px favicons where folds turn to mush
 */

/** Cerebrum: overlapping circles painted in one colour read as a brain's bumps. */
const LOBES = [
  [186, 186, 78], [272, 164, 84], [352, 206, 72],
  [182, 268, 74], [266, 262, 82], [348, 272, 64]
];

/**
 * A short brainstem stub, kept clear of the bolt's tail. An anatomically sized
 * cerebellum hanging off the bottom read as a hot-air balloon, so the organ is
 * carried by the grooves below instead and this is only a hint.
 */
const STEM = '<rect x="276" y="312" width="42" height="70" rx="21"/>';

/**
 * Sulci. Brains are told apart from clouds by their grooves, not their outline,
 * so these are meanders that double back rather than loose squiggles. Clipped
 * to the silhouette, so a curve can never spill past the edge.
 */
const FOLDS = [
  "M150 160 C196 150, 212 192, 180 216 C148 240, 168 274, 212 272",
  "M124 236 C156 256, 138 290, 170 312",
  "M248 90 C226 136, 268 162, 242 208",
  "M332 118 C300 158, 338 186, 378 174",
  "M326 218 C292 236, 300 274, 346 270"
];

/** Cerebellum striations, tucked inside the lower right of the silhouette. */
const RIDGES = [
  "M292 292 C316 280, 348 280, 374 294",
  "M298 312 C320 300, 348 300, 372 314",
  "M308 330 C326 319, 350 319, 368 330"
];

/** The bolt. One path, drawn twice: a dark halo, then the fill on top. */
const BOLT = "M296 128 L196 274 L258 274 L228 404 L336 246 L274 246 Z";

function lobes(tag) {
  return LOBES.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join("");
}

function build(options = {}) {
  const scale = options.scale || 1;
  const simple = !!options.simple;

  // The mark's own bounds sit slightly up and right of centre, so nudge it back
  // before scaling rather than eyeballing the margins at every size.
  const tx = 256 - 266, ty = 256 - 242;
  const open = `<g transform="translate(256 256) scale(${scale * 1.12}) translate(-256 -256) translate(${tx} ${ty})">`;

  const brain =
    `<g fill="url(#bb-brain)">${lobes()}${STEM}</g>` +
    `<g clip-path="url(#bb-clip)" fill="none" stroke="#6D28D9" stroke-opacity=".5"` +
    ` stroke-width="13" stroke-linecap="round">` +
    FOLDS.map((d) => `<path d="${d}"/>`).join("") +
    RIDGES.map((d) => `<path d="${d}" stroke-width="10"/>`).join("") +
    `</g>`;

  const bolt =
    `<path d="${BOLT}" fill="none" stroke="#0B1120" stroke-opacity=".9" stroke-width="34"` +
    ` stroke-linejoin="round"/>` +
    `<path d="${BOLT}" fill="url(#bb-bolt)"/>`;

  // The favicon drops the brain entirely: at 16px the folds are noise and only
  // the bolt silhouette survives.
  const mark = simple
    ? `<g transform="translate(256 256) scale(${scale * 1.5}) translate(-256 -256) translate(-10 -10)">${bolt}</g>`
    : `${open}${brain}${bolt}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Brain Blitz">
<defs>
<linearGradient id="bb-bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#5B21B6"/><stop offset=".45" stop-color="#312E81"/><stop offset="1" stop-color="#0B1120"/>
</linearGradient>
<radialGradient id="bb-glow" cx=".82" cy=".14" r=".62">
<stop offset="0" stop-color="#22D3EE" stop-opacity=".5"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/>
</radialGradient>
<linearGradient id="bb-brain" x1=".1" y1="0" x2=".9" y2="1">
<stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#E0F2FE"/><stop offset="1" stop-color="#A5F3FC"/>
</linearGradient>
<linearGradient id="bb-bolt" x1=".2" y1="0" x2=".8" y2="1">
<stop offset="0" stop-color="#FDE68A"/><stop offset=".4" stop-color="#FACC15"/><stop offset="1" stop-color="#F59E0B"/>
</linearGradient>
<clipPath id="bb-clip">${lobes()}${STEM}</clipPath>
</defs>
<rect width="512" height="512" fill="url(#bb-bg)"/>
<rect width="512" height="512" fill="url(#bb-glow)"/>
${mark}
</svg>
`;
}

module.exports = { build };
