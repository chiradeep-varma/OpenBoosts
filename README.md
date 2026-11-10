<p align="center"><img src="icons/128.png" width="88" alt=""></p>
<h1 align="center">OpenBoosts</h1>
<p align="center"><b>Make any website yours.</b><br>Recolor it, restyle it, zap what you don't want. For every Chromium browser.</p>

<p align="center"><img src="store/screenshot-1.png" width="860" alt="A site recolored with OpenBoosts, with the boost panel open"></p>

OpenBoosts is a browser extension that changes the websites you use and keeps them changed. Open a site, click the icon, and it is yours to recolor, restyle and trim. It is modeled on the Boosts feature of the Arc browser, and works in Chrome, Brave, Edge, Vivaldi, Opera and anything else built on Chromium.

No account, no server, no analytics, no build step, no dependencies. Your boosts stay in your browser.

## What it does

### Recolor any website

Drag on the color square: direction picks the hue, distance from the middle how strong it is. The site's own colors are rewritten, so backgrounds, text and borders change while photos and video stay as they are. The arrow key puts the site's colors back.

### Zap what you don't want

<p align="center"><img src="store/screenshot-2.png" width="760" alt="Zapping an element"></p>

Click anything on the page to remove it for good. If it is one of a repeating set (cards, ads, suggested posts) you can remove them all at once. A zap is tied to what the element is, its link, label or id, so it stays gone when the site collapses a sidebar or re-renders.

### Dark mode and any font

<p align="center"><img src="store/screenshot-3.png" width="760" alt="A site in dark mode with a chosen font"></p>

The lightbulb flips any site between light and dark. Pick any font installed on your computer, step the size through 90, 100, 110, 125 and 150%, and switch the case between as written, UPPERCASE and lowercase.

### Block distracting sites

<p align="center"><img src="store/screenshot-4.png" width="760" alt="A blocked site"></p>

One key blocks the site: while that boost is on, the site never loads. There is no button on the blocked page. To open the site again, switch the boost off on the All Boosts page.

### Add your own CSS and JS

<p align="center"><img src="store/screenshot-5.png" width="760" alt="Custom CSS"></p>

CSS applies as you type. JavaScript runs on every load of the site.

### All your boosts in one place

<p align="center"><img src="store/screenshot-6.png" width="760" alt="The All Boosts page"></p>

Each set of changes is a boost. A site can have several and runs one at a time; click the boost's name in the panel to switch, rename, add or delete. The All Boosts page lists every site, turns boosts on and off, and exports or imports them as files.

Shortcuts: `Alt+B` opens the panel, `Alt+Z` starts zapping. Change them at `chrome://extensions/shortcuts`.

## Install

From source:

1. Download or clone this repository.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, …) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the folder.

For JavaScript boosts only, open the extension's **Details** and turn on **Allow User Scripts**. The browser keeps this switch off for every extension until its user turns it on, including ones installed from the Chrome Web Store. Everything else works without it.

## Coming from Arc

CSS and JavaScript written for an Arc boost run here unchanged: paste them into **Code**, or import the boost's `.css` / `.js` file from the All Boosts page and say which site it is for. Zaps are plain CSS selectors in both, so a selector copied from Arc works as a `display: none` rule.

Arc's color and font choices are not importable; Arc has no documented export for them.

## How it stays light

- **Sites without a boost cost one storage read.** The page script runs once and does nothing more unless the site has a boost.
- **Color is CSS, not a script touching elements.** For each of the site's rules that sets a color, OpenBoosts adds a rule with the same selector whose value is the original wrapped in a color expression (`oklch(from <original> …)`). The browser does the math; hover states, class changes and new content need no work. Dragging the pad only changes a handful of custom properties.
- **Recoloring is dormant unless a color boost is on.** No observers and no timers otherwise.
- **The zap picker loads only when you zap** and removes itself when you finish.
- **Blocking is one browser rule** (`declarativeNetRequest`), enforced by the browser itself with no script running.
- **JavaScript boosts are registered with the browser** (`chrome.userScripts`) rather than injected by a script that has to run first.

## Known limits

- Color reaches the page's own stylesheets, inline styles and color attributes. Colors declared inside shadow DOM, and gradients that mix images with colors, stay as the site wrote them.
- Every background takes one hue and every text color another, so text placed over a photo may lose contrast.
- Size zooms the whole page. Chromium has no text-only scaling on desktop.
- A zap of something with no link, label or id falls back to its position in the page, and may need redoing if the site rebuilds its markup.
- A font boost skips icon fonts by guessing from class names; an unusual icon font may turn into letters.
- There is no gallery or share link. Boosts travel as files.

## Privacy

OpenBoosts collects nothing. See [PRIVACY.md](PRIVACY.md).

## How it is put together

```
manifest.json    extension manifest (MV3)
engine.js        boost → CSS; pure functions shared by everything below
content.js       applies a site's boosts on every page
recolor.js       rewrites the site's color rules while a color boost is on
zap.js           the zap picker, injected on demand
background.js    registers JS boosts, fetches cross-origin stylesheets, keeps the blocking rule, handles Alt+Z
popup.*          the boost panel
manage.*         the All Boosts page, import and export
blocked.html     the page a blocked site lands on
ui.css           styles shared by the pages above
```

There is nothing to build: edit a file and reload the extension.

## License

MIT. OpenBoosts is an independent project and is not affiliated with or endorsed by The Browser Company. Arc is their trademark.
