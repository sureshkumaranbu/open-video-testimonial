"use client";

import { Pager } from "@/components/admin";
import { PAGE_SIZES, type PageSize } from "@/lib/inbox-query";

/** Server-side pages of 25, 50 or 100 (INBOX-05). */
export function InboxPager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: PageSize) => void;
}) {
  return (
    <Pager
      page={page}
      pageSize={pageSize}
      total={total}
      onPage={onPage}
      pageSizes={PAGE_SIZES}
      onPageSize={(n) => onPageSize(n as PageSize)}
      label="Testimonial pages"
      testId="inbox-pager"
    />
  );
}
