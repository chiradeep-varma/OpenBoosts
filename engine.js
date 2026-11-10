// OpenBoosts engine: pure functions that turn a boost into CSS. Shared by the page
// script, the panel, the All Boosts page and the tests, so it must stay free of DOM
// and chrome.* calls. `var` + the guard make it safe to inject twice into one page.
var OB = globalThis.OB ?? (() => {
  // A site's boosts live under one storage key: { boosts: [boost, …] }.
  // www.example.com and example.com are the same site.
  const siteKey = (host) => 'site:' + host.replace(/^www\./, '');

  const CASES = ['uppercase', 'lowercase', 'capitalize'];
  // h, s: hue and saturation · b: brightness · k: contrast · scheme: how far the text's hue sits from the background's
  const DEFAULT_COLOR = { h: 265, s: 60, b: 50, k: 50, mode: 'light', scheme: 0 };

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, min, max, fallback) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(max, Math.max(min, +v)) : fallback);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // The one shape a boost may have. Everything read from a file or from storage
  // passes through here, so nothing else has to distrust its input.
  function cleanBoost(b) {
    const c = b?.color;
    return {
      id: str(b?.id, 40) || newId(),
      name: str(b?.name, 40) || 'My Boost',
      on: b?.on !== false,
      color: c && typeof c === 'object' ? {
        h: num(c.h, 0, 359, DEFAULT_COLOR.h),
        s: num(c.s, 0, 100, DEFAULT_COLOR.s),
        b: num(c.b, 0, 100, DEFAULT_COLOR.b),
        k: num(c.k, 0, 100, DEFAULT_COLOR.k),
        mode: c.mode === 'dark' ? 'dark' : 'light',
        scheme: num(c.scheme, 0, 359, 0),
      } : null,
      font: str(b?.font, 80),
      size: num(b?.size, 50, 200, 100),
      case: CASES.includes(b?.case) ? b.case : '',
      zaps: (Array.isArray(b?.zaps) ? b.zaps : [])
        .filter((z) => typeof z?.sel === 'string' && z.sel.trim() && !/[{}]/.test(z.sel))
        .slice(0, 500)
        .map((z) => ({ sel: z.sel.slice(0, 1000), label: str(z.label, 60) })),
      block: b?.block === true, // while this boost runs, the site doesn't open
      css: str(b?.css, 500000),
      js: str(b?.js, 500000),
    };
  }
  const newBoost = () => cleanBoost({});

  // ---- color -------------------------------------------------------------------
  const hsl = (h, s, l) => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  };
  const rgb = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;

  // sRGB → OKLCH [lightness 0–1, chroma, hue°]: the space the page's colors are remapped in.
  const oklch = ([r, g, b]) => {
    [r, g, b] = [r, g, b].map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
  };

  // The two colors a boost paints with: `paper` for backgrounds, `ink` for text.
  function palette(c) {
    const h2 = (c.h + (c.scheme || 0)) % 360;
    return c.mode === 'dark'
      ? { paper: hsl(c.h, c.s * 0.55, 7 + c.b * 0.13), ink: hsl(h2, 20 + c.s * 0.5, 74 + (c.k ?? 50) * 0.24) }
      : { paper: hsl(c.h, c.s, 80 + c.b * 0.17), ink: hsl(h2, 15 + c.s * 0.45, 26 - (c.k ?? 50) * 0.18) };
  }

  // How a color the site declared becomes a color of the boost. Each is a CSS
  // expression wrapped around the site's own value, so the browser does the math,
  // `var()` values resolve on their own, and the original alpha survives: what was
  // transparent stays transparent. Every background takes the paper's hue, every
  // text color the ink's; the original lightness and saturation nudge the result,
  // so cards, muted text and colored buttons keep their place in the hierarchy.
  // The numbers live in custom properties (set by colorCss), which is why changing
  // the boost's color never has to touch the rules recolor.js generates.
  const MAP = {
    bg: (v) => `oklch(from ${v} calc(var(--oba) + var(--obb)*l) calc(var(--opc) + min(c,.2)*.5) var(--oph)/alpha)`,
    text: (v) => `oklch(from ${v} calc(var(--ota) + var(--otb)*clamp(var(--otl),l,var(--oth))) calc(var(--oic) + min(c,.2)*.6) var(--oih)/alpha)`,
    line: (v) => `oklch(from ${v} var(--oll) calc(var(--opc) + min(c,.2)*.6) var(--oph)/alpha)`,
  };

  // The part of a color boost that doesn't depend on the site's stylesheets: the
  // numbers above, the page's base colors, and the colors that live in markup.
  function colorCss(c) {
    const { paper, ink } = palette(c);
    const [pL, pC, pH] = oklch(paper), [iL, iC, iH] = oklch(ink);
    const dark = c.mode === 'dark';
    const n = (v) => +v.toFixed(4);
    const vars = {
      oba: dark ? pL : pL - 0.1, obb: dark ? 0.07 : 0.1, opc: pC, oph: pH, // background lightness = oba + obb × original
      ota: dark ? iL - 0.3 : iL, otb: dark ? 0.3 : 0.22, otl: dark ? 0.45 : 0, oth: dark ? 1 : 0.55, oic: iC, oih: iH, // text lightness = ota + otb × clamp(otl, original, oth)
      oll: dark ? pL + 0.14 : pL - 0.12, // borders
    };
    const color = (expr) => `attr(${expr} type(<color>))`;
    return `:root{color-scheme:${dark ? 'dark' : 'light'};${Object.entries(vars).map(([k, v]) => `--${k}:${n(v)}`).join(';')}}` +
      // Zero specificity: these only fill in where the site said nothing.
      `:where(html){background-color:${rgb(paper)};color:${rgb(ink)}}` +
      `:where(a:any-link){color:${MAP.text('#06c')}}` +
      // Colors written as attributes (old-school tables, SVG icons). Needs typed attr(), Chrome 133+; older browsers skip these rules.
      `:where([bgcolor]){background-color:${MAP.bg(color('bgcolor'))}}` +
      `:where(font[color]){color:${MAP.text(color('color'))}}` +
      `:where(body[text]){color:${MAP.text(color('text'))}}` +
      `:where(svg [fill]:not([fill="none"],[fill^="url"])){fill:${MAP.text(color('fill'))}}` +
      `:where(svg [stroke]:not([stroke="none"],[stroke^="url"])){stroke:${MAP.text(color('stroke'))}}` +
      // Inline styles: recolor.js copies their colors into these two properties.
      `[style*="--ob-bg"]{background-color:${MAP.bg('var(--ob-bg)')}!important}` +
      `[style*="--ob-fg"]{color:${MAP.text('var(--ob-fg)')}!important}`;
  }

  // ---- a whole boost -----------------------------------------------------------
  // ponytail: icon fonts are spared by class-name guess; add a per-boost exclude list if a site's icons turn into letters.
  const TEXT = 'body,body *:not(i,code,pre,kbd,samp,svg *,[class*="icon" i],[class*="fa-"],[class*="material-symbols"],[class*="codicon"],[class*="glyph" i])';

  function boostCss(b) {
    let out = '';
    if (b.color) out += colorCss(b.color);
    if (b.font) out += `${TEXT}{font-family:${JSON.stringify(b.font)},system-ui,sans-serif!important}`;
    // Chromium has no text-only scaling on desktop (text-size-adjust is ignored), so size zooms the page.
    if (b.size && b.size !== 100) out += `html{zoom:${b.size / 100}!important}`;
    if (CASES.includes(b.case)) out += `body,body *{text-transform:${b.case}!important}`;
    // One rule per zap: a selector the site has made invalid can't take the others down with it.
    for (const z of b.zaps ?? []) if (!/[{}]/.test(z.sel)) out += `${z.sel}{display:none!important}`;
    return out + (b.css ? '\n' + b.css : '');
  }

  // A site runs one boost at a time: the first that is switched on. `only` is how
  // every switch flips one on, so two are never on together.
  const active = (boosts) => (boosts ?? []).find((b) => b.on !== false);
  const only = (boosts, id) => { for (const b of boosts) b.on = b.id === id; };
  const siteCss = (boosts) => { const b = active(boosts); return b ? boostCss(b) : ''; };
  const hasColor = (boosts) => !!active(boosts)?.color;

  return { siteKey, CASES, DEFAULT_COLOR, MAP, cleanBoost, newBoost, hsl, rgb, oklch, palette, colorCss, boostCss, siteCss, hasColor, active, only };
})();

if (typeof module !== 'undefined') module.exports = OB;
