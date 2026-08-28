# Quick start: your first transcription

**For:** anyone who has just opened TRATT and has a recording to transcribe.
**You will end up with:** a corrected transcript saved as a file on your computer.
**Time:** about ten minutes of your attention. If you use automatic transcription,
add download and processing time; see step 3.

You do not need an account. You do not need to install anything.

---

## 1. Open TRATT

You land on a page headed **Transcribe conversations locally in your web browser**.

![The TRATT start page](../assets/visp_tratt_main.png)

Use **Chrome**, **Edge**, **Firefox** or **Opera**. Safari works for manual
transcription but cannot run automatic transcription; see
[Troubleshooting](troubleshooting.md#automatic-transcription-is-greyed-out).

## 2. Load your recording

Stay on the **Upload file** tab and drag your audio or video file onto the dashed
box, or click the box and pick the file.

Most formats work: `.wav`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.mp4`, `.mov`,
`.webm` and more. The full list with size limits is in
[Loading a recording](loading-media.md#supported-file-formats).

A green check mark next to the file name means TRATT has read it. A video file
takes a little longer, because the sound has to be extracted first.

> **No recording yet?** Switch to the **Record now** tab and record straight into
> the browser. See [Recording in the browser](loading-media.md#recording-in-the-browser).

> **Just looking?** The **Open demo** link in the top right of the box loads a
> sample recording so you can try the editor without your own material.

## 3. Decide whether a model should write the first draft

Once the file is loaded, a box appears under the drop zone with the checkbox
**Auto-transcribe with Whisper**.

- **Leave it unchecked** to type everything yourself. Continue to step 4.
- **Tick it** and a speech-recognition model will produce a draft you then correct.
  Pick your **Transcription language**, then pick a model size. Bigger models are
  more accurate and slower, and the first run has to download the model
  (roughly 100 MB to 3 GB, cached for next time).

  Optionally tick **Speaker separation** to have TRATT guess who spoke when. If you
  know how many people are on the recording, type that number; for a two-person
  interview, type `2`.

This all runs on your own machine. The only thing fetched from the internet is the
model itself. Details and model recommendations:
[Automatic draft transcription](automatic-transcription.md).

## 4. Start

Click the button below the box: **Start new transcription**.

If you asked for a draft, you now see progress: first the model download, then
*Transcribing audio…* with a time counter, then *Identifying speakers…* if you
enabled speaker separation. On a long recording this can take a while; the page
must stay open. When it finishes, the editor opens by itself.

## 5. Correct the text

You arrive in the **2D-Editor**: the recording is drawn as a waveform on several
lines, one line after another, with the text sitting under each chunk of speech.

TRATT calls each of those chunks a **transcription unit**: one utterance, roughly
one line of a subtitle. Other tools call it a segment.

![Correcting one unit in the transcription window](../assets/visp_tratt_popup_editor_audio_only.png)

To correct a unit:

1. Move the mouse over it and press **Enter**. A window opens showing just that
   unit's audio and its text.
2. Press **Tab** to play it, **Tab** again to pause, **Esc** to stop.
3. Fix the text.
4. Press **Alt + →** to save and move to the next unit, or **Alt + ↓** to save and
   close the window.

That loop, Enter, Tab, type, Alt + →, is the whole job. Everything else is
refinement.

If you need to mark something that is not a word (a pause, laughter, background
noise, an unintelligible word), use the marker buttons above the text field, or
**Alt + 1** … **Alt + 7**. See [Markers](transcribing.md#markers).

Your progress is saved in the browser continuously. You do not have to press save.

## 6. Look over the whole thing

Press **Alt + 0** to open the **Overview** window. It shows how many units exist,
how many have text, and the whole transcript as a table. Click any row to edit it
there, or click ▶ to hear it.

![The Overview window](../assets/visp_tratt_overview_edit.png)

## 7. Export

Click **Export**: the download icon in the top bar, and also a button along the
bottom of the editor. The dialog is headed *Export transcriptions*. Choose a
format and click **Download**.

![Export formats](../assets/visp_tratt_export_formats.png)

If you are not sure which one you want:

| You want to… | Choose |
| --- | --- |
| Read or edit the transcript in Word or LibreOffice | **Word (.docx)** or **OpenDocument (.odt)** |
| Make subtitles | **SubRip (.srt)** or **WebVTT (.vtt)** |
| Keep working in TRATT later, losing nothing | **AnnotJSON (`_annot.json`)** |
| Analyse it in Praat or ELAN | **TextGrid** or **ELAN (.eaf)** |

Word and OpenDocument export can put each utterance on its own line or run it as
continuous text, and can prefix speaker names and timestamps. All the options are
described in [Exporting](exporting.md).

---

## Two things worth knowing before you close the tab

**TRATT remembers your transcript, but never your recording.** When you come back,
the text is still there, but you must drag the same media file in again to keep
working. Export a file whenever you stop for the day.

**Nothing was uploaded.** Your recording stayed on your machine the whole time. See
[What leaves your computer](privacy.md).

---

Next: [How transcribing works](transcribing.md) if you are going to do this often,
or [Keyboard shortcuts](shortcuts.md) if you just want to be faster.
