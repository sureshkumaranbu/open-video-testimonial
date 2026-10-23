import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName, sessionFromToken } from "./auth";

/** For server components: returns the session or redirects to the login page. */
export async function requireAdminPage() {
  const store = await cookies();
  const session = sessionFromToken(store.get(sessionCookieName())?.value);
  if (!session) redirect("/admin/login");
  return session;
}
