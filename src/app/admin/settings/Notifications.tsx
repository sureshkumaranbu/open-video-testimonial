"use client";

/**
 * A slot in Settings for the signed-in person's email notifications and the
 * team's chat channels (INT-01, INT-02). Filled in by WP7.1 and shown only
 * with the `notifications` feature on. Renders nothing for now.
 */
export function Notifications({ email, projects }: { email: string; projects: { id: string; name: string }[] }) {
  return null;
}
