# Sign-in and your team

These sign-in methods are for **your dashboard**. The people who send you testimonials never need an account.

Out of the box, the owner signs in with the email and password in `.env` (`ADMIN_EMAIL` and `ADMIN_PASSWORD`). You can also turn on any of these:

| Method | What you need | Good for |
|---|---|---|
| [Email link](#email-link) | Email set up ([guide](EMAIL.md)) | Everyone. No passwords to remember |
| [Google](#google) | A free Google Cloud project | Teams on Gmail or Google Workspace |
| [Apple](#apple) | A **paid** Apple Developer Program membership and an HTTPS domain | People who prefer Apple, including Hide My Email |
| [Single sign-on (OIDC)](#single-sign-on-oidc) | An OpenID Connect provider: Okta, Microsoft Entra ID, Authentik, Keycloak, Zitadel… | Teams that sign in to everything through one company account |

The sign-in page shows only the methods that are set up. **Settings → This server** lists each one as On or Off, and says what's missing.

- [Who can sign in](#who-can-sign-in)
- [Email link](#email-link)
- [Google](#google)
- [Apple](#apple)
- [Single sign-on (OIDC)](#single-sign-on-oidc)
- [Turning the password off](#turning-the-password-off)
- [Trying it on your own computer](#trying-it-on-your-own-computer)
- [Troubleshooting](#troubleshooting)

## Who can sign in

There is one **owner**: the address in `ADMIN_EMAIL`. Everyone else is an **admin** unless the owner gives them another role (below). Admins can do everything except invite, remove or change people.

### Roles and projects

With the `team2` flag (on by default), the owner can give each person a role and, for editors and viewers, the projects they may open. Set it when inviting, or with **Change access** in **Settings → Team** (that works for people let in by `ADMIN_EMAILS` or `ALLOWED_EMAIL_DOMAINS` too):

| Role | May |
|---|---|
| Owner | Everything, including the team, roles, storage and deleting projects. Always `ADMIN_EMAIL` |
| Admin | Everything except the team: settings, API keys, webhooks, notification channels, connected assistants, the audit log, new projects. Always every project |
| Editor | Content in their projects: approve, edit and delete testimonials, forms, widgets, walls, imports and exports, campaigns (start and send them), Stripe and Shopify triggers. Not settings, keys, webhooks or the team |
| Viewer | Look at their projects and share approved testimonials (the image studio, embed codes). Nothing they do changes anything |

The server checks the role and project on every dashboard request: a viewer pressing Approve, or anyone opening another project's address, gets a refusal (a 403, or the not-found page), whatever the browser shows. Lists, analytics and notification emails only include the projects someone may open. Editors and viewers see their role next to **Settings**. Without `team2`, everyone but the owner is an admin with every project, as before.

### The audit log

**Settings → Audit log** (admins, flag `team2`) lists who approved, rejected, hid, edited, retagged, trashed, restored or deleted testimonials, who exported what, and every change to the team, API keys, webhooks, campaigns, Stripe and Shopify triggers, project links and deletions, and connected assistants, through the dashboard or the API. Filter by action, person, project and dates, or **Download CSV**. Entries are kept for `AUDIT_RETENTION_DAYS` (365 by default). They never hold secrets, IP addresses or browser details.

You can let people in three ways, and use any mix of them:

1. **Invite them** in **Settings → Team**. They get an email with a link that signs them in. If email isn't set up, Plaudit shows the link for you to send yourself. The link works once, for 72 hours. After that, they can sign in from the sign-in page as usual.
2. **List them** in `.env`: `ADMIN_EMAILS=ada@example.com,grace@example.com`
3. **Allow a whole domain** in `.env`: `ALLOWED_EMAIL_DOMAINS=yourcompany.com`. Anyone with a *verified* address there can sign in.

Whichever way they were let in, people sign in with an email link, Google, Apple or single sign-on, using that address. The password is only for the owner.

To take someone out:

- If they were invited, press the bin next to their name in **Settings → Team**. They are signed out straight away.
- If they were let in by `ADMIN_EMAILS` or `ALLOWED_EMAIL_DOMAINS`, change `.env` and restart.

Google, Apple and single sign-on accounts are matched by their verified email address. So if `ada@example.com` was invited, she can sign in with an email link, or with a Google or Apple account that uses that address.

## Email link

Set up email first, using the [email setup guide](EMAIL.md). Once **Settings → This server** shows email as **On**, the sign-in page offers **Email me a link**. There's nothing else to configure.

How it works:

- You type your address and get a link. The page always says *"If this address can sign in, we've sent it a link"*, so it can't be used to find out who has access.
- The link works **once**, for **15 minutes**, and only in the **browser where you asked for it**. Someone who sees the email can't use it from another device.
- Opening the link shows a **Sign in** button. Nothing happens until you press it, so email security scanners that open links can't use it up.
- **Limits:**
  - Each device can ask for 3 links per address every 15 minutes, and an address gets at most 10 in that time. Past either limit the page still says the same thing, but nothing is sent, so someone asking for your links can't lock you out.
  - Each device can ask for 5 links in all every 15 minutes. Plaudit tells devices apart by their IP address, so behind a reverse proxy set `TRUST_PROXY=true`. Without it, everyone shares one limit. People behind the same office network or VPN share it too.

## Google

This takes about 10 minutes. You need a Google account; a Google Cloud project is free.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and sign in.
2. **Create a project.** Use the project picker at the top, choose **New project**, and name it, for example "Plaudit".
3. **Set up the consent screen.** Google Cloud may call it **Google Auth Platform** or **OAuth consent screen**.
   - **App name:** for example "Acme testimonials". **User support email:** your address.
   - **Audience:** choose **Internal** if everyone uses your Google Workspace. Otherwise choose **External**.
   - With **External**, the app starts in **Testing**, and only the **test users** you add can sign in. Add yourself and your team, or press **Publish app**.
   - **Contact information:** your address.
   - **Scopes** (data access): `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. These are basic, non-sensitive scopes.
4. **Create the client.** Go to **Credentials** (or **Clients**) → **Create credentials** → **OAuth client ID**.
   - **Application type:** Web application.
   - **Authorised redirect URIs:** add `https://YOUR-DOMAIN/api/auth/callback/google`. It must match `PUBLIC_URL` exactly, including `https://`.
   - Press **Create**.
5. Copy the **Client ID** and **Client secret** into `.env`:

   ```bash
   GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   # Optional, for Google Workspace: suggest and require accounts on this domain
   # GOOGLE_HOSTED_DOMAIN=yourcompany.com
   ```

6. Restart Plaudit: `docker compose up -d`, or stop it and run `npm start` again.
7. Open **Settings → This server**. Google should say **On** and show the redirect URI. Sign out and try **Continue with Google**.

Google only says who someone is. Who may sign in is still decided by [the rules above](#who-can-sign-in).

## Apple

Before you start:

- You need a **paid [Apple Developer Program](https://developer.apple.com/programs/) membership**. A free Apple account isn't enough.
- Plaudit must be on a **real domain with HTTPS**. Apple doesn't accept `localhost` or IP addresses. To try it on your own computer, see [below](#trying-it-on-your-own-computer).

In [developer.apple.com/account](https://developer.apple.com/account), open **Certificates, Identifiers & Profiles**:

1. **Make an App ID.**
   - Go to **Identifiers** → **+** → **App IDs** → **App**.
   - Enter a description (for example "Plaudit") and an explicit Bundle ID (for example `com.yourcompany.plaudit`).
   - Under Capabilities, tick **Sign in with Apple**. Press **Continue**, then **Register**.
2. **Make a Services ID.** This becomes `APPLE_CLIENT_ID`.
   - Go to **Identifiers** → **+** → **Services IDs**.
   - Enter a description (for example "Plaudit sign-in"). This is the name people see when they sign in.
   - Enter an identifier, for example `com.yourcompany.plaudit.signin`. Register it.
3. **Set its domain and return URL.**
   - Open the Services ID, tick **Sign in with Apple**, and press **Configure**.
   - **Primary App ID:** the one from step 1.
   - **Domains and Subdomains:** `YOUR-DOMAIN`, without `https://`.
   - **Return URLs:** `https://YOUR-DOMAIN/api/auth/callback/apple`.
   - Save, then **Continue** and **Save**.
4. **Make a key.**
   - Go to **Keys** → **+**. Name it (for example "Plaudit sign-in"), tick **Sign in with Apple**, and press **Configure**. Pick the App ID from step 1.
   - Press **Save**, **Continue**, then **Register**.
   - **Download the `.p8` file now.** Apple lets you download it only once. Note the **Key ID** shown next to it.
5. **Find your Team ID.** It's in the top right of the developer site, and under **Membership details**.
6. Add the values to `.env`. A `.env` value has to be on one line, so put `\n` where the key file's line breaks are. This command prints the key that way:

   ```bash
   awk 'NF {printf "%s\\n", $0}' AuthKey_ABC123DEFG.p8
   ```

   ```bash
   APPLE_CLIENT_ID=com.yourcompany.plaudit.signin
   APPLE_TEAM_ID=A1B2C3D4E5
   APPLE_KEY_ID=ABC123DEFG
   APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----\n"
   # or, instead of APPLE_PRIVATE_KEY, the path to the file (inside the container, with Docker):
   # APPLE_PRIVATE_KEY_FILE=/run/secrets/AuthKey_ABC123DEFG.p8
   ```

7. Restart Plaudit, then check **Settings → This server**. Apple should say **On**.

**About Hide My Email:** people can choose to hide their address from you. Apple then gives Plaudit a private relay address like `x1y2z3@privaterelay.appleid.com`, which won't match anyone you invited. They'll see a message asking them to sign in again and choose **Share My Email**. Alternatively, you can invite the relay address itself.

Apple sends a person's name only the first time they sign in. Plaudit keeps it from then on.

## Single sign-on (OIDC)

Any provider that speaks OpenID Connect and publishes a discovery document (`<issuer>/.well-known/openid-configuration`) works: Okta, Microsoft Entra ID (Azure AD), Authentik, Keycloak, Zitadel, Auth0, Google Workspace's own OIDC and others. The sign-in page then shows **Continue with** and the name you choose.

1. **In your provider, create an application** (it may be called an app registration, a client or an OAuth2/OpenID provider):
   - **Type:** a web application (confidential client) using the **authorization code** flow.
   - **Redirect URI** (sign-in redirect, callback URL): `https://YOUR-DOMAIN/api/auth/callback/oidc`. It must match `PUBLIC_URL` exactly.
   - **Scopes:** `openid`, `email` and `profile`.
   - Copy the **client ID** and **client secret**, and find the **issuer URL**.
2. **Set it in `.env`:**

   ```bash
   OIDC_ISSUER=https://acme.okta.com              # the issuer URL, as the provider shows it
   OIDC_CLIENT_ID=0oa1b2c3d4…
   OIDC_CLIENT_SECRET=…
   OIDC_LABEL=Okta                                # "Continue with Okta"; default "single sign-on"
   # Optional:
   # OIDC_SCOPES=openid email profile             # openid is always included
   # OIDC_EMAIL_DOMAINS=acme.com                  # only accept addresses at these domains from this provider
   # OIDC_TRUST_EMAIL=true                        # see "Verified addresses" below
   ```

   Typical issuer URLs: Okta `https://<your-org>.okta.com` (or `…/oauth2/default` for its default authorization server); Entra ID `https://login.microsoftonline.com/<tenant-id>/v2.0`; Authentik `https://<host>/application/o/<app-slug>/`; Keycloak `https://<host>/realms/<realm>`. Plaudit reads the rest from the discovery document.
3. **Restart Plaudit** and open **Settings → This server**: **Single sign-on (OIDC)** should say **On** with the redirect URI. Sign out and try the new button.

How it works: the same flow as Google. Each sign-in has a random state, nonce and PKCE code, kept on the server for 10 minutes and tied to your browser by a cookie. Plaudit checks that the discovery document names the issuer you set, logs in to the token endpoint with HTTP Basic (or by posting the secret, if that's all the provider offers), and checks the id_token's signature with the provider's published keys (public-key algorithms only), its issuer, audience, expiry and nonce. After signing in you always land on the dashboard; there's no return address anyone could tamper with.

**Who may sign in doesn't change.** The provider only says who someone is; [the rules above](#who-can-sign-in) still decide whether they get in: the owner, invited people, `ADMIN_EMAILS` and `ALLOWED_EMAIL_DOMAINS`. `OIDC_EMAIL_DOMAINS` is an extra check on top: addresses at other domains are refused from this provider even if they were invited.

**Verified addresses.** Plaudit needs the id_token to say `email_verified: true`, so nobody can claim an address that isn't theirs. Microsoft Entra ID usually leaves that claim out; if every address in your directory is one your organisation controls, set `OIDC_TRUST_EMAIL=true` to accept tokens without it. A token that says `email_verified: false` is refused either way.

## Turning the password off

Once another method works for the owner, you can turn off password sign-in:

```bash
PASSWORD_LOGIN=false
```

As a safety net, this setting is ignored until at least one other method is on, so you can't lock yourself out with a typo. **Settings → This server** says when that's happening. You can also leave `ADMIN_PASSWORD` empty.

## Trying it on your own computer

| Method | On `http://localhost:3000` |
|---|---|
| Email link | Works. Use `MAIL_OUTBOX=true` or Mailpit ([email guide](EMAIL.md#try-it-out-locally)) |
| Google | Works. Add `http://localhost:3000/api/auth/callback/google` as a redirect URI. Google allows `http://` only for localhost |
| Apple | Needs a public HTTPS address. Use a tunnel (see below) |
| Single sign-on | Works if your provider accepts `http://localhost:3000/api/auth/callback/oidc` as a redirect URI (Keycloak and Authentik do; some providers want HTTPS) |

For Apple, run a tunnel such as [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) or [ngrok](https://ngrok.com/docs/getting-started/):

```bash
cloudflared tunnel --url http://localhost:3000   # prints https://something.trycloudflare.com
```

Then:

- Set `PUBLIC_URL` to that HTTPS address, and `COOKIE_SECURE=true`.
- Restart Plaudit.
- Add the address to the Services ID's domains and return URLs.

Each instance's session cookie name includes a short hash of `PUBLIC_URL`. So two Plaudit servers on one computer (say ports 3000 and 3001) no longer sign you out of each other.

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| Google: **Error 400: redirect_uri_mismatch** | The redirect URI in Google Cloud doesn't exactly match Plaudit's | Copy the one shown in **Settings → This server** into the OAuth client's **Authorised redirect URIs**. Check `PUBLIC_URL`: `http` vs `https`, `www`, a trailing port |
| Google: **Error 401: invalid_client**, or "Sign-in was refused: invalid_client" | Wrong client ID or secret | Copy both again from Google Cloud, with no spaces, and restart |
| Google: **Access blocked: … has not completed the Google verification process** or **403: access_denied** | The app is in Testing and this account isn't a test user | Add them as a test user, or publish the app |
| Apple: **invalid_client** | Apple didn't accept the signed client secret | Check `APPLE_CLIENT_ID` is the **Services ID** (not the App ID), and check `APPLE_TEAM_ID`, `APPLE_KEY_ID` and that the key has Sign in with Apple |
| Apple: **Invalid redirect_uri** or **invalid_request** | The return URL or domain isn't registered | Add `https://YOUR-DOMAIN/api/auth/callback/apple` and the domain to the Services ID. Apple refuses `localhost` and `http://` |
| "APPLE_PRIVATE_KEY isn't a valid .p8 key" | The key got mangled in `.env` | Use the `awk` command above, or `APPLE_PRIVATE_KEY_FILE` |
| "… isn't allowed to sign in here" | The address isn't the owner, invited, in `ADMIN_EMAILS` or in an allowed domain | Invite it in **Settings → Team**, or add it to `.env` |
| "… is a private Apple relay address" | They chose Hide My Email | Sign in again and choose **Share My Email**, or invite the relay address |
| Single sign-on: "Sign-in didn't work" and the log says "discovery document names another issuer" | `OIDC_ISSUER` isn't the provider's issuer exactly | Open `<OIDC_ISSUER>/.well-known/openid-configuration` and copy its `issuer` value (a trailing `/` doesn't matter) |
| Single sign-on: "That account's email address isn't verified yet" | The token has no `email_verified: true` (common with Entra ID) | Verify the address with the provider, or set `OIDC_TRUST_EMAIL=true` if you control every address there |
| Single sign-on: "accepts only your organisation's addresses" | The address isn't at a domain in `OIDC_EMAIL_DOMAINS` | Use your work account, or change `OIDC_EMAIL_DOMAINS` |
| Single sign-on: "Sign-in was refused: invalid_client" | Wrong client ID or secret, or the provider wants another way of sending it | Copy both again; check the application is a confidential (web) client |
| "This link has expired" | Sign-in links last 15 minutes; invitations 72 hours | Ask for a new link on the sign-in page |
| "Open this link in the same browser where you asked for it" | The link was opened on another device or browser | Open it where you asked for it, or ask for a new one on this device |
| "This link has already been used" | Each link works once | Ask for a new one |
| No email arrives | Email isn't working | Press **Send test email** in Settings, and see the [email guide](EMAIL.md#troubleshooting) |
| "That sign-in took too long or started in another browser" | More than 10 minutes passed, or cookies were blocked | Try again in one browser tab, with cookies allowed for your Plaudit site |
