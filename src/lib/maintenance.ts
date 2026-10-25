/**
 * Periodic housekeeping: `trash.purge` (every 6 h, deletes testimonials
 * trashed more than TRASH_RETENTION_DAYS ago) and `maintenance.word-count`
 * (hourly, fills word_count where it's null). Filled in by WP1.3; until then
 * this registers nothing.
 */
export function registerMaintenanceJobs(): void {}
