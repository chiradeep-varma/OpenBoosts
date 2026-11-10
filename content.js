// Runs on every page at document_start, so it does as little as possible: one
// storage read, and on sites with no boost, nothing more. A color boost switches
// on recolor.js; custom JS is registered by background.js as a user script; the
// zap picker is only injected when asked for.
if (!window.__openBoosts) {
  window.__openBoosts = true;

  const key = OB.siteKey(location.hostname);
  const style = document.createElement('style');
  style.id = 'openboosts';
  let css = '';

  const render = (site) => {
    const next = OB.siteCss(site?.boosts);
    if (next !== css) style.textContent = css = next;
    if (!css) style.remove();
    else if (!style.isConnected) document.documentElement.append(style);
    OBRecolor.toggle(OB.hasColor(site?.boosts), style);
  };

  // The name a site gives itself, kept for the All Boosts page. Read once the
  // head is in, and only on sites that have a boost.
  const nameKey = 'name:' + key.slice(5);
  const remember = (site, known) => {
    if (!site?.boosts?.length) return;
    if (document.readyState === 'loading') return addEventListener('DOMContentLoaded', () => remember(site, known), { once: true });
    const name = document.querySelector('meta[property="og:site_name"], meta[name="application-name"]')?.content?.trim().slice(0, 40);
    if (name && name !== known) chrome.storage.local.set({ [nameKey]: name });
  };

  chrome.storage.local.get([key, nameKey]).then((s) => { render(s[key]); remember(s[key], s[nameKey]); });
  chrome.storage.onChanged.addListener((c) => { if (c[key]) render(c[key].newValue); });

  // Once the page's own styles are in, move ours after them so a boost's CSS wins ties.
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', () => style.isConnected && document.documentElement.append(style), { once: true });
  }
}
