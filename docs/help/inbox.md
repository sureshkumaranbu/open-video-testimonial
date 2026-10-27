# The inbox

_On by default (the `inbox2` section; `PLAUDIT_FEATURES` can turn it off). Without it, a project opens the classic dashboard._

A project's **Testimonials** tab is where everything that comes in is reviewed, edited and published.

## Tabs

**All · Pending · Approved · Hidden · Rejected · Feedback · Trash**, each with a count that follows your search and filters. The inbox opens on **Pending**.

- **Approved** testimonials are public: they show on your wall, widgets and the API's public feed.
- **Hidden** ones are kept for your own use (a sales deck, say) and never shown publicly.
- **Feedback** holds private answers from forms, which are never published. Delete them from there when you've read them.
- **Trash**: see [The trash](#the-trash). **All** leaves the trash out.

## Search, filters and sort

- **Search** looks through names, emails, companies, job titles, headlines, the text, video transcripts, every answer and tags. Words match from their start ("pric" finds "pricing"), and every word must match. It stays quick with tens of thousands of testimonials.
- **Filters**: rating (including "No rating"), tags (any or all of them), source platform, how it arrived (form, added by hand, CSV import, platform import, API), type (text only, video, image), form, language, what the person's consent covers, word count, the date it was added, and whether it has a photo, a company logo or images. The filters in use show as chips above the list; remove one with its chip, or **Clear filters**.
- **Sort** by date added, date posted, rating, name or word count, either way. Your sort, the card or table view and the page size are remembered for you.
- **Share a view**: the tab, search, filters, sort and page are in the address bar. Copy it, and the link opens the same view.
- Pages hold 25, 50 or 100 testimonials.

## Card and table views

The **card** view shows each testimonial in full, with its video, answers, fields and consent record, and the quick controls (approve, hide, reject, move to pending, rename, tag, delete). The **table** view shows one line each; **Details** opens the drawer.

## Acting on many at once

Tick testimonials (or **Select all on this page**) to get the bulk bar: **Approve**, **Hide**, **Reject**, **Tags…** (add or remove tags, keeping the others), **Export CSV** and **Move to trash**. In the trash: **Restore** and **Delete forever**. Up to 500 at a time.

Rows that can't take the action are skipped, and the result says why: one whose author withdrew consent can only stay rejected, one whose author asked to keep it private can't be approved, one already in that status is left as it is. Each change is recorded in that testimonial's history and sends its own webhook.

## The detail drawer

**Details** opens everything about one testimonial: every answer with its video and captions, images, custom fields and the hidden fields from the link, where it came from (with a link to the original), private feedback, the consent record and the history.

Keys while it's open: **j** next, **k** previous, **a** approve, **h** hide, **Escape** close.

A video testimonial has a **Video** section: trim, poster, replace and download ([video tools](video.md)). **Its page** opens an approved testimonial's own public page, and **Create image** opens it in the [image studio](share.md).

### Editing

**Edit** changes the name, job title, company, website, rating, headline, the text of **every** answer, the date posted, the source platform and link, language and tags. Changing what the author wrote marks the testimonial **Edited after consent**, adds it to the consent record and the history, and keeps your highlights on their phrases.

### Highlights

Select words in any answer, then **Highlight selection**. Highlighted phrases can be emphasised by widgets and walls. Remove one with its ✕. A highlight follows its phrase when the text is edited, and goes when the phrase does.

### History

Who changed what, and when: status changes, edits, answer edits, tags, highlights, the trash and restores, whether made in the dashboard, through the API or by auto-approve.

## The trash

**Delete** on a card moves the testimonial to the trash: it's off every public page at once, and its files are no longer served. **Restore** puts it back with the status it had (one whose author withdrew consent comes back as rejected), and its media is public again if it's approved.

Testimonials are deleted for good after 30 days in the trash (`TRASH_RETENTION_DAYS`), or at once with **Delete forever**, which is only offered in the trash.

## Exporting

**Export** downloads the current view (every page of it, not just the one on screen) as CSV or JSON, with a `custom:<key>` and `hidden:<key>` column for each field. To export only some testimonials, select them and use **Export CSV** in the bulk bar. The full project backup is still under **Import & export**.

## Adding a testimonial by hand

**Add testimonial** is for praise you received somewhere else: an email, a call, a post or a review. Choose **Text**, **Video** (the file is converted and transcribed like any other) or **Image** (a screenshot), then add the person's details, photo and company logo, up to 5 images, where and when it was posted, tags and the status. It's **approved** unless you choose otherwise, no webhooks are sent and auto-approve doesn't apply. The consent record notes that consent was collected outside Plaudit, so keep your own record of it.

## Possible duplicates and merging

With the `customers` section on, the inbox spots testimonials that are probably the same person saying something twice: the same customer or email address, or the same name with very similar words. (Imports never duplicate a review; this is for someone who sent two, or one you added by hand after they sent theirs.) Turn on **Possible duplicates** in Filters to see only those, and the drawer says **Possible duplicate of …** on each.

**Merge into…** in the drawer moves this testimonial into another one of the same person (a likely duplicate, or any other you search for):

- Both stay. This one's words and video become an extra answer on the other, like a form's question 2. Extra answers are for you only, so the other one's public words don't change.
- Its other answers, highlights, tags and images join the other one. Images from a testimonial that wasn't public itself (not approved yet, or kept private, or with narrower consent) stay for you only, so a merge never publishes anything new.
- Its consent record is copied onto the other one's (marked "From merged testimonial …"), and it keeps its own.
- It goes to the trash, marked **Merged into …**, with a line in both histories. **Restore** brings it back to Pending with everything it had; the copy in the other one stays.

Merging isn't offered for a testimonial whose author withdrew consent, or while its video is still processing, and only works within one project.

## Translations

With the `translations` section on, the drawer has a **Translations** section: the testimonial in other languages, each with a language code (`fr`, `de`, `pt-br`). **Add a translation** to write one yourself; with a translation provider on the server (`TRANSLATE_PROVIDER`: DeepL, LibreTranslate or any OpenAI-compatible endpoint, with your own key), **Translate with …** writes it for you (marked **Machine**), and you can edit it after. Each change is in the history.

- **Bulk Translate** (in the bulk bar, with a provider) translates the selected testimonials into the languages you list, in the background. Translations you wrote yourself are kept.
- A form can **translate new testimonials into** some languages as they arrive ([forms guide](forms.md#settings)).
- What the author wrote never changes. A translation is shown only where you ask: a widget set to **Translations: Visitor's language** shows a public testimonial's translation to visitors whose browser asks for that language ([widgets guide](widgets.md#studio)), and a testimonial's own page takes `?lang=fr`. Public pages never call your provider; they only show translations already saved.
- Text goes to your provider only when you translate: from the drawer, a form's setting or bulk Translate. Without a provider, nothing is sent anywhere.
- Translations are in the JSON export and the project's zip export.

## Smart search

With the `aisearch` section on, the **Smart search** switch beside the search box finds testimonials by meaning: "quick delivery" finds "the parcel arrived fast". It needs your own OpenAI-compatible embeddings endpoint (`EMBEDDINGS_MODEL`, `EMBEDDINGS_API_URL`, `EMBEDDINGS_API_KEY`). The best 100 matches show, best first, with your other filters applied.

- **What it sends.** To be searchable, every testimonial's headline, text, transcript and answers are sent to your embeddings provider (new and edited ones within a minute, older ones by an hourly backfill), and each search's words too. Only turn it on with a provider you trust with them. Unchanged text isn't sent twice.
- **When it can't.** Without a provider, or when the provider doesn't answer, it's the usual keyword search, and the inbox says so under the search box.
