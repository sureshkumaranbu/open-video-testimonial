import { cookies } from "next/headers";
import Link from "next/link";
import { LINK_COOKIE, LINK_PROBLEMS, peekLoginToken } from "@/lib/login-links";
import { Button } from "@/components/ui/button";
import { SignInFrame } from "../SignInFrame";
import { ConfirmLink } from "./ConfirmLink";

export const metadata = { title: "Sign in" };

/**
 * Where emailed links land. Opening it changes nothing (mail scanners open
 * links too); the button signs in.
 */
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const token = (await searchParams).token;
  const raw = typeof token === "string" ? token : "";
  const result = peekLoginToken(raw, (await cookies()).get(LINK_COOKIE)?.value);
  return (
    <SignInFrame>
      {"problem" in result ? (
        <>
          <h1 className="font-display text-[1.875rem] leading-tight font-bold tracking-tight text-foreground">This link can&apos;t be used</h1>
          <p className="error" role="alert">
            {LINK_PROBLEMS[result.problem!]}
          </p>
          <Button asChild className="w-full">
            <Link href="/admin/login">Go to sign-in</Link>
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-[1.875rem] leading-tight font-bold tracking-tight text-foreground">
              {result.purpose === "invite" ? "Accept your invitation" : "Sign in to Plaudit"}
            </h1>
            <p className="text-muted-foreground">
              as <strong className="font-semibold text-foreground">{result.email}</strong>
            </p>
          </div>
          <ConfirmLink token={raw} label={result.purpose === "invite" ? "Accept and sign in" : "Sign in"} />
        </>
      )}
    </SignInFrame>
  );
}
