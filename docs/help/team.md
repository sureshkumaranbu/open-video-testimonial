# Your team: roles, projects and the audit log

People you invite under **Settings › Team** can sign in with an email link, Google, Apple or single sign-on ([setting those up](../AUTH.md)). With the `team2` flag (on by default), the owner also chooses what each person may do.

## Roles

| Role | What they can do |
|---|---|
| **Owner** | Everything. Only the owner invites, removes and changes people, moves storage and deletes projects. It's the `ADMIN_EMAIL` address |
| **Admin** | Everything else: settings, API keys, webhooks, notification channels, connected assistants, the audit log and new projects, in every project |
| **Editor** | The content of their projects: approving, editing and deleting testimonials, forms, widgets, walls, imports, exports, campaigns (including starting them) and Stripe or Shopify triggers |
| **Viewer** | Looking at their projects and sharing approved testimonials: the image studio, embed codes, analytics |

New people are admins unless you choose otherwise when you invite them. Editors and viewers see their role in the top bar. What a role can't do is refused by the server, so a button that slipped through only shows an error.

## Projects

An editor or viewer can open **every project** (including new ones) or only those you tick. Everywhere else, the other projects simply don't exist for them: not in the project list, analytics, search or emails. Change it any time with **Change access** next to their name; it applies to their next click.

People let in by `ADMIN_EMAILS` or an allowed domain are admins until you change their access here. Someone from an allowed domain appears in the list once they've signed in.

## API keys and assistants

Admins can make an API key for a single project (**Settings › API keys › Reaches**). AI assistants connected by signing in act as the person who connected them, with that person's role and projects ([mcp.md](mcp.md)).

## The audit log

**Settings › Audit log** (admins) shows who did what, newest first:

- testimonials approved, rejected, hidden, moved back to pending, edited, retagged, trashed, restored, deleted, added by hand or through the API, and bulk actions;
- exports (CSV, JSON and .zip);
- people invited, removed or given another role; API keys created or revoked; webhooks added, changed or deleted; assistants connected or disconnected;
- campaigns started, paused or deleted, Stripe and Shopify triggers, project links changed and projects deleted.

Filter by action, person, project and dates, and **Download CSV** for what matches. Changes made with an API key show the key's name. Entries are kept for a year (`AUDIT_RETENTION_DAYS`) and never include passwords, keys, IP addresses or browser details. With `team2` off nothing is recorded.
