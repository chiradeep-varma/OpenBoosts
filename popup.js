// The boost panel. It edits one site's boosts and writes them straight to storage;
// the page script hears each write and restyles the page, so every control is live.
// Opened from the toolbar it edits the current tab's site; opened as
// popup.html?host=…&boost=… (from the All Boosts page) it edits that site from anywhere.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabHost = URL.canParse(tab?.url) && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : null;
const host = (params.get('host') ?? tabHost)?.replace(/^www\./, '');

document.addEventListener('click', (e) => e.target.closest('[data-act=all]') && chrome.runtime.openOptionsPage());

if (!host) {
  for (const n of document.querySelectorAll('.bar, .view')) n.hidden = true;
  $('nope').hidden = false;
} else {
  const key = OB.siteKey(host);
  const onTab = !!tabHost && OB.siteKey(tabHost) === key;
  const load = (v) => ({ boosts: (v?.boosts ?? []).map(OB.cleanBoost) });

  let site = load((await chrome.storage.local.get(key))[key]);
  // Open on the boost that was asked for, else the one the site is running.
  let cur = site.boosts.findIndex((b) => b.id === params.get('boost'));
  if (cur < 0) cur = Math.max(0, site.boosts.findIndex((b) => b.on));
  // A site with no boost shows a blank one that is only saved on its first edit.
  let draft = site.boosts.length ? null : OB.newBoost();
  let written = JSON.stringify(site);
  let view = 'home';
  let lang = 'css';
  const boost = () => site.boosts[cur] ?? draft;

  const write = () => {
    written = JSON.stringify(site);
    return site.boosts.length ? chrome.storage.local.set({ [key]: site }) : chrome.storage.local.remove(key);
  };
  // At most one write every 16ms, however fast the pad is dragged.
  let queued = false;
  function save() {
    if (draft) { site.boosts.push(draft); cur = site.boosts.length - 1; draft = null; }
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; write(); }, 16); // a timer, not a frame: frames stop when the panel isn't being drawn
  }

  // Someone else changed this site (a zap on the page, the All Boosts page): take it, don't overwrite it.
  chrome.storage.onChanged.addListener((c) => {
    if (!c[key]) return;
    const next = load(c[key].newValue);
    if (JSON.stringify(next) === written) return;
    site = next;
    written = JSON.stringify(site);
    cur = Math.min(cur, Math.max(0, site.boosts.length - 1));
    draft = site.boosts.length ? null : OB.newBoost();
    paint();
  });

  const make = (tag, text, parent) => { const n = parent.appendChild(document.createElement(tag)); n.textContent = text; return n; };
  // A row in a list: a name, and a ✕ that takes it out.
  const row = (text, hint, remove) => {
    const li = document.createElement('li');
    make('span', text, li).title = hint;
    const x = make('button', '✕', li);
    x.title = x.ariaLabel = `Remove ${text}`;
    x.onclick = remove;
    return li;
  };

  // ---- color -------------------------------------------------------------------
  const pad = $('pad');
  const field = pad.firstElementChild;
  function setColor(patch) {
    const b = boost();
    b.color = { ...(b.color ?? OB.DEFAULT_COLOR), ...patch };
    save();
    paintColor();
  }
  // Direction from the middle is the hue; distance is the strength, full at 37% of
  // the field so the puck never hangs over the edge.
  const drag = (e) => {
    const r = field.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    setColor({
      h: Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360) % 360,
      s: Math.round(Math.min(1, Math.hypot(dx, dy) / (r.width * 0.37)) * 100),
    });
  };
  pad.onpointerdown = (e) => { pad.setPointerCapture(e.pointerId); drag(e); };
  pad.onpointermove = (e) => e.buttons && pad.hasPointerCapture(e.pointerId) && drag(e);
  pad.onkeydown = (e) => {
    const c = boost().color ?? OB.DEFAULT_COLOR;
    const step = { ArrowLeft: { h: (c.h + 354) % 360 }, ArrowRight: { h: (c.h + 6) % 360 }, ArrowUp: { s: Math.min(100, c.s + 5) }, ArrowDown: { s: Math.max(0, c.s - 5) } }[e.key];
    if (step) { e.preventDefault(); setColor(step); }
  };
  $('bulb').onclick = () => setColor({ mode: boost().color?.mode === 'dark' ? 'light' : 'dark' });
  $('color-clear').onclick = () => { boost().color = null; save(); paintColor(); };

  function paintColor() {
    const c = boost().color;
    pad.classList.toggle('idle', !c);
    $('color-clear').disabled = !c;
    $('bulb').setAttribute('aria-pressed', String(c?.mode === 'dark'));
    if (!c) { field.style.removeProperty('--glow'); return; }
    const a = c.h * Math.PI / 180, reach = c.s / 100 * 37;
    field.style.setProperty('--x', 50 + Math.cos(a) * reach + '%');
    field.style.setProperty('--y', 50 + Math.sin(a) * reach + '%');
    field.style.setProperty('--c', `hsl(${c.h} ${Math.max(35, c.s)}% 62%)`);
    field.style.setProperty('--glow', `hsl(${c.h} 90% 62% / ${0.1 + c.s / 500})`);
    pad.setAttribute('aria-valuenow', c.h);
    pad.setAttribute('aria-valuetext', `hue ${c.h}, strength ${c.s}`);
  }

  // ---- font, size, case ----------------------------------------------------------
  // The font list is a popover of our own rather than a native menu: with a few
  // hundred fonts a native one grows past the window as it scrolls.
  const fontMenu = $('font-menu');
  let fonts = [];
  chrome.fontSettings.getFontList().then((list) => { fonts = list.map((f) => f.fontId); }).catch(() => {});
  fontMenu.onbeforetoggle = (e) => {
    if (e.newState !== 'open') return;
    // A boost made on another machine may name a font this one lacks; still list it.
    const names = ['', ...(boost().font && !fonts.includes(boost().font) ? [boost().font] : []), ...fonts];
    fontMenu.replaceChildren(...names.map((n) => {
      const item = document.createElement('button');
      item.textContent = n || 'Site’s own font';
      item.dataset.font = n;
      item.setAttribute('aria-current', String(n === boost().font));
      return item;
    }));
    fontMenu.style.top = $('font').getBoundingClientRect().bottom + 4 + 'px';
  };
  fontMenu.ontoggle = (e) => { if (e.newState === 'open') fontMenu.querySelector('[aria-current=true]')?.scrollIntoView({ block: 'center' }); };
  fontMenu.onclick = (e) => {
    if (e.target.dataset.font === undefined) return;
    boost().font = e.target.dataset.font;
    save();
    fontMenu.hidePopover();
    paintType();
  };

  // Each click steps to the next value and wraps around.
  const SIZES = [100, 110, 125, 150, 90];
  const CASES = ['', 'uppercase', 'lowercase'];
  const after = (list, v) => list[(list.indexOf(v) + 1) % list.length];
  $('size').onclick = () => { boost().size = after(SIZES, boost().size); save(); paintType(); };
  $('case').onclick = () => { boost().case = after(CASES, boost().case); save(); paintType(); };

  function paintType() {
    const b = boost();
    $('font-name').textContent = b.font || 'Font';
    $('size').textContent = b.size === 100 ? 'Size' : b.size + '%';
    $('size').setAttribute('aria-pressed', String(b.size !== 100));
    // The key shows the case it applies: Aa as written, AA uppercase, aa lowercase.
    $('case').textContent = { uppercase: 'AA', lowercase: 'aa' }[b.case] ?? 'Aa';
    $('case').setAttribute('aria-pressed', String(!!b.case));
  }

  // ---- title and its menu --------------------------------------------------------
  const name = $('name');
  const rename = (editing) => {
    $('title').hidden = editing;
    name.hidden = !editing;
    if (editing) { name.value = boost().name; name.select(); }
  };
  name.onblur = () => {
    if (name.hidden) return;
    boost().name = name.value.trim() || 'My Boost';
    save();
    rename(false);
    paint();
  };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
  // Switching one boost on switches the site's others off.
  $('on').onchange = () => {
    if (draft) { site.boosts.push(draft); cur = site.boosts.length - 1; draft = null; }
    $('on').checked ? OB.only(site.boosts, boost().id) : (boost().on = false);
    commit();
  };

  // A site's other boosts sit at the top of the menu.
  function paintMenu() {
    const many = site.boosts.length > 1;
    $('menu-boosts').replaceChildren(...(many ? site.boosts : []).map((b, i) => {
      const item = document.createElement('button');
      item.textContent = b.name;
      item.className = b.on ? '' : 'off';
      item.setAttribute('aria-current', String(i === cur));
      item.dataset.boost = i;
      return item;
    }), ...(many ? [document.createElement('hr')] : []));
  }

  let armed = 0;
  $('menu').onclick = async (e) => {
    const { act, boost: index } = e.target.dataset;
    if (act === 'delete') {
      // A second click within three seconds deletes; no dialog to dismiss.
      if (Date.now() - armed > 3000) { armed = Date.now(); e.target.textContent = 'Click again to delete'; return; }
      site.boosts.splice(cur, 1);
      cur = Math.max(0, site.boosts.findIndex((b) => b.on));
      draft = site.boosts.length ? null : OB.newBoost();
      await write();
    } else if (act === 'new' && !draft) {
      site.boosts.push(OB.cleanBoost({ name: `My Boost ${site.boosts.length + 1}` }));
      cur = site.boosts.length - 1;
      OB.only(site.boosts, boost().id);
      await write();
    } else if (index !== undefined) cur = +index; // Choosing a boost only shows it; its switch decides whether it runs, so a blocking boost can be opened and changed.
    armed = 0;
    $('menu').querySelector('[data-act=delete]').textContent = 'Delete boost';
    $('menu').hidePopover();
    view = 'home';
    paint();
    if (act === 'rename' || act === 'new') rename(true);
  };

  // ---- zap -----------------------------------------------------------------------
  if (!onTab) { $('zap').disabled = true; $('zap').title = 'Open this site in a tab to zap things on it'; }
  $('zap').onclick = async () => {
    try {
      if (!draft) await write();
      // The picker adds to this boost; with only a blank draft it makes one on the first zap.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (id) => { window.__obZapBoost = id; }, args: [draft ? null : boost().id] });
      // The first three are harmless to repeat, and cover a tab opened before the extension was installed.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js', 'recolor.js', 'content.js', 'zap.js'] });
      window.close();
    } catch {
      $('zap').disabled = true;
      $('zap').title = "This page can't be zapped";
    }
  };
  $('zap-open').onclick = () => { view = 'zaps'; paint(); };
  $('zap-clear').onclick = () => { boost().zaps = []; save(); view = 'home'; paint(); };

  function paintZaps() {
    const zaps = boost().zaps;
    $('zap-open').hidden = !zaps.length;
    $('zap-open').textContent = zaps.length;
    $('zap-open').title = 'See what is zapped';
    $('zap-open').ariaLabel = `${zaps.length} zapped: see the list`;
    if (view === 'zaps' && !zaps.length) view = 'home';
    $('zap-list').replaceChildren(...zaps.map((z, i) => row(z.label || 'Element', z.sel, () => { zaps.splice(i, 1); save(); paint(); })));
  }

  // ---- block -------------------------------------------------------------------
  // Blocking is part of the boost: while this boost runs, the site doesn't open.
  // It is undone where boosts are switched off, on the All Boosts page; the page a
  // stopped site lands on offers no way back, on purpose.
  // The key shows the boost's setting, like every other key: lit means this boost
  // blocks. Whether it is in force is the switch's job; a switched-off boost dims
  // the whole panel, so a lit key on a dimmed panel reads as "set, but not running".
  // After anything that changes which boost runs: if the site is now blocked,
  // background.js is already reloading this tab onto the blocked page, so the panel leaves.
  async function commit() {
    await write();
    if (OB.active(site.boosts)?.block && onTab) window.close();
    paint();
  }
  $('block').onclick = () => {
    boost().block = !boost().block;
    if (draft) { site.boosts.push(draft); cur = site.boosts.length - 1; draft = null; }
    commit();
  };

  // ---- code ----------------------------------------------------------------------
  // JS boosts run through the browser's user-scripts switch, which is off until the
  // user turns it on. If it was off and is now on, the background registers what it couldn't.
  let jsOff = false;
  try {
    await chrome.userScripts.getScripts();
    if (localStorage.jsOff) { localStorage.removeItem('jsOff'); chrome.runtime.sendMessage('sync'); }
  } catch { jsOff = true; localStorage.jsOff = 1; }

  const src = $('src');
  $('lang').onclick = (e) => { const b = e.target.closest('button'); if (b) { lang = b.dataset.v; paint(); } };
  $('code').onclick = () => { view = 'code'; paint(); src.focus(); };
  src.oninput = () => { boost()[lang] = src.value; save(); };
  src.onkeydown = (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    src.setRangeText('  ', src.selectionStart, src.selectionEnd, 'end');
    src.oninput();
  };
  function paintCode() {
    const b = boost();
    $('code-mark').textContent = b.css.trim() || b.js.trim() ? '{…}' : '{}';
    for (const t of $('lang').children) t.setAttribute('aria-pressed', String(t.dataset.v === lang));
    if (src.value !== b[lang]) src.value = b[lang];
    src.placeholder = lang === 'css' ? 'body {\n  background: papayawhip;\n}' : "document.title = 'Boosted';";
    $('code-note').textContent = lang === 'css' ? ''
      : jsOff ? 'To run JavaScript, open the browser’s extensions page, choose OpenBoosts → Details, and turn on “Allow User Scripts”.'
        : 'Runs on every load of this site. Reload the tab to see changes.';
  }

  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => { view = 'home'; paint(); };

  function paint() {
    const b = boost();
    $('title-name').textContent = b.name;
    $('title').title = host;
    $('on').checked = b === (OB.active(site.boosts) ?? draft); // on means it is the one running
    paintMenu();
    paintColor();
    paintType();
    paintZaps(); // may send the view home, so it runs before the views are shown
    $('block').setAttribute('aria-pressed', String(b.block));
    document.body.classList.toggle('off', !$('on').checked);
    paintCode();
    for (const v of ['home', 'code', 'zaps']) $(v === 'home' ? 'home' : `view-${v}`).hidden = view !== v;
    document.body.classList.toggle('wide', view === 'code'); // code needs room to be read
  }
  paint();
}
