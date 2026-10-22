/**
 * Sample people for the home page. The faces and clips in public/samples
 * are licensed stock footage from Pexels (see docs/CREDITS.md); the names,
 * roles, companies and quotes paired with them are fictional, and the
 * people shown have not used or endorsed Plaudit. Every place these appear
 * labels them as samples.
 */
export type SamplePerson = {
  id: string;
  name: string;
  role: string;
  company: string;
  /** 160×160 face crop. */
  avatar: string;
};

export type SampleVideoTestimonial = SamplePerson & {
  rating: number;
  quote: string;
  sources: { src: string; type: string }[];
  poster: string;
  width: number;
  height: number;
};

const avatar = (file: string) => `/samples/avatars/${file}.jpg`;

/** One fictional identity per face, so a face never changes name between sections. */
export const PEOPLE = {
  maya: { id: "maya", name: "Maya", role: "Creator and coach", company: "Fernhill Studio", avatar: avatar("maya") },
  daniel: { id: "daniel", name: "Daniel", role: "Support lead", company: "Quillpath", avatar: avatar("daniel") },
  grace: { id: "grace", name: "Grace", role: "Operations manager", company: "Brightmoor", avatar: avatar("aiko") },
  theo: { id: "theo", name: "Theo", role: "Agency founder", company: "Northgate Digital", avatar: avatar("theo") },
  jordan: { id: "jordan", name: "Jordan", role: "Personal trainer", company: "Ridgeline Fitness", avatar: avatar("jordan") },
  ken: { id: "ken", name: "Ken", role: "SaaS founder", company: "Tallyhook", avatar: avatar("ken") },
  leila: { id: "leila", name: "Leila", role: "Course creator", company: "Studio Leila", avatar: avatar("leila") },
} satisfies Record<string, SamplePerson>;

// The clips have no audio track (see docs/CREDITS.md).
const clip = (file: string) => ({
  sources: [
    { src: `/samples/${file}.webm`, type: 'video/webm; codecs="vp9"' },
    { src: `/samples/${file}.mp4`, type: 'video/mp4; codecs="avc1.4D401F"' },
  ],
  poster: `/samples/${file}.jpg`,
  width: 960,
  height: 600,
});

export const SAMPLE_VIDEOS: SampleVideoTestimonial[] = [
  {
    ...PEOPLE.maya,
    rating: 5,
    quote: "I send one link after every workshop. Their videos are the best thing on my site now.",
    ...clip("maya"),
  },
  {
    ...PEOPLE.daniel,
    rating: 5,
    quote: "We send the link after onboarding calls. Approving a video takes seconds.",
    ...clip("daniel"),
  },
  {
    ...PEOPLE.grace,
    rating: 5,
    quote: "Clients record a quick hello from their desk. No app, no account, no fuss.",
    ...clip("aiko"),
  },
];

export const byId = (id: string) => SAMPLE_VIDEOS.find((v) => v.id === id)!;

/** Short text testimonials, each from one of the people above. */
export const SAMPLE_QUOTES: (SamplePerson & { text: string })[] = [
  { ...PEOPLE.theo, text: "We embed a different tag per client page. Zero CSS fights." },
  { ...PEOPLE.ken, text: "Self-hosted means our customer list stays ours." },
  { ...PEOPLE.leila, text: "Students record on their phones. I approve over coffee." },
  { ...PEOPLE.jordan, text: "One link in my follow-up message and the videos started arriving." },
  { ...PEOPLE.maya, text: "Video testimonials convert better than my portfolio does." },
  { ...PEOPLE.daniel, text: "Docker compose up, done. Took less time than reading a pricing page." },
  { ...PEOPLE.grace, text: "The dark theme matched our site without touching a line of code." },
];

export const SAMPLE_DISCLAIMER =
  "Sample testimonials for illustration. Names and quotes are fictional; footage is licensed stock from Pexels, and the people shown haven't used or endorsed Plaudit.";

export const CREDITS_URL = "https://github.com/sureshkumaranbu/open-video-testimonial/blob/main/docs/CREDITS.md";
