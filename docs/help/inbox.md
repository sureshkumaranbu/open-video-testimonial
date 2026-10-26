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
