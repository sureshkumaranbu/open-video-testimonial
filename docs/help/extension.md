# Browser extension

The Plaudit extension for Chrome and Firefox saves praise you find on the web to your inbox: select the words on any page, or on a post on X or LinkedIn, and save them as a **Pending** testimonial, with the author's name, and on X and LinkedIn their handle or profile and photo. It talks only to your own Plaudit server, through the REST API.

## Install it

Until it's published in the stores (below), install it from your Plaudit copy:

- **Chrome, Edge, Brave**: run `npm run build:extension` (or use the `extension/` folder as it is). Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose the `extension` folder.
- **Firefox**: run `npm run build:extension`, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose `dist/extension-firefox.zip`. A temporary add-on lasts until Firefox restarts; for a permanent one it must be signed (below). Firefox 128 or later.

## Set it up

1. In Plaudit, go to **Settings › API keys › New key**. Choose **Read and write** (the least that can add a testimonial) and limit it to the one project you'll save to. Copy the key; it's shown once.
2. Open the extension's options (right-click its icon › **Options**, or Firefox's add-on page › **Preferences**).
3. Enter your Plaudit address (it must start with `https://`; `http://` only for this computer, such as `http://localhost:3000`) and the key, click **Find my projects**, choose the project and click **Save**.
4. The browser may ask to let the extension reach your Plaudit address. It works either way, so you can say no.

The key is kept in the extension's own storage on this device and sent only to your Plaudit address. Revoke it in Plaudit at any time.

## Save a testimonial

- **From the page**: select the words, right-click and choose **Save selection as testimonial**.
- **From the toolbar**: select the words, then click the Plaudit icon.

A small window shows the words, the name and where it came from. Check them (you can edit both), tick **The author agreed to be quoted**, and click **Save to Plaudit**. It arrives in the inbox as Pending, for you to approve like any other testimonial, with a link to the post or page, the platform (X or LinkedIn) and the author's profile. The author's photo is downloaded by your server in the background.

On X and LinkedIn with nothing selected, the toolbar button takes the whole post's text. On other pages it uses the page's own author tag, if it has one; otherwise type the name.

These sites change their pages often. When the extension can't find the author, it still saves the words you selected and the page's link, and you fill in the name.

## What it can see

- It reads a page **only when you use its menu item or button there** (the browser's "active tab" permission), and only that page. It has no access to any site in the background and never reads pages on its own.
- It sends what's in the review window, the page's address and title, and the author details shown, to your Plaudit server, and nothing to anyone else. It has no analytics.
- It can't read the browser's own pages or the extension stores.

Your server accepts the extension's requests (CORS) only from extension pages and only with an API key; cookies are never used.

## Publishing it (for maintainers)

This is a human task: each store needs an account and a review.

**Chrome Web Store**

1. Register as a developer at the Chrome Web Store Developer Dashboard (a one-time fee) with the account that will own the listing.
2. Run `npm run build:extension` and upload `dist/extension-chrome.zip` as a new item.
3. Fill in the listing: the description, a 128×128 icon (`extension/icons/icon-128.png`), at least one 1280×800 screenshot, a category (Productivity) and a support address.
4. **Privacy practices**: the single purpose ("save selected text from a page to the user's own Plaudit server"); why each permission is needed: `activeTab` and `scripting` (read the selection and the post's author on the page the user acts on), `contextMenus` (the menu item), `storage` (the server address and key), and the optional host permissions (only the user's own server, asked for at runtime). Data: "website content" is sent only to the user's own server; nothing is sold or used for anything else. A privacy policy URL is required: link a page that says this.
5. Submit for review. Updates: raise `version` in `extension/manifest.json`, build and upload the new zip.

**Firefox Add-ons (AMO)**

1. Sign in at addons.mozilla.org's Developer Hub.
2. Set your own add-on id first: `FIREFOX_ADDON_ID=you@your-domain.example npm run build:extension` (the default id is a placeholder).
3. Submit `dist/extension-firefox.zip`, either listed on AMO or unlisted (signed for your own distribution).
4. AMO asks for the source when code is minified; ours isn't, so the zip is the source. Answer the data-collection questions as for Chrome.
5. Once reviewed and signed, the signed `.xpi` installs permanently.
