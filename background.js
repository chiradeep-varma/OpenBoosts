// A boost's JS can't be eval'd from a content script (Manifest V3 forbids it), so
// it runs through chrome.userScripts. That API only exists once the user turns on
// "Allow User Scripts" for this extension; until then the calls throw, JS boosts
// don't run, and everything else works.

// What the registered scripts depend on. If it didn't change there is nothing to do,
// which keeps colour-dragging and zapping from re-registering scripts on every save.
const live = (site) => (site?.boosts ?? []).filter((b) => b.on !== false).slice(0, 1); // one boost runs per site
const jsOf = (site) => JSON.stringify(live(site).filter((b) => b.js?.trim()).map((b) => [b.id, b.js]));

async function sync() {
  const all = await chrome.storage.local.get();
  const scripts = [];
  for (const [key, site] of Object.entries(all)) {
    if (!key.startsWith('site:')) continue;
    const host = key.slice(5);
    for (const b of live(site)) {
      if (!b.js?.trim()) continue;
      // An IP address has no www form, and one invalid pattern rejects the whole script.
      const matches = /[a-z]$/i.test(host) ? [`*://${host}/*`, `*://www.${host}/*`] : [`*://${host}/*`];
      scripts.push({ id: b.id, matches, js: [{ code: b.js }], world: 'MAIN' });
    }
  }
  await chrome.userScripts.unregister();
  // One at a time, so a boost the browser rejects can't keep the others from running.
  for (const s of scripts) {
    await chrome.userScripts.register([s]).catch((e) => console.warn('OpenBoosts: JS boost skipped:', e.message));
  }
}

// Serialised: two overlapping syncs would register the same id twice.
let queue = Promise.resolve();
const run = () => { queue = queue.then(sync).catch((e) => console.warn('OpenBoosts: JS boosts not synced:', e.message)); };

chrome.storage.onChanged.addListener((changes) => {
  const touched = Object.entries(changes).some(([k, c]) => k.startsWith('site:') && jsOf(c.oldValue) !== jsOf(c.newValue));
  if (touched) run();
});
chrome.runtime.onInstalled.addListener(run);
chrome.runtime.onStartup.addListener(run);

// Blocking is one browser rule: every site whose running boost has `block` set
// is sent to blocked.html before it loads, subdomains included. The browser
// enforces it, so blocking costs nothing at run time and holds while this worker sleeps.
const blocks = (site) => live(site)[0]?.block === true;
async function block() {
  const all = await chrome.storage.local.get();
  const sites = Object.keys(all).filter((k) => k.startsWith('site:') && blocks(all[k])).map((k) => k.slice(5)).filter((h) => /^[a-z0-9.-]+$/.test(h));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: sites.length ? [{
      id: 1,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { requestDomains: sites, resourceTypes: ['main_frame'] },
    }] : [],
  });
}
// Whatever flipped a block (the panel, the All Boosts page, an import), the rule
// is rebuilt here, and tabs already open on a site that just became blocked are
// reloaded so they land on the blocked page right away, not on their next visit.
chrome.storage.onChanged.addListener(async (changes) => {
  const flipped = Object.entries(changes).filter(([k, c]) => k.startsWith('site:') && blocks(c.oldValue) !== blocks(c.newValue));
  if (!flipped.length) return;
  await block().catch(() => {});
  for (const [key, c] of flipped) {
    if (!blocks(c.newValue)) continue;
    const host = key.slice(5);
    // An IP address has no subdomains, and one invalid pattern rejects the query.
    const url = /[a-z]$/i.test(host) ? [`*://${host}/*`, `*://*.${host}/*`] : [`*://${host}/*`];
    for (const t of await chrome.tabs.query({ url }).catch(() => [])) chrome.tabs.reload(t.id);
  }
});
chrome.runtime.onInstalled.addListener(block);
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  // The panel asks for a sync when it finds user scripts allowed, in case that just happened.
  if (m === 'sync') return void run();
  // recolor.js asks for the text of a stylesheet on another origin, which a page
  // script can't read. Only this extension's own scripts can send messages here.
  if (typeof m?.css === 'string' && /^https?:\/\//.test(m.css)) {
    fetch(m.css, { credentials: 'omit' }).then((r) => (r.ok ? r.text() : '')).catch(() => '').then(reply);
    return true; // reply comes later
  }
});

// Alt+Z: start zapping on the current tab without opening the panel.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'zap' || !tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js', 'recolor.js', 'content.js', 'zap.js'] });
  } catch { /* a page extensions can't touch, e.g. chrome:// or the Web Store */ }
});
