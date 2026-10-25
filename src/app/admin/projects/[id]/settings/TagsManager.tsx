"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { BulkBar, Checkbox, ConfirmDialog, EmptyState, Field, toggleValue } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { TagUsage } from "@/lib/projects";
import "@/app/admin/project-settings.css";

const uses = (n: number) => `${n.toLocaleString()} ${n === 1 ? "testimonial" : "testimonials"}`;

/**
 * Every tag of the project, with how many testimonials have it: rename one
 * everywhere at once, merge several into one, or delete one (the testimonials
 * stay). Each change shows in the affected testimonials' history.
 */
export function TagsManager({ projectId, tags: initial, onToast }: { projectId: string; tags: TagUsage[]; onToast: (message: string) => void }) {
  const [tags, setTags] = useState(initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<TagUsage | null>(null);
  const [merging, setMerging] = useState(false);
  const [into, setInto] = useState("");
  const url = `/api/admin/projects/${projectId}/tags`;

  /** Applies the tags list a change answered with, dropping selections that no longer exist. */
  function update(next: TagUsage[]) {
    setTags(next);
    setSelected((s) => s.filter((name) => next.some((t) => t.name === name)));
  }

  function startRename(name: string) {
    setEditing(name);
    setDraft(name);
    setRenameError(null);
  }

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const to = draft.trim().toLowerCase();
    if (to === editing) return setEditing(null);
    setRenaming(true);
    setRenameError(null);
    try {
      const { tags: next } = await api<{ tags: TagUsage[] }>(url, { method: "PATCH", json: { action: "rename", from: editing, to } });
      update(next);
      setEditing(null);
      onToast(`Renamed “${editing}” to “${to}”`);
    } catch (err) {
      setRenameError(errorMessage(err));
    } finally {
      setRenaming(false);
    }
  }

  async function remove() {
    const tag = deleting!;
    const { tags: next } = await api<{ tags: TagUsage[] }>(url, { method: "DELETE", json: { name: tag.name } });
    update(next);
    onToast(`Deleted the tag “${tag.name}”`);
  }

  function openMerge() {
    // Suggest the most used of the selected tags.
    const top = [...tags].filter((t) => selected.includes(t.name)).sort((a, b) => b.count - a.count)[0];
    setInto(top?.name ?? "");
    setMerging(true);
  }

  async function merge() {
    const target = into.trim().toLowerCase();
    if (!target) throw new Error("Give the merged tag a name.");
    const { tags: next } = await api<{ tags: TagUsage[] }>(url, { method: "PATCH", json: { action: "merge", from: selected, into: target } });
    update(next);
    setSelected([]);
    onToast(`Merged into “${target}”`);
  }

  return (
    <section className="panel" aria-labelledby="ps-tags-h" data-testid="tags-manager">
      <div className="panel-head">
        <h2 id="ps-tags-h" className="ps-title">
          <Icon name="filter" />
          Tags
        </h2>
      </div>
      <div className="panel-body stack">
        {tags.length === 0 ? (
          <EmptyState icon="filter" title="No tags yet" level={3}>
            <p>Tags you add to testimonials show up here, so you can rename, merge or tidy them in one place.</p>
          </EmptyState>
        ) : (
          <>
            <p className="muted small">Renaming or deleting a tag changes it on every testimonial at once. Select two or more to merge them.</p>
            <ul className="ps-list" aria-label="Tags">
              {tags.map((t) => (
                <li key={t.name} className="ps-list-row" data-testid="tag-row" data-tag={t.name}>
                  {editing === t.name ? (
                    <form className="ps-rename" onSubmit={rename}>
                      <Field label={`New name for “${t.name}”`} error={renameError}>
                        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={32} autoFocus autoCapitalize="off" spellCheck={false} />
                      </Field>
                      <div className="row">
                        <button type="submit" className="small" disabled={renaming || !draft.trim()}>
                          {renaming ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="ghost small" onClick={() => setEditing(null)} disabled={renaming}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="ps-list-main">
                        <Checkbox
                          label={<span className="ps-tag">{t.name}</span>}
                          checked={selected.includes(t.name)}
                          onChange={() => setSelected((s) => toggleValue(s, t.name))}
                        />
                        <span className="muted small ps-tag-count">{uses(t.count)}</span>
                      </span>
                      <span className="row ps-row-actions">
                        <button type="button" className="ghost small" onClick={() => startRename(t.name)} aria-label={`Rename ${t.name}`}>
                          Rename
                        </button>
                        <button type="button" className="ghost small danger" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`}>
                          Delete
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <BulkBar count={selected.length} onClear={() => setSelected([])} noun={["tag", "tags"]} testId="tags-bulk">
        <button type="button" className="small" onClick={openMerge} disabled={selected.length < 2}>
          Merge…
        </button>
      </BulkBar>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Delete the tag “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete tag"
        busyLabel="Deleting…"
        danger
        testId="delete-tag-dialog"
      >
        {deleting && (
          <p>
            It comes off {deleting.count === 0 ? "no testimonials" : uses(deleting.count)}. The testimonials themselves stay, and widgets or walls
            that show only this tag will show nothing.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={merging}
        onClose={() => setMerging(false)}
        onConfirm={merge}
        title={`Merge ${selected.length} tags`}
        confirmLabel="Merge tags"
        busyLabel="Merging…"
        testId="merge-tags-dialog"
      >
        <p>
          Testimonials tagged {selected.map((s, i) => (
            <span key={s}>
              {i > 0 && (i === selected.length - 1 ? " or " : ", ")}
              <span className="ps-tag">{s}</span>
            </span>
          ))}{" "}
          get the one tag below instead.
        </p>
        <Field label="Merged tag name" hint="One of these, or a new name.">
          <input type="text" value={into} onChange={(e) => setInto(e.target.value)} maxLength={32} autoCapitalize="off" spellCheck={false} />
        </Field>
      </ConfirmDialog>
    </section>
  );
}
