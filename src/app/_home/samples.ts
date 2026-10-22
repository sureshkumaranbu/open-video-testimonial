/**
 * Fictional sample video testimonials for the home page. The clips in
 * public/samples are synthetic placeholders (see docs/CREDITS.md and
 * scripts/make-sample-videos.sh); the people and companies are invented.
 * Every place these appear labels them as samples.
 */
export type SampleVideoTestimonial = {
  id: string;
  name: string;
  role: string;
  company: string;
  rating: number;
  quote: string;
  sources: { src: string; type: string }[];
  poster: string;
  width: number;
  height: number;
};

const clip = (id: string) => ({
  sources: [
    { src: `/samples/${id}.webm`, type: 'video/webm; codecs="vp9, opus"' },
    { src: `/samples/${id}.mp4`, type: 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"' },
  ],
  poster: `/samples/${id}.jpg`,
  width: 960,
  height: 600,
});

export const SAMPLE_VIDEOS: SampleVideoTestimonial[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Owner",
    company: "Fernhill Bakery",
    rating: 5,
    quote: "Customers filmed a quick hello at the counter. It's the best thing on our website now.",
    ...clip("maya"),
  },
  {
    id: "daniel",
    name: "Daniel",
    role: "Support lead",
    company: "Quillpath",
    rating: 5,
    quote: "We send the link after onboarding calls. Approving a video takes seconds.",
    ...clip("daniel"),
  },
  {
    id: "aiko",
    name: "Aiko",
    role: "Yoga teacher",
    company: "Brightmoor Studio",
    rating: 4,
    quote: "Students record on their phones between classes. No app, no fuss.",
    ...clip("aiko"),
  },
];
