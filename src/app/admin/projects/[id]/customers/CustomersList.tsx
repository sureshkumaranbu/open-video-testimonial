"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { EmptyState, Pager, SearchField } from "@/components/admin";
import type { CustomerListItem } from "@/lib/customer-records";
import "@/app/admin/customers.css";

type Page = { items: CustomerListItem[]; total: number; page: number; pageSize: number };

/** INBOX-12: the project's customers, searchable, with how much each one has sent and been sent. */
export function CustomersList({ projectId, initial }: { projectId: string; initial: Page }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page>(initial);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (page > 1) sp.set("page", String(page));
      const next = await api<Page>(`/api/admin/projects/${projectId}/customers?${sp}`);
      if (n === seq.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    }
  }, [projectId, q, page]);

  useEffect(() => {
    // The server already rendered the first page.
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
  }, [load]);

  if (initial.total === 0 && !q && data.total === 0) {
    return (
      <EmptyState icon="user" title="No customers yet" testId="customers-empty">
        <p>A record appears for each person when their first testimonial arrives, from a form, an import or one you add yourself.</p>
      </EmptyState>
    );
  }

  return (
    <div className="stack" data-testid="customers">
      <div className="cu-toolbar">
        <div className="cu-search">
          <SearchField
            label="Search customers"
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Name, email or company…"
            testId="customers-search"
          />
        </div>
        <p className="muted small" role="status">
          {data.total === 1 ? "1 customer" : `${data.total.toLocaleString("en")} customers`}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data.items.length === 0 ? (
        <div className="empty">
          <p>Nobody matches “{q}”. Try part of a name or email address.</p>
        </div>
      ) : (
        <div className="panel">
          <table className="cu-table" data-testid="customers-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Email</th>
                <th scope="col" className="cu-num">Testimonials</th>
                <th scope="col" className="cu-num">Feedback</th>
                <th scope="col" className="cu-num">Invitations</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} data-testid="customer-row">
                  <td>
                    <Link className="cu-name" href={`/admin/projects/${projectId}/customers/${c.id}`}>
                      {c.name}
                    </Link>
                    {(c.title || c.company) && <div className="muted xsmall">{[c.title, c.company].filter(Boolean).join(", ")}</div>}
                  </td>
                  <td data-label="Email">{c.email ?? <span className="muted">No email</span>}</td>
                  <td className="cu-num" data-label="Testimonials" data-testid="customer-testimonials">
                    {c.testimonials}
                  </td>
                  <td className="cu-num" data-label="Feedback">
                    {c.feedback}
                  </td>
                  <td className="cu-num" data-label="Invitations">
                    {c.invites}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} label="Customer pages" />
    </div>
  );
}
