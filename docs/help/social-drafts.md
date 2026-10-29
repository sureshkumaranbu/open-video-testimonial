# Social post drafts

When you approve a testimonial, Plaudit writes a short post about it for X and LinkedIn: a quote in the customer's own words, their name and role, and a link to the testimonial's own page. You can edit it, copy it, or open X's or LinkedIn's share page with it. Plaudit never posts for you and never asks for your social accounts. With the `commerce` feature flag (on by default).

## In the inbox

Open an approved testimonial. The drawer's **Social post** panel shows the draft:

```
“We get ten testimonials a week now. The team loves it.”
— Ada Lovelace, CTO at Acme
```

- The quote is the start of what they wrote (whole sentences when they fit; for a video, its transcript), never words they didn't use.
- It fits one post on X with the link (X counts any link as 23 characters); the counter says how much room is left.
- **Save** keeps your edits. **Use the template** goes back to the draft Plaudit made.
- **Copy** copies the post and its link.
- **Post on X** opens X's own share page with the text and link filled in. **Share on LinkedIn** opens LinkedIn's share page with the link; paste the copied text there.
- If the testimonial has a social clip (Video tools › Social clip), **Download it** to attach it to your post.
- **Rewrite with AI** appears when your server has an AI provider and AI is on for the project ([insights.md](insights.md#ai)). It sends the testimonial's words and the current draft, and suggests a new post. A suggestion is kept only when its quote is the customer's own words, word for word, and is in the post; otherwise your draft stays. Nothing is saved until you click Save. Every request is in the audit log.

Viewers can see and copy drafts; editors change them.

## Send drafts to Buffer or Typefully

Every `testimonial.approved` webhook carries the draft as `data.socialDraft` ([API.md](../API.md#webhooks)):

- `socialDraft.text`: the post without the link,
- `socialDraft.url`: the testimonial's page,
- `socialDraft.post`: the text, a blank line and the link, ready to post,
- `socialDraft.shareUrls.x` and `.linkedin`: the share links,
- `socialDraft.clip.url`: the social clip, when there is one (download it with your API key).

The webhook fires when you approve, with the template draft. To send your edits too, also tick **testimonial.social_draft_updated** on the webhook: it fires each time someone saves the draft (or puts it back to the template), with the same `data.socialDraft`. Your automation can then update or replace the queued post.

First, in Plaudit, go to **Settings › Webhooks** and add a webhook with the address your automation tool gives you (below), choosing the event **testimonial.approved** and, if you like, one project.

### Zapier and Buffer

1. In Zapier, create a Zap. Trigger: **Plaudit › Testimonial approved** (the Plaudit app; [integrations.md](integrations.md)), or **Webhooks by Zapier › Catch Hook** and paste its URL into Plaudit's webhook.
2. Approve a testimonial in Plaudit so Zapier sees a sample.
3. Action: **Buffer › Add to Queue**. Choose your X or LinkedIn channel.
4. For **Text**, pick `data socialDraft post` (or `data socialDraft text`, and put `data socialDraft url` in **Link**).
5. Optionally add a **Filter** step first, for example only when `data testimonial rating` is 5, or only for one project.
6. Test the step and turn the Zap on. Each approval now lands in your Buffer queue for you to review.

### Zapier and Typefully

1. Same trigger as above.
2. Action: **Typefully › Create Draft**.
3. **Content**: `data socialDraft post`. Leave scheduling empty to keep it as a draft, or choose "next free slot".
4. Test and turn it on. The draft waits in Typefully for you to edit and publish.

### Make

1. Create a scenario. First module: **Webhooks › Custom webhook**; copy its address into Plaudit's webhook.
2. Approve a testimonial so Make learns the data structure.
3. Add **Buffer › Create a status update** (choose the profile, set **Text** to `data.socialDraft.post`), or **HTTP › Make a request** to Typefully's API (`POST https://api.typefully.com/v1/drafts/` with your Typefully API key in the `X-API-KEY` header and the body `{"content": "{{data.socialDraft.post}}"}`).
4. Optionally add a filter between them (`event` equals `testimonial.approved`, a rating, a project).
5. Run once to test, then switch the scenario on.

### n8n

1. Add a **Webhook** node (POST); copy its production URL into Plaudit's webhook. To check Plaudit's signature, turn on **Raw Body** and add a Code node as in [API.md](../API.md#connecting-n8n).
2. Add an **IF** node: `{{$json.body.event}}` equals `testimonial.approved` (and any rating or project rule you like).
3. For Buffer, add an **HTTP Request** node to Buffer's API with your access token, sending `{{$json.body.data.socialDraft.post}}` as the text for your profile. For Typefully, an **HTTP Request** node: POST `https://api.typefully.com/v1/drafts/`, header `X-API-KEY` with your Typefully key, JSON body `{"content": "{{$json.body.data.socialDraft.post}}"}`.
4. Activate the workflow.

Buffer's and Typefully's own menus and API details change from time to time; if a field name above has moved, their help pages have the current one. Plaudit's side, `data.socialDraft`, stays as described.

## Turning it off

Leave `commerce` out of `PLAUDIT_FEATURES` and the panel, the drafts and the webhook field go; nothing else changes.
