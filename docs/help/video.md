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

## Multiclip

When someone answers more than one question on video, the drawer's **Clips and multiclip** section offers **Make a multiclip**: their answers joined into one video, each after a card with its question in your brand colour (the brand kit's main colour, or the project's accent colour) and your logo. It's made in the background; when it's ready you can watch it, **Download** it, or **Use as the video**. That makes it the testimonial's own video everywhere: it's converted again, the transcript is made again, and the trim and poster start over. The first answer's own file is kept, so **Show the first answer again** puts things back as they were. A multiclip that's in use can't be deleted until you switch back.

Answers to further questions are never public on their own. Using a multiclip as the video makes them part of the public video, so it asks first.

## Social clips

**Social clip** makes a short video for social media from the testimonial's video (the cut, when trimmed; up to three minutes):

- **Shape**: vertical 9:16 (Reels, TikTok, Shorts) or square 1:1, at 1080 pixels wide.
- **Look**: four of our own. **Studio** fills the frame with a brand-colour name bar along the bottom; **Frame** puts the video on your brand colour with the name and captions underneath; **Bold** shows big captions a few words at a time; **Soft** shows the whole picture over a blurred fill with captions on a dark band.
- **Captions** are burned in word by word from the testimonial's captions (or its transcript, spread over the video when there are no timed captions), with the word being said highlighted. **Name tag** and **Logo** can be turned off.

The six most recent clips are kept; download them as MP4.

## Highlight reels

**Highlight reels** (a project tab) joins the best moments of your approved videos. Make a reel, then for each clip pick a testimonial and **select the words to keep** in its transcript and press **Use the selected words**; the times are filled in and you can nudge them. Videos without timed captions are cut by their times instead. Add a title card and a closing card (with a line under each), choose landscape, vertical or square, and turn **Background music** and **Captions** on or off. A reel is up to 20 clips of up to two minutes each, and ten minutes in all.

**Render the reel** saves it and makes the MP4 in the background; the last three renders are kept. Reels are saved with the project, so you can change one and render it again. Only approved testimonials whose authors haven't withdrawn can be used; if one stops being approved, the reel says which clip to remove.

The background music is our own: Plaudit synthesises a quiet ambient bed while it renders (see [`docs/CREDITS.md`](../CREDITS.md#highlight-reel-music-vid-08)). No third-party audio is used.

Multiclips, social clips and reels are private: only your team can watch them, and downloading needs the editor role or above. Viewers can watch but not make, use or delete them.

## Your own welcome and thank-you videos

In the form builder, the **Welcome** and **Thank you** pages have **Your video**: record it with the same recorder your customers use, or upload a file. It's converted and, when transcription is set up, captioned, then plays on that page (with captions on by default). Anyone can watch it while the form is live; when the form is paused it's private again. The welcome video shows only when the welcome page is on.

## Streaming (HLS)

With `VIDEO_HLS=true`, every approved video also gets an adaptive-streaming copy: two or three renditions (360p, 540p and 720p, never larger than the video) in four-second pieces with a playlist that lets the player switch with the connection. Widgets, walls and testimonial pages list it before the MP4, so browsers that play HLS themselves (Safari, on Mac, iPhone and iPad) stream it, and every other browser keeps the MP4; the widget script doesn't grow. The copy is public exactly while the MP4 is: once a testimonial is rejected, hidden or withdrawn, its playlist and every piece answer 404. A trim or a new file makes a new copy and deletes the old one. It's off by default because it costs CPU and storage.

These sections follow the `video2` flag; HLS follows `VIDEO_HLS`.
