# Contributing

Thanks for helping! Bug reports, fixes, translations and docs are all welcome.

## Getting set up

```bash
npm ci
cp .env.example .env      # set ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET
npm run dev               # http://localhost:3000
```

Install ffmpeg to work on video conversion or transcripts. For email work, set `MAIL_OUTBOX=true` and read the `.eml` files in `data/mail-outbox`.

## Before opening a pull request

```bash
npm run typecheck
npm test            # fast, no browser
npm run test:e2e    # builds the app and runs Playwright in Chromium
```

- Add or update tests with your change. Pure logic goes in Vitest (`tests/`), and anything a person clicks goes in Playwright (`e2e/`).
- Database changes: edit `src/db/schema.ts`, then run `npm run db:generate -- --name short_description` and commit the new file in `drizzle/`. Migrations run automatically at start-up, so never edit one that's already released.
- Keep new dependencies to a minimum and explain why one is needed in the PR. Pin to a release that is at least two weeks old.
- No telemetry, trackers or calls to outside services that the owner hasn't configured.
- This project is a clean-room implementation. Don't copy code, text, styles or assets from commercial testimonial products.

## Project notes

- This uses **Next.js 16**, so some APIs differ from older guides. The docs ship in `node_modules/next/dist/docs/`.
- Background work (video conversion, email, webhooks, imports) runs through the SQLite job queue in `src/lib/jobs.ts`. Register handlers in `src/lib/worker.ts`.
