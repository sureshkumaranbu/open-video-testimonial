# Video tools

Open a video testimonial in the inbox (**Testimonials**, then click it) and the drawer shows a **Video** section under the player. Every change below is saved in the testimonial's **History**, sends the opt-in `testimonial.updated` webhook, and (for a trim or a new file) marks it **Edited after consent**, like changing someone's words. The tools are part of the inbox, so they follow the `inbox2` flag.

Trimming and picking a frame need ffmpeg on the server (it's in the Docker image). Without it, videos are served as uploaded, and you can still upload a poster, replace the file and download it.

## Trim

**Trim** shows the original recording with its waveform (louder is taller). Drag **Start** and **End**, or move them with the arrow keys (a tenth of a second a step); the part you cut is greyed out. **Preview the cut** plays just the part you keep. **Save trim** makes a new MP4 in the background; the old version stays up until the new one is ready, which usually takes seconds.

- **Nothing is lost.** The original file is kept, so you can change the trim or press **Show the whole video** at any time. At least one second has to stay.
- **The original is private once you trim.** Visitors only ever get the cut; the untrimmed file is no longer a fallback and its address answers 404 to anyone but you.
- **Captions follow the cut.** They're kept in the original's timing and shifted when they're served, so players show the right words at the right moment, and undoing a trim brings them all back.
- **The transcript.** When the video has captions, the transcript becomes the words in the part you keep (the old one is in the history). Without captions the transcript isn't changed; edit it by hand if you cut words out, or press **Transcribe** again.
- Only the testimonial's main video can be trimmed. Videos answering further questions stay as recorded; they're never public.

## Poster

The poster is the still shown before a video plays, on widgets, walls, the testimonial's own page and in the API.

- **Use this frame**: drag **Frame** to a moment and save. If you trim later, the poster is taken again at the same moment of the new cut.
- **Upload an image**: a PNG, JPEG, WebP or GIF (never SVG), up to the usual image size limit. An uploaded poster stays when you trim.
- **Use the default frame** goes back to a frame about a second in.

## Replace the video

**Replace video** uploads a new file in pieces (large files are fine, and a dropped connection resumes). The new file takes the old one's place everywhere: the trim and poster are cleared, it's converted again, and when transcription is set up the transcript and captions are made again. The old files are deleted, unless something else still uses them.

## Download

**Original** downloads the file exactly as it was uploaded; **MP4** downloads the converted video (the cut, when trimmed). Downloads need you to be signed in: there is no public link, and they're never cached outside your browser.
