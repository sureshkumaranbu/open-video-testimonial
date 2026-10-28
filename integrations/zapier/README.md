# Plaudit for Zapier

A [Zapier Platform CLI](https://github.com/zapier/zapier-platform/tree/main/packages/cli) app for Plaudit. **It isn't published**: listing it in Zapier's directory needs the project owner's Zapier developer account. You can push it as a private app to your own Zapier account.

| Kind | Name | Plaudit API |
|---|---|---|
| Trigger | New Testimonial | REST hook on `testimonial.created` (`POST`/`DELETE /webhooks`); samples from `GET /projects/{slug}/testimonials` |
| Trigger | Testimonial Approved | REST hook on `testimonial.approved`; samples from `…/testimonials?status=approved` |
| Trigger | New Private Feedback | REST hook on `feedback.created`; samples from `GET /projects/{slug}/feedback` |
| Action | Create Testimonial | `POST /projects/{slug}/testimonials` |
| Action | Send Invite | `POST /invites` |
| Action | Approve Testimonial | `PATCH /testimonials/{id}` with `status: approved` |
| Action | Tag Testimonial | `GET`, then `PATCH /testimonials/{id}` with the tags added |

It uses only the public REST API with an API key. Feedback and the campaign dropdown need the `api2` feature flag on your server (on by default).

Triggers are instant: turning a Zap on subscribes a webhook through `POST /api/v1/webhooks` (a read-and-write key; it shows in Plaudit's **Settings › Webhooks**), and turning it off deletes it. Zapier's samples come from the newest 50 items through the API. Webhooks need the `api2` flag on your server (on by default), and your Plaudit server must reach Zapier on the internet.

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
