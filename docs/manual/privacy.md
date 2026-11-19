# How Tratt uses the internet

**For:** anyone handling interviews, clinical recordings, or anything else where
"where did the audio go?" is a question you have to be able to answer.

**Short answer:** Tratt reaches the network to fetch *itself* and, when you ask
for one, a language model. It does not send your recording or your transcript
anywhere. The only exception is a [Visp project](visp-projects.md), where
sending the transcript to a server is the whole point.

---

<a id="every-connection"></a>

## Every connection Tratt makes

| What | When | Where to | What travels |
| --- | --- | --- | --- |
| **The app's own files** | First load, and again when a new version is published | The server that hosts Tratt | Nothing of yours |
| **A speech, speaker-separation or translation model** | The first time that model runs | `huggingface.co` | Nothing of yours. Before downloading a translation model, Tratt first asks whether that language pair exists at all. |
| **A maintenance notice** | At start-up | The server that hosts Tratt | Nothing of yours |
| **Your material** | Only in a [Visp project](visp-projects.md) | That project's server | The transcript you are working on, and whatever the project asks you to send |

Outside a Visp project, that is the whole list. Your audio is never uploaded,
not for transcription and not for anything else: the model runs **in the tab**,
on your machine.

## What never leaves your machine

- **The recording.** It is read from disk into the tab's memory, decoded, and
  dropped when you close the tab. Tratt neither uploads it nor writes it back to
  disk.
- **The transcript**, outside a Visp project. It is kept in this browser's
  storage so you can come back to it.
- **Your settings**, including the choice of light or dark mode
  (**Switch between light and dark mode** in the header, stored under
  `tratt.theme`).

## Working offline

Tratt installs a service worker, so after the first successful load the app runs
from your browser's cache. Once you have also downloaded the models you intend to
use, you can disconnect entirely and keep transcribing: nothing in the editing,
the exporting or the storage needs the network.

If your machine or network cannot reach `huggingface.co`, automatic
transcription and translation are simply unavailable. Everything else in Tratt
still works, including transcribing by hand and every export format.

---

## Where your data is kept instead

| | Where it is stored |
| --- | --- |
| The audio or video file you are working on | In the browser tab's memory only |
| The draft transcription produced by a model | In this browser's storage on your machine |
| The transcript you are editing | In this browser's storage on your machine |
| Your settings and colour theme | In this browser's storage on your machine |

Because the audio is only held in memory, Tratt remembers your transcript
between sessions but not your recording: when you come back, attach the same
media file again and carry on.

**Do not lean on that too heavily.** Browser storage is a working convenience,
not an archive. Make a habit of [exporting](exporting.md) after a session.

## Clearing your data

**Delete all data permanently**, at the foot of **Storage and memory** in the
list, is the short way. Tratt asks first — *Delete all transcripts, logs and
settings in this browser? This cannot be undone.* — and on **Yes** empties this
browser's storage and reloads itself, so you are back at the empty start page
with nothing kept. Export your work before you press it; see
[The archive, and how to pick up where you left off](exporting.md#exporting-an-archive).

Do this on a shared machine when you are finished.

The hidden maintenance page does the same and a little more: add `/help-tools`
to Tratt's address (for example
`https://tratt.visp.humlab.umu.se/help-tools`) and use **Clear all Storage
Data**. That page can also make a zip backup of your local Tratt data and
restore one; see [Troubleshooting](troubleshooting.md#the-maintenance-page).

Browsers also clear IndexedDB when you clear site data, use a private window that
you then close, or run storage-cleanup tooling. Treat the in-browser copy as a
working convenience, not as your archive; [export a file](exporting.md) whenever
you stop.
