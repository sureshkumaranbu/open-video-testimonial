# Plaudit for Zapier

A [Zapier Platform CLI](https://github.com/zapier/zapier-platform/tree/main/packages/cli) app for Plaudit. **It isn't published**: listing it in Zapier's directory needs the project owner's Zapier developer account. You can push it as a private app to your own Zapier account.

| Kind | Name | Plaudit API |
|---|---|---|
| Trigger | New Testimonial | `GET /projects/{slug}/testimonials` (polling) |
| Trigger | Testimonial Approved | `GET /projects/{slug}/testimonials?status=approved` (polling) |
| Trigger | New Private Feedback | `GET /projects/{slug}/feedback` (polling; needs `api2`) |
| Action | Create Testimonial | `POST /projects/{slug}/testimonials` |
| Action | Send Invite | `POST /invites` |
| Action | Approve Testimonial | `PATCH /testimonials/{id}` with `status: approved` |
| Action | Tag Testimonial | `GET`, then `PATCH /testimonials/{id}` with the tags added |

It uses only the public REST API with an API key. Feedback and the campaign dropdown need the `api2` feature flag on your server (on by default).

Triggers poll every few minutes (Zapier's schedule) and look at the newest 50 items. **Testimonial Approved** follows creation order, so approving a testimonial that's older than the newest 50 approved ones won't trigger it. For instant events, use Plaudit's signed webhooks with "Webhooks by Zapier › Catch Hook" and check the `Plaudit-Signature` header in a Code step ([docs/API.md](../../docs/API.md#verifying-webhook-signatures)).

## Try it in your own Zapier account

```bash
npm install -g zapier-platform-cli
cd integrations/zapier
npm install
zapier login
zapier register "Plaudit (private)"
zapier push
```

Update `zapier-platform-core` in package.json to the version your CLI expects (`zapier validate` says so). Then connect it with your Plaudit address and an API key (read and write, for the actions). Plaudit's unit tests (`tests/integrations.test.ts`) run each trigger and action against a stand-in for Zapier's `z.request` and check the requests match the API; they don't run Zapier itself.
