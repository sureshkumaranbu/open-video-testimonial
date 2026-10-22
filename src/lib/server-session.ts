import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

/** For server components: returns the session or redirects to the login page. */
export async function requireAdminPage() {
  const store = await cookies();
  const session = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/admin/login");
  return session;
}
