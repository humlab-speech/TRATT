# Troubleshooting

---

## Loading a file

**"This file type is not supported." / "File format not supported."**
The extension is not in Tratt's list. Convert to `.wav` or `.mp3` and try again.
See [supported formats](loading-media.md#supported-file-formats).

**"File exceeds the maximum allowed size of 3000 MB." or an invalid-size error**
The Traat application is subject to two limits due to how in-browser applications work. First, there is a global 3000 MB ceiling in how much storage the application can use. Second, there are per-file limiations: 1.9 GB for
`.wav`, 500 MB for everything else. If you are having trouble loading in a recording, convert it
to FLAC or MP3, or split the recording into two.

**"Transcript filename does not match the audio filename."**
Tratt assumes that the audio file and transcript file with time information have identical names but for their file extensions. Rename the transcript so its base name matches the
audio's, e.g. `interview3.wav` with `interview3.srt`. The one exception to the rule is *annotJSON* files, in which case teh application assumes that the files are named like `interview3.wav` and `interview3_annot.json`.

**The transcript file sits there with a spinner**
It is waiting for audio. Drop the media file too. A transcript cannot be
opened without a media file, with the same name (See above).

**Loading a video takes a long time**
This is expected. When a video file is loaded, the sound has to be decoded out of the container in the browser. 
Please use a simpler audio format, preferably `.wav`, if the process is very slow.

---

## Automatic transcription

<a id="automatic-transcription-is-greyed-out"></a>

**The Auto-transcribe checkbox is disabled, with a warning about Safari**
Safari and other WebKit browsers reload the tab part-way through large model
downloads, losing your work, so Tratt disables the feature in these browsers. Use Chrome, Edge
or Firefox. Manual transcription in Safari is unaffected.

**The checkbox is missing entirely**
It only appears once audio has loaded *and* no transcript file has been supplied.
There is nothing to draft if you already brought a transcript.

**The largest models are greyed out, "Requires WebGPU"**
Your browser or graphics hardware does not expose WebGPU. Which models that affects
depends on the language you picked. Use Tiny or Small, or run
Tratt on a machine with a discrete graphics card. In Chrome and Edge you can check whether you have WebGPU 
at `chrome://gpu`.

**The model download stalls or fails**
The models are downloaded from `huggingface.co`. If your network blocks it, automatic
transcription cannot work. In this case, you can still perform manual transcription. On a slow link,
you can start with the Tiny model to confirm the pipeline works before committing to a
multi-gigabyte download.

**Transcription fails part-way, mentioning WebGPU**
Some drivers cannot sustain a long WebGPU run. Tratt picks WebGPU automatically and
has no switch of its own, so force the CPU path by disabling WebGPU in the browser
(Chrome/Edge: `chrome://flags` → *WebGPU* → **Disabled**, and restart the browser) and reload the application.
This causes the application to use the WebAssembly pipeline, which will be slower, but may work better. 

**It is taking a very long time**
Model size, recording length, and your hardware determines how fast the processing will be. Speaker separation adds more
processin ttime still, because that model always runs witout WebGPU accelleration. The progress bar shows position
within the recording. If it is moving, work is being done and you just have to wait. If you need an estimate of how long the processing will be, run a five-minute excerpt first.

**The speaker labels are wrong**
The process of determoning speaker changes and assigning units to the correct speaker is very error prone. To give it some guidande, provide it the expected number of speakers, but please expect that you need to fix
labels with **Ctrl/Cmd + S** in your manual review. See
[Tiers and speakers](tiers-and-speakers.md#fixing-speaker-labels).

---

## Audio playback

**No sound, or "Missing permissions"**
In this case, the browser is blocking autoplay. Tratt shows the fix for your browser: click the
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
You are trying to perform a merge that would destroy text. Empty one of the two units first.

**"You can't apply undo & redo at the moment."**
Another operation is still running. Wait a second and try again.

---

## Recording

**"Microphone permission was denied." / "No microphone was found."**
Grant microphone access in the browser's settings and reload. On macOS, also
check System Settings → Privacy & Security → Microphone for your browser.

**Device names are blank**
Browsers hide device labels until permission has been granted once. Click
**Request access**, then **Refresh devices**.

**"Your browser does not support MP4 recording, saving as WebM."**
This applies to Firefox. The changes is safe to perform, as Tratt accepts both formats.

**The volume light stays red**
The microphone is too quiet or is not the one you think it is. Stop, pick a
different input device, check the system input level, and try again. You may not be able to recover a recording 
that was performed with to low recording level afterwards.

**I closed the tab mid-recording**
Come back to the Record tab. Tratt offers *Unfinished recording recovered* with the
option to continue, download the partial file, or discard it.

---

<a id="the-workbench"></a>

## The Workbench


**A file failed with "Ran out of memory"**
You have attached too much decoded audio to the session at once. The **Working memory (est.)** meter
shows how much storage is being used. Export what is finished,
**Clear finished** to release it, then attach the next few recordings. Using a smaller
transcription model also helps.

**A file failed with "Could not read the audio"**
You are uploading a media file in an unsupported file format, or the file is damaged. Try to
 start page on its own, and convert it to `.wav` or `.mp3` if it still
fails.

**A file failed with "Could not load the model"**
The model download did not complete. Check the network, then **Retry** on that
row. The rest of the queue is unaffected.

**Everything says "Interrupted"**
The page was closed or reloaded while the queue was running. 
Re-attach the audio and run the queue again. In most cases, nothing is lost in this process.

**The Transcribe button is greyed out**
No pipeline is configured. Open **Pipeline settings** and tick
**Auto-transcribe with Whisper** first.

**Every file says "Attach file…"**
This is normal after a reload. Tratt keeps a copy of the transcripts in its storage, but not the media. So each recording
needs its audio to be attached from your computer again. An
[exported archive](exporting.md#exporting-an-archive) contains everythink though and restores both at once.

**Everything came back orange**
Intended. Transcripts stored before version 3.2, and any transcript rebuilt on
resume before the 3.2 fixes, load as non-verified. Tratt cannot know who checked
them. Listen to a unit or edit it and it turns green. See
[Verified transcriptions](checking-your-work.md#verified-transcriptions).

**"This doesn't look like the same file"**
The file you picked differs from the one the entry was made from. The dialog shows
both, so that you may compare them. When only the modification time differs it is usually a
copy or re-exported audio and **Use anyway** is safe.

**The start page replaced a recording that was in the Workbench list**
They share one stored session slot, and TRATT warns about this before it happens.
Use one route or the other for a given piece of material.

---

## Losing work

**My transcript is gone**
Tratt keeps a copy of transcripts in this browser's storage. You can have problems if
you clear site data, use a private window and close it, switch browsers or machines,
or if a cleanup tool clears IndexedDB.

**I dropped the file back in but the button said "Start new transcription"**
That means TRATT does not recognise the file as the one the stored session belongs
to, and clicking it *discards* the stored transcript. Check that it is the same
file, with the same name, before clicking the button to start a new transcription.


<a id="the-maintenance-page"></a>

---

## The maintenance page

This pave is not linked to from the interface: add `/help-tools` to TRATT's address, for example
`https://tratt.demo.humlab.umu.se/help-tools`.

| Tool | Use it when |
| --- | --- |
| **Refresh App** | Tratt is behaving oddly after an update. It forces a reload and refreshes the cache |
| **Clear all Storage Data** | You are finished on a shared machine, or storage is corrupt. It removes the transcript, logs and settings permanently. |
| **Stresstest** | Checking whether this browser and machine can cope |
| **Backup local data** | Before clearing anything, or before a browser update. It downloads a zip of Tratt's local data |
| **Restore local backup** | Restoring the previous state from a zip file |

**Clear all Storage Data cannot be undone.** Export your transcript, or take a
backup, first.

---

## Reporting a problem

TRATT has a built-in feedback form (the question-mark icon in the top bar), but it
only appears when the app is connected to an OCTRA backend, which the standard
local-only TRATT deployment is not. In that case, report problems on the project's
issue tracker: <https://github.com/humlab-speech/TRATT/issues>.

Whichever route you use, a bug report is usually not actionable without:

- your browser and version, and your operating system;
- whether WebGPU was available, and which model you selected;
- the file format and rough length of the recording;
- what you did, what you expected, and what happened instead;
- anything in the browser's developer console (F12 → Console).

If the in-app form is available, tick the option to include the protocol: the log
of what the app was doing. It is generated from your session, so read it first if
the material is sensitive.
