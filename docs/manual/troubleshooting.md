# Troubleshooting

---

## Loading a file

**"This file type is not supported." / "File format not supported."**
The extension is not in TRATT's list. Convert to `.wav` or `.mp3` and try again.
See [supported formats](loading-media.md#supported-file-formats).

**"File exceeds the maximum allowed size of 3000 MB." or an invalid-size error**
Two limits apply: a global 3000 MB ceiling, and a per-format one — 1.9 GB for
`.wav`, 500 MB for everything else. A long `.wav` is the usual culprit; convert it
to FLAC or MP3, or split the recording.

**"Transcript filename does not match the audio filename."**
TRATT pairs the two by name. Rename the transcript so its base name matches the
audio's, e.g. `interview3.wav` with `interview3_annot.json`.

**The transcript file sits there with a spinner**
It is waiting for audio. Drop the media file too — a transcript alone cannot be
opened.

**Loading a video takes a long time**
Expected: the sound has to be decoded out of the container in the browser. `.wav`
loads fastest.

---

## Automatic transcription

<a id="automatic-transcription-is-greyed-out"></a>

**The Auto-transcribe checkbox is disabled, with a warning about Safari**
Safari and other WebKit browsers reload the tab part-way through large model
downloads, losing your work, so TRATT disables the feature there. Use Chrome, Edge
or Firefox. Manual transcription in Safari is unaffected.

**The checkbox is missing entirely**
It only appears once audio has loaded *and* no transcript file has been supplied —
there is nothing to draft if you already brought a transcript.

**Medium and Large models are greyed out — "Requires WebGPU"**
Your browser or graphics hardware does not expose WebGPU. Use Tiny or Small, or run
TRATT on a machine with a discrete graphics card. In Chrome and Edge you can check
at `chrome://gpu`.

**The model download stalls or fails**
Models come from `huggingface.co`. If your network blocks it, automatic
transcription cannot work; everything else in TRATT still does. On a slow link,
start with the Tiny model to confirm the pipeline works before committing to a
multi-gigabyte download.

**Transcription fails part-way, mentioning WebGPU**
Some drivers cannot sustain a long WebGPU run. TRATT picks WebGPU automatically and
has no switch of its own, so force the CPU path by disabling WebGPU in the browser
(Chrome/Edge: `chrome://flags` → *WebGPU* → **Disabled**, restart) and reloading.
Everything then runs on WASM: slower, and only the smaller models remain available.

**It is taking a very long time**
Model size, recording length and hardware all multiply. Speaker separation adds more
still, because that model always runs on the CPU. The progress bar shows position
within the recording — if it is moving, it is working. If you need an estimate,
run a five-minute excerpt first.

**The speaker labels are wrong**
Diarization is a guess. Give it the expected number of speakers next time, and fix
labels with **Ctrl/Cmd + S** — see
[Tiers and speakers](tiers-and-speakers.md#fixing-speaker-labels).

---

## Audio playback

**No sound, or "Missing permissions"**
The browser is blocking autoplay. TRATT shows the fix for your browser: click the
crossed-out play icon at the left of the address bar, set Autoplay to *Allow Audio
and Video*, then click **Reload** in the dialog.

**"This transcription unit has to be visible to play the audio contained within it"**
Scroll the unit into view first, or lower **Seconds per line** in Preferences so
more units fit.

---

## Boundaries and editing

**"Cannot set boundary in a transcription unit that is already transcribed."**
Your drag selection spans units that already have text. Place a single boundary
with **S** instead of using a selection, or clear the text first.

**"Cannot delete boundary because there are neighboring transcription units that are
already transcribed."**
Merging would destroy text. Empty one of the two units first.

**"You can't apply undo & redo at the moment."**
Another operation is still running. Wait a second and try again.

---

## Recording

**"Microphone permission was denied." / "No microphone was found."**
Grant microphone access in the browser's site settings and reload. On macOS, also
check System Settings → Privacy & Security → Microphone for your browser.

**Device names are blank**
Browsers hide device labels until permission has been granted once. Click
**Request access**, then **Refresh devices**.

**"Your browser does not support MP4 recording — saving as WebM."**
Firefox. Harmless: TRATT accepts both.

**The volume light stays red**
The microphone is too quiet or is not the one you think it is. Stop, pick a
different input device, check the system input level, and re-record. There is no
fixing this afterwards.

**I closed the tab mid-recording**
Come back to the Record tab. TRATT offers *Unfinished recording recovered* with the
option to continue, download the partial file, or discard it.

---

## Losing work

**My transcript is gone**
TRATT keeps it in this browser's storage, in this browser profile. It disappears if
you clear site data, use a private window and close it, switch browsers or machines,
or if a cleanup tool clears IndexedDB.

**I dropped the file back in but the button said "Start new transcription"**
That means TRATT does not recognise the file as the one the stored session belongs
to, and clicking it *discards* the stored transcript. Check that it is the same
file, with the same name, before clicking.

**Prevention:** export an AnnotJSON file at the end of every session. It is the only
copy that lives outside the browser.

<a id="the-maintenance-page"></a>

---

## The maintenance page

Not linked from the interface: add `/help-tools` to TRATT's address — for example
`http://localhost:5321/help-tools`.

| Tool | Use it when |
| --- | --- |
| **Refresh App** | TRATT is behaving oddly after an update — forces a reload and refreshes the cache |
| **Clear all Storage Data** | You are finished on a shared machine, or storage is corrupt. Removes the transcript, logs and settings permanently. |
| **Stresstest** | Checking whether this browser and machine can cope |
| **Backup local data** | Before clearing anything, or before a browser update — downloads a zip of TRATT's local data |
| **Restore local backup** | Putting that zip back |

**Clear all Storage Data cannot be undone.** Export your transcript, or take a
backup, first.

---

## Reporting a problem

TRATT has a built-in feedback form (the question-mark icon in the top bar), but it
only appears when the app is connected to an OCTRA backend — which the standard
local-only TRATT deployment is not. In that case, report problems on the project's
issue tracker: <https://github.com/humlab-speech/TRATT/issues>.

Whichever route you use, a bug report is usually not actionable without:

- your browser and version, and your operating system;
- whether WebGPU was available, and which model you selected;
- the file format and rough length of the recording;
- what you did, what you expected, and what happened instead;
- anything in the browser's developer console (F12 → Console).

If the in-app form is available, tick the option to include the protocol — the log
of what the app was doing. It is generated from your session, so read it first if
the material is sensitive.
