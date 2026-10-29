/**
 * The shapes and looks M16's renders come in. Client-safe (the drawer and
 * the reel editor list them). The looks are our own: what each one draws is
 * in src/lib/video/compose.ts.
 */
export const RENDER_FORMATS = ["landscape", "vertical", "square"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

/** Output sizes in pixels. Social clips are 9:16 or 1:1 at 1080 wide. */
export const CANVAS: Record<RenderFormat, { w: number; h: number }> = {
  landscape: { w: 1280, h: 720 },
  vertical: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

export const FORMAT_NAMES: Record<RenderFormat, string> = {
  landscape: "Landscape 16:9",
  vertical: "Vertical 9:16",
  square: "Square 1:1",
};

/** VID-07: the social clip looks. */
export const SOCIAL_LOOKS = ["studio", "frame", "bold", "soft"] as const;
export type SocialLook = (typeof SOCIAL_LOOKS)[number];

export const LOOK_NAMES: Record<SocialLook, { label: string; hint: string }> = {
  studio: { label: "Studio", hint: "Full-bleed video, a brand-colour name bar along the bottom, captions just above it." },
  frame: { label: "Frame", hint: "The video framed on your brand colour, the name and captions underneath." },
  bold: { label: "Bold", hint: "Big captions a few words at a time in the middle, a thin brand stripe on top." },
  soft: { label: "Soft", hint: "The whole picture over a blurred fill, captions on a soft dark band." },
};

/** VID-07: the longest social clip, in ms. */
export const MAX_SOCIAL_MS = 180_000;
