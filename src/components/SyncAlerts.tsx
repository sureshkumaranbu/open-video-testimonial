import Link from "next/link";
import type { FailingSync } from "@/lib/importers/sync";

/** IMP-02: the in-app notice for automatic imports that failed 3 times in a row (they keep trying). */
export function SyncAlerts({ alerts }: { alerts: FailingSync[] }) {
  if (!alerts.length) return null;
  return (
    <div className="stack" data-testid="sync-alerts">
      {alerts.map((a) => (
        <div key={a.id} className="notice small" role="status">
          The automatic import from <strong>{a.label}</strong> has failed {a.failures} times in a row{a.lastError ? ` (${a.lastError})` : ""}. Plaudit keeps trying.{" "}
          <Link href={`/admin/projects/${a.projectId}/data`}>Check it</Link>
        </div>
      ))}
    </div>
  );
}
