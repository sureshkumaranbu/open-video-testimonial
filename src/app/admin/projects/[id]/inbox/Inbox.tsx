"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/db/schema";
import type { SystemStatus } from "@/lib/system";
import { accentStyle } from "@/lib/theme";
import { toInboxParams, type InboxPrefs, type InboxQuery } from "@/lib/inbox-query";
import { api, errorMessage } from "@/app/admin/api";
import { EmptyState, Toast, useSelection } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { AutoApprovePanel, EmbedPanel, ProjectHead, SettingsPanel } from "../Dashboard";
import { ManualAddModal } from "../ManualAddModal";
import { InboxBulkBar } from "./BulkBar";
import { CardView } from "./CardView";
import { DetailDrawer } from "./DetailDrawer";
import { FeedbackList } from "./FeedbackList";
import { FilterPanel, activeFilters, clearFilter } from "./FilterPanel";
import { InboxPager } from "./Pager";
import { TableView } from "./TableView";
import { InboxToolbar } from "./Toolbar";
import { EMPTY_TEXT, TAB_LABELS, type BulkResult, type InboxCounts, type InboxFacetsJson, type InboxPage, type InboxStats } from "./types";
import "@/app/admin/inbox.css";

const busy = (s: string) => s === "queued" || s === "processing";

/** The request for a view: sort, direction and size always explicit, so the server never guesses. */
function requestParams(q: InboxQuery) {
  const sp = toInboxParams(q);
  sp.set("tab", q.tab);
  sp.set("sort", q.sort);
  sp.set("dir", q.dir);
  sp.set("size", String(q.pageSize));
  return sp;
}

/** The address-bar form: defaults left out, except where they differ from what this person would get by default. */
function addressParams(q: InboxQuery, prefs: InboxPrefs) {
  const sp = toInboxParams(q);
  if (q.sort !== prefs.inboxSort) sp.set("sort", q.sort);
  if (q.dir !== prefs.inboxDir) sp.set("dir", q.dir);
  if (q.pageSize !== prefs.pageSize) sp.set("size", String(q.pageSize));
  return sp;
}

const VERB: Record<string, string> = {
  approve: "approved",
  hide: "hidden",
  reject: "rejected",
  pending: "moved to pending",
  tag: "tagged",
  untag: "untagged",
  trash: "moved to the trash",
  restore: "restored",
  delete: "deleted for good",
};

/**
 * Inbox v2 (INBOX-01..09, 15): status tabs with live counts, search,
 * filters, sort and pages on the server, the view in the address bar, card
 * and table views, bulk actions, the detail drawer and the trash. The cards
 * keep the classic dashboard's controls, labels and test ids.
 */
export function Inbox({
  project: initialProject,
  publicUrl,
  system,
  initialQuery,
  initialPrefs,
  widgetStudio,
  shareStudio,
  publicPages = false,
  customers = false,
  initialOpenId,
}: {
  project: Project;
  publicUrl: string;
  system: SystemStatus;
  initialQuery: InboxQuery;
  initialPrefs: InboxPrefs;
  widgetStudio?: string;
  /** The image studio (SHARE-01), when the share flag is on: the drawer's "Create image" goes there. */
  shareStudio?: string;
  /** Testimonials' own pages (/t/, WALL-04) are on with the walls flag. */
  publicPages?: boolean;
  /** INBOX-11, INBOX-12: customer links, "Possible duplicates" and "Merge into…" (customers flag). */
  customers?: boolean;
  /** Opens this testimonial in the drawer at once (the "Review and approve" link in notifications). */
  initialOpenId?: string;
}) {
  const [project, setProject] = useState(initialProject);
  const [query, setQuery] = useState<InboxQuery>(initialQuery);
  const [prefs, setPrefs] = useState<InboxPrefs>(initialPrefs);
  const [page, setPage] = useState<InboxPage | null>(null);
  const [facets, setFacets] = useState<InboxFacetsJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: "error" } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ action: string; result: BulkResult } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const seq = useRef(0);

  const items = useMemo(() => page?.items ?? [], [page]);
  const ids = useMemo(() => items.map((t) => t.id), [items]);
  const selection = useSelection(ids);
  const counts: InboxCounts | null = page?.counts ?? null;
  const stats: InboxStats = page?.stats ?? { pending: 0, approved: 0, video: 0 };

  const load = useCallback(
    async (withFacets = false) => {
      const n = ++seq.current;
      const sp = requestParams(query);
      if (withFacets) sp.set("facets", "1");
      try {
        const data = await api<InboxPage>(`/api/admin/projects/${project.id}/testimonials?${sp}`);
        if (n !== seq.current) return; // a newer view is already loading
        setPage(data);
        if (data.facets) setFacets(data.facets);
        setError(null);
      } catch (e) {
        if (n === seq.current) setError(errorMessage(e));
      }
    },
    [project.id, query],
  );

  // The first load also fetches what the filter panel offers.
  const first = useRef(true);
  useEffect(() => {
    void load(first.current);
    first.current = false;
  }, [load]);

  // The view lives in the address bar, so copying the URL shares it.
  useEffect(() => {
    const sp = addressParams(query, prefs).toString();
    const url = `${window.location.pathname}${sp ? `?${sp}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [query, prefs]);

  // Keep the selection to rows still on screen.
  const { prune } = selection;
  useEffect(() => prune(), [ids, prune]);

  // Refresh while videos are converting, so results show up by themselves.
  const processing = items.some((t) => busy(t.mediaStatus) || busy(t.transcriptStatus));
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [processing, load]);

  const change = useCallback((patch: Partial<InboxQuery>) => {
    setQuery((q) => ({ ...q, page: 1, ...patch }));
  }, []);

  const savePrefs = useCallback((patch: Partial<InboxPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    // Remembering the view is a convenience; a failure only means it isn't remembered.
    void api("/api/admin/me/prefs", { method: "PUT", json: { ui: patch } }).catch(() => undefined);
  }, []);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await load(true);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [load],
  );

  const update = (id: string, patch: Record<string, unknown>) =>
    act(() => api(`/api/admin/testimonials/${id}`, { method: "PATCH", json: patch }));
  const trash = (id: string) => {
    if (!confirm("Move this testimonial to the trash? You can restore it for 30 days.")) return;
    void act(() => api(`/api/admin/testimonials/${id}/trash`, { method: "POST" }));
  };
  const restore = (id: string) => act(() => api(`/api/admin/testimonials/${id}/restore`, { method: "POST" }));
  const deleteForever = (id: string) => {
    if (!confirm("Delete this testimonial and its files for good? This can't be undone.")) return;
    void act(() => api(`/api/admin/testimonials/${id}`, { method: "DELETE" }));
  };

  async function bulk(action: string, tags?: string[]) {
    const chosen = selection.selectedIds;
    if (!chosen.length) return;
    if (action === "delete" && !confirm(`Delete ${chosen.length === 1 ? "this testimonial" : `these ${chosen.length} testimonials`} and their files for good? This can't be undone.`)) return;
    try {
      const result = await api<BulkResult>(`/api/admin/projects/${project.id}/testimonials/bulk`, { method: "POST", json: { action, ids: chosen, tags } });
      selection.clear();
      setBulkResult({ action, result });
      await load(true);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: "error" });
    }
  }

  async function exportSelection(format: "csv" | "json") {
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, ids: selection.selectedIds }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "The export failed. Try again.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `plaudit-${project.slug}-selection.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: "error" });
    }
  }

  const exportHref = (format: "csv" | "json") => {
    const sp = requestParams({ ...query, page: 1 });
    sp.delete("size");
    sp.set("format", format);
    return `/api/admin/projects/${project.id}/export?${sp}`;
  };

  const tab = query.tab;
  const filters = activeFilters(query, facets);
  const transcription = system.transcription.enabled && system.ffmpeg;
  const view = prefs.inboxView;
  const openIndex = openId ? ids.indexOf(openId) : -1;
  // When the open testimonial leaves the list (approved from Pending, say), j and k carry on from where it was.
  const lastIndex = useRef(-1);
  useEffect(() => {
    if (openIndex >= 0) lastIndex.current = openIndex;
  }, [openIndex]);
  const gone = openId !== null && openIndex < 0 && lastIndex.current >= 0;
  const prevId = gone ? ids[lastIndex.current - 1] : openIndex > 0 ? ids[openIndex - 1] : undefined;
  const nextId = gone ? ids[lastIndex.current] : openIndex >= 0 ? ids[openIndex + 1] : undefined;

  const cardProps = {
    transcription,
    onUpdate: update,
    onTrash: trash,
    onHide: (id: string) => update(id, { status: "hidden" }),
    onRestore: restore,
    onDeleteForever: deleteForever,
    onOpen: setOpenId,
    onReprocess: (id: string) => act(() => api(`/api/admin/testimonials/${id}/reprocess`, { method: "POST" })),
    onTranscribe: (id: string) => act(() => api(`/api/admin/testimonials/${id}/transcribe`, { method: "POST" })),
    selection,
  };

  return (
    <div className="stack-lg" style={accentStyle(project.accentColor)} data-testid="inbox">
      <ProjectHead project={project} actions={<ManualAddModal projectId={project.id} onAdded={() => void load(true)} />} />

      <div className="stat-row">
        <div className="stat pending">
          <strong>{stats.pending}</strong>
          <span>Waiting for review</span>
        </div>
        <div className="stat">
          <strong>{stats.approved}</strong>
          <span>Live on your site</span>
        </div>
        <div className="stat">
          <strong>{stats.video}</strong>
          <span>Video testimonials</span>
        </div>
      </div>

      <div className="workspace">
        <section className="queue ib-queue" aria-label="Testimonials">
          <div className="segmented status-filter ib-tabs" role="group" aria-label="Filter by status">
            {TAB_LABELS.map((t) => (
              <button key={t.id} type="button" aria-pressed={tab === t.id} title={t.hint} onClick={() => change({ tab: t.id })} data-tab={t.id}>
                {t.label}
                <span className="count">{counts ? counts[t.id] : 0}</span>
              </button>
            ))}
          </div>

          {tab !== "feedback" && (
            <InboxToolbar
              query={query}
              view={view}
              filtersOpen={filtersOpen}
              filterCount={filters.length}
              onSearch={(q) => change({ q })}
              onToggleFilters={() => setFiltersOpen((o) => !o)}
              onSort={(sort, dir) => {
                change({ sort, dir });
                savePrefs({ inboxSort: sort, inboxDir: dir });
              }}
              onView={(v) => savePrefs({ inboxView: v })}
              exportHref={exportHref}
            />
          )}
          {tab !== "feedback" && filtersOpen && <FilterPanel query={query} facets={facets} onChange={change} duplicates={customers} />}
          {tab !== "feedback" && filters.length > 0 && (
            <div className="ib-active row" data-testid="active-filters">
              <span className="muted xsmall">Filtered by</span>
              {filters.map((f) => (
                <button key={f.id} type="button" className="ib-chip" onClick={() => change(clearFilter(f.id))} aria-label={`Remove filter ${f.label}`}>
                  {f.label}
                  <Icon name="close" />
                </button>
              ))}
              <button type="button" className="ghost small" onClick={() => change(clearFilter("*"))}>
                Clear filters
              </button>
            </div>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {bulkResult && (
            <div className="notice ib-bulk-result" role="status" data-testid="bulk-result">
              <div className="row spread">
                <strong>
                  {bulkResult.result.updated.length} {VERB[bulkResult.action] ?? "updated"}
                  {bulkResult.result.skipped.length > 0 && `, ${bulkResult.result.skipped.length} skipped`}
                </strong>
                <button type="button" className="ghost small" onClick={() => setBulkResult(null)}>
                  Dismiss
                </button>
              </div>
              {bulkResult.result.skipped.length > 0 && (
                <ul className="small" data-testid="bulk-skipped">
                  {bulkResult.result.skipped.slice(0, 20).map((s) => (
                    <li key={s.id}>
                      {items.find((t) => t.id === s.id)?.authorName ?? "One testimonial"}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "feedback" ? (
            <FeedbackList projectId={project.id} version={feedbackVersion} onChanged={() => {
              setFeedbackVersion((v) => v + 1);
              void load();
            }} />
          ) : (
            <>
              {!page && !error && <p className="muted">Loading testimonials…</p>}
              {page && items.length === 0 && !filters.length && !query.q && tab !== "trash" && page.counts.all === 0 && (page.counts.trash ?? 0) === 0 ? (
                // ONB-06: a project with nothing yet gets one clear next step.
                <EmptyState
                  icon="inbox"
                  title="No testimonials yet"
                  testId="inbox-empty"
                  action={
                    <a className="button" href={`${publicUrl}/c/${project.slug}`} target="_blank" rel="noreferrer">
                      Open your collection form
                    </a>
                  }
                >
                  <p>{EMPTY_TEXT[tab]} Share the link with customers, or import reviews you already have from Import &amp; export.</p>
                </EmptyState>
              ) : page && items.length === 0 && (
                <div className="empty">
                  <Icon name="inbox" />
                  <p>{filters.length || query.q ? "Nothing matches these filters. Remove one to see more." : EMPTY_TEXT[tab]}</p>
                </div>
              )}
              {items.length > 0 &&
                (view === "table" ? <TableView items={items} {...cardProps} /> : <CardView items={items} {...cardProps} />)}
              {page && (
                <InboxPager
                  page={query.page}
                  pageSize={query.pageSize}
                  total={page.total}
                  onPage={(p) => setQuery((q) => ({ ...q, page: p }))}
                  onPageSize={(size) => {
                    change({ pageSize: size });
                    savePrefs({ pageSize: size });
                  }}
                />
              )}
              <InboxBulkBar
                count={selection.count}
                tab={tab}
                onClear={selection.clear}
                onAction={(a, tags) => void bulk(a, tags)}
                onExport={(f) => void exportSelection(f)}
                tags={facets?.tags ?? []}
              />
            </>
          )}
        </section>

        <aside>
          <EmbedPanel slug={project.slug} publicUrl={publicUrl} widgetStudio={widgetStudio} />
          <AutoApprovePanel project={project} onSaved={setProject} />
          <SettingsPanel project={project} onSaved={setProject} />
        </aside>
      </div>

      <DetailDrawer
        id={openId}
        position={openIndex >= 0 ? { index: openIndex, count: ids.length } : null}
        onClose={() => {
          setOpenId(null);
          lastIndex.current = -1;
        }}
        onPrev={prevId ? () => setOpenId(prevId) : undefined}
        onNext={nextId ? () => setOpenId(nextId) : undefined}
        onChanged={() => void load(true)}
        tags={facets?.tags ?? []}
        shareStudio={shareStudio}
        publicPages={publicPages}
        customers={customers}
        projectId={project.id}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} onDismiss={() => setToast(null)} testId="inbox-toast" />
    </div>
  );
}

export type CardCallbacks = {
  transcription: boolean;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void> | void;
  onTrash: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onOpen: (id: string) => void;
  onReprocess: (id: string) => void;
  onTranscribe: (id: string) => void;
  selection: ReturnType<typeof useSelection>;
};
