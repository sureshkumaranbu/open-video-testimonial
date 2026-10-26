# Getting started

_On by default (the `onboarding` section; `PLAUDIT_FEATURES` can turn it off)._

The dashboard shows a **Get started** card until you finish or skip the setup guide. It never sends you anywhere you didn't click.

## The setup guide

**Start setup** (or go to `/admin/welcome`) asks three things:

1. **Project name**.
2. **Your website** (optional).
3. **What do you sell?** This only changes the wording of your first form's questions.

“Email me new testimonials” is ticked for you; untick it if you'd rather not (you can change it later in [notifications](notifications.md)).

### What we look for on your site

With a website, Plaudit reads your home page once:

- your **logo** (the app icon, a logo image in the header, or the link preview image; never SVG) and **brand colour** (the page's theme colour), and
- **testimonials already on it**: schema.org reviews, and quote blocks (a `blockquote`, a `figure`, or something with “testimonial”, “review” or “quote” in its class) with a name next to them.

You see what was found, choose with **Select all** and **Clear**, and **Import** brings the chosen ones in as approved, marked as from your website. Nothing found is fine: carry on and collect new ones.

Plaudit respects your `robots.txt`, reads at most 5 MB for 10 seconds, and never reaches private network addresses. If the site can't be read, the project is still made with the default look.

### What it makes

- Your project's **form**, step by step, with questions for your kind of business, in your colour and with your logo.
- A published **Wall of Love**, set as the main wall at `/wall/<project>`.
- Two **widgets**: a grid and a carousel.

## The Get started checklist

On the project page, until you hide it:

1. **Import or collect testimonials**: done when the project has one.
2. **Customise a widget**: done when you change a widget or make a new one.
3. **Add it to your site**: tick **I've added it** once the snippet is on your site.
4. **Share your form link**: **Copy form link**, or send invitations from Requests.

Each step can be skipped (and un-skipped). **Hide this list** appears once every step is done or skipped.
