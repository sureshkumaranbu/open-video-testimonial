import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import "@/app/admin/admin-kit.css";

/**
 * What a list shows when it has nothing yet: what goes here, and the first
 * thing to do (ONB-06: one primary action). It has no state, so server pages
 * can render it too.
 */
export type EmptyStateProps = {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
  /** The heading level that fits the page outline (default 2). */
  level?: 2 | 3;
};

export function EmptyState({ icon, title, children, action, testId, level = 2 }: EmptyStateProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className="ak-empty" data-testid={testId}>
      {icon && (
        <span className="ak-empty-icon">
          <Icon name={icon} />
        </span>
      )}
      <Heading className="ak-empty-title">{title}</Heading>
      {children && <div className="ak-empty-body">{children}</div>}
      {action && <div className="ak-empty-action">{action}</div>}
    </div>
  );
}
