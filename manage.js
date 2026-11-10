// The All Boosts page: every site's boosts in one list, plus import and export.
// Names and hosts here can come from an imported file, so the page is built with
// textContent only, never innerHTML.
const $ = (id) => document.getElementById(id);
const h = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

async function change(key, fn) {
  const site = (await chrome.storage.local.get(key))[key] ?? { boosts: [] };
  fn(site);
  await (site.boosts.length ? chrome.storage.local.set({ [key]: site }) : chrome.storage.local.remove(key));
}

const summary = (b) => [
  b.block && 'Blocked', b.color && 'Color', b.font, b.size !== 100 && `${b.size}%`, b.case,
  b.zaps.length && `${b.zaps.length} zapped`, b.css.trim() && 'CSS', b.js.trim() && 'JS',
].filter(Boolean).join(' · ') || 'Empty';

function row(key, raw, running) {
  const b = OB.cleanBoost(raw);
  // On means running: of a site's boosts, only the one that is actually applied shows as on.
  const toggle = h('input', { type: 'checkbox', checked: b.id === running, ariaLabel: `${b.name} on` });
  // A site runs one boost at a time, so switching one on switches its others off.
  toggle.onchange = () => change(key, (s) => (toggle.checked ? OB.only(s.boosts, b.id) : (s.boosts.find((x) => x.id === b.id).on = false)));
  const del = h('button', { className: 'btn quiet', textContent: 'Delete' });
  let armed = 0;
  del.onclick = () => {
    if (Date.now() - armed > 3000) { armed = Date.now(); del.textContent = 'Really delete?'; return; }
    change(key, (s) => { s.boosts = s.boosts.filter((x) => x.id !== b.id); });
  };
  return h('div', { className: 'boost-row' },
    h('div', { className: 'text' },
      h('span', { className: 'title', textContent: b.name }),
      h('span', { className: 'what', textContent: summary(b) })),
    del,
    h('label', { className: 'switch', title: 'Turn this boost on or off' }, toggle, h('span')));
}

// What to call a site: the name it gives itself (content.js saves it on a visit),
// else the main word of its address, so instagram.com reads "Instagram".
// ponytail: the longest label that isn't the ending; a public-suffix list would be exact.
function siteName(host, saved) {
  if (typeof saved === 'string' && saved.trim()) return saved.trim().slice(0, 40);
  const word = host.split('.').slice(0, -1).sort((a, b) => b.length - a.length)[0] ?? host;
  return word[0].toUpperCase() + word.slice(1);
}

// A site's tile: its favicon, or its first letter on a pastel picked from its address.
function avatar(host) {
  let n = 0;
  for (const ch of host) n = (n * 31 + ch.charCodeAt(0)) % 360;
  const a = h('span', { className: 'avatar', textContent: host[0].toUpperCase() });
  a.style.background = `hsl(${n} 85% 86%)`;
  favicon(host).then((src) => {
    if (!src) return;
    a.classList.add('icon');
    a.replaceChildren(h('img', { src, alt: '' }));
  });
  return a;
}

// The site's favicon from the browser's own cache: nothing is fetched from the
// site or anyone else. A site the browser has never visited gets the generic
// globe, which is told apart by comparing with the icon of an address that can't
// exist; those sites keep their letter.
const iconUrl = (page) => `${chrome.runtime.getURL('_favicon/')}?pageUrl=${encodeURIComponent(page)}&size=32`;
const bytes = (url) => fetch(url).then((r) => r.blob()).then((b) => b.text()).catch(() => '');
const globe = bytes(iconUrl('https://no-such-site.invalid/'));
async function favicon(host) {
  // The cache is keyed by the page that was visited, which may or may not have had the www.
  for (const page of [`https://www.${host}/`, `https://${host}/`]) {
    const url = iconUrl(page);
    const icon = await bytes(url);
    if (icon && icon !== await globe) return url;
  }
  return null;
}

async function render() {
  const all = await chrome.storage.local.get();
  const sites = Object.entries(all).filter(([k, v]) => k.startsWith('site:') && v?.boosts?.length).sort(([a], [b]) => a.localeCompare(b));
  $('empty').hidden = sites.length > 0;
  $('export').hidden = !sites.length;
  const total = sites.reduce((n, [, s]) => n + s.boosts.length, 0);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  $('tagline').textContent = total ? `${plural(total, 'boost')} on ${plural(sites.length, 'site')}` : '';
  $('sites').replaceChildren(...sites.map(([key, site]) => {
    const host = key.slice(5);
    return h('section', {},
      h('div', { className: 'site-head' }, avatar(host), h('a', { href: `https://${host}`, target: '_blank', rel: 'noreferrer', title: host, textContent: siteName(host, all['name:' + host]) })),
      h('div', { className: 'rows' }, ...site.boosts.map((b) => row(key, b, OB.active(site.boosts)?.id))));
  }));
}

// ---- export / import -------------------------------------------------------------
$('export').onclick = async () => {
  const all = await chrome.storage.local.get();
  const sites = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('site:')).map(([k, v]) => [k.slice(5), v.boosts]));
  const file = new Blob([JSON.stringify({ openboosts: 1, sites }, null, 2)], { type: 'application/json' });
  h('a', { href: URL.createObjectURL(file), download: 'openboosts-backup.json' }).click();
};

// Import takes only files that Export made. Everything it brings in arrives
// switched off, so nothing from a file restyles a site, blocks it or runs code
// until the user turns it on. What happened is said on the page, not in a dialog.
let noticeTimer = 0;
function notice(text) {
  $('notice').textContent = text;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 8000);
}

$('import').onclick = () => $('files').click();
$('files').onchange = async () => {
  const add = {}; // host → raw boosts
  let rejected = 0;
  for (const f of $('files').files) {
    let data;
    try { data = JSON.parse(await f.text()); } catch { /* counted below */ }
    if (data?.sites && typeof data.sites === 'object') {
      for (const [host, boosts] of Object.entries(data.sites)) if (Array.isArray(boosts)) (add[host] ??= []).push(...boosts);
    } else if (data?.boost && typeof data.host === 'string') (add[data.host] ??= []).push(data.boost);
    else rejected++;
  }
  $('files').value = '';

  let count = 0;
  for (const [host, boosts] of Object.entries(add)) {
    if (!/^[a-z0-9.-]+$/i.test(host)) continue;
    await change(OB.siteKey(host.toLowerCase()), (site) => {
      for (const b of boosts) { site.boosts.push(OB.cleanBoost({ ...b, id: '', on: false })); count++; }
    });
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  notice([
    count && `Imported ${plural(count, 'boost')}, switched off.`,
    rejected && `${plural(rejected, 'file')} ${rejected === 1 ? "wasn't an OpenBoosts export" : "weren't OpenBoosts exports"}.`,
  ].filter(Boolean).join(' ') || 'Nothing to import.');
};

chrome.storage.onChanged.addListener(render);
render();
