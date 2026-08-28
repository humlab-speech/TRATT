# Loading a recording

**For:** everyone. This page covers the three ways material gets into TRATT, what
formats work, and how to pick up where you left off.

---

## Upload a file

On the start page, the **Upload file** tab shows a dashed drop zone:
*Drag & Drop one audio file (+ one optional transcript file) here or click here.*

You can drop **one media file**, and optionally **one transcript file** alongside
it, in either order. TRATT waits until it has audio before it can do anything —
while it waits, the transcript file shows a spinner and the hint
*Waiting for audio file*.

While a file is being read you see a progress bar (for `.wav`) or a turning gear
(for everything else, which has to be decoded first). Then:

| Icon | Meaning |
| --- | --- |
| ✓ | Loaded and usable |
| ⚠ | Loaded, but with a caveat — hover it to read the warning |
| ✗ | Rejected — hover it to read why |
| ⚙ (gear, clickable) | This transcript format has import options. Click to set them. |

Common rejections: an unsupported extension, a file over the size limit, or a
transcript whose name does not match the audio file's name.

### The transcript file

If you already have a transcript — from an earlier TRATT session, from another
tool, or from a subtitle file — drop it in with the audio and TRATT will open it
for editing instead of starting from scratch. Formats it can read are listed in
[Exporting → what TRATT can read](exporting.md#formats-tratt-can-read).

Some importers offer options; the gear icon next to the file opens them. SubRip and
WebVTT, for example, can pull speaker names out of the cue text and put each speaker
on their own tier. See [Tiers and speakers](tiers-and-speakers.md).

---

<a id="recording-in-the-browser"></a>

## Recording in the browser

The **Record now** tab records straight into TRATT — no separate recorder, no file
to move around.

1. Choose the recording source with the two small icon buttons at the top of the
   panel — **Audio only** (microphone) or **Audio + video** (camera). They carry no
   text label; hover to confirm which is which.
2. Open the **Input devices** control to pick a specific microphone or camera. If
   the list is empty or unnamed, click **Request access** — browsers hide device
   names until you have granted permission once.
3. Click **Start recording**. A level light shows red (too quiet — check the
   microphone), orange (marginal) or green (good). Watch it for the first few
   seconds; a red light for the whole recording is unrecoverable.
4. **Pause** / **Resume** as needed, then **Stop**.
5. **Use recording** loads it straight into TRATT as if you had uploaded it.
   **Download** saves a copy to disk. **Discard** throws it away.

TRATT records MP4 where the browser supports it, and WebM otherwise (Firefox); both
are fine as input.

**Recovery.** If the tab crashes or you close it mid-recording, the next visit
offers *Unfinished recording recovered* with the session's start time, approximate
length and size, and lets you continue it, download the partial file, or discard it.

**Warning on leaving.** If you have a recording that has not been used or exported,
TRATT warns you before you navigate away. Take the warning seriously — an unexported
recording is gone once the tab is.

---

<a id="supported-file-formats"></a>

## Supported file formats

| Extension | Notes | Maximum size |
| --- | --- | --- |
| `.wav` | Read natively; fastest and most precise | 1.9 GB |
| `.mp3`, `.m4a`, `.flac`, `.ogg` | Duration in samples is estimated and may differ slightly from other applications | 500 MB |
| `.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.avi`, `.3gp`, `.mka`, `.wma`, `.opus`, `.aac`, `.mp2`, `.amr` | Decoded in the browser; takes longer to load | 500 MB each |

The app states the same limits as *Max. file size: 500 MB · WAV up to 1.9 GB*. The
full list is available in the app itself: click **Supported files** above the drop
zone.

### Video

If you load a video, TRATT works with its sound. When the format is one your
browser can play directly — **MP4 is the safest choice, WebM also works well** —
the picture is shown alongside the waveform in the transcription window, which
helps a great deal with overlapping speech and gesture. Formats the browser cannot
play natively are still transcribed, just without the picture.

---

## Coming back to a session

TRATT keeps your transcript in the browser but **never keeps your media file**.

When you return, the start page shows *There is data from a previous transcription
available* together with the name, size and date of the file you were working on.
Drag that same file in again and click **Continue transcription** to carry on where
you stopped.

The button below the drop zone tells you which of the two is about to happen:

| Button | What it does |
| --- | --- |
| **Continue transcription** (blue) | The file you supplied matches the stored session. Your stored transcript is reopened. |
| **Start new transcription** (red) | The file does not match the stored session, or there is none. Clicking it **discards the stored transcript** and starts fresh — with no further confirmation, and no undo. |

TRATT decides which button to show by comparing the file you dropped with the one
recorded in the stored session (by name and size, and by base name so that the same
recording in a different format still counts as a match). If you expected
*Continue* and got the red *Start new*, you have supplied a different file — check
it before clicking.

If the media file you supply is not the one the transcript was made from, the
boundaries will not line up with the sound. TRATT cannot detect this for you.

> Export a file before you stop for the day. Browser storage is a convenience, not
> an archive — see [What leaves your computer](privacy.md).
