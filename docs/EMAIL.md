# Set up email

Plaudit sends three kinds of plain-text email: **invitations** from Requests, **reminders**, and **receipts** with a private withdrawal link. It sends them through an SMTP server you choose. That can be your mailbox provider (Gmail, Microsoft 365, Zoho, Hostinger…) or a transactional email service (Resend, Postmark, SendGrid, Mailgun, Amazon SES, Brevo).

Email is optional. Without it, Requests still makes personal links that you can send yourself.

- [1. Pick a provider](#1-pick-a-provider)
- [2. Add the settings](#2-add-the-settings)
- [3. Check it works](#3-check-it-works)
- [Provider recipes](#provider-recipes)
- [Make sure mail lands in the inbox](#make-sure-mail-lands-in-the-inbox)
- [Troubleshooting](#troubleshooting)
- [Try it out locally](#try-it-out-locally)

## 1. Pick a provider

- **Just you, a few requests a week:** the mailbox you already have is fine. Gmail, Google Workspace, Zoho, Hostinger or your web host's mailbox all work.
- **Many requests, or your own domain:** a transactional email service is more reliable. Most have a free tier, and they give you the DNS records that keep mail out of spam.

## 2. Add the settings

Put two settings in `.env`. Copy the exact values from a [recipe below](#provider-recipes).

```bash
SMTP_URL=smtps://you%40example.com:your-password@smtp.example.com:465
SMTP_FROM="Your Company <you@example.com>"
```

- `SMTP_URL` is the mail server, with your login inside it. It starts with:
  - `smtps://` for port **465**, which uses TLS from the start
  - `smtp://` for ports **587**, **25** and **2525**, which upgrade to TLS with STARTTLS
- An `@` in the username must be written `%40`. Other special characters in the password (`/ : # ? % +`) must be URL-encoded too. If that's awkward, use separate settings instead:

  ```bash
  SMTP_HOST=smtp.example.com
  SMTP_PORT=465
  SMTP_USER=you@example.com
  SMTP_PASSWORD=pa/ss:word#1      # as is, no encoding
  # SMTP_SECURE=true              # implied by port 465; false for 587, 25 and 2525
  ```

  If both are set, `SMTP_URL` wins.
- `SMTP_FROM` is who the mail comes from. It **must** be an address your provider lets you send as: usually your own login, a verified alias, or any address on a verified domain.

  > **Don't leave `SMTP_FROM` unset.** Without it, mail goes out as `no-reply@localhost`, which real mail servers refuse. **Settings → This server** shows a warning when this happens.

Restart Plaudit after any change:

- Docker: `docker compose up -d`
- Without Docker: stop the server, then run `npm start` again

## 3. Check it works

1. Sign in and open **Settings**. Under **This server**, the Email line should say **On: sending as** followed by your `SMTP_FROM`.
2. Press **Send test email**. It goes to your sign-in address unless you type another one.
   - If it sends, check the inbox. Look in the spam folder too; if it's there, see [deliverability](#make-sure-mail-lands-in-the-inbox).
   - If it fails, you'll see the mail server's exact words and a hint. Look the error up in [Troubleshooting](#troubleshooting).
3. Once you're using it, **Requests** shows each person's email status:
   - **Retrying: …** means a send failed and will be tried again. The reason is shown.
   - **Failed: …** means it gave up. A wrong password, or a sender or address the server refused, fails straight away, since retrying wouldn't help. Fix the setting, then press **Send again**.

## Provider recipes

Replace the values in capitals. Each recipe links to the provider's own page, so you can check the values there. Providers change their settings from time to time.

### Gmail and Google Workspace

1. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv) for the account.
2. Create an [App Password](https://myaccount.google.com/apppasswords). Google shows 16 letters; enter them without spaces. Your normal password won't work.
   - App Passwords aren't offered with Advanced Protection, when 2-Step Verification uses only security keys, or when a Workspace admin has turned them off.
   - Changing your Google password deletes your App Passwords.

```bash
SMTP_URL=smtps://YOU%40gmail.com:APPPASSWORD@smtp.gmail.com:465
SMTP_FROM="Your Name <YOU@gmail.com>"
```

- From must be the account itself, or an address added under Gmail's **Settings → Accounts → Send mail as**.
- Docs: [App Passwords](https://support.google.com/accounts/answer/185833), [SMTP settings](https://support.google.com/a/answer/176600).

### Microsoft 365 (work or school accounts)

1. An admin turns on **Authenticated SMTP** for the mailbox: Microsoft 365 admin center → **Users → Active users** → the user → **Mail → Manage email apps**.
   - It's off by default for organisations created after January 2020.
   - Security defaults also turn it off.

```bash
SMTP_URL=smtp://YOU%40YOURCOMPANY.COM:PASSWORD@smtp.office365.com:587
SMTP_FROM="Your Company <YOU@YOURCOMPANY.COM>"
```

- Use port 587. 465 isn't supported.
- From must be the mailbox you sign in as, or one it has **Send As** rights on. Otherwise you'll get error `5.7.60`.
- **Heads-up:** Microsoft is retiring password sign-in for SMTP.
  - At the end of December 2026, it will be turned off by default for existing organisations. Admins can turn it back on.
  - New organisations created after that won't have it, and it is due to be removed for good in the second half of 2027.
  - For something that keeps working, use a transactional service below.
- Docs: [send email from an application](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365), [enable SMTP AUTH](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission), [deprecation timeline](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835).

### Outlook.com, Hotmail and Live (personal accounts)

These don't work with Plaudit. Since September 2024, personal Microsoft accounts only allow SMTP with OAuth sign-in, not a password. Use one of the other options. ([Microsoft's announcement](https://techcommunity.microsoft.com/t5/outlook-blog/keeping-our-outlook-personal-email-users-safe-reinforcing-our/ba-p/4164184))

### Zoho Mail

```bash
SMTP_URL=smtps://YOU%40YOURDOMAIN.COM:PASSWORD@smtp.zoho.com:465
SMTP_FROM="Your Company <YOU@YOURDOMAIN.COM>"
```

- Paid organisation accounts use `smtppro.zoho.com` instead.
- Accounts in other regions use a different host. Zoho shows the right one for your account in its mail settings, under **Server Configuration**.
- With two-factor sign-in on, use an **Application-Specific Password** instead of your normal one.
- Docs: [Zoho SMTP settings](https://www.zoho.com/mail/help/zoho-smtp.html).

### Hostinger email

```bash
SMTP_URL=smtps://YOU%40YOURDOMAIN.COM:MAILBOXPASSWORD@smtp.hostinger.com:465
SMTP_FROM="Your Company <YOU@YOURDOMAIN.COM>"
```

- The values are in hPanel → **Emails → Manage → Connect Apps & Devices**.
- Docs: [Hostinger email configuration](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/).

### cPanel hosting mailboxes

In cPanel, open **Email Accounts**, choose **Connect Devices** for the mailbox, and copy the **outgoing server** and **SMTP port**. They're often `mail.YOURDOMAIN.COM` and 465, but use what your host shows.

```bash
SMTP_URL=smtps://YOU%40YOURDOMAIN.COM:MAILBOXPASSWORD@mail.YOURDOMAIN.COM:465
SMTP_FROM="Your Company <YOU@YOURDOMAIN.COM>"
```

### Resend

First verify your domain in Resend. The username is literally `resend`, and the password is an API key.

```bash
SMTP_URL=smtps://resend:RE_API_KEY@smtp.resend.com:465
SMTP_FROM="Your Company <hello@YOURDOMAIN.COM>"
```

- Port 2465 works the same way. For STARTTLS, use `smtp://` with 587 or 2587.
- Docs: [Resend SMTP](https://resend.com/docs/send-with-smtp).

### Postmark

Use the **Server API Token** (not the Account token) as both the username and the password.

```bash
SMTP_URL=smtp://SERVER_TOKEN:SERVER_TOKEN@smtp.postmarkapp.com:587
SMTP_FROM="Your Company <hello@YOURDOMAIN.COM>"
```

- Postmark doesn't support port 465. Use 587, 2525 or 25, with `smtp://`.
- From must be a confirmed Sender Signature or on a verified domain.
- Docs: [Postmark SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp), [sender signatures](https://postmarkapp.com/developer/user-guide/managing-your-account/managing-sender-signatures).

### SendGrid

The username is literally `apikey`. The password is an API key with at least **Mail Send** permission.

```bash
SMTP_URL=smtps://apikey:SG.YOUR_API_KEY@smtp.sendgrid.net:465
SMTP_FROM="Your Company <hello@YOURDOMAIN.COM>"
```

- Or use `smtp://` with 587 or 2525.
- From must be a verified Single Sender or on an authenticated domain.
- Docs: [SendGrid SMTP](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api), [sender identity](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sender-identity).

### Mailgun

Use the sending domain's **SMTP login** and SMTP password, from the domain's SMTP credentials in the Mailgun dashboard. Your Mailgun account password won't work.

```bash
SMTP_URL=smtp://postmaster%40MG.YOURDOMAIN.COM:SMTP_PASSWORD@smtp.mailgun.org:587
SMTP_FROM="Your Company <hello@MG.YOURDOMAIN.COM>"
```

- Domains in Mailgun's EU region use `smtp.eu.mailgun.org`.
- Docs: [Mailgun SMTP](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp).

### Amazon SES

Create **SMTP credentials** in the SES console. They are not your IAM access keys, and they only work in the region they were made for.

```bash
SMTP_HOST=email-smtp.REGION.amazonaws.com    # e.g. email-smtp.eu-west-1.amazonaws.com
SMTP_PORT=465
SMTP_USER=SMTP_USERNAME
SMTP_PASSWORD=SMTP_PASSWORD                  # often contains / or +, so the separate settings are easier
SMTP_FROM="Your Company <hello@YOURDOMAIN.COM>"
```

- From must be a verified identity: an address or a domain.
- New accounts start in the **sandbox**, where they can only send to verified addresses, up to 200 messages a day. Request production access before inviting real people.
- Docs: [SES SMTP](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html), [SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html), [leaving the sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

### Brevo

In Brevo's SMTP settings, create an **SMTP key** (not an API key) and copy the **SMTP login** shown there.

```bash
SMTP_URL=smtp://SMTP_LOGIN:SMTP_KEY@smtp-relay.brevo.com:587
SMTP_FROM="Your Company <hello@YOURDOMAIN.COM>"
```

- If the login looks like `12345@smtp-brevo.com`, write the `@` as `%40`.
- From must be a verified sender or on an authenticated domain. The SMTP login itself is not a valid From address.
- Docs: [Brevo SMTP](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP), [senders](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).

## Make sure mail lands in the inbox

Gmail, Yahoo and Microsoft check that mail really comes from the domain it claims. When you send from your own domain (`hello@yourcompany.com`), add these DNS records with your domain registrar or DNS host:

- **SPF:** a `TXT` record that lists who may send for the domain. Your provider tells you what to include.
- **DKIM:** a key record (`TXT` or `CNAME`) your provider gives you, so receivers can check the mail's signature.
- **DMARC:** a `TXT` record at `_dmarc.yourcompany.com`, for example `v=DMARC1; p=none; rua=mailto:you@yourcompany.com`. Tighten it to `p=quarantine` once SPF and DKIM pass.

Transactional services and Google Workspace / Microsoft 365 walk you through these when you verify the domain. Sending from a plain `@gmail.com` address needs none of this.

Also:

- `SMTP_FROM` must be a verified sender.
- Set `PUBLIC_URL` to your real address, so links in emails don't point to localhost.

## Troubleshooting

**Send test email** and the Requests page show the mail server's exact error. Common ones:

| Error contains | What it means | Fix |
|---|---|---|
| `ECONNREFUSED`, `ETIMEDOUT`, `connect` | Plaudit can't reach the mail server | Check the host and port. Many hosts block outgoing mail ports (see below). Try 587 or 2525, or ask your host to unblock them |
| `ENOTFOUND` | The host name doesn't exist | Check the spelling of the host |
| `EAUTH`, `535`, `Invalid login`, `Username and Password not accepted` | Wrong username or password | Gmail and Zoho with two-factor sign-in need an app password. Write `@` in the username as `%40`, or use `SMTP_USER` and `SMTP_PASSWORD`. For Microsoft 365, check Authenticated SMTP is on |
| `wrong version number`, `Greeting never received` | `smtp://` vs `smtps://` doesn't match the port | 465 needs `smtps://`; 587, 25 and 2525 need `smtp://` |
| `self-signed certificate`, `certificate`, `altnames` | The server's certificate doesn't match | Use the exact host name your provider gives, not an IP address or another name |
| `Mail command failed`, `550`/`553` with "sender", `5.7.60`, `not owned` | The server won't send as `SMTP_FROM` | Use your login address, or a verified alias, sender or domain |
| `all recipients were rejected`, `not verified` | The server refused the recipient | Check the address. SES and some trials only send to verified addresses |
| `no-reply@localhost` in the error | `SMTP_FROM` isn't set | Set `SMTP_FROM` and restart |

### Hosts that block outgoing mail ports

Many cloud and VPS hosts block SMTP ports to stop spam. If you get `ETIMEDOUT` from a server but the same settings work from your laptop, this is probably why.

| Host | Blocked by default | What to do |
|---|---|---|
| DigitalOcean | 25, 465, 587 | Use port 2525 with a service that offers it (SendGrid, Mailgun, Postmark, Brevo) |
| Linode / Akamai | 25, 465, 587 on some new accounts | Open a support ticket, or use port 2525 |
| Hetzner Cloud | 25, 465 | Use 587, or ask for an unblock after your first paid invoice |
| AWS EC2 | 25 | Use 587 or 465 |
| Google Cloud | 25 | Use 587 or 465 |
| Vultr | 25 | Use 587 or 465 |
| Oracle Cloud | 25 (newer tenancies) | Use 587 or 465 |

Sources: [DigitalOcean](https://docs.digitalocean.com/support/why-is-smtp-blocked/), [Akamai](https://techdocs.akamai.com/cloud-computing/docs/send-email), [Hetzner](https://docs.hetzner.com/cloud/servers/faq/), [AWS](https://repost.aws/knowledge-center/ec2-port-25-throttle), [Google Cloud](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail), [Vultr](https://docs.vultr.com/support/products/compute/why-is-smtp-blocked), [Oracle](https://docs.oracle.com/en-us/iaas/releasenotes/changes/f7e95770-9844-43db-916c-6ccbaf2cfe24/index.htm).

## Try it out locally

There are two ways to see emails without sending them to anyone.

**The outbox.** Set `MAIL_OUTBOX=true` (and no `SMTP_URL`). Each email is written as an `.eml` file in `DATA_DIR/mail-outbox`, which any mail app can open.

**Mailpit.** This is a fake mail server with a web inbox.

```bash
docker run -p 8025:8025 -p 1025:1025 axllent/mailpit
```

Then set `SMTP_URL=smtp://localhost:1025`, `SMTP_FROM="Test <test@example.com>"`, restart Plaudit, and open <http://localhost:8025> to read the mail.

If Plaudit itself runs in Docker, `localhost` means its own container. Use `SMTP_URL=smtp://host.docker.internal:1025` instead; on Linux, also add `extra_hosts: ["host.docker.internal:host-gateway"]` to the service in `docker-compose.yml`.

Docs: [Mailpit with Docker](https://mailpit.axllent.org/docs/install/docker/).
