# Working with several recordings

**For:** anyone with a folder of recordings rather than a single file.

Tratt has one working surface, and it holds as many recordings as you like. 

![The list of recording bundles beside the editor](../assets/visp_tratt_workbench.png)

The editors, the shortcuts, the
markers, the tiers and the export formats are the ones described in the rest of
this manual.

<a id="when-to-use-it"></a>

## One recording or many

| | One recording | Several |
| --- | --- | --- |
| Automatic transcription | Starts as soon as the file is in | A queue that works through the list, one at a time |
| Moving between recordings | — | Click a row in the list |
| Export | That recording | One of them, the ticked ones, or all of them in one archive |

---

## Recording bundles

Each entry in the list is a **recording bundle**: a recording's audio
together with its transcript. The two parts behave differently:

- The **transcript** is saved in the browser as you work, and is still there
  when you come back.
- The **audio** is never saved. Tratt reads it from your computer while the page
  is open, so after a reload a recording bundle has its transcript but no audio
  until you attach the audio again.

The list shows both parts: the **Audio** column has a speaker when the audio is
attached and **Attach** when it is not, and the **Transcript** column says where
the transcript is. In this manual, *file* means only a file on your
computer, which is the one you drop, choose or download.


---

## The layout

Four things sit on the left, from top to bottom:

1. **Recording bundles** with their number, and the buttons **Export…**,
   **Delete done** and **Delete**.
2. The **Upload file** and **Record now** tabs over a drop area:
   *Drop audio or video files here, or a .zip saved from Tratt*. While a
   recording bundle is waiting for its audio, the drop area says that dropping
   that audio file attaches it.
3. **Transcription**: the transcription settings, whether new files are
   transcribed automatically, and — when some file is waiting — the button
   that starts the queue.
4. **Storage and memory**: two capacity meters, **Browser storage** and
   **Working memory (est.)**, over **Delete all data permanently**.

The rest of the window is the recording bundle you have selected in the list.
The list is the only place to switch between recording bundles; hover over one
to see its audio details.
Above the editor, one bar holds the editor tabs, **Shortcuts**, **Overview** and
**Help**. Below it is the editor itself.

---

## Adding recordings

Drop as many audio or video files as you like on the drop area at once, or click
it and select them. Each file becomes its own entry in the list with its own
transcript. Formats and size limits are the same as everywhere else, listed under
[Loading a recording](loading-media.md#supported-file-formats).

**A transcript file** belongs with its recording: drop it together with the audio,
or after the audio is already in the list. Tratt pairs the two by name and tells
you when it cannot:

- *No recording named "x". Drop the transcript together with its audio file, or
  name it like the recording.*
- *Attach the audio of "x" first, then drop its transcript again.*
- Replacing a transcript that already has text asks for confirmation first,
  because your edits to it would be lost.


**Record now** records straight into the list, exactly as it does on the empty
start page.
See [Recording in the browser](loading-media.md#recording-in-the-browser).

<a id="loading-an-archive"></a>

### Loading an exported archive

Drop a `.zip` that Tratt exported earlier on the same drop area. Every recording
in it comes back with its audio attached and its transcript in place, and
automatic transcription stops so that finished work is not transcribed over.
That is the intended way to resume a session, move work between machines or hand
it to a colleague. A description of the procedure, including what the archive holds and what
changes on the way back in, is under
[The archive, and how to pick up where you left off](exporting.md#exporting-an-archive).

---

## Transcribing

The large orange **Transcribe** button, under the file list, is a
split button. Its left part starts transcription; its right part (the sliders
icon) opens the **Transcription settings**: the model, the transcription
language, speaker separation and local translation, described in
[Automatic draft transcription](automatic-transcription.md). Hover over the
sliders icon to see the current settings without opening them.

**Transcribe new files automatically** is a switch at the top of the settings.
When it is on, files are transcribed as they arrive. You can drop several
recordings and wait for them all to be processed. With nothing left to do, the
button then reads **Auto-transcribe on**.

When it is off, new recording bundles wait. The button reads **Transcribe N**
and runs the queue over every recording bundle that has no transcript yet,
skipping those whose audio is not attached. While the queue is
running, files are transcribed one at a time and the button becomes the run's
progress bar: *Transcribing 2 of 5*, filling up as the files are done. While a
file is prepared (its audio read, and the first time, its model loaded) its part
of the bar pulses. Clicking the button stops the run after you confirm: the file
in progress is cancelled, and the files still waiting are not transcribed.

The button can always be clicked. When there is nothing for it to do, it says
why, and its tooltip says so too.

### Transcribing a file again

To transcribe a file again, for example with a larger model or other settings,
mark it in the file list. The button then reads **Transcribe N selected**.
Files that already have a transcript are only transcribed again after you
confirm. Their current transcript is **replaced and cannot be restored**,
including any corrections you made, so use **Export…** first if you want to
keep a copy. The confirmation says how many passages a person has already
corrected or checked by listening.

If you edit a file's transcript while it is being transcribed again, your edits
are kept and the new result is discarded.

---

## Watching it work

Each row in **Recording bundles** shows, in its **Transcript** column, where the
transcript stands:

| Status | Means |
| --- | --- |
| **Queued** | Waiting its turn |
| **Running** | Being worked on now, with the current stage and how far it has come, e.g. *Transcribing 40%* |
| **Done** | Finished |
| **Failed** | Stopped on an error, with **Retry** on the row |
| **Cancelled** | Stopped by you, with **Retry** on the row |
| **Has text** / **Not transcribed** | Never run: whether the transcript has any text yet (imported, or typed by hand) |
| **Interrupted** | The page was closed or reloaded part-way |

The button on the row stops that one recording bundle (*Stop transcribing this recording bundle*) and leaves the rest of the
queue alone.

A failed file says what went wrong (*Could not read the audio*,
*Could not load the model*, *Ran out of memory*, *Cancelled*, or simply *Failed*).
**Ran out of memory** means that the batch uploaded is too large for the available storage.
[Capacity](#capacity) below.

---

## Editing a result

Click a recording bundle in the list to open it. Hover over it to see its audio
details, for example `1:45 · 16 kHz mono · 3.4 MB`. When the audio is not
attached, they read *Audio not attached*, and **Attach audio…** sits at the right
end of the bar with the editor tabs.

From there you are in the ordinary editor. You select the 2D, Dictaphone, or Linear editor with the
editor tabs, and work as described in
[How transcribing works](transcribing.md). **Shortcuts** (Alt + 8) and
**Overview** (Alt + 0) are in the same bar as the tabs.

Playing a unit or editing its text marks it
[verified](checking-your-work.md#verified-transcriptions).

Edits are saved as you type, per recording bundle. Switching to another one in the list
does not make Tratt lose data.

---

## Coming back later

Tratt keeps your recording bundles' transcripts but never their audio. When you
return, a **Welcome back** panel greets you: *Tratt kept your transcripts from
last time, but not your audio. To listen and correct,
attach each recording bundle's audio with "Attach" in the list, or drop the same
audio files here.* Pick the same file from disk (with **Attach** in the list,
**Attach audio…** in the header, or by dropping it) and editing continues where
you left off. Until then the editor says *This recording bundle's audio isn't
attached*, with an **Attach audio…** button.

If the file you pick does not look like the one the entry was made from, Tratt
stops to ask: *This doesn't look like the same audio*, with what you picked and
what it expected side by side, and **Use anyway**. When only the modification
time differs, Tratts indicates that, since that is usually a copy or re-exported audio rather
than the wrong recording.

You can also export an archive before you stop and
[load that back](#loading-an-archive) next time, which restores the audio and the
transcripts together and needs no re-attaching.

---

<a id="capacity"></a>

## Capacity

The two meters measure different things, and only one of them limits how much you
can have open.

**Browser storage** is what Tratt keeps on disk, which includes the downloaded models and your
transcripts. The note under it estimates both, for example *models ~210 MB for the
current pipeline + annotations ~221 MB*. **Media is never written to storage**,
which is why a folder of large recordings does not fill it up. Some browsers do
not report usage at all, and the indicator is then unavailable.

**Working memory (est.)** is decoded audio held in the tab. 
Every recording whose audio is attached occupies memory for as long as it
is attached. If you are near the budget, or a file fails with *Ran out of memory*,
work through the material in smaller groups,  export and
[Delete done](#housekeeping), then attach the next few.

At the foot of the panel, **Delete all data permanently** empties this browser's
storage: every transcript, log and setting, not only the recordings in the list.
Tratt asks first and then reloads itself, leaving you on the empty start page.
Export before you use it; see
[How Tratt uses the internet](privacy.md#clearing-your-data).

---

## Getting results out

**Export…** under the list opens the export dialog, described in
[Exporting](exporting.md). Choose there what to export: the recording bundle open
in the editor, the ones you have ticked, or all of them. It works even when the
audio is not attached. Recording bundles without a transcript are left out.

One recording in one format downloads as that file; anything more comes as one
archive. The dialog closes when you click **Download**, and the download starts
when the files are ready. Recordings Tratt had to skip are listed in a warning.

What the archive contains, and how to load it back, is described in
[Exporting an archive](exporting.md#exporting-an-archive).

---

<a id="housekeeping"></a>

## Housekeeping

**Delete done** deletes the recording bundles marked *Done*, transcripts included. **Delete**
takes out the ones you have ticked, and the checkbox in the Files header ticks
them all. These actions cannot be undone.
