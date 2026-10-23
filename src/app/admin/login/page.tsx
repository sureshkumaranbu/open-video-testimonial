import { signInMethods } from "@/lib/sign-in";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

/** Why a Google or Apple sign-in came back here, by its ?error= code. */
const ERRORS: Record<string, string> = {
  "not-allowed": "isn't allowed to sign in here. Ask the owner to invite this address.",
  "private-relay":
    "is a private Apple relay address, which hasn't been invited. Sign in again and choose “Share My Email”, or ask the owner to invite the relay address.",
  unverified: "That account's email address isn't verified yet. Verify it with the provider, then try again.",
  "wrong-domain": "Use your work Google account for this team.",
  expired: "That sign-in took too long or started in another browser. Please try again.",
  cancelled: "Sign-in was cancelled.",
  "not-configured": "That sign-in method isn't set up on this server.",
  failed: "Sign-in didn't work. Please try again; if it keeps failing, the owner can check the server log.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const code = typeof params.error === "string" ? params.error : "";
  const email = typeof params.email === "string" ? params.email.slice(0, 254) : "";
  const message = ERRORS[code] ? (code === "not-allowed" || code === "private-relay" ? `${email || "That address"} ${ERRORS[code]}` : ERRORS[code]) : null;
  const m = signInMethods();
  return <LoginForm methods={{ password: m.password, email: m.email, google: m.google, apple: m.apple }} error={message} />;
}
