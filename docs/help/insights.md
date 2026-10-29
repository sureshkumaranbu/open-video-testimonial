# Insights, case studies, surveys and screenshots

What your customers say, across every testimonial and survey answer, and three ways to use it: case studies, NPS surveys and reading screenshots of reviews. Everything here works without AI. With your own AI provider, a few buttons can do more, and nothing is sent to it until you press one.

These sections follow the `insights` flag (on with `PLAUDIT_FEATURES=all`).

- [AI](#ai): setting up your own provider, and what is sent
- [Case studies](#case-studies)
- [Voice of Customer](#voice-of-customer)
- [Ask a question](#ask-a-question)
- [NPS and surveys](#nps-and-surveys)
- [Saved reports](#saved-reports)
- [Reading screenshots](#reading-screenshots)
- [Who can do what](#who-can-do-what)

## AI

Plaudit has no AI of its own and calls no AI service unless you set one up. Any OpenAI-compatible `/chat/completions` endpoint works: OpenAI, a gateway such as OpenRouter, or a model on your own machine (Ollama, llama.cpp, vLLM).

| Setting | Default | What it does |
|---|---|---|
| `AI_MODEL` | unset | The model to use. AI is off until this is set |
| `AI_API_URL` | `https://api.openai.com/v1` | The provider's address. For Ollama: `http://127.0.0.1:11434/v1` |
| `AI_API_KEY` | unset | Your key, sent as `Authorization: Bearer …`. Leave it out for a local model that needs none |

**Settings → This server** shows whether AI is on and which model and host it uses.

**AI in this project.** On **Insights**, an admin can switch AI off for one project. Then nothing of that project (testimonials, survey answers, screenshots) is ever sent to the provider, and its pages work as they do without AI. It's on for every project by default once `AI_MODEL` is set.

**What is sent, and when.** Only when an editor presses a button that says so:

| Button | What goes to the provider |
|---|---|
| Case study → **Draft with AI** | That testimonial's headline, text, video transcript and answers, the person's name, title and company, and your project's name. Never their email, phone or private fields. Up to 8,000 characters |
| Insights → **Find themes with AI** | Up to 60 of the testimonials (or survey comments) in the chosen range, spread over it, each cut to 500 characters, with their rating. No names or emails. 12,000 characters at most |
| Ask a question (an editor, with AI on) | The question and the words of the (at most 8) testimonials found for it |
| Forms → New survey → **Draft with AI** | Only the goal you type and your project's name |
| Read the screenshot (with `OCR_PROVIDER=ai`) | The image, PNG, JPEG or WebP, up to 4 MB |

Every answer is checked before it's used, and anything that doesn't fit is dropped: a pull quote must be the customer's own words, a metric's number must appear in what they said, a theme must cite testimonials that were sent. When the provider fails or answers nonsense, you get a message and keep what you had. Each AI request is in the audit log.

Answers are kept only where you save them (a case study, a report). The brand scan in the setup guide uses `BRAND_AI_*` when those are set, and these `AI_*` settings otherwise.

## Case studies

**Case studies** turns one testimonial into a customer story: a title, a short summary, the challenge, the solution, the result, a pull quote in the customer's words and up to four numbers.

1. Open a testimonial in the inbox and choose **Case study**, or pick one on the **Case studies** page and press **Make a case study**. You can also add the testimonial and its case study at once from **Add testimonial → Case study**.
2. It starts as a template: the person, a title, and the pull quote from the testimonial's highlight (or its first sentence). The sections are empty, with prompts.
3. Fill it in, or with AI on, press **Draft with AI** to fill the fields from the testimonial. Check every line; nothing is saved until **Save**.
4. The preview on the right is the page as people will read it.
5. **Save and publish** gives it a page at `/cs/<id>` with a **Download PDF** button. **Download PDF** in the editor works for drafts too.

A published case study is public only while its testimonial could have its own page: approved, not withdrawn, and with public consent. If the testimonial is rejected or withdrawn, the page and PDF stop working at once, as if they'd never existed. **Unpublish** does the same. The PDF is drawn on your server (A4, in the Geist font, your project's colour); characters the font can't draw, such as emoji, are left out.

## Voice of Customer

**Insights → Voice of Customer** reads the testimonials in a period (the last 12 months to start with), optionally with one tag, or the comments from your NPS questions:

- **The breakdown**: how many, the average rating, and how many are positive (4 or 5 stars), neutral (3) or negative (1 or 2). For survey comments: promoters (9–10), passives (7–8) and detractors (0–6).
- **What they talk about**: the words and phrases most of them share, such as "easy to use" or "customer support", counted from your inbox's search index. Common words, people's names, companies, emails and tags never count.
- **What they love** and **what to improve**: the same, from the happy ones and from the rest.
- With AI on, **Find themes with AI** adds named themes with a sentiment, what they love and what to improve, each citing the testimonials it came from.

Rejected and trashed testimonials are left out. A report reads the newest 2,000 at most.

## Ask a question

Type a question such as "What do customers say about onboarding?". Plaudit finds the testimonials that answer it: by meaning when [smart search](inbox.md#smart-search) is set up, by their words otherwise. With AI on, an editor also gets a short answer that cites the testimonials it used; without AI you get the testimonials alone.

## NPS and surveys

**An NPS question** asks "How likely are you to recommend us?" from 0 to 10, then "What's the main reason for your score?". Add it to any step-by-step form with **Add NPS question** in the builder (one per form). Answers are private: they go to **Insights → NPS**, never onto a public page, and on a testimonial form they're linked to the testimonial.

**A survey** is a form for everyone's opinion, not only for testimonials. **Forms → New survey** makes one with an NPS question and a few private questions of your own:

- Everyone answers the NPS question and your questions. Those answers stay private (NPS, and **Feedback** in the inbox marked "Survey").
- A **promoter** (9 or 10) is asked whether they'd also write a short testimonial. Only if they say yes do they go on to the question, consent and about-you pages, and only then is a testimonial made, through the usual review in the inbox. Turn the offer off, or change its wording, on the NPS question in the builder.
- A new survey starts **paused**, so you can check it in the builder; resume it in Settings to publish it. A survey can't be the project's default form.

This is the low-rating branch's idea in reverse: no one is steered by their score into posting a public review, and nothing becomes public without the person's own yes and consent.

**AI survey.** With AI on, type what you want to learn (say, "why trial users don't upgrade") and press **Draft with AI**: it writes the NPS wording and up to five questions, which you can change before making the survey, and again in the builder.

**The NPS dashboard** (**Insights → NPS**): the score (the share of promoters minus the share of detractors, from −100 to 100), the three groups, the scores 0–10, a trend per day (or per week for longer periods), and the latest comments, for all forms or one. With AI on, **Find themes in the comments with AI** reads the comments as Voice of Customer does.

## Saved reports

**Save report** on any of the three keeps it as it is now, with its name, so it reads the same next month even after testimonials change. **Saved reports** lists them; open one to read it again, or download it as **CSV** (one row per finding, with the testimonials it cites). Reports hold excerpts of testimonials, never emails.

## Reading screenshots

Praise often arrives as a screenshot: a message, a social post, a review on a site with no importer. With OCR on, **Add testimonial → Image** (and **Import & export → Import a screenshot**) can read it:

1. Attach the screenshot and press **Read the screenshot**.
2. Plaudit fills the text, the name and the date it found. Check and correct them.
3. **Add testimonial** saves it, with the image kept as its screenshot.

| Setting | What it does |
|---|---|
| `OCR_PROVIDER=command` | Runs a program on your server, so no image leaves it. `OCR_COMMAND` is the command, with `{input}` for the image file; it must print the text. With [tesseract](https://github.com/tesseract-ocr/tesseract): `OCR_COMMAND="tesseract {input} stdout"`. It runs without a shell, for 60 seconds at most |
| `OCR_PROVIDER=ai` | Sends the image to your AI provider (above) as a vision message; needs a model that reads images |
| unset (`off`) | No reading; the Image tab adds the screenshot as it is |

Only PNG, JPEG and WebP up to 4 MB are read, checked by their first bytes. Nothing is saved until you add the testimonial.

## Who can do what

With roles on (`team2`): viewers read case studies, Insights, NPS and saved reports, ask questions (without the AI answer) and download PDFs. Editors make, change, publish and delete case studies, use every AI button, read screenshots, save and delete reports and download them as CSV. Only admins switch AI in a project on or off. Each change is in the audit log.
