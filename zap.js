// The zap picker. Injected only when the user starts zapping, into the same
// isolated world as content.js, so a page that is never zapped never pays for it.
// Hover outlines the thing that would go; a click zaps it, or offers "all like it"
// when it is one of a repeating set; Esc ends.
(() => {
  if (document.getElementById('openboosts-zap')) return;

  const root = document.documentElement;
  const key = OB.siteKey(location.hostname);
  const boostId = window.__obZapBoost;
  delete window.__obZapBoost;

  // ---- what to zap -------------------------------------------------------------
  const INTERACTIVE = 'a[href],button,[role="button"],[role="link"],[role="menuitem"],[role="tab"],summary';

  // The box an element visibly occupies. An inline link wrapped around blocks, or a
  // `display: contents` wrapper, reports a sliver or nothing; what it contains is the truth.
  function rectOf(n) {
    const r = n.getBoundingClientRect();
    const display = getComputedStyle(n).display;
    if (display !== 'inline' && display !== 'contents' && r.width && r.height) return r;
    const range = document.createRange();
    range.selectNodeContents(n);
    const inner = range.getBoundingClientRect();
    return inner.width && inner.height ? inner : r;
  }
  const area = (n) => { const r = rectOf(n); return r.width * r.height; };
  const onlyChild = (p) => p.children.length === 1 && ![...p.childNodes].some((c) => c.nodeType === 3 && c.data.trim());

  // The pointer lands on the innermost element (an icon, a label), but what people
  // mean is the button it belongs to. Wrappers that are the same box as that button
  // come along, so no empty shell is left behind. The outline shows exactly this
  // element: what you see is what goes.
  function unit(el) {
    const control = el.closest(INTERACTIVE);
    if (control && rectOf(control).height <= Math.max(120, rectOf(el).height * 3)) el = control;
    for (let p = el.parentElement; p && p !== document.body && p !== root; p = el.parentElement) {
      if (!onlyChild(p) || area(p) > area(el) * 1.15) break;
      el = p;
    }
    return el;
  }

  // ---- selectors ---------------------------------------------------------------
  // A zap has to keep matching after the site re-renders, collapses a sidebar or
  // ships a new build. So selectors lean on what an element is (its link, label,
  // test id), fall back to class names that look hand-written, and use position
  // only as a last resort.
  const stableClass = (c) => c.length > 2 &&
    !/\d{2}|[:/[\]@!%.]|^(css|sc|jsx|svelte|ng|js|is|has)-|^(active|selected|open|hover|focus|visible|hidden|show|current|loaded|loading|collapsed|expanded)$/.test(c) &&
    !(/[a-z][A-Z]/.test(c) && !/[-_]/.test(c)) && !(/[a-z]\d|\d[a-z]/i.test(c) && !/[-_]/.test(c));
  const stableId = (id) => !/^[:\d]|\d{6,}|^(radix|headlessui|ember|mui|react)/i.test(id);
  const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return 0; } };
  const quote = (v) => `"${v.replace(/["\\]/g, '\\$&')}"`;

  // A name the element carries in its own markup, or null. Accepted only while it
  // picks out a handful of elements: the same link shown in two layouts is one
  // thing to zap, but a label shared by forty buttons names nothing.
  function anchor(n) {
    const tag = CSS.escape(n.localName);
    let sel = n.id && stableId(n.id) ? '#' + CSS.escape(n.id) : null;
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'href']) {
      if (sel) break;
      const v = n.getAttribute(attr);
      if (!v || v.length > 120 || /[\n\r]/.test(v)) continue;
      if (attr === 'href' && (n.localName !== 'a' || v === '/' || /^(#|javascript:)/i.test(v))) continue;
      if (attr === 'name' && !/^(input|select|textarea|button|form|iframe)$/.test(n.localName)) continue;
      sel = `${tag}[${attr}=${quote(v)}]`;
    }
    const hits = sel ? count(sel) : 0;
    return hits >= 1 && hits <= 4 ? sel : null;
  }

  const term = (n) => CSS.escape(n.localName) + [...n.classList].filter(stableClass).slice(0, 3).map((c) => '.' + CSS.escape(c)).join('');

  // By structure: the element's tag and classes, then as many ancestors (and
  // positions among siblings) as it takes to be the only match, stopping early at
  // an ancestor that has a name.
  function pathSel(el) {
    let sel = '';
    for (let n = el; n && n !== root; n = n.parentElement) {
      let t = (n !== el && anchor(n)) || term(n);
      if (count(t + (sel && ' > ' + sel)) === 1) return t + (sel && ' > ' + sel);
      // No parent: the site re-rendered and this element is no longer part of the page.
      if (!n.parentElement) return null;
      const same = [...n.parentElement.children].filter((c) => c.localName === n.localName);
      if (same.length > 1 && !t.startsWith('#')) t += `:nth-of-type(${same.indexOf(n) + 1})`;
      sel = t + (sel && ' > ' + sel);
      if (count(sel) === 1) return sel;
    }
    return sel;
  }

  function selectorFor(el) {
    const own = anchor(el);
    if (own) return own;
    // A wrapper around one named thing (a nav item around its link): zap the named
    // thing wherever it shows up, and this wrapper around it. If another layout
    // wraps it differently, the thing itself still goes.
    let chain = '';
    for (let n = el, depth = 0; n.children.length === 1 && depth < 6; depth++) {
      n = n.children[0];
      const name = anchor(n);
      if (name) return `${name}, ${CSS.escape(el.localName)}:has(>${chain} ${name})`;
      chain += ` ${CSS.escape(n.localName)} >`;
    }
    return pathSel(el);
  }

  // This element and the others like it: the tightest group of more than one that
  // its tag and classes, plus up to three ancestors, pick out.
  function relatedSel(el) {
    let best = null, sel = '';
    for (let n = el, depth = 0; n && n !== document.body && n !== root && depth < 4; n = n.parentElement, depth++) {
      sel = term(n) + (sel && ' > ' + sel);
      const c = count(sel);
      if (c < 2 || c > 150 || (best && c >= best.n)) continue;
      // A set is elements that share this one's class, or three or more plain siblings.
      // Anything looser ("div > div", two unrelated asides) would gather strangers.
      const named = /[.[]/.test(term(el)) || (c > 2 && [...document.querySelectorAll(sel)].every((m) => m.parentElement === el.parentElement));
      if (named) best = { sel, n: c };
    }
    return best;
  }

  // A short name for the list in the panel: what the element calls itself, else
  // its first words, else what kind of thing it is.
  const KIND = { a: 'Link', button: 'Button', img: 'Image', picture: 'Image', svg: 'Icon', video: 'Video', iframe: 'Embed', nav: 'Navigation',
    header: 'Header', footer: 'Footer', aside: 'Sidebar', form: 'Form', input: 'Field', ul: 'List', ol: 'List', li: 'Item', section: 'Section',
    article: 'Post', dialog: 'Dialog', table: 'Table', p: 'Text' };
  function labelFor(el) {
    const kind = KIND[el.localName];
    const named = el.getAttribute('aria-label') || (el.children.length < 3 && el.querySelector('[aria-label]')?.getAttribute('aria-label')) || el.alt;
    const words = (named || el.innerText || '').trim().split(/\s+/).filter(Boolean);
    // Something with a lot of text is better named by what it is than by how it starts.
    if (!words.length || (words.length > 4 && kind)) return kind ?? 'Element';
    const short = words.slice(0, 3).join(' ');
    return short.length > 22 ? short.slice(0, 21) + '…' : short + (words.length > 3 ? '…' : '');
  }

  // ---- storage -----------------------------------------------------------------
  // Zaps go to the boost the panel was showing, else the one the site is running,
  // and that boost becomes the one that runs.
  async function update(change) {
    const site = (await chrome.storage.local.get(key))[key] ?? { boosts: [] };
    let b = site.boosts.find((x) => x.id === boostId) ?? OB.active(site.boosts) ?? site.boosts[0];
    if (!b) site.boosts.push(b = OB.newBoost());
    OB.only(site.boosts, b.id);
    change(b);
    await chrome.storage.local.set({ [key]: site });
  }

  // ---- UI, in a shadow root so the page's CSS can't reach it ---------------------
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
  const host = el('div', '');
  host.id = 'openboosts-zap';
  // A Size boost zooms the page; the outline is drawn in real pixels, so the zoom is undone here.
  const zoom = root.currentCSSZoom || parseFloat(getComputedStyle(root).zoom) || 1;
  host.style.cssText = `all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;zoom:${1 / zoom}!important`;
  const shadow = host.attachShadow({ mode: 'open' });
  const css = el('style', '');
  css.textContent = `
    * { box-sizing: border-box; font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
    /* A white line inside a dark one shows on any page; no color of its own. */
    .box { position: fixed; left: 0; top: 0; border-radius: 6px; background: rgba(20, 19, 24, .1);
      box-shadow: 0 0 0 1.5px #fff, 0 0 0 3px #1c1b20; will-change: transform; }
    .box.rel { background: rgba(20, 19, 24, .06); box-shadow: 0 0 0 1px #fff, 0 0 0 2px rgba(28, 27, 32, .75); }
    .glass { pointer-events: auto; color: #fff; background: rgba(24, 23, 28, .9); border: 1px solid rgba(255, 255, 255, .12);
      -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: 0 12px 40px rgba(0, 0, 0, .35); }
    .menu { position: fixed; left: 0; top: 0; display: grid; gap: 2px; padding: 6px; border-radius: 14px; min-width: 210px;
      animation: pop .12s ease-out; transform-origin: top left; }
    .bar { position: fixed; left: 50%; bottom: 24px; translate: -50% 0; display: flex; align-items: center; gap: 8px;
      padding: 7px 7px 7px 18px; border-radius: 999px; white-space: nowrap; animation: rise .2s ease-out; }
    .bar span { opacity: .8; margin-right: 8px; }
    button { all: unset; box-sizing: border-box; font: inherit; color: #fff; cursor: pointer; padding: 9px 12px; border-radius: 9px; }
    button:hover, button:focus-visible { background: rgba(255, 255, 255, .14); }
    .bar button { padding: 7px 14px; border-radius: 999px; background: rgba(255, 255, 255, .12); }
    .bar .done { background: #fff; color: #1c1b20; font-weight: 600; }
    .bar .done:hover { background: #e9e8ee; }
    [hidden] { display: none !important; }
    @keyframes pop { from { opacity: 0; scale: .94; } }
    @keyframes rise { from { opacity: 0; translate: -50% 12px; } }
    @media (prefers-reduced-motion: reduce) { .menu, .bar { animation: none; } }
  `;
  const box = el('div', 'box');
  const related = el('div', '');
  const menu = el('div', 'menu glass');
  const zapThis = el('button', '', 'Zap this');
  const zapAll = el('button', '');
  menu.append(zapThis, zapAll);
  const bar = el('div', 'bar glass');
  const undo = el('button', '', 'Undo');
  const done = el('button', 'done', 'Done');
  bar.append(el('span', '', 'Click anything to remove it'), undo, done);
  box.hidden = menu.hidden = undo.hidden = true;
  shadow.append(css, related, box, menu, bar);
  root.append(host);

  // ---- behaviour ---------------------------------------------------------------
  const stop = new AbortController();
  const on = (type, fn, opts) => addEventListener(type, fn, { capture: true, signal: stop.signal, ...opts });
  let target = null, picked = null, frame = 0, pointer = null, added = 0;

  // The outline snaps to its element: no easing, so it is never somewhere the pointer isn't.
  const place = (node, r) => {
    node.style.transform = `translate(${r.left}px,${r.top}px)`;
    node.style.width = r.width + 'px';
    node.style.height = r.height + 'px';
  };
  const aim = (node) => {
    target = node;
    box.hidden = !node;
    if (node) place(box, rectOf(node));
  };
  const showRelated = (sel) => {
    related.replaceChildren();
    if (!sel) return;
    for (const n of [...document.querySelectorAll(sel)].slice(0, 80)) {
      const r = rectOf(n);
      if (r.width && r.height) place(related.appendChild(el('div', 'box rel')), r);
    }
  };
  const closeMenu = () => { menu.hidden = true; picked = null; showRelated(null); };
  const exit = () => { stop.abort(); host.remove(); };
  const under = (x, y) => {
    let n = document.elementFromPoint(x, y);
    if (!n || n === host || n === document.body || n === root) return null;
    n = unit(n);
    // Something that fills most of the window is the page itself; one stray click must not erase it.
    return area(n) > innerWidth * innerHeight * 0.7 ? null : n;
  };

  on('mousemove', (e) => {
    if (picked || e.target === host) return;
    pointer = e;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const n = under(pointer.clientX, pointer.clientY);
      if (n !== target) aim(n);
    });
  }, { passive: true });
  on('scroll', () => { if (target) place(box, rectOf(target)); closeMenu(); }, { passive: true });

  // While zapping, the page gets none of the pointer's presses: a click picks, it doesn't follow links.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick']) {
    on(type, (e) => {
      if (e.target === host) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'click') return;
      if (picked) return closeMenu();
      const node = under(e.clientX, e.clientY);
      if (!node) return;
      aim(node);
      // Everything about the element is worked out now, while it is on the page. Sites
      // like Instagram re-render constantly; by the time a menu item is clicked, this
      // node may have been thrown away and replaced by a new one that looks the same.
      const sel = selectorFor(node), label = labelFor(node);
      if (!sel) return;
      const rel = relatedSel(node);
      if (!rel) return zap([node], sel, label);
      picked = { node, rel, sel, label };
      zapAll.textContent = `Zap all ${rel.n} like it`;
      menu.hidden = false;
      const x = Math.min(e.clientX + 8, innerWidth - menu.offsetWidth - 8);
      const y = Math.min(e.clientY + 8, innerHeight - menu.offsetHeight - 8);
      menu.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
    });
  }

  on('keydown', (e) => {
    if (e.key !== 'Escape') return;
    picked ? closeMenu() : exit();
    e.preventDefault();
    e.stopImmediatePropagation();
  });

  async function zap(nodes, sel, label) {
    closeMenu();
    aim(null);
    // A quick dissolve, then the boost's CSS takes over and hides them for good.
    const fades = nodes.slice(0, 40).map((n) => n.animate(
      [{}, { opacity: 0, transform: 'scale(.96)' }],
      { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160, easing: 'ease-in', fill: 'forwards' },
    ));
    // Raced against a timer: animations don't tick in a tab that isn't being shown.
    await Promise.race([Promise.all(fades.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 220))]);
    await update((b) => b.zaps.push({ sel, label }));
    // Dropped only after the rule is in, so Undo brings the element back and nothing flashes.
    setTimeout(() => fades.forEach((a) => a.cancel()), 80);
    added++;
    undo.hidden = false;
  }

  zapThis.onclick = () => zap([picked.node], picked.sel, picked.label);
  zapAll.onclick = () => zap([...document.querySelectorAll(picked.rel.sel)], picked.rel.sel, `${picked.rel.n} × ${picked.label}`);
  zapAll.onmouseenter = () => showRelated(picked?.rel.sel);
  zapAll.onmouseleave = () => showRelated(null);
  undo.onclick = async () => {
    await update((b) => b.zaps.pop());
    undo.hidden = --added < 1;
  };
  done.onclick = exit;
})();
