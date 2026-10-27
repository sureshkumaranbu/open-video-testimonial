# Campaigns

_On by default (the `campaigns` section; `PLAUDIT_FEATURES` can turn it off). Without it the **Campaigns** tab is hidden; the API, the webhook and links in emails already sent keep working. Sending needs email set up on the server ([docs/EMAIL.md](../EMAIL.md))._

A campaign emails a group of people your own invitation to leave a testimonial, follows up with reminders, and shows how far each person got. The **Requests** tab stays as it was for quick one-off links; campaign recipients are listed on their campaign, not there.

## Making one

1. Open the project's **Campaigns** tab, name the campaign and press **Create campaign**. If the project has more than one form, choose the one the links open.
2. A new campaign is a **draft**: nothing is sent. Write the email on the **Email** tab and add people on **Recipients**.
3. Press **Start campaign**. Everyone added so far gets the invitation, and anyone added later gets it straight away.

**Pause** stops new invitations and reminders until you press **Resume**; reminders that came due meanwhile go out then. **Delete** removes the campaign and its recipients (their links stop working); testimonials they sent stay.

## The email

| Setting | What it does |
|---|---|
| Sender name | The name people see. The address is always your server's `SMTP_FROM` |
| Reply-to | Where replies go, if not to `SMTP_FROM` |
| Subject and message | Your wording. `{{name}}`, `{{first_name}}`, `{{company}}`, `{{title}}`, `{{project}}` and `{{link}}` are filled in for each person, and so is any extra column of your CSV (`{{plan}}` for a "plan" column). The Requests tab's `{name}` style works too. When someone has no name, `{{first_name}}` becomes "there" |
| Button text | The button in the email. `{{link}}` on a line of its own becomes the button; leave it out and the button goes after your message |
| Right-to-left text | For Arabic, Hebrew, Persian or Urdu wording |
| Reminders | Up to three, each a number of days after the invitation (any days you like, such as 2, 5 and 10). They stop when the person responds, says no thanks or unsubscribes |
| Track opens | Off by default. When on, the email carries a tiny image from your server, so you can see who opened it |

Every email also ends with a **No thanks** link and an **unsubscribe** link; you can't remove them.

**Preview.** The preview beside the editor is built by the same code that builds the real email, so it's what people get. It shows your unsaved changes, as a sample person or as any recipient (**Preview as**), in the email or plain-text version. The open pixel is left out, so previewing never counts as an open.

**Send a test to me.** Sends the email, marked "[Test]", to the address you're signed in with, using the sample person. It also shows what your sending domain publishes for SPF and DMARC. That's information only: a missing record never stops a campaign, but mail is more likely to land in spam without them ([how to add them](../EMAIL.md#make-sure-mail-lands-in-the-inbox)).

## Recipients

Add people four ways:

- **Paste or CSV.** One person per line (`name, email, company`, or just an address), or a CSV with a header row. Columns called name (or first name and last name), email, company and title (or job title or role) are recognised; every other column becomes a variable for the email.
- **Customers.** Pick people the project already knows, with a search.
- **One person.** Name, email, company and job title.
- **Auto-collect.** From your other tools (below).

After each import the report lists **every row that was skipped**, with its line number and why:

| Reason | Meaning |
|---|---|
| Not a valid address | The row has no usable email address |
| Already in this campaign | The address is already a recipient, or appears twice in the import |
| Unsubscribed | The address unsubscribed from this project's emails |
| Already responded | The address already sent this project a testimonial |

## Tracking

Each recipient shows their furthest step, and the **funnel** at the top counts them:

| Step | Recorded when |
|---|---|
| Queued | The invitation is waiting to go out (with "Scheduled for" when it's delayed) |
| Sent | The mail server accepted it |
| Bounced | The mail server refused the address for good while sending. Later bounce emails aren't read |
| Failed | Sending gave up for another reason (the reason is shown) |
| Opened | The email's image loaded, only when **Track opens** is on. The count includes everyone who clicked, because many mail apps hide images |
| Clicked | They pressed the link or button in the email |
| Started | They opened the form through their personal link |
| Responded | They sent a testimonial through it; it's marked **Requested** in the inbox |
| Said no thanks | They pressed **No thanks**. Their reminders stop |
| Unsubscribed | They unsubscribed. This stops every email from the project to that address, in every campaign and request |

Only times are stored: no IP addresses and no browser details. **No thanks** opens a page with one button, because mail security scanners open every link in a message and would otherwise decline on people's behalf.

**Copy link** gives you a recipient's personal link to send another way, and **Send again** re-sends the invitation while the campaign is sending.

## Auto-collect

Invite people automatically, for example a few days after they buy. Both ways need the campaign to be **sending**; while it's a draft or paused they're refused, so nothing is lost silently.

- **Incoming webhook.** On the **Auto-collect** tab press **Create webhook URL** and copy it: it's shown once. Your shop, CRM or automation tool (n8n, Zapier, Make) sends `POST` JSON such as `{"email": "ada@example.com", "name": "Ada", "plan": "Pro"}`. Extra fields become variables; `"delayDays": 3` (or `?delay=3` on the URL) sends the invitation three days later. **Regenerate URL** replaces it if it leaks; the old one stops working at once.
- **REST API.** `POST /api/v1/invites` with a read-and-write API key from **Settings**, the campaign id from the Auto-collect tab, and the same fields. See [docs/API.md](../API.md#campaign-invites).

People already in the campaign, unsubscribed or who already responded are skipped, so sending the same person twice never emails them twice.

For your own automations, the opt-in webhook events `invite.sent`, `invite.opened`, `invite.clicked` and `invite.declined` are under **Settings → Webhooks**.
