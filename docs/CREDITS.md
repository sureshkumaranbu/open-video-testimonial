# Credits and media provenance

## Sample video testimonials (`public/samples/`)

Real stock footage under the [Pexels License](https://www.pexels.com/license/): free for commercial use, no attribution required (credited here anyway). Clips were trimmed to 8–10 s, cropped to 960×600, re-encoded (H.264 MP4 + VP9 WebM) and **had their audio removed**, because the person on screen is not saying the fictional quote shown next to them. Posters are frames from the same clips.

| Files | Pexels source | Creator | Licence |
|---|---|---|---|
| `maya.webm`, `maya.mp4`, `maya.jpg` | [A woman talking in front of the camera (9032398)](https://www.pexels.com/video/a-woman-talking-in-front-of-the-camera-9032398/) | Alena Darmel | Pexels License |
| `daniel.webm`, `daniel.mp4`, `daniel.jpg` | [Man looking at the camera while talking (8048247)](https://www.pexels.com/video/man-looking-at-the-camera-while-talking-8048247/) | Antoni Shkraba | Pexels License |
| `aiko.webm`, `aiko.mp4`, `aiko.jpg` | [Casual businesswoman looking at camera and talking (5941020)](https://www.pexels.com/video/casual-businesswoman-looking-at-camera-and-talking-5941020/) | Theo Decker | Pexels License |

### Avatar headshots (`public/samples/avatars/`)

160×160 face crops taken from frames of Pexels videos (Pexels License):

| File | Pexels source | Creator |
|---|---|---|
| `maya.jpg`, `daniel.jpg`, `aiko.jpg` | the three clips above | as above |
| `theo.jpg` | [Casual businessman looking at camera and talking (5941016)](https://www.pexels.com/video/casual-businessman-looking-at-camera-and-talking-5941016/) | Theo Decker |
| `jordan.jpg` | [Man talking while looking at camera (8135343)](https://www.pexels.com/video/man-talking-while-looking-at-camera-8135343/) | ANTONI SHKRABA production |
| `ken.jpg` | [Man looking and talking to the camera (7643836)](https://www.pexels.com/video/man-looking-and-talking-to-the-camera-7643836/) | MART PRODUCTION |
| `leila.jpg` | [A woman talking and looking at the camera (8685444)](https://www.pexels.com/video/a-woman-talking-and-looking-at-the-camera-8685444/) | ANTONI SHKRABA production |

**Not an endorsement.** The people in this footage are stock models. They have not used or endorsed Plaudit. The names, roles and quotes paired with them on the home page are fictional and always shown with a "Sample" label.

`scripts/make-sample-videos.sh` is kept as an offline fallback that generates placeholder clips with no real person.

## Sample testimonials (text)

The names, roles, companies and quotes used on the home page are fictional. Any resemblance to real people or businesses is unintended. They are always shown with a "Sample" label and an "illustration" caption.

## Test fixtures (`e2e/fixtures/`)

`sample.webm` (ffmpeg `testsrc2` pattern plus a sine tone) and `avatar.png` (ffmpeg `testsrc2` frame) are generated, and MIT like the rest of the repository.

## Form fonts (`public/fonts/`)

Self-hosted so a form never asks a third party for a font (FORM-08).

| Files | Font | Licence |
|---|---|---|
| `geist-latin.woff2`, `geist-mono-latin.woff2` | [Geist and Geist Mono](https://github.com/vercel/geist-font), latin subset | SIL Open Font License 1.1 |
| `og/Geist-Regular.ttf` | Geist Regular (for generated share images; satori reads TTF only) | SIL Open Font License 1.1 |

Schibsted Grotesk and Newsreader, also offered in the form designer, are the app's own fonts, self-hosted at build time by `next/font` (both SIL Open Font License 1.1).
