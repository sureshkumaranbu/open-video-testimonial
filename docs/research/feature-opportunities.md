# Feature opportunities for Plaudit

_Researched 2026-10-22 from a Claude Code cloud session. This is a desk study of what people say about hosted testimonial tools, used to decide what Plaudit should build next. It builds on [`senja-teardown.md`](senja-teardown.md) and the roadmap in [`../SPEC.md`](../SPEC.md)._

---

## 1. Method & limits

### What was searched

About 45 web searches covered these products: Senja, Testimonial.to, Famewall, Shoutout.io, Trustmary, Vocal Video, VideoAsk (Typeform), Boast, EmbedSocial, Elfsight, Testimonial Hero, Endorsal and Kudobuzz. For each one we looked for:
- reviews and pros/cons on G2, Capterra, GetApp, Software Advice, the Shopify App Store, AppSumo and Trustpilot
- pricing and free-plan limits
- the vendor's own help centre, changelog or feature board
- cross-cutting topics: mobile recording failures, widget speed, accessibility, consent/GDPR, Google's review-snippet policy and the FTC's 2024 fake-review rule

### What was blocked

- **Page fetches.** WebFetch failed with `ENOTFOUND` on the one host tried (g2.com), which confirms the earlier finding. No review page was opened directly. **Every finding below comes from search-engine result summaries**, not from reading the page itself.
- **Reddit.** The search API refused `reddit.com` outright ("not accessible to our user agent"). Open searches never surfaced a Reddit thread either. **We have no first-hand Reddit evidence.** The only "Reddit says…" claim we found was second-hand, on a competitor's blog, and we have not used it.
- **Indie Hackers and X.** No relevant threads surfaced.
- **Product Hunt.** Only launch pages for small new tools surfaced, via a third-party tracker. There were no useful comments.
- **Thin review volumes.** Most of these products have few reviews: Senja has 19 on G2, Testimonial.to about 12, Vocal Video 22–24, and Trustmary 23 on Capterra. Boast has one Capterra review, from 2018. Many "cons" rest on one or two reviewers.
- **Biased sources.** Much of the comparison content is written by competing vendors (Famewall, Senja, WiserNotify/WiserReview, Bragly, Tagembed, Vocal Video, TheyLuvIt and others). Where we use it, we label it "competitor blog".

### How confidence is marked

| Mark | Meaning |
|---|---|
| **High** | Several independent sources agree, or the vendor's own docs state it. |
| **Medium** | One credible independent source (such as a review-site summary), or several sources that are not fully independent. |
| **Low** | One reviewer, an old review, a competitor's claim, or our own inference. |

Source types are tagged as: *review site*, *vendor docs*, *vendor pricing*, *changelog*, *competitor blog*, *third-party blog*, *dev forum*, or *legal/regulatory summary*.

**Prices** are as seen in search summaries on 2026-10-22 ("as of search, 2026-10"). Sources often disagree, and we say so where they do. Check the live pricing pages before quoting any price.

---

## 2. Feature matrix

Legend: ✓ = has it · ✗ = doesn't · partial = limited or plan-gated in a way that matters · ? = unknown from what we could reach.

| Product | Video recording | Imports | AI features | Widgets | Walls | Integrations | Analytics | Free-plan caps | Branding removal | Self-host | API / webhooks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Senja** | ✓ | ✓ (CSV, extension, ~35 platforms) | ✓ (transcripts, translation on Pro, excerpts, AI case studies) | ✓ (20+ styles) | ✓ | ✓ (Zapier; native Slack since 2026-04) | ✓ (views, engagement, 30 days) | 15 testimonials in total | paid | ✗ | paid only |
| **Testimonial.to** | ✓ (built-in trim) | partial (X/LinkedIn free; 10+ review sites paid) | ? | ✓ | ✓ | ✓ (Zapier; Make via webhooks) | partial (called "limited") | 2 video + 10 text, in total | partial (sources conflict) | ✗ | top tiers only |
| **Famewall** | ✓ | ✓ (25–30+ sources) | partial (AI summary, AI reply assistant) | ✓ (7 layouts) | ✓ | ? | ? | 10 text + 1 video, 1 wall | ? | ✗ | ? (React package exists) |
| **Shoutout.io** | ✓ | partial (X/Twitter) | ? | ✓ | ✓ | ? | ? | ? (1 project, per competitor) | paid ($100 one-off on lifetime plan) | ✗ | ? |
| **Trustmary** | ✓ | ✓ (Google, Facebook, Yelp, G2…; count limited by plan) | ✓ (AI ranks reviews) | ✓ (incl. exit-intent popup) | partial (review wall widget) | partial (WordPress plugin) | ✓ (A/B tests on Business plan) | Solo $0, 1 review source | ? | ✗ | ? |
| **Vocal Video** | ✓ (teleprompter, background blur) | ? | ✓ (AI edits, summaries) | ✓ | ? | ✓ (Zapier, HubSpot, Salesforce…) | ? | 5 published videos, 720p, watermark, no download | paid (Essential and up) | ✗ | partial (API on Pro, per competitor) |
| **VideoAsk** | ✓ | ✗ | partial (transcripts) | ✓ | ✗ | ✓ (Zapier, Make, webhooks) | ? | 20 processing minutes/month | ? | ✗ | ✓ (webhooks) |
| **Boast** | ✓ | ? | ? | ✓ | ? | ? | ? | no free plan found; trial; from ~$50/mo | ✗ (per competitor) | ✗ | ? |
| **EmbedSocial** | partial (separate forms product) | ✓ (Google, Facebook, Instagram) | ? | ✓ | ? | ✓ | ? | 1 source, branded | paid | ✗ | ? |
| **Elfsight** (testimonial widgets) | ✗ | ✗ (entered by hand) | ? | ✓ (slider/grid) | ✗ | partial (site-builder installs) | ? | 1 widget, 200 views/month | paid | ✗ | ? |
| **Testimonial Hero** (done-for-you service) | ✓ (produced remote interviews) | ✗ | ? | ? | ? | ? | ? | no free plan; ~$7,800/yr | n/a | ✗ | ? |
| **Endorsal** | ? | ? | ? | ✓ | ? | ✓ (Zapier, Make, Shopify, WooCommerce) | partial (request campaign stats) | ? (sources conflict) | ✓ (white label) | ✗ | ✓ |
| **Kudobuzz** (Shopify reviews) | ? | ✓ (social/UGC) | ? | ✓ | ? | partial (Shopify, Wix) | ? | ? | ? | ✗ | ? |
| **Plaudit today** | ✓ | ✗ (roadmap) | ✗ | ✓ (grid/list) | ✓ | ✗ (roadmap) | ✗ (by design) | **none** | **no forced branding** | **✓** | partial (read-only public JSON feed) |

**Sources for the matrix** (as of search, 2026-10):
- **Senja**
  - [support: free vs paid](https://support.senja.io/what-are-the-differences-between-the-free-and-paid-plans-sdcfs), [support: is Senja free](https://support.senja.io/articles/is-senja-free-about-senjas-pricing-3354w)
  - [support: transcriptions](https://support.senja.io/manage-testimonials/what-are-video-transcriptions), [support: video excerpt](https://support.senja.io/what-is-video-excerpt-xn5k4), [support: form language](https://support.senja.io/can-i-localize-my-form-language-447d3)
  - [support: analytics](https://support.senja.io/what-are-testimonial-analytics-etnz4), [changelog: Slack](https://feedback.senja.io/changelog/live-native-slack-notification-is-up-and-running)
  - our own [teardown](senja-teardown.md)
- **Testimonial.to**
  - [pricing](https://testimonial.to/pricing), [help: export](https://help.testimonial.to/en/articles/6304554-export-video-and-text-testimonials), [help: trim](https://help.testimonial.to/en/articles/6442675-how-to-trim-your-video)
  - [help: Zapier](https://help.testimonial.to/en/articles/6236700-zapier), [help: Make](https://help.testimonial.to/en/articles/16529057-connect-testimonial-with-make)
  - [Dupple review](https://dupple.com/tools/testimonial), [RefGrow comparison](https://refgrow.com/blog/video-testimonial-software)
- **Famewall**: [comparison page (vendor)](https://famewall.io/compare/testimonial-to-alternative), [carousel widget (vendor)](https://famewall.io/testimonial-carousel-widget/), [WiserNotify (competitor blog)](https://wisernotify.com/blog/famewall-alternatives/)
- **Shoutout.io**: [ColdIQ](https://coldiq.com/tools/shoutout), [TrustRadius](https://www.trustradius.com/products/shoutout-io), [WiserNotify (competitor blog)](https://wisernotify.com/blog/shoutout-alternatives/)
- **Trustmary**: [key features / pricing (vendor)](https://trustmary.com/key-features/), [WordPress plugin](https://wordpress.org/plugins/trustmary/)
- **Vocal Video**: [pricing (vendor)](https://vocalvideo.com/pricing), [FitGap](https://us.fitgap.com/products/060027/vocal-video), [StoryPrompt (competitor blog)](https://storyprompt.com/blog/the-best-vocal-video-alternative), [teleprompter help](https://help.vocalvideo.com/article/128-sharing-scripts-with-a-teleprompter), [llms.txt (vendor)](https://vocalvideo.com/llms.txt)
- **VideoAsk**: [Capterra pricing](https://www.capterra.com/p/239248/videoask/pricing/), [Typeform community on webhooks](https://community.typeform.com/questions/7404)
- **Boast**: [Software Advice](https://www.softwareadvice.com/product/470408-Boast/), [Vocal Video (competitor blog)](https://vocalvideo.com/resources/boast-alternative/)
- **EmbedSocial**: [Famewall (competitor blog)](https://famewall.io/compare/embedsocial-alternative), [Tagembed (competitor blog)](https://tagembed.com/blog/?p=25787), [Shopify app listing](https://apps.shopify.com/embedsocial-shoppable-ugc)
- **Elfsight**: [Testimonials Slider pricing (vendor)](https://elfsight.com/testimonials-slider-widget/pricing/)
- **Testimonial Hero**: [G2](https://www.g2.com/products/testimonial-hero/reviews)
- **Endorsal**: [AutoRequests (vendor)](https://endorsal.io/features/autorequests), [GetApp](https://www.getapp.com/customer-management-software/a/endorsal)
- **Kudobuzz**: [Shopify App Store reviews](https://apps.shopify.com/kudobuzz-testimonials/reviews)

---

## 3. What users praise

1. **A link customers can use without signing up or installing anything.** Reviewers of Testimonial.to, Vocal Video and Senja most often praise how easy it is for a customer to open a link and record or write in the browser. *High* · review site and third-party blog · [Testimonial.to roundup](https://www.keywordsearch.com/blog/essential-features-of-testimonialto-for-success), [Vocal Video on G2](https://www.g2.com/products/vocal-video/reviews), [Senja on G2](https://www.g2.com/products/senja/reviews)
2. **Fast setup and simple embedding.** Senja and Testimonial.to reviewers like that they can set up, organise and embed quickly. One independent review reports a first Senja widget live within about 15 minutes. *High* · review site · [Senja on G2](https://www.g2.com/products/senja/reviews), [Testimonial on G2](https://www.g2.com/products/testimonial/reviews), [ReviewNexa](https://reviewnexa.com/senja-io-review/)
3. **A free tier that actually works.** Senja's free plan, with unlimited widget views, is repeatedly called the most generous in the category. *Medium* · third-party blog · [MakerStack](https://makerstack.co/reviews/senja-review/), [WiserReview](https://wiserreview.com/blog/testimonial-to-alternatives/)
4. **Responsive support from small teams.** Vocal Video, Kudobuzz (during platform moves) and EmbedSocial reviewers praise support. Testimonial Hero reviewers praise proactive account management. *Medium* · review site · [Vocal Video on G2](https://www.g2.com/products/vocal-video/reviews), [Kudobuzz reviews](https://apps.shopify.com/kudobuzz-testimonials/reviews), [Testimonial Hero on G2](https://www.g2.com/products/testimonial-hero/reviews)
5. **One library for everything.** Pulling praise from X, LinkedIn, Google, G2 and others into one place next to directly collected testimonials is a headline feature everywhere, and reviewers mention it positively. *Medium* · vendor docs and review site · [Famewall (vendor)](https://famewall.io/automated-testimonial-software/), [Senja AppSumo import (vendor)](https://support.senja.io/import-testimonials-from-appsumo-2xytv)
6. **Fast widgets.** Some Elfsight users specifically praise that its widgets don't slow their sites. This shows that speed is something buyers notice. *Low* (contradicted elsewhere, see §4) · review site · [Elfsight on G2](https://www.g2.com/products/elfsight/reviews?qs=pros-and-cons)

---

## 4. What users complain about

| # | Theme | What the evidence says | Confidence · source type |
|---|---|---|---|
| C1 | **Volume caps on free plans, and big jumps to paid** | Senja: 15 testimonials in total; anything over the cap is collected but hidden. Testimonial.to free: 2 video + 10 text in total. Famewall free: 1 video. Vocal Video free: 5 published videos at 720p with a watermark and no download. VideoAsk free: 20 processing minutes a month. MakerStack calls Senja's cap one that "arrives quickly once a product gets traction". | **High** · vendor pricing and third-party blogs · [Senja](https://support.senja.io/what-are-the-differences-between-the-free-and-paid-plans-sdcfs), [Testimonial.to pricing](https://testimonial.to/pricing), [Vocal Video pricing](https://vocalvideo.com/pricing), [MakerStack](https://makerstack.co/reviews/senja-review/), [Capterra: VideoAsk pricing](https://www.capterra.com/p/239248/videoask/pricing/) |
| C2 | **Pricing that adds up: per space, per brand, per seat, per view** | Testimonial.to's top plans are priced per space, so each extra brand costs again. Senja Pro charges $10/mo per extra project and $5/mo per extra seat (MakerStack). A VideoAsk user calls the plans "prohibitively expensive, especially if you're an existing Typeform customer" ([btw.so](https://www.btw.so/marketing-tools/video-marketing/videoask)). EmbedSocial is called steep for small businesses (G2 summary). Vocal Video paid plans are annual-only, from about $99/mo (FitGap). | **High** for the theme · review site, vendor pricing and third-party blog · [Dupple](https://dupple.com/tools/testimonial), [MakerStack](https://makerstack.co/reviews/senja-review/), [FitGap](https://us.fitgap.com/products/060027/vocal-video), [SaaSHub](https://www.saashub.com/compare-lightwidget-vs-embedsocial) |
| C3 | **View-metered widgets that switch off** | Elfsight's free plan is 200 views a month, and a widget is temporarily deactivated once its limit is hit. A BigCommerce reviewer says it "counts web crawlers as users and cuts off after 10,000 views". G2 users ask for pay-as-you-go. An AppSumo lifetime buyer reports caps added after purchase. | **Medium** · review site and vendor pricing · [Elfsight pricing](https://elfsight.com/testimonials-slider-widget/pricing/), [BigCommerce app](https://www.bigcommerce.com/apps/elfsight-testimonials-slider/), [AppSumo](https://appsumo.com/products/elfsight-2020/reviews/), [G2](https://www.g2.com/products/elfsight/reviews?qs=pros-and-cons) |
| C4 | **Key features paywalled: branding, downloads, API** | Removing branding, high-resolution video downloads and custom styling sit on upper tiers for Testimonial.to and Vocal Video. API/Zapier are not on Senja's free plan, and Testimonial.to's API, webhooks, Zapier and Make are on Ultimate. Two G2 reviewers say Vocal Video's most useful features needed the Pro plan. | **High** · vendor pricing, review site and third-party blog · [Senja plans](https://support.senja.io/what-are-the-differences-between-the-free-and-paid-plans-sdcfs), [Testimonial.to Zapier help](https://help.testimonial.to/en/articles/6236700-zapier), [b2bsaasreviews](https://b2bsaasreviews.com/products/testimonial-to), [Vocal Video on G2](https://www.g2.com/products/vocal-video/reviews) |
| C5 | **Not enough control over widget design** | Testimonial.to G2 reviewers want more control over design and layout. EmbedSocial's templates are hard to brand without custom CSS. A Boast reviewer wanted more embed customisation. One review says Testimonial.to's customisation "can feel restricted on lower tiers". A Senja reviewer wanted more templates, though another disagreed. | **Medium** · review site and competitor blog · [Testimonial on G2](https://www.g2.com/products/testimonial/reviews), [Tagembed](https://tagembed.com/blog/?p=25787), [Boast on Capterra](https://www.capterra.com.au/reviews/151440/boast), [Creator Economy Tools](https://creatoreconomytools.com/tool/testimonial-to) |
| C6 | **Heavy widgets that hurt page speed** | An Endorsal 1-star review (2021) says its code bloats the page and hurts site speed. A rival vendor cites an Elfsight user whose PageSpeed score dropped sharply. An independent review found that 4–5 Elfsight widgets noticeably increased script time. A tool builder claims typical widgets ship 200–300 KB of JS. Our own capture found Senja widget bundles of **235 KB to 1 MB each** ([teardown §5](senja-teardown.md)). Widget-performance blogs flag layout shift (CLS) as the usual failure. | **Medium** · review site, competitor blog, our own observation and third-party blog · [Endorsal on Capterra](https://www.capterra.co.za/reviews/193044/endorsal), [Elfsight review](https://widgets.code.blog/2026/05/24/elfsight-widgets-review/), [dev.to](https://dev.to/ahnhyeongkyu/stop-shipping-300kb-testimonial-wiwebdev-saas-javascript-testimonialsdgets-theres-a-better-way-3039), [Testimonials.io on CWV](https://testimonials.io/blog/testimonial-widgets-core-web-vitals) |
| C7 | **Mobile recording and upload trouble** | A Boast reviewer (2018): "video recording functionality was an issue on some mobile devices". VideoAsk's upload size limit stopped some applicants uploading short videos (Capterra, 2022). Developers report that iOS Safari's MediaRecorder reloads the page on recordings of about a minute or more, loses the stop event on iPad, and only supports WebM from Safari 18.4. Senja's help tells owners to re-edit portrait phone videos into landscape and re-upload. | **Medium** for the theme (few reviews mention it directly, but the platform bugs are well documented) · review site, dev forum and vendor docs · [Boast on Capterra](https://www.capterra.com.au/reviews/151440/boast), [VideoAsk on Capterra](https://www.capterra.com/p/239248/videoask/reviews/), [Apple forum: long recordings](https://developer.apple.com/forums/thread/694867), [Apple forum: stop event](https://developer.apple.com/forums/thread/662277), [MediaRecorder support](https://www.testmuai.com/learning-hub/mediarecorder-browser-support/), [Senja edit help](https://support.senja.io/how-do-i-edit-my-video-testimonial-qdbtx) |
| C8 | **Getting customers to actually record** | A Testimonial Hero reviewer found it "very difficult to find customers that were comfortable with video" ([G2](https://www.g2.com/products/testimonial-hero/reviews)). A Vocal Video reviewer says it took iteration to get useful content. Another wanted prep material for customers. Vendors respond with automated email/SMS requests and reminders (Endorsal, Boast, Senja). One review notes Testimonial.to includes no automated email campaigns. | **Medium** · review site, vendor docs and third-party blog · [Vocal Video on G2](https://www.g2.com/products/vocal-video/reviews), [Endorsal AutoRequests](https://endorsal.io/features/autorequests), [Boast listing](https://www.softwareadvice.com/product/470408-Boast/), [Getcredibly](https://getcredibly.org/blog/testimonial-to-alternatives) |
| C9 | **Weak or awkward integrations** | Senja's G2 summary: "integration options can be challenging at times". Testimonial.to reviewers want more integrations and automation. A VideoAsk user reports webhooks not reaching their server, and its transcript is not a separate webhook field. VideoAsk emails on every open, not on real leads. | **Medium** · review site and vendor forum · [Senja on G2](https://www.g2.com/products/senja/reviews), [Testimonial on G2](https://www.g2.com/products/testimonial/reviews), [Typeform community](https://community.typeform.com/questions/7404), [VideoAsk on Capterra AU](https://www.capterra.com.au/software/1018272/videoask) |
| C10 | **Data handling and getting out** | A Kudobuzz merchant says the app "exposes customer email addresses in your website's page source code". Another says it kept emailing customers after uninstall. A third describes failed renewals and no way to update payment details. Exports are fragmented: Testimonial.to exports CSV, but videos are downloaded one by one. Senja's CSV covers text, and videos are a separate download. | **Medium** for fragmented exports (vendor docs) · **Low–Medium** for the Kudobuzz incidents (one reviewer each, unverified) · [Kudobuzz reviews](https://apps.shopify.com/kudobuzz-testimonials/reviews), [Testimonial.to export](https://help.testimonial.to/en/articles/6304554-export-video-and-text-testimonials), [Senja video export](https://support.senja.io/manage-testimonials/how-do-i-download-export-my-video-testimonials) |
| C11 | **Limited video editing** | Vocal Video's editing is called "somewhat limited" on G2. Senja's editing is limited compared with dedicated media software (Software Finder). Boast's editing is limited (competitor blog). | **Medium** · review site and competitor blog · [Vocal Video on G2](https://www.g2.com/products/vocal-video/reviews), [Software Finder](https://softwarefinder.com/customer-service-software/senja), [Vocal Video on Boast](https://vocalvideo.com/resources/boast-alternative/) |
| C12 | **Support and account issues** | Vocal Video account problems "take patience" (G2 summary). Elfsight technical support can take days (G2). Endorsal's 2021 reviewer criticised responsiveness. | **Low–Medium** · review site · [Vocal Video on G2](https://www.g2.com/products/vocal-video/reviews), [Elfsight on G2](https://www.g2.com/products/elfsight/reviews?qs=pros-and-cons) |
| C13 | **Thin reporting** | Testimonial.to's dashboard is called "a little sparse" for reporting. Independent comparisons cite limited analytics. | **Low** · third-party blog · [b2bsaasreviews](https://b2bsaasreviews.com/products/testimonial-to), [RefGrow](https://refgrow.com/blog/video-testimonial-software) |

**Not supported by the evidence we could reach:**
- **AI quality.** We found no user complaints, positive or negative, about AI transcripts, summaries or clips. AI features are mostly vendor claims.
- **Lock-in when cancelling.** Testimonial.to requires deleting extra spaces before downgrading. The only claim that widgets stop rendering after you stop paying comes from a pay-once competitor's blog ([testimonials.ltd](https://testimonials.ltd/blog/lifetime-deal-testimonial-software)). *Low.*

---

## 5. Gaps: things none or few of them do well

1. **Self-hosting and data ownership.** None of the hosted tools can be self-hosted. The only self-hosted option that surfaced, Testified.io, is proprietary ([AlternativeTo](https://alternativeto.net/software/senja)). We found no open-source, self-hosted video-testimonial project. *Medium.*
2. **A complete, portable export.** Text and video are exported separately, there is no single archive that includes consent records and tags, and there is no documented importer from one vendor's export into another. *Medium (vendor docs).*
3. **Volume with no metering.** Every hosted tool meters something: testimonials, videos, minutes, views, spaces or seats (§4 C1–C3). *High.*
4. **Light, accessible widgets.** No vendor we found publishes a performance budget or an accessibility statement for its testimonial widgets. Senja's bundles are large (§4 C6). Carousel accessibility (pause control, announced slides, keyboard focus) is a known pitfall ([MADA guide](https://ictaccess.mada.org.qa/ui-accessible-component/en/carousel.html)). *Medium (absence of evidence plus our own observation).*
5. **Recording that survives real phones.** iOS Safari quirks are well documented, yet vendors' help pages still push fixes onto owners (re-edit portrait videos). There is no evidence of resumable or chunked uploads anywhere. *Medium.*
6. **Consent you can show later.** Senja has a consent step and Vocal Video sells custom legal releases on Pro. But nobody advertises a per-testimonial record of what wording was agreed to, when, and with which version of the form, or a simple withdrawal flow. GDPR release templates expect withdrawal and retention to be spelled out ([Paperform template](https://paperform.co/templates/gdpr-photo-video-release-form/), [Genie AI template](https://www.genieai.co/en-gb/template/testimonial-release-form)). *Medium.*
7. **One form in several languages.** Senja supports 18 form languages, but needs **a separate form per language**. Translating submissions requires Pro ([Senja help](https://support.senja.io/is-senja-available-in-my-language-cfllf)). *Medium (vendor docs).*
8. **Honest rich snippets.** Senja sells rating rich snippets on its top plan. But since 2019 Google has not shown review stars for `LocalBusiness`/`Organization` reviews hosted on the business's own site, **including via third-party widgets** ([Google Search Central](https://developers.google.com/search/blog/2019/09/making-review-rich-results-more-helpful?authuser=1), [SE Roundtable](https://www.seroundtable.com/google-updates-rules-reviews-rich-results-28232.html)). Few vendors explain this. *Medium (the policy is from 2019; check it is still current).*

---

## 6. Feature proposals

Ordered by priority: how strong the evidence is, how much it helps the core collect → moderate → display loop, and how well it fits a free, self-hosted tool. Several overlap with the existing roadmap in `SPEC.md`. Where they do, we say what to add or change.

### P1. Recording that works on real phones (mobile-first recorder)

- **Problem.** Customers on phones fail to record or upload, and that testimonial is lost for good. Evidence: §4 C7 ([Boast review](https://www.capterra.com.au/reviews/151440/boast), [Apple forum](https://developer.apple.com/forums/thread/694867), [VideoAsk upload limits](https://www.capterra.com/p/239248/videoask/reviews/)). Customers are camera-shy (C8).
- **What we'd build.**
  - Pick the codec at runtime with `MediaRecorder.isTypeSupported`, preferring MP4/AAC on iOS.
  - Record in timeslices and upload chunks as they arrive. This gives resumable uploads, and the server can stitch the chunks or finalise via ffmpeg.
  - Fall back to the native camera via `<input type="file" accept="video/*" capture>` when MediaRecorder misbehaves.
  - Guard against long iOS recordings by stopping cleanly before the known crash length. Make the limit configurable.
  - Provide unlimited retakes, a 3-2-1 countdown, a portrait-friendly layout, and an on-screen prompt overlay that shows the owner's questions while recording (a simple teleprompter).
  - Optionally record one question at a time.
- **Why it suits Plaudit.** It is pure client-side work, with no paid video host. Every self-hoster benefits, and it protects the "no limits" promise from being undercut by failed captures.
- **Effort.** **M–L.** Depends on the ffmpeg worker (SPEC P1 #1) for finalising chunks and transcoding iOS output. It needs a real-device test matrix: Playwright WebKit plus manual iOS checks.
- **Confidence.** Medium.

### P2. Request links with prefill, plus reminder emails

- **Problem.** The hardest part is getting customers to respond (C8). Vendors treat requests and reminders as core: [Endorsal AutoRequests](https://endorsal.io/features/autorequests), [Boast reminders](https://www.softwareadvice.com/product/470408-Boast/), and Senja invites with follow-ups (teardown). Testimonial.to reportedly has none built in ([Getcredibly](https://getcredibly.org/blog/testimonial-to-alternatives)).
- **What we'd build.** This extends SPEC P1 #5 and the "prefill" item from P2.
  - Per-recipient signed links (`/c/<slug>?r=<token>`) that prefill name, email and company and mark the submission as *requested*, so the owner can see who has and hasn't responded.
  - SMTP settings, plus an invite screen that takes pasted rows or a CSV.
  - One or two reminders on a configurable delay that stop once the person responds, and an unsubscribe link.
  - A bring-your-own-SMTP model, so there is no per-email cost.
- **Why it suits Plaudit.** Hosted tools charge for this, or push it to Zapier. With self-hosted SMTP the owner's own domain sends the mail.
- **Effort.** **M.** Depends on SMTP config and a small job scheduler (a cron-like loop in the app process is fine for a single instance).
- **Confidence.** Medium.

### P3. One-click full export and import (no lock-in), including competitor migration

- **Problem.** Exports are split (CSV for text, videos one by one) at [Testimonial.to](https://help.testimonial.to/en/articles/6304554-export-video-and-text-testimonials) and [Senja](https://support.senja.io/manage-testimonials/how-do-i-download-export-my-video-testimonials). Data-handling incidents (C10) and over-cap testimonials being hidden (C1) make owners wary.
- **What we'd build.**
  - **Export.** One `.zip` per project (or per instance) containing `plaudit.json`, a versioned schema with testimonials, tags, consent records and project settings, plus a `media/` folder. Also a flat CSV for spreadsheets.
  - **Import.** Read that zip back, for backup and restore or moving between instances.
  - **Mappers.** Map Senja's CSV/XLS export and Testimonial.to's CSV export, both documented by the vendors, onto our fields. Videos come from per-file uploads or URLs the owner supplies.
- **Why it suits Plaudit.** "Your data, your disk" is the reason to self-host. A migration path from the paid leaders is also the cheapest way to win users.
- **Effort.** **M.** Builds on SPEC P1 #7 (CSV import). No external dependencies.
- **Confidence.** Medium.

### P4. REST API and signed webhooks (Zapier, n8n, Make, Activepieces)

- **Problem.** APIs and webhooks sit on top tiers elsewhere (C4: [Testimonial.to](https://help.testimonial.to/en/articles/6236700-zapier), [Senja](https://support.senja.io/what-are-the-differences-between-the-free-and-paid-plans-sdcfs)). Reviewers find the integrations awkward or unreliable (C9).
- **What we'd build.** This is SPEC P1 #6 as written, plus:
  - delivery logs with retry and backoff, and a "send test event" button
  - the transcript as its own field in payloads, which addresses the VideoAsk complaint
  - published n8n and Activepieces example workflows
- **Why it suits Plaudit.** Free automation is a natural open-source edge, and self-hosters often run n8n next to their apps.
- **Effort.** **M.** No external dependencies.
- **Confidence.** Medium–High.

### P5. Local Whisper transcripts and captions

- **Problem.** Transcripts are table stakes: Senja transcribes on every plan ([help](https://support.senja.io/manage-testimonials/what-are-video-transcriptions)) and Vocal Video lists captions. Captions are an accessibility need, and transcripts make testimonials searchable and quotable.
- **What we'd build.**
  - An optional worker container running `whisper.cpp` or `faster-whisper` with a small model by default. It writes a `.vtt` file and a transcript, and the owner can edit both in the dashboard.
  - Captions as `<track>` on every player, plus a "use transcript as text quote" button.
  - A pluggable remote API for owners who prefer one.
- **Why it suits Plaudit.** It runs on the owner's CPU, so there is no per-minute fee and no audio leaves the server. That is a strong privacy story.
- **Effort.** **M.** Depends on the ffmpeg worker (audio extraction). Model download size and CPU time need documenting.
- **Confidence.** Medium. This is demand inferred from competitors offering the feature; we found no user complaints about AI quality.

### P6. A light, accessible widget, with a published budget

- **Problem.** Heavy widgets hurt Core Web Vitals (C6), and some buyers praise speed specifically (§3.6). No vendor publishes an accessibility statement (§5.4).
- **What we'd build.**
  - A performance budget enforced in CI, for example a widget script under ~15 KB gzipped, excluding the video player.
  - Reserved height to avoid layout shift, `loading="lazy"` posters, and video loaded only on click.
  - WCAG 2.2 AA work: keyboard focus order, `aria-roledescription` and a pause button for any future carousel or marquee, `prefers-reduced-motion`, 4.5:1 contrast checks in both themes, and captions on by default once P5 lands.
  - A short accessibility statement in the docs.
- **Why it suits Plaudit.** Plaudit already avoids trackers. Small, accessible and private is a clear differentiator that costs nothing to run.
- **Effort.** **S–M**, ongoing. It should shape SPEC P1 #4 (more layouts) before carousels and marquees are built.
- **Confidence.** Medium.

### P7. Widget builder with live preview, and saved widget configs

- **Problem.** Not enough design control (C5). This is the most common "dislike" in Testimonial.to's G2 summary.
- **What we'd build.**
  - A dashboard page with a live preview iframe and controls for layout, theme, accent and font, card radius and shadow, columns, max items, tag filter, pinned order, and show/hide of rating, avatar, date and company.
  - Saved as a widget record with an ID, so the snippet becomes `data-widget="<id>"`.
  - A safe custom-CSS field scoped to the Shadow DOM, plus CSS custom properties for host-site theming.
- **Why it suits Plaudit.** Branding and custom styling are paywalled elsewhere (C4) and free here.
- **Effort.** **M.** Matches SPEC P1 #4 ("per-widget saved configurations") and P2 ordering/pinning.
- **Confidence.** Medium.

### P8. Consent ledger

- **Problem.** Owners need to prove permission later, and customers may withdraw. Senja edits to rating or video need the customer's consent ([help](https://support.senja.io/how-do-i-edit-my-video-testimonial-qdbtx)). Vocal Video sells custom legal releases on Pro (FitGap). GDPR release templates expect withdrawal and retention terms (§5.6). The FTC's 2024 rule bans fake or misattributed testimonials ([Search Engine Land](https://searchengineland.com/ftc-fake-reviews-testimonials-445209)).
- **What we'd build.**
  - An append-only `consent_events` table: who, when, IP hash (optional), the exact consent text and its version hash, and scopes such as "website", "social" and "use my name/face".
  - Owner-editable consent wording, versioned.
  - A per-testimonial "edited after consent" flag.
  - A private withdrawal link in the thank-you email that unpublishes the testimonial and logs the event.
  - Consent included in exports (P3).
- **Why it suits Plaudit.** The self-hoster is the data controller, so a built-in audit trail is genuinely useful and fits the spec's "privacy by default" goal.
- **Effort.** **S–M.** Extends the existing `consent_at`. The withdrawal email depends on P2's SMTP.
- **Confidence.** Medium.

### P9. Video trimming (non-destructive)

- **Problem.** Awkward starts and ends. Both Senja and Testimonial.to ship trim ([Testimonial.to help](https://help.testimonial.to/en/articles/6442675-how-to-trim-your-video), [Senja help](https://support.senja.io/how-do-i-edit-my-video-testimonial-qdbtx)). Editing elsewhere is called limited (C11).
- **What we'd build.**
  - Start/end handles in the dashboard player, stored as `trim_start` and `trim_end`.
  - The ffmpeg worker renders a trimmed copy and keeps the original.
  - A choice of poster frame.
- **Why it suits Plaudit.** It is cheap with ffmpeg and needs no third-party editor.
- **Effort.** **S** once the ffmpeg worker exists.
- **Confidence.** Medium.

### P10. Slack and Discord notifications

- **Problem.** Owners want to know as soon as something arrives. Senja shipped native Slack on all plans in April 2026 ([changelog](https://feedback.senja.io/changelog/live-native-slack-notification-is-up-and-running)). VideoAsk's noisy "someone opened it" emails are a complaint ([Capterra AU](https://www.capterra.com.au/software/1018272/videoask)).
- **What we'd build.**
  - Incoming-webhook URLs for Slack and Discord (and generic), sent on *submitted* and *approved*, with name, rating, a short snippet and a dashboard link.
  - An email digest option via P2's SMTP.
- **Why it suits Plaudit.** Incoming webhooks need no OAuth app, so it works on any self-hosted instance.
- **Effort.** **S.** Reuses P4's event bus.
- **Confidence.** Medium.

### P11. CSV and manual import, plus Google reviews via official channels

- **Problem.** Every serious competitor imports existing praise (matrix "Imports"). Imports are often plan-gated: Testimonial.to review-site imports are paid, and Trustmary limits the number of platforms by plan ([Trustmary](https://trustmary.com/key-features/)).
- **What we'd build.**
  - SPEC P1 #7, plus a column mapper with preview.
  - A `source` and `source_url` field shown as a small badge.
  - A Google Business Profile import that reads the owner's own reviews through the official API or a Google Takeout file, not by scraping, in line with the spec's non-goals.
- **Why it suits Plaudit.** It is unlimited and free. It also doubles as the competitor-migration path (P3).
- **Effort.** **S** for CSV and manual entry. **M** for Google: OAuth app setup is the owner's job, so it needs documentation.
- **Confidence.** Medium for CSV. Low–Medium for Google specifically.

### P12. Privacy-first widget analytics

- **Problem.** Owners want to know whether widgets are seen. Senja shows views and engagement ([help](https://support.senja.io/what-are-testimonial-analytics-etnz4)). Testimonial.to's reporting is called sparse (C13). Elfsight counts crawlers as views (C3).
- **What we'd build.**
  - Off by default.
  - When on, the widget sends one cookieless beacon per page view with widget ID, host and event (view, play, CTA click).
  - No visitor IDs, crawlers filtered by user agent, and daily aggregate counts only.
  - Video play rate per testimonial.
- **Why it suits Plaudit.** It keeps the "no tracking" promise, because the data stays on the owner's server and holds no personal data.
- **Effort.** **S–M.** Matches SPEC P2 "privacy-friendly view counts".
- **Confidence.** Low–Medium. Demand is inferred more than voiced.

### P13. Shareable social image cards and single-testimonial pages

- **Problem.** Owners reuse testimonials on social media. Senja includes images on its free plan ([help](https://support.senja.io/articles/is-senja-free-about-senjas-pricing-3354w)). Famewall and new entrants such as VideoTestimonials ship graphic generators ([Product Hunt](https://www.producthunt.com/p/videotestimonials/videotestimonials)).
- **What we'd build.**
  - `/t/<id>` public pages for approved testimonials.
  - Server-rendered OG images (Next's `ImageResponse`) in square and landscape, plus a "download PNG" button.
  - Optionally a captioned MP4 card for video, after P5.
- **Why it suits Plaudit.** It is all generated locally, with no design SaaS.
- **Effort.** **S** for images. **M** for captioned video.
- **Confidence.** Low–Medium. This is vendor parity rather than a voiced complaint.

### P14. Multi-language collection forms

- **Problem.** Senja needs a separate form per language, and auto-translation is Pro-only ([help](https://support.senja.io/is-senja-available-in-my-language-cfllf)).
- **What we'd build.**
  - Translate the collection page UI strings via community-maintained locale files.
  - Choose the language from `Accept-Language` or `?lang=`.
  - Let the owner set the question and thank-you text per language within **one** project.
  - Store the submission's language on the testimonial.
- **Why it suits Plaudit.** Translation is a classic open-source contribution, and it serves non-English owners whom hosted tools under-serve.
- **Effort.** **M.** Matches SPEC P2 "Localisation".
- **Confidence.** Low–Medium. The evidence comes from vendor docs, not user complaints.

### Considered and not recommended now

| Candidate | Why not yet |
|---|---|
| **SEO rich snippets** (SPEC P1 #8) | Google suppresses review stars for self-serving `LocalBusiness`/`Organization` reviews, including via widgets ([Google, 2019](https://developers.google.com/search/blog/2019/09/making-review-rich-results-more-helpful?authuser=1)). The benefit is limited to some `Product`/`SoftwareApplication` pages. Keep it small, document the policy honestly, and **move it below P1–P5**. *Medium.* |
| **AI highlight clips** | Senja has excerpts and "moments", but we found no user demand or complaint about clips. It needs transcripts (P5) and trimming (P9) first. A transcript-driven "pick a sentence → make a clip" tool could come later. *Low.* |
| **Spam / AI-generated testimonial detection** | Every submission is already moderated by hand, and Plaudit has a honeypot and rate limit. The FTC rule is about the business publishing fakes, not visitors spamming forms. A cheaper, evidence-backed step is the "requested via signed link" badge from P2 plus the consent ledger (P8). Revisit if spam reports appear. *Low.* |

---

## 7. Recommended next 3 features

1. **Mobile-first recorder plus the ffmpeg pipeline (P1, with P9 trimming close behind).** Collection is the step that matters most. A recording that fails on an iPhone loses the testimonial, and the iOS failure modes are well documented. The ffmpeg worker is also the prerequisite for transcripts (P5), trimming (P9) and Safari playback (SPEC P1 #1), so it unblocks the most later work.
2. **Request links with prefill and reminders (P2).** Getting customers to respond is the most consistent pain after price (C8). Hosted vendors charge for automated requests, while a self-hoster's own SMTP makes it free. Its signed links also support the consent ledger and a "requested" badge.
3. **Full export/import with competitor mappers (P3).** It costs little (M, no dependencies) and delivers the core promise of a self-hosted tool, which is no lock-in. Importers for Senja and Testimonial.to exports turn their users' frustration with caps and per-space pricing (C1, C2) into a one-step move to Plaudit.

The REST API and webhooks (P4) are a close fourth. They are already well specified in SPEC P1 #6 and unlock Slack/Discord notifications (P10) cheaply.

---

## 8. Sources

All were seen as search-result summaries on 2026-10-22. Pages were not opened, because fetches were blocked.

**Review sites**
- G2: [Senja](https://www.g2.com/products/senja/reviews) · [Senja vs Testimonial](https://www.g2.com/compare/senja-vs-testimonial) · [Testimonial](https://www.g2.com/products/testimonial/reviews) · [Vocal Video](https://www.g2.com/products/vocal-video/reviews) · [VideoAsk](https://g2.com/products/videoask-by-typeform/reviews) · [Testimonial Hero](https://www.g2.com/products/testimonial-hero/reviews) · [Trustmary](https://g2.com/products/trustmary/reviews) · [Elfsight pros and cons](https://www.g2.com/products/elfsight/reviews?qs=pros-and-cons)
- Capterra: [VideoAsk reviews](https://www.capterra.com/p/239248/videoask/reviews/) · [VideoAsk pricing](https://www.capterra.com/p/239248/videoask/pricing/) · [VideoAsk AU](https://www.capterra.com.au/software/1018272/videoask) · [Boast AU reviews](https://www.capterra.com.au/reviews/151440/boast) · [Endorsal ZA reviews](https://www.capterra.co.za/reviews/193044/endorsal) · [Trustmary UK](https://www.capterra.co.uk/reviews/214611/trustmary)
- Others: [Software Advice: Boast](https://www.softwareadvice.com/product/470408-Boast/) · [GetApp: Endorsal](https://www.getapp.com/customer-management-software/a/endorsal) · [Shopify App Store: Kudobuzz](https://apps.shopify.com/kudobuzz-testimonials/reviews) · [AppSumo: Elfsight](https://appsumo.com/products/elfsight-2020/reviews/) · [BigCommerce: Elfsight Testimonials Slider](https://www.bigcommerce.com/apps/elfsight-testimonials-slider/) · [TrustRadius: Shoutout.io](https://www.trustradius.com/products/shoutout-io)

**Vendor docs, pricing and changelogs**
- Senja: [free vs paid](https://support.senja.io/what-are-the-differences-between-the-free-and-paid-plans-sdcfs) · [pricing](https://support.senja.io/articles/is-senja-free-about-senjas-pricing-3354w) · [transcriptions](https://support.senja.io/manage-testimonials/what-are-video-transcriptions) · [edit/trim](https://support.senja.io/how-do-i-edit-my-video-testimonial-qdbtx) · [excerpt](https://support.senja.io/what-is-video-excerpt-xn5k4) · [form language](https://support.senja.io/can-i-localize-my-form-language-447d3) · [languages](https://support.senja.io/is-senja-available-in-my-language-cfllf) · [analytics](https://support.senja.io/what-are-testimonial-analytics-etnz4) · [video export](https://support.senja.io/manage-testimonials/how-do-i-download-export-my-video-testimonials) · [AppSumo import](https://support.senja.io/import-testimonials-from-appsumo-2xytv) · [Slack changelog](https://feedback.senja.io/changelog/live-native-slack-notification-is-up-and-running) · [feature requests](https://support.senja.io/how-do-i-request-a-feature-or-integration-kwabz)
- Testimonial.to: [pricing](https://testimonial.to/pricing) · [export](https://help.testimonial.to/en/articles/6304554-export-video-and-text-testimonials) · [trim](https://help.testimonial.to/en/articles/6442675-how-to-trim-your-video) · [Zapier](https://help.testimonial.to/en/articles/6236700-zapier) · [Make](https://help.testimonial.to/en/articles/16529057-connect-testimonial-with-make) · [downgrade](https://help.testimonial.to/en/articles/6892055-how-to-downgrade-or-cancel-a-plan)
- Vocal Video: [pricing](https://vocalvideo.com/pricing) · [teleprompter](https://help.vocalvideo.com/article/128-sharing-scripts-with-a-teleprompter) · [recorder update](https://vocalvideo.com/resources/explore-the-major-upgrade-to-our-video-recorder/) · [llms.txt](https://vocalvideo.com/llms.txt)
- Others: [Trustmary key features](https://trustmary.com/key-features/) · [Famewall automated testimonials](https://famewall.io/automated-testimonial-software/) · [Famewall carousel](https://famewall.io/testimonial-carousel-widget/) · [Endorsal AutoRequests](https://endorsal.io/features/autorequests) · [Elfsight pricing](https://elfsight.com/testimonials-slider-widget/pricing/) · [Typeform community: VideoAsk webhooks](https://community.typeform.com/questions/7404)

**Third-party and competitor blogs** (bias noted in the text)
- [MakerStack: Senja review](https://makerstack.co/reviews/senja-review/) · [Software Finder: Senja](https://softwarefinder.com/customer-service-software/senja) · [ReviewNexa](https://reviewnexa.com/senja-io-review/)
- [Dupple: Testimonial.to](https://dupple.com/tools/testimonial) · [b2bsaasreviews: Testimonial.to](https://b2bsaasreviews.com/products/testimonial-to) · [Creator Economy Tools](https://creatoreconomytools.com/tool/testimonial-to) · [Getcredibly](https://getcredibly.org/blog/testimonial-to-alternatives) · [WiserReview](https://wiserreview.com/blog/testimonial-to-alternatives/) · [RefGrow](https://refgrow.com/blog/video-testimonial-software) · [keywordsearch](https://www.keywordsearch.com/blog/essential-features-of-testimonialto-for-success)
- [FitGap: Vocal Video](https://us.fitgap.com/products/060027/vocal-video) · [StoryPrompt](https://storyprompt.com/blog/the-best-vocal-video-alternative) · [Vocal Video on Boast](https://vocalvideo.com/resources/boast-alternative/)
- [btw.so: VideoAsk](https://www.btw.so/marketing-tools/video-marketing/videoask)
- [WiserNotify: Famewall](https://wisernotify.com/blog/famewall-alternatives/) · [WiserNotify: Shoutout](https://wisernotify.com/blog/shoutout-alternatives/) · [ColdIQ: Shoutout](https://coldiq.com/tools/shoutout)
- [Famewall vs EmbedSocial](https://famewall.io/compare/embedsocial-alternative) · [Tagembed: EmbedSocial](https://tagembed.com/blog/?p=25787) · [SaaSHub](https://www.saashub.com/compare-lightwidget-vs-embedsocial)
- [Elfsight review 2026](https://widgets.code.blog/2026/05/24/elfsight-widgets-review/) · [testimonials.ltd](https://testimonials.ltd/blog/lifetime-deal-testimonial-software)
- [AlternativeTo: Senja](https://alternativeto.net/software/senja) · [Product Hunt: VideoTestimonials](https://www.producthunt.com/p/videotestimonials/videotestimonials)

**Technical, accessibility and regulatory**
- [MediaRecorder browser support](https://www.testmuai.com/learning-hub/mediarecorder-browser-support/) · [Apple forum: long iOS recordings](https://developer.apple.com/forums/thread/694867) · [Apple forum: stop event](https://developer.apple.com/forums/thread/662277)
- [dev.to: 300 KB widgets](https://dev.to/ahnhyeongkyu/stop-shipping-300kb-testimonial-wiwebdev-saas-javascript-testimonialsdgets-theres-a-better-way-3039) · [Testimonials.io: Core Web Vitals](https://testimonials.io/blog/testimonial-widgets-core-web-vitals) · [Pureproof: Core Web Vitals](https://www.getpureproof.com/blog/testimonial-widgets-core-web-vitals)
- [MADA accessible carousel guide](https://ictaccess.mada.org.qa/ui-accessible-component/en/carousel.html)
- [Google: review rich results (2019)](https://developers.google.com/search/blog/2019/09/making-review-rich-results-more-helpful?authuser=1) · [SE Roundtable](https://www.seroundtable.com/google-updates-rules-reviews-rich-results-28232.html)
- [Search Engine Land: FTC final rule](https://searchengineland.com/ftc-fake-reviews-testimonials-445209) · [Sidley: FTC rule](https://datamatters.sidley.com/2024/08/30/u-s-ftcs-new-rule-on-fake-and-ai-generated-reviews-and-social-media-bots/)
- [Paperform: GDPR release template](https://paperform.co/templates/gdpr-photo-video-release-form/) · [Genie AI: testimonial release](https://www.genieai.co/en-gb/template/testimonial-release-form)

---

## Suspicious content

None found in this session. No search result contained instructions aimed at an agent (to install, run, send or do anything). The earlier suspicious package noted in the Senja teardown was not re-encountered.
