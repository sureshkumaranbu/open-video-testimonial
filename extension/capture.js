/*
 * Plaudit browser extension (EXT-01): reads what's selected on a page, and on
 * X and LinkedIn post pages the post's author (name, handle, photo), from the
 * page's own DOM. Injected only into the tab the user acts on (activeTab), so
 * it's a classic script: it defines globalThis.plauditCapture and nothing else.
 *
 * Every read is defensive: those sites change their markup often, and any part
 * that isn't found is simply left out. When the author can't be read, the
 * capture falls back to the plain selection with the page's own author tags.
 */
(function () {
  "use strict";

  function clean(s, max) {
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t ? t.slice(0, max) : null;
  }
  function absUrl(doc, u) {
    if (!u) return null;
    try {
      var url = new URL(u, doc.location.href);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (e) {
      return null;
    }
  }
  /** The first of `selectors`, in this order of preference, that `root` contains. */
  function first(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }
  function textOf(el) {
    return el ? clean(el.textContent, 400) : null;
  }
  /** The element the selection starts in, so a parser can find the post around it. */
  function selectionElement(doc) {
    var sel = doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var n = sel.getRangeAt(0).commonAncestorContainer;
    return n && n.nodeType === 1 ? n : n && n.parentElement;
  }
  function selectionText(doc) {
    var sel = doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null;
    var t = sel ? String(sel.toString()) : "";
    return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
  }
  function host(doc) {
    try {
      return doc.location.hostname.replace(/^(www|mobile)\./, "");
    } catch (e) {
      return "";
    }
  }

  /** X (and twitter.com): the post around the selection, else the page's first one. */
  function fromX(doc, near) {
    var post = (near && near.closest('article[data-testid="tweet"]')) || doc.querySelector('article[data-testid="tweet"]');
    if (!post) return null;
    var names = post.querySelector('[data-testid="User-Name"]');
    if (!names) return null;
    var parts = Array.prototype.map
      .call(names.querySelectorAll("span"), function (s) {
        return clean(s.textContent, 120);
      })
      .filter(Boolean);
    var handle = null;
    var name = null;
    parts.forEach(function (p) {
      if (!handle && /^@[A-Za-z0-9_]{1,15}$/.test(p)) handle = p;
      else if (!name && p.charAt(0) !== "@" && p !== "·" && !/^\d/.test(p)) name = p;
    });
    var img = post.querySelector('[data-testid="Tweet-User-Avatar"] img');
    var time = post.querySelector("a[href*='/status/'] time");
    return {
      platform: "x",
      name: name,
      handle: handle,
      avatarUrl: img ? absUrl(doc, img.getAttribute("src")) : null,
      profileUrl: handle ? "https://x.com/" + handle.slice(1) : null,
      headline: null,
      postText: textOf(post.querySelector('[data-testid="tweetText"]')),
      postUrl: time && time.parentElement ? absUrl(doc, time.parentElement.getAttribute("href")) : null,
    };
  }

  /** LinkedIn: the post (feed update) around the selection, else the page's first one. */
  function fromLinkedIn(doc, near) {
    var POST = ".feed-shared-update-v2, [data-urn^='urn:li:activity'], .update-components-actor";
    var post = (near && near.closest(POST)) || doc.querySelector(POST);
    if (!post) return null;
    var actor = post.querySelector(".update-components-actor") || (post.matches(".update-components-actor") ? post : null) || post;
    // Best first: the visible name, without the screen-reader copy ("View … profile") next to it.
    var name = textOf(
      first(actor, [
        ".update-components-actor__title span[aria-hidden='true']",
        ".update-components-actor__name span[aria-hidden='true']",
        ".feed-shared-actor__name",
        ".update-components-actor__title",
      ]),
    );
    if (!name) return null;
    var link = actor.querySelector("a.update-components-actor__meta-link, a.update-components-actor__image, a[href*='/in/'], a[href*='/company/']");
    var img = actor.querySelector(".update-components-actor__avatar img, .update-components-actor__image img, img");
    var profile = link ? absUrl(doc, link.getAttribute("href")) : null;
    return {
      platform: "linkedin",
      name: name,
      handle: null,
      avatarUrl: img ? absUrl(doc, img.getAttribute("src")) : null,
      profileUrl: profile ? profile.split("?")[0] : null,
      headline: textOf(first(actor, [".update-components-actor__description span[aria-hidden='true']", ".update-components-actor__description"])),
      postText: textOf(post.querySelector(".update-components-text, .feed-shared-text, .feed-shared-update-v2__description")),
      postUrl: null,
    };
  }

  /** Any other page: its own author tags, if it has them. */
  function fromPage(doc) {
    var meta = function (sel) {
      var m = doc.querySelector(sel);
      return m ? clean(m.getAttribute("content"), 120) : null;
    };
    var name = meta('meta[name="author"]') || meta('meta[property="article:author"]') || textOf(doc.querySelector('[itemprop="author"] [itemprop="name"], [itemprop="author"], [rel="author"]'));
    return { platform: null, name: name && !/^https?:/.test(name) ? name : null, handle: null, avatarUrl: null, profileUrl: null, headline: null, postText: null, postUrl: null };
  }

  /** What the extension sends: the selection, the page and a best-effort author. */
  globalThis.plauditCapture = function (doc) {
    doc = doc || document;
    var h = host(doc);
    var near = selectionElement(doc);
    var author = null;
    try {
      if (h === "x.com" || h === "twitter.com") author = fromX(doc, near);
      else if (h === "linkedin.com" || /\.linkedin\.com$/.test(h)) author = fromLinkedIn(doc, near);
    } catch (e) {
      author = null;
    }
    if (!author || !author.name) author = fromPage(doc);
    var text = selectionText(doc) || author.postText || "";
    return {
      text: text,
      url: absUrl(doc, doc.location.href),
      title: clean(doc.title, 200),
      platform: author.platform,
      sourceUrl: author.postUrl || absUrl(doc, doc.location.href),
      author: { name: author.name, handle: author.handle, avatarUrl: author.avatarUrl, profileUrl: author.profileUrl, headline: author.headline },
    };
  };
})();
