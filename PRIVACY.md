# Privacy

OpenBoosts collects nothing. There is no account, no server, no analytics and no tracking.

**What is stored, and where.** Your boosts (colors, fonts, sizes, zapped elements, blocked sites, and any CSS or JavaScript you write) and the names of the sites they belong to are saved in your browser's own extension storage on your computer. They leave it only when you export them to a file yourself.

**What it reads.** To restyle a page, OpenBoosts reads that page's stylesheets and structure inside your browser. Nothing it reads is sent anywhere.

**Network requests.** OpenBoosts makes one kind of request: when a color boost is on and a site loads a stylesheet from a different address (a CDN, for example), the extension downloads that same stylesheet again, without cookies, so it can recolor it. The request goes to the address the site itself already asked your browser to load, and to no one else.

**Site icons** on the All Boosts page come from your browser's own icon cache, not from the internet.

**Permissions** exist to do the above: access to the pages you visit (to restyle them), storage (to keep your boosts), your list of installed fonts (to offer them), and blocking rules (for sites you choose to block).

Questions: open an issue at https://github.com/chiradeep-varma/OpenBoosts/issues.
