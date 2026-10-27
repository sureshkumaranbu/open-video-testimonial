# Analytics

How your widgets, forms, walls and review snippets are doing, without cookies and without tracking anyone. Open **Analytics** in the top bar for every project at once, or the panel at the bottom of a widget, form or wall (and **Renders by day** on a snippet in the SEO tab).

This page also explains exactly what is collected and what isn't. You're welcome to show it, or link to it, from your own privacy notice.

## What you see

**The dashboard** (`/admin/analytics`) has a period (the last 7, 30 or 90 days, 12 months, or two dates of your choice, as far back as you like) and compares it with the period of the same length just before. Pick one project or all of them. It shows:

- **New testimonials**, split into forms, imports, added by hand and the API.
- **Waiting for review**: how many are pending right now, and how long the oldest has waited.
- **Average rating** of everything sent in the period, including private low-rating feedback, so a 1-star that went to private feedback still counts.
- **Widget views, visitors and clicks** (read more, the link to the original review, the call to action or rating badge, and video plays).
- **Form views and completions**, with the completion rate.
- **Wall views and call to action clicks.**
- **Review booster clicks** (from the booster's own daily counts).
- **Snippet renders**: how often a page, or a search engine, loaded a dynamic review snippet.
- **Invitations**: campaign emails sent in the period, then opened (only for campaigns that track opens), clicked, started and answered.
- **Views by day**, with the previous period as a dashed line, and tables of widgets, forms and walls you can sort by any column.

**A widget** shows where it's live ("Live on example.com/pricing", and the other pages it was seen on in the last 7 days), views, visitors, clicks by kind, its top pages and the comparison with the period before. The widget list says the same in a line under each name.

**A form** shows views, visitors, starts (someone moved past the first page), completions and the completion rate, the average rating, and **where people stop**: how many visitors reached each page, then how many sent it. The classic one-page form counts views and completions only.

**A wall** shows views, visitors, clicks on its call to action buttons (the hero button and the one between cards) and clicks on its other links (logo, header links, original reviews).

## "Your widget seems to be off your site"

Once a widget has been seen on a website, Plaudit notices when it stops: after **7 days with no views from any page**, it's marked as not seen. You'll see an alert on the Projects page, the widget list, the dashboard and the widget itself, and you can hide it. If you turned on **Settings → Notifications → When a widget stops showing on your site**, you also get an email. As soon as a page shows it again, the alert clears by itself.

Views on Plaudit's own hosted link (`/embed/w_…`) are counted but never make a widget "live". When the hosted link is shown in an iframe on your site, the page around it is used instead (browsers usually pass on only its site, such as `example.com`, not the full path).

Webhooks can hear about it too: `widget.installed` (the first view from a site, or the first after it was reported missing) and `widget.removed`. Both are opt-in: tick them on the webhook ([API.md](../API.md#webhooks)).

## What is collected

For each view or click, Plaudit stores one row with:

- which widget, form, wall or snippet it was, and what happened (a view, a kind of click, a form start, a form page reached, a completion, a snippet render);
- for widgets, the page it happened on, as the address **without its query string or fragment** (`https://example.com/pricing`, never `?email=…` or `#…`). For snippets, only the site (`https://example.com`). For forms, the page number reached;
- the day and time;
- a **visitor id**: a hash of the visitor's IP address, their browser's user agent and your project, mixed with a random value (a salt) that the server makes each day. The salt never leaves the server and is deleted after two days, so nobody, including you and us, can work out the IP address from the hash or recognise the same person on another day or in another project.

That's all. **Not collected:** cookies, local storage or any other id kept in the browser; IP addresses; user agents or device details; query strings, fragments, referrers or page titles; names, emails or anything typed into a form (form submissions are stored as testimonials, as always, not as analytics); anything from other websites. No third-party script is loaded: the widget, walls and forms only ever talk to your own Plaudit server.

A **visitor** is counted once a day. Over a period, the visitors number adds up each day's, so someone who comes back on three days counts three times. Days are in UTC.

Search engines, link previews and similar robots aren't counted as visitors, except for snippet renders, which exist for search engines.

## How long it's kept

- **Single events** are deleted after **30 days** (once that day has been added to the daily totals).
- **Daily totals** (counts and visitors per day, per widget, form, wall or snippet, and each widget's top pages) are kept for as long as you keep the project, so the dashboard has no 30-day limit.
- **Salts** are deleted after two days.

Deleting a project deletes its analytics. Today's numbers are read live; finished days are added to the totals by an hourly job.

## Limits that protect your database

The collection endpoints are public, so they're careful with what they accept:

- Each request must be small (2 KB) and in the expected shape; anything else, and anything for an unknown, deleted or draft widget, form or wall, is ignored. The answer is always empty.
- Each IP address can send 600 events in 10 minutes. The address is only held in memory for this, never stored.
- One visitor counts at most 50 times a day for each kind of event on each widget, form or wall: a page reloading itself in a loop isn't an audience.
- A day keeps each widget's 100 busiest pages; the rest add up under "Other pages".
- Each widget, form, wall or snippet stores at most 50,000 events a day. Past that, events are counted as "not counted" and the dashboard says so. Real traffic stays well below it.

## Turning it off

Set `ANALYTICS=off` on the server and restart. Nothing is collected or stored from then on (the widget's beacons are answered and dropped), the analytics pages and panels disappear, and the hourly job only deletes what's older than 30 days. You can also hide just the pages, keeping collection on, by leaving `analytics` out of `PLAUDIT_FEATURES` (see the README's [Turning sections off](../../README.md#turning-sections-off)).
