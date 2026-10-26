# Forms

_Behind the `forms` preview flag (`PLAUDIT_FEATURES=forms`, or `all`)._

A project can have several forms, each with its own questions, fields, look, language and rules. Open **Forms** in a project.

## The forms list

- **Create form**: give it a name and start blank (from your project's question) or from a template: software product, online course, coaching, agency or studio, product review, local business, team member story or event feedback. Every template is a starting point you edit afterwards.
- Each form shows its link, whether it's **Live** or **Paused**, its layout, and how many testimonials and invites it has, with the response rate.
- **Edit**, **Share**, **Duplicate**, **Pause**/**Resume** and **Delete**. Deleting a form keeps its testimonials (they no longer show a form). The default form can't be deleted: make another one the default first.
- Search by name or link, and switch between the list and an expanded view.

## The default form and the classic page

Every project has a **default form**: what `/c/<project>` and personal request links without a form open. On upgraded projects it uses the **classic** one-page layout and reads and writes the same settings as the project's Settings tab, so nothing changes until you choose.

- A classic form can show one question and the standard details. To add more questions, custom fields, other languages or a design, press **Switch to step-by-step**. From then on `/c/<project>` sends visitors (and their `?r=` request links) to the form's new page, `/f/<project>/<form>`.
- Every rule in a form's Settings (auto-approve, auto-tags, pausing, the per-IP limit, the receipt template, form webhooks) also applies to the classic page.

## The builder

The page list is on the left, a live preview in the middle (switch between desktop, tablet and phone widths) and the selected page's settings on the right. The preview is the real form, with recording and sending turned off, so it looks exactly like the public page. **Save changes** stores everything at once; leaving the page asks first only if something is unsaved.

### Content

Pages, in order: rating, welcome, the questions, private questions, consent, about you, about your company, review and send, thank you. Each can be turned off except the main question.

- **Questions**: up to 10. Each has its own title, subtitle (a different one while recording, if you like), up to 8 tips, how it can be answered (video or text, video only, text only), the longest video (15 s to 10 min), up to 3 images, and whether it's **required** or can be skipped. The main question's answer is the testimonial's text or video; the others are stored as answers beside it. Reorder questions with the arrows.
- **Private questions**: the answer goes to private feedback and is never published.
- **Consent**: your own wording (or the standard wording in the form's language), extra uses people can agree to (social media, paid ads, full name, face), and an optional "keep it private" choice. A private testimonial can be read by your team but can never be approved.
- **About you** and **About your company**: which details to ask for and which are required, plus **custom fields**: short or long text, dropdown, checkbox, NPS 0–10, web address or number. A dropdown choice can add a tag (`Enterprise = enterprise`). Custom fields are private, shown in the inbox and exported as `custom:<key>`.
- **Thank you**: title and message (with a different version for 3 stars or fewer), an optional button (for example "Also review us on Google"), "copy my words", and share buttons, which appear only to people who agreed to social media use.

### Design

Logo (PNG, JPEG, WebP or GIF; shown unless you hide it), colours (primary, background, text, button, button text, stars), heading and body fonts, wide or compact, solid or soft buttons, corner radius and light or dark. Colours you leave empty follow the project's brand kit, then its colour. Fonts are served by your own server, so the form never contacts another site.

**Language**: English, Spanish, French, German, Portuguese, Italian, Dutch, Polish, Hindi, Tamil or Arabic. Every default label switches with it, and Arabic (like Hebrew and Farsi) reads right to left. Search for any label to change its wording for this form.

> The translations other than English are our own wording and **need review by native speakers**. Override any label that reads oddly.

### Settings

- **Link**: change it and old links keep working (they redirect). QR codes and embeds you made before still point to the old address.
- **Status**: pause the form to show your message instead.
- **Auto-approve**: off, every testimonial, a minimum number of stars, written testimonials only, or anything people agreed to make public. Text with a link always waits for you, private testimonials are never approved, and videos count only if you include them (once every video is processed).
- **Tags** every testimonial gets, **hidden fields** to keep from the link (for example `utm_source`, `order_id`; stored privately), and prefilled details people **can't change**.
- **Receipt email** with its own subject and message, sent only for personal request links (so the form can't be used to email strangers). It always includes the private withdraw link.
- **Most testimonials from one place per day**, a hint to turn the phone sideways before recording, and hiding the form from search engines.
- **Form webhooks** receive this form's testimonials only.

### Share

The hosted link, a QR code (download as PNG or SVG, in any colour), and three ways to embed the form on your site: inline, a popup button, or an iframe. See [`docs/EMBED.md`](../EMBED.md).

## Links that fill in the form

- `?name=`, `?email=`, `?company=`, `?title=`, `?website=`, `?phone=` prefill the details. They stay editable unless you lock them in Settings.
- Parameters on the hidden-field list are stored with the testimonial.
- A personal request link (`?r=`) always wins for the name, email and company it was sent to.
- At most 20 parameters are read, each up to 200 characters.
