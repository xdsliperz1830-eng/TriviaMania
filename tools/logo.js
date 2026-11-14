/**
 * The Brain Blast app mark, as SVG.
 *
 * This is deliberately NOT the store key art (art/icon-512.png): that one is a
 * listing tile with a wordmark, and at home-screen size — around 48 CSS pixels —
 * the words are unreadable. A launcher icon has to survive being tiny, so this
 * is a flat vector mark with one idea in it: a brain with a lightning bolt
 * through it.
 *
 * Styled to match the game's "Toybox" theme: the game's blue, and the icon
 * pack's thick navy (#040335) outline with a solid drop under the mark.
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

  // Outline and drop: the silhouette stroked thick in navy, once shifted down as
  // a solid shadow and once in place, before the white fill goes on top.
  const silhouette = `${lobes()}${STEM}`;
  const outline =
    `<g fill="#040335" stroke="#040335" stroke-width="26" transform="translate(0 14)">${silhouette}</g>` +
    `<g fill="#040335" stroke="#040335" stroke-width="26">${silhouette}</g>`;
  const brain =
    outline +
    `<g fill="url(#bb-brain)">${silhouette}</g>` +
    `<g clip-path="url(#bb-clip)" fill="none" stroke="#3F55D0" stroke-opacity=".45"` +
    ` stroke-width="13" stroke-linecap="round">` +
    FOLDS.map((d) => `<path d="${d}"/>`).join("") +
    RIDGES.map((d) => `<path d="${d}" stroke-width="10"/>`).join("") +
    `</g>`;

  const bolt =
    `<path d="${BOLT}" fill="#040335" stroke="#040335" stroke-width="30" stroke-linejoin="round"` +
    ` transform="translate(0 12)"/>` +
    `<path d="${BOLT}" fill="none" stroke="#040335" stroke-width="30" stroke-linejoin="round"/>` +
    `<path d="${BOLT}" fill="url(#bb-bolt)"/>` +
    // a light lip along the bolt's upper edge, like the icons' bevels
    `<path d="M296 128 L196 274 L214 274 L292 158 Z" fill="#FFF3B0" fill-opacity=".75"/>`;

  // The favicon drops the brain entirely: at 16px the folds are noise and only
  // the bolt silhouette survives.
  const mark = simple
    ? `<g transform="translate(256 256) scale(${scale * 1.5}) translate(-256 -256) translate(-10 -10)">${bolt}</g>`
    : `${open}${brain}${bolt}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Brain Blast">
<defs>
<linearGradient id="bb-bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#3A57DB"/><stop offset=".5" stop-color="#2F48C7"/><stop offset="1" stop-color="#1C2687"/>
</linearGradient>
<radialGradient id="bb-glow" cx=".5" cy=".18" r=".7">
<stop offset="0" stop-color="#FFFFFF" stop-opacity=".22"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
</radialGradient>
<linearGradient id="bb-brain" x1=".1" y1="0" x2=".9" y2="1">
<stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#F1F5FF"/><stop offset="1" stop-color="#C9D6FF"/>
</linearGradient>
<linearGradient id="bb-bolt" x1=".2" y1="0" x2=".8" y2="1">
<stop offset="0" stop-color="#FFE680"/><stop offset=".45" stop-color="#FEC41C"/><stop offset="1" stop-color="#FE9100"/>
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
