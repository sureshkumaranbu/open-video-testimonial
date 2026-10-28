# Integrations

Ready-made connections to other tools. Each one uses only Plaudit's public REST API (`/api/v1`, with an API key) and its signed webhooks, both described in [docs/API.md](../docs/API.md). None of them is published in a marketplace yet: listing them needs the project owner's accounts at Zapier, Make, n8n and WordPress.org.

| Folder | What it is | Licence |
|---|---|---|
| [`wordpress/plaudit/`](wordpress/) | WordPress plugin: settings, a block, `[plaudit]` shortcodes, SEO mode, a site-wide toast | GPL-2.0-or-later (WordPress.org requires it) |
| [`zapier/`](zapier/) | Zapier Platform CLI app: new and approved testimonials, private feedback; create, approve, tag, invite | MIT |
| [`n8n/`](n8n/) | Two n8n workflows to import: approved testimonials to Slack (signature checked), and invites after a purchase | MIT |
| [`make/`](make/) | A Make scenario blueprint: invites after a purchase | MIT |
| [`../packages/react/`](../packages/react/) | `@plaudit/react`: `PlauditWidget` and `PlauditForm` | MIT |

The MCP server for AI assistants is built into Plaudit itself: see [docs/help/mcp.md](../docs/help/mcp.md).

`tests/integrations.test.ts` checks that these files exist, that every API path they call is in Plaudit's OpenAPI description, that the shortcode attributes match the docs, and (when PHP is installed) lints the plugin and runs its rendering through a small harness. None of them has been run inside the real Zapier, Make, n8n or WordPress yet.
