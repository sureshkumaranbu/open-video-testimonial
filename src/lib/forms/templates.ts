import {
  formDesignSchema,
  formLabelsSchema,
  formPagesSchema,
  formSettingsSchema,
  type FormConfig,
  type FormPage,
  type ResponseMode,
} from "./schema";

/**
 * Starting points for a new form (FORM-18): a page set, questions and tips
 * for a kind of business, all in our own words. Every template is a
 * step-by-step form; the owner edits everything afterwards.
 */

export const TEMPLATE_IDS = ["saas", "course", "coaching", "agency", "ecommerce", "local", "employee", "event"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

type Q = { title: string; tips?: string[]; mode?: ResponseMode; required?: boolean; subtitle?: string };

type Blueprint = {
  id: TemplateId;
  name: string;
  description: string;
  welcome: (project: string) => { title: string; message: string; bullets?: string[] };
  questions: Q[];
  /** Ask about their company too (B2B). */
  company?: boolean;
  thankYou: (project: string) => { title: string; message: string };
};

const BLUEPRINTS: Blueprint[] = [
  {
    id: "saas",
    name: "Software product",
    description: "For apps and online tools: the problem it solved and the result.",
    welcome: (p) => ({
      title: `How has ${p} worked out for you?`,
      message: "A minute or two of your words helps other teams decide.",
      bullets: ["Video or text, your choice", "Nothing is published until you agree"],
    }),
    questions: [
      {
        title: "What was your team doing before {project}?",
        tips: ["The tool or workaround you used", "What it cost you in time or money"],
      },
      { title: "What has changed since you started?", tips: ["A number you can share", "A task that got easier"], required: false },
    ],
    company: true,
    thankYou: (p) => ({ title: "Thanks, that really helps", message: `The ${p} team reads every one of these.` }),
  },
  {
    id: "course",
    name: "Online course",
    description: "For courses and cohorts: where students started and what they can do now.",
    welcome: (p) => ({ title: `Tell future students about ${p}`, message: "Share what the course was like, in your own words." }),
    questions: [
      { title: "Where were you before the course?", tips: ["What you wanted to learn", "What held you back"] },
      { title: "What can you do now that you couldn't before?", tips: ["A project you finished", "Something you'd tell a friend"], required: false },
    ],
    thankYou: () => ({ title: "Thank you for sharing", message: "Your story will help someone decide to start." }),
  },
  {
    id: "coaching",
    name: "Coaching",
    description: "For coaches and consultants: the change a client felt.",
    welcome: (p) => ({ title: `How was working with ${p}?`, message: "Your experience helps others take the first step." }),
    questions: [
      { title: "What made you look for a coach?", tips: ["The goal you had", "What you had tried already"] },
      { title: "What is different for you now?", tips: ["How you feel about it", "A moment you noticed the change"], required: false },
    ],
    thankYou: () => ({ title: "Thank you", message: "It means a lot that you took the time." }),
  },
  {
    id: "agency",
    name: "Agency or studio",
    description: "For agencies and freelancers: the brief, the work and the outcome.",
    welcome: (p) => ({ title: `How was your project with ${p}?`, message: "A few words about the work, the team and the result." }),
    questions: [
      { title: "What did you need help with?", tips: ["The brief in one sentence", "Your deadline or constraint"] },
      { title: "How did the project go, and what came of it?", tips: ["Working with the team", "Results since launch"], required: false },
    ],
    company: true,
    thankYou: () => ({ title: "Thanks for the kind words", message: "We'd be glad to work with you again." }),
  },
  {
    id: "ecommerce",
    name: "Product review",
    description: "For shops: a short review of a product someone bought.",
    welcome: (p) => ({ title: `How do you like your order from ${p}?`, message: "A quick review helps other shoppers choose." }),
    questions: [
      { title: "What do you like most about it?", tips: ["Quality and fit", "How you use it"] },
      { title: "Who would you recommend it to?", required: false },
    ],
    thankYou: () => ({ title: "Thanks for your review", message: "Happy shopping!" }),
  },
  {
    id: "local",
    name: "Local business",
    description: "For shops, salons, clinics and restaurants: a visit in a few words.",
    welcome: (p) => ({ title: `How was your visit to ${p}?`, message: "It takes a minute, and it helps a small business a lot." }),
    questions: [
      { title: "What was your visit like?", tips: ["The service", "The people", "What you'd come back for"] },
    ],
    thankYou: (p) => ({ title: "Thank you!", message: `See you again soon at ${p}.` }),
  },
  {
    id: "employee",
    name: "Team member story",
    description: "For hiring pages: what it's like to work here, from the team.",
    welcome: (p) => ({ title: `What is it like to work at ${p}?`, message: "Your honest view helps people decide to join." }),
    questions: [
      { title: "What do you work on, and what do you enjoy about it?", tips: ["A typical week", "Something you're proud of"] },
      { title: "What would you tell a friend who is thinking of joining?", required: false },
    ],
    thankYou: () => ({ title: "Thank you", message: "Your words will help us find great colleagues." }),
  },
  {
    id: "event",
    name: "Event feedback",
    description: "For conferences, workshops and meetups: highlights from attendees.",
    welcome: (p) => ({ title: `How was ${p}?`, message: "Tell us what you'll remember from it." }),
    questions: [
      { title: "What was the highlight for you?", tips: ["A talk or session", "Someone you met"] },
      { title: "Would you come again, and why?", required: false },
    ],
    thankYou: () => ({ title: "Thanks for coming", message: "We hope to see you at the next one." }),
  },
];

function build(b: Blueprint, project: string): FormConfig {
  const name = project.trim() || "us";
  const fillName = (s: string) => s.replaceAll("{project}", name);
  const pages: FormPage[] = formPagesSchema.parse([
    { type: "rating", title: "" },
    { type: "welcome", enabled: true, ...b.welcome(name) },
    ...b.questions.map((q, i) => ({
      type: "question",
      key: `q${i + 1}`,
      primary: i === 0,
      required: i === 0 ? true : (q.required ?? true),
      title: fillName(q.title),
      subtitle: q.subtitle,
      tips: q.tips ?? [],
      mode: q.mode ?? "video_text",
    })),
    { type: "consent" },
    {
      type: "about_you",
      fields: b.company
        ? { email: { enabled: true }, photo: { enabled: true }, title: { enabled: true }, company: { enabled: false } }
        : {},
    },
    ...(b.company ? [{ type: "about_company", enabled: true }] : []),
    { type: "review", enabled: true },
    { type: "thank_you", ...b.thankYou(name), copyText: true, share: true },
  ]);
  return {
    v: 1,
    layout: "steps",
    pages,
    design: formDesignSchema.parse({}),
    labels: formLabelsSchema.parse({}),
    settings: formSettingsSchema.parse({}),
  };
}

export const FORM_TEMPLATES: { id: TemplateId; name: string; description: string; build(projectName: string): FormConfig }[] =
  BLUEPRINTS.map((b) => ({ id: b.id, name: b.name, description: b.description, build: (p: string) => build(b, p) }));

export function getTemplate(id: string) {
  return FORM_TEMPLATES.find((t) => t.id === id) ?? null;
}
