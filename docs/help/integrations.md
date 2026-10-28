# Zapier, Make, n8n and React

Ready-made connections to other tools, in the repository's [`integrations/`](../../integrations/) and [`packages/`](../../packages/) folders. They use only Plaudit's REST API (with an [API key](../API.md#keys)) and its signed webhooks. None is listed in a marketplace yet, because that needs the project owner's accounts there; until then, you add them yourself as described below. For WordPress see [wordpress.md](wordpress.md); for AI assistants, [mcp.md](mcp.md).

## Zapier

A Zapier app ([`integrations/zapier/`](../../integrations/zapier/)) you can push to your own Zapier account as a private app (its README has the commands).

- **Triggers:** New Testimonial, Testimonial Approved, New Private Feedback. They're instant: turning a Zap on subscribes a webhook through the API (it shows in **Settings › Webhooks**), turning it off removes it.
- **Actions:** Create Testimonial (the person's consent is required), Send Invite (through an active campaign), Approve Testimonial, Tag Testimonial.

Zapier's samples (when you set up a step) come from the newest 50 items. Use a read-and-write key.

## n8n

Two workflows to import ([`integrations/n8n/`](../../integrations/n8n/)):

- **Approved testimonials to Slack**: Plaudit's webhook, a Code node that checks the signature over the raw body, then a Slack message with the quote.
- **Invites after a purchase**: your shop's webhook, then `POST /api/v1/invites`, so the campaign's invitation goes out 7 days later.

## Make

A scenario blueprint ([`integrations/make/`](../../integrations/make/)): your shop's webhook, then `POST /api/v1/invites`. Its README also explains how to check Plaudit's signature in a Make filter.

## React (`@plaudit/react`)

[`packages/react/`](../../packages/react/) has `PlauditWidget` (a saved widget; with optional server-rendered HTML for search engines) and `PlauditForm` (a form as the iframe embed, growing with each step). Both render safely on the server. It isn't on npm yet: build it from the folder or copy its source. Its README has examples for Next.js.

## Triggers without code

A campaign's **incoming webhook URL** (its Auto-collect tab) takes an invite from any tool that can send a webhook, with no API key ([campaigns.md](campaigns.md)).
