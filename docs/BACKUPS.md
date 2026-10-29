# Backups and recovery

Plaudit keeps everything in one SQLite database plus the media files. Postgres (TEAM-06) is deferred: SQLite in WAL mode handles a single server well, and the steps below cover backups and moving to a new machine.

What to back up, all under `DATA_DIR` (`/data` in Docker):

| What | Where | Notes |
|---|---|---|
| The database | `plaudit.db` (or `DATABASE_PATH`) | Copy it with SQLite's backup command, never with `cp` while the server runs |
| Media | `uploads/` | Only with the default `STORAGE_DRIVER=local`. With S3, turn on versioning for the bucket instead |
| Temporary files | `tmp/` | Not needed |

## A nightly copy

SQLite's online backup is safe while Plaudit is running:

```bash
sqlite3 /data/plaudit.db ".backup /backups/plaudit-$(date +%F).db"
```

Copy `uploads/` alongside it (for example with `rsync -a /data/uploads/ /backups/uploads/`), and keep a few days of copies somewhere other than the server.

The zip export (Settings → Import & export) is per project and is meant for moving a project, not for backing up the whole server.

## Continuous copies with Litestream

[Litestream](https://litestream.io) streams every change in the database to S3-compatible storage, so you lose at most a few seconds if the server dies. Plaudit already uses WAL mode, which Litestream needs. A minimal `litestream.yml`:

```yaml
dbs:
  - path: /data/plaudit.db
    replicas:
      - url: s3://your-bucket/plaudit
```

Run `litestream replicate -config litestream.yml` next to Plaudit, as a second container sharing the `/data` volume or as a service on the host. Give it the bucket's credentials the way its docs describe. To recover on a new machine, before starting Plaudit:

```bash
litestream restore -config litestream.yml -o /data/plaudit.db /data/plaudit.db
```

Then restore `uploads/` (or point the new server at the same S3 bucket) and start Plaudit with the same `SESSION_SECRET` and settings.

## Moving to a new server

1. Stop Plaudit, or take a `.backup` copy as above.
2. Copy `plaudit.db` and `uploads/` to the new server's `DATA_DIR`.
3. Start it with the same settings. Migrations run on start and never rewrite existing tables.

Keep the same `SESSION_SECRET` if you want everyone to stay signed in. Sales-popup purchase matching uses the server's own key, which lives in the database, so it moves with it.
