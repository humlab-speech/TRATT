# Privacy within the TRATT application

**For:** anyone handling interviews, clinical recordings, or anything else where
"where did the audio go?" is a question you have to be able to answer.

**Short answer:** your recording and your transcript never leave the browser.
The only thing TRATT downloads on your behalf is the app itself and, if you
switch it on, a speech or translation model.

---

## How the different kinds of data are stored

| | Where it is stored |
| --- | --- |
| The audio or video file you are working on | In the browser tab's memory only. It is read from disk, decoded, and discarded when you close the tab. It is never uploaded and never written back to disk by TRATT. |
| The draft transcription produced by a transcription model | In the browser's local storage on your machine. |
| The transcript you are editing | In the browser's local storage on your machine. |

Because the audio is only held in memory, TRATT will remember your
transcript between sessions, but will not store your recording. When you come back, drag the
same sound or media file in again and you can continue your work.
**Please do not, however, rely too heavilly on this mechanism to work correctly*. 
Instead, make a habit of making a copy of your transcript after a completed session [See Exporting](exporting.md).

## What is fetched from the network

**1. The application itself.** Loading the page fetches TRATT's own files from
whichever server hosts it. TRATT installs a service worker, so after the first
successful load the app runs from your browser's local storage (cache). This means 
that you can go fully offline and keep transcribing once you have completed the download
of any automatic annotation model you wish to use (See below). 

**2. Speech-recognition and translation models**
Ticking **Auto-transcribe with Whisper**, **Speaker separation** or
**Translate transcript locally** downloads the selected model to your local browser storage 
(between roughly 100 MB and 3 GB depending on the model). The
model is then cached in your browser and reused if you start the application again.

Your audio is **not** sent by the app to a server for transcription.

If your machine or network cannot reach the servers where the automatic annotation models are stored (`huggingface.co`)
, automatic transcription simply will not available; everything else in TRATT will still work.

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
