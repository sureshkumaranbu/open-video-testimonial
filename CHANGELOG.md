# Changelog

## Unreleased

- **Home page: real sample video testimonials.**
  - The sample clips and faces are now licensed stock footage from Pexels, with every source listed in [`docs/CREDITS.md`](docs/CREDITS.md).
  - The hero demo's Recording step plays a muted, looping clip, but only while it's in view, and shows the poster instead with reduced motion or Save-Data.
  - A wall of video cards now sits near the top.
  - Every sample card shows a face.
  - Names and quotes stay fictional and are labelled as samples.

## 0.2.0

The top features from [`docs/research/feature-opportunities.md`](docs/research/feature-opportunities.md).

- **Mobile-first recorder.**
  - MP4 recording on Safari and iOS, a countdown, on-screen questions, a portrait layout and a camera switch.
  - A per-project time limit, and a "use camera app" fallback.
- **Resumable uploads.** Video uploads in pieces while it records and resumes after dropped connections.
- **Video conversion.** With ffmpeg, every video becomes MP4 (H.264/AAC) with a poster, and the original is kept. ffmpeg is in the Docker image.
- **Transcripts and captions** from a local program (such as whisper.cpp) or an OpenAI-compatible API. Both are editable, and captions are on by default in every player.
- **Consent ledger.** Versioned wording, scopes, an append-only history, an "edited after consent" flag and a private withdrawal link.
- **Request links.** Prefilled personal links, invitations and reminders through your own SMTP, one-click unsubscribe, and receipt emails.
- **REST API** (`/api/v1`, OpenAPI 3.1) with read and read-write keys, plus **signed webhooks** with retries and a delivery log.
- **Import and export.**
  - One-zip export of everything, which imports as a new project on any server.
  - CSV import with a column mapper and optional media download.
- A Settings page showing which optional features are on, plus API keys and webhooks.

Database migrations `0001` to `0005` are applied automatically on start-up. Existing videos are converted in the background once ffmpeg is available.

## 0.1.0

The first release: collection page, dashboard, wall of love, script and iframe embeds, and Docker.
