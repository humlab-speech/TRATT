# What leaves your computer

**For:** anyone handling interviews, clinical recordings, or anything else where
"where did the audio go?" is a question you have to be able to answer.

**Short answer:** your recording and your transcript never leave the browser.
The only thing TRATT downloads on your behalf is the app itself and, if you
switch it on, a speech or translation model.

---

## What stays local

| | Where it lives |
| --- | --- |
| The audio or video file you load | In the browser tab's memory only. It is read from disk, decoded, and discarded when you close the tab. It is never uploaded and never written back to disk by TRATT. |
| The transcript you produce | In the browser's own database (IndexedDB) on your machine. |
| Your settings, your interface language, your logged actions | Same local database. |
| The draft produced by automatic transcription | Produced on your machine, by a model running in your browser. |

Because the audio is only held in memory, TRATT can offer to remember your
transcript between sessions but not your recording. When you come back, drag the
same file in again and your text is waiting.

## What is fetched from the network

**1. The application itself.** Loading the page fetches TRATT's own files from
whichever server hosts it. TRATT installs a service worker, so after the first
successful load the app runs from your browser's cache: you can go fully offline
and keep transcribing. Your browser will pick up a new version of the app when one
is published; TRATT shows a *New update available* notice rather than reloading
under you.

**2. Speech-recognition and translation models, only if you ask for them.**
Ticking **Auto-transcribe with Whisper**, **Speaker separation** or
**Translate transcript locally** downloads the selected model from
`huggingface.co` (between roughly 100 MB and 3 GB depending on the model). The
model is then cached in your browser and reused.

Your audio is **not** sent to Hugging Face or anywhere else. The traffic goes one
way: the model comes down, the recording stays put.

If your machine or network cannot reach `huggingface.co`, automatic transcription
simply is not available; everything else in TRATT still works.

## Clearing your data

Open the hidden maintenance page by adding `/help-tools` to TRATT's address (for
example `http://localhost:5321/help-tools`) and use **Clear all Storage Data**. It
removes the stored transcript, logs and settings from this browser permanently. Do
this on a shared machine when you are finished, after exporting your work. The
same page can also make a zip backup of your local TRATT data and restore one; see
[Troubleshooting](troubleshooting.md#the-maintenance-page).

Browsers also clear IndexedDB when you clear site data, use a private window that
you then close, or run storage-cleanup tooling. Treat the in-browser copy as a
working convenience, not as your archive; [export a file](exporting.md) whenever
you stop.
