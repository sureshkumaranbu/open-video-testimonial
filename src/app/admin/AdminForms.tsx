"use client";

import { Icon } from "@/components/Icon";

/**
 * Signs out and goes to the sign-in page. Its accessible name is always "Sign
 * out"; the app shell passes its own look (className) and label (children).
 */
export function LogoutButton({ className = "ghost small", children, onClick, ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      {...rest}
      type="button"
      className={className}
      aria-label="Sign out"
      onClick={async (e) => {
        onClick?.(e);
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      {children ?? (
        <>
          <Icon name="logout" />
          <span className="hide-narrow">Sign out</span>
        </>
      )}
    </button>
  );
}

/** B-05: ends every session this person has, this one included (the same as Sign out). */
export function SignOutEverywhereButton() {
  return (
    <button
      type="button"
      className="secondary small"
      data-testid="sign-out-everywhere"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
    >
      Sign out everywhere
    </button>
  );
}
