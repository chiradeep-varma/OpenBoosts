// Recolors a site by rewriting its own color rules, rather than laying a tint over
// it. For every rule in the site's stylesheets that sets a color, it emits a rule
// with the same selector whose value is the original passed through OB.MAP. The
// site's cascade, hover states and class toggles keep working because the
// selectors are theirs; images and video are never touched; and a stylesheet this
// can't read simply keeps its original colors.
//
// Dormant unless a color boost is on for the site: no observers, no timers.
// Known limits: colors declared inside shadow DOM, and in gradients that mix
// url() with colors, stay as the site wrote them.
var OBRecolor = globalThis.OBRecolor ?? (() => {
  const root = document.documentElement;
  const state = new Map(); // site stylesheet → { n: rules converted, el: our <style> }
  let on = false, anchor = null, order = [], queue = [], observer, ticker = 0, debounce = 0, pumping = false;

  const mine = (sheet) => { const n = sheet.ownerNode; return n?.id === 'openboosts' || n?.dataset?.ob !== undefined; };

  // ---- one rule's declarations ---------------------------------------------------
  // Values that carry no color of their own: inherited, reset, or already see-through.
  const PLAIN = /^(|inherit|initial|unset|revert|revert-layer|currentcolor|transparent|none)$/i;
  // A whole `background` that is one function call and not an image: var(--x), rgb(var(--x)), color-mix(…).
  const ONE_COLOR = /^(?!url|[\w-]*gradient|image|cross-fade|element)[\w-]+\((?:[^()]|\([^()]*\))*\)$/i;
  const STOP = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)|\b(?:white|black)\b/gi;
  // The color in `1px solid rgb(var(--x))` or `1px solid var(--line)`, or null.
  function colorIn(shorthand) {
    const parts = shorthand.match(/[^\s(]+\((?:[^()]|\([^()]*\))*\)|[^\s()]+/g) ?? [];
    const literal = parts.find((p) => /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|color-mix\(|color\(|light-dark\()/i.test(p));
    if (literal) return literal;
    const rest = parts.filter((p) => !/^(-?[\d.]|thin|medium|thick|none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset|calc\()/i.test(p));
    return parts.length > 1 && rest.length === 1 && rest[0].startsWith('var(') ? rest[0] : null;
  }
  const SIDES = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];

  function declarations(s) {
    let out = '';
    const put = (prop, kind, as = prop) => {
      const v = s.getPropertyValue(prop);
      if (PLAIN.test(v) || v.startsWith('url(')) return v;
      out += `${as}:${OB.MAP[kind](v)}${s.getPropertyPriority(prop) ? '!important' : ''};`;
      return v;
    };
    put('color', 'text');
    if (!put('background-color', 'bg')) {
      // `background: var(--x)` or `rgb(var(--x))` leaves the longhand unreadable until the variable
      // resolves. If it turns out to be an image, our declaration is invalid there and changes nothing.
      const whole = s.getPropertyValue('background').trim();
      if (whole.includes('var(') && ONE_COLOR.test(whole)) out += `background-color:${OB.MAP.bg(whole)}${s.getPropertyPriority('background') ? '!important' : ''};`;
    }
    const image = s.getPropertyValue('background-image');
    if (image.includes('gradient(') && !image.includes('url(')) {
      const mapped = image.replace(STOP, (stop) => OB.MAP.bg(stop));
      if (mapped !== image) out += `background-image:${mapped}${s.getPropertyPriority('background-image') ? '!important' : ''};`;
    }
    let sides = 0;
    for (const side of SIDES) if (put(side, 'line')) sides++;
    if (!sides) {
      // `border: 1px solid var(--line)` hides its longhands until the variable resolves; read the color from its text.
      const whole = s.getPropertyValue('border');
      const color = whole.includes('var(') && colorIn(whole);
      if (color) out += `border-color:${OB.MAP.line(color)}${s.getPropertyPriority('border') ? '!important' : ''};`;
    }
    put('outline-color', 'line');
    // Rings and shadows: a ring drawn in the page's old background would stay as a dark or white halo.
    const shadow = s.getPropertyValue('box-shadow');
    if (shadow && shadow !== 'none') {
      const mapped = shadow.replace(STOP, (stop) => OB.MAP.bg(stop));
      if (mapped !== shadow) out += `box-shadow:${mapped}${s.getPropertyPriority('box-shadow') ? '!important' : ''};`;
    }
    put('fill', 'text');
    put('stroke', 'text');
    put('-webkit-text-fill-color', 'text');
    return out;
  }

  // ---- a stylesheet → its overrides ------------------------------------------------
  // At-rules are re-emitted around their contents so media queries, layers and
  // containers keep deciding which rule wins.
  function wrapper(rule) {
    if (rule instanceof CSSMediaRule) return `@media ${rule.conditionText}`;
    if (rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`;
    if (rule instanceof CSSLayerBlockRule) return `@layer ${rule.name}`;
    if (rule instanceof CSSContainerRule) return `@container ${rule.conditionText}`;
    const text = rule.cssText;
    return text.slice(0, text.indexOf('{'));
  }

  function convert(rules) {
    let out = '';
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const body = declarations(rule.style) + (rule.cssRules?.length ? convert(rule.cssRules) : '');
        if (body) out += `${rule.selectorText}{${body}}`;
      } else if (rule instanceof CSSImportRule) {
        try {
          const inner = rule.styleSheet ? convert(rule.styleSheet.cssRules) : '';
          if (inner) out += rule.media.mediaText ? `@media ${rule.media.mediaText}{${inner}}` : inner;
        } catch { /* an import from another origin */ }
      } else if (rule instanceof CSSGroupingRule) {
        const inner = convert(rule.cssRules);
        if (inner) out += `${wrapper(rule)}{${inner}}`;
      }
    }
    return out;
  }

  function emit(sheet, css) {
    const st = state.get(sheet);
    if (!st || !on) return;
    const media = sheet.media?.mediaText;
    if (css && media && media !== 'all') css = `@media ${media}{${css}}`;
    if (!css) { st.el?.remove(); st.el = null; return; }
    if (!st.el) { st.el = document.createElement('style'); st.el.dataset.ob = ''; }
    if (st.el.textContent !== css) st.el.textContent = css;
  }

  // Our <style>s sit at the end of <html>, in the same order as the sheets they
  // shadow and before the boost's own style, so ties resolve as they did before.
  function place() {
    let next = anchor?.parentNode === root ? anchor : null;
    for (let i = order.length - 1; i >= 0; i--) {
      const el = state.get(order[i])?.el;
      if (!el) continue;
      if (el.parentNode !== root || el.nextSibling !== next) root.insertBefore(el, next);
      next = el;
    }
  }

  // A stylesheet from another origin can't be read from the page; the background
  // worker fetches its text and it is parsed here, detached from the document.
  async function foreign(sheet) {
    state.set(sheet, { n: -1, el: null });
    const text = await chrome.runtime.sendMessage({ css: sheet.href }).catch(() => '');
    if (!text || !state.has(sheet)) return;
    try {
      const copy = new CSSStyleSheet();
      copy.replaceSync(text);
      emit(sheet, convert(copy.cssRules));
      place();
    } catch { /* not CSS after all */ }
  }

  // Converts queued sheets in slices of ~30ms so a site with megabytes of CSS
  // never holds up a frame for long.
  function pump() {
    pumping = false;
    const start = performance.now();
    while (queue.length && performance.now() - start < 30) {
      const sheet = queue.shift();
      const st = state.get(sheet) ?? { n: 0, el: null };
      state.set(sheet, st);
      try {
        const rules = sheet.cssRules;
        emit(sheet, convert(rules));
        st.n = rules.length;
      } catch { st.n = -1; }
    }
    place();
    if (queue.length) { pumping = true; setTimeout(pump, 8); }
  }

  // Finds stylesheets that are new or have grown (CSS-in-JS appends rules without
  // touching the DOM) and drops the overrides of ones that are gone.
  function scan() {
    if (!on) return;
    order = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])].filter((s) => !mine(s));
    const live = new Set(order.filter((s) => !s.disabled));
    for (const [sheet, st] of state) if (!live.has(sheet)) { st.el?.remove(); state.delete(sheet); }
    for (const sheet of live) {
      const st = state.get(sheet);
      let n;
      try { n = sheet.cssRules.length; } catch { if (!st && sheet.href) foreign(sheet); continue; }
      if (st?.n !== n && !queue.includes(sheet)) queue.push(sheet);
    }
    if (!pumping) pump();
  }
  const soon = () => { clearTimeout(debounce); debounce = setTimeout(scan, 16); };

  // ---- inline styles ---------------------------------------------------------------
  // A rule can't read `style="…"`, so the element's own colors are copied into two
  // custom properties that a rule in OB.colorCss maps. Only custom properties are
  // written, so the page's styles are never altered.
  const INLINE = '[style*="color"],[style*="background"]';
  function inline(el) {
    const s = el.style;
    if (!s) return;
    for (const [prop, copy] of [['background-color', '--ob-bg'], ['color', '--ob-fg']]) {
      const now = s.getPropertyValue(prop);
      const want = PLAIN.test(now) ? '' : now;
      if (want === s.getPropertyValue(copy)) continue;
      want ? s.setProperty(copy, want) : s.removeProperty(copy);
    }
  }

  function watch(records) {
    let sheets = false;
    for (const r of records) {
      if (r.type === 'attributes') { inline(r.target); continue; }
      if (r.target.localName === 'style' && !mine({ ownerNode: r.target })) sheets = true;
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if ((n.localName === 'style' || n.localName === 'link') && n.dataset.ob === undefined && n.id !== 'openboosts') sheets = true;
        if (n.hasAttribute('style')) inline(n);
        if (n.firstElementChild) for (const c of n.querySelectorAll(INLINE)) inline(c);
      }
      for (const n of r.removedNodes) if (n.localName === 'style' || n.localName === 'link') sheets = true;
    }
    if (sheets) soon();
  }
  const loaded = (e) => { if (e.target?.localName === 'link') soon(); };

  // Turns recoloring on or off. `boostStyle` is the boost's own <style>, which ours stay ahead of.
  function toggle(next, boostStyle) {
    anchor = boostStyle;
    if (next === on) return;
    on = next;
    if (on) {
      observer = new MutationObserver(watch);
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
      addEventListener('load', loaded, true);
      ticker = setInterval(() => document.hidden || scan(), 1500);
      for (const el of document.querySelectorAll(INLINE)) inline(el);
      scan();
    } else {
      observer.disconnect();
      removeEventListener('load', loaded, true);
      clearInterval(ticker);
      clearTimeout(debounce);
      for (const st of state.values()) st.el?.remove();
      state.clear();
      queue = [];
    }
  }

  return { toggle };
})();
