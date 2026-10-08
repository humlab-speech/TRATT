# TRATT manual

TRATT turns a recording of people talking into editable text, entirely inside your
web browser. You load a sound or video file, optionally let a speech-recognition
model write a first draft, correct that draft against the audio, and export the
result as a document, subtitle file or annotation file.

Nothing you load is uploaded anywhere. The recording never leaves your computer;
see [What leaves your computer](privacy.md) for exactly what does.

---

## Start where you are

| If you are… | Go to |
| --- | --- |
| **New here.** You have a recording and want text out of it, today. | [Quick start: your first transcription](quick-start.md) *(about 5 minutes of reading, plus model download time)* |
| **Transcribing for real.** You work in TRATT regularly and want to be fast and correct. | [How transcribing works](transcribing.md), then [Keyboard shortcuts](shortcuts.md) |
| **Holding a folder of recordings**, not one file. | [The Workbench](workbench.md) |
| **Looking one thing up.** | The reference list below |

---

## Two ways of working

Most of TRATT is about one recording at a time: you load a file on the start page,
transcribe it, export it. That is what the next two sections describe, and it is
where to start.

If you have a batch, the **Workbench** at `/workbench` holds many recordings in one
list, transcribes them through a queue, and lets you click between the results. It
is a preview and not in every build. The editors, shortcuts and formats are the
same either way, so nothing you learn below is wasted.

---

## Contents

**Getting started**

- [Quick start: your first transcription](quick-start.md)
- [What leaves your computer](privacy.md)

**One recording at a time**

- [Loading a recording](loading-media.md): upload, record in the browser, supported formats, resuming a session
- [Automatic draft transcription](automatic-transcription.md): speech-recognition models, languages, speaker separation, translation
- [How transcribing works](transcribing.md): transcription units, boundaries, markers, speakers
- [The editors](the-editors.md): 2D, Dictaphone, Linear
- [Tiers and speakers](tiers-and-speakers.md)
- [Checking your work](checking-your-work.md): the Overview window, statistics, guidelines

**Many recordings**

- [The Workbench](workbench.md): a file list, a transcription queue, batch export

**Results and tools**

- [Exporting](exporting.md): every format TRATT can write, and what each is good for
- [Tools](using-tools.md): combining units, cutting audio, custom tables

**Reference**

- [Keyboard shortcuts](shortcuts.md)
- [Troubleshooting](troubleshooting.md)
- [Glossary](glossary.md): what TRATT calls things
- [Coming from the OCTRA manual](coming-from-octra.md)

---

## About this manual

TRATT is a fork of [OCTRA](https://github.com/IPS-LMU/octra) (Institute of
Phonetics and Speech Processing, LMU Munich), developed for the Visible Speech
platform by [Humlab](https://www.umu.se/humlab/) and
[Språkbanken CLARIN](https://sprakbanken.se/) at Umeå University.

The [OCTRA manual](https://clarin.phonetik.uni-muenchen.de/apps/octra/manuals/octra/)
describes the upstream tool. Much of it still applies to the shared editing
machinery, but it does not describe TRATT's local speech recognition, in-browser
recording, speaker handling or document export, and it describes a server-backed
mode that TRATT does not run. If you have been reading it, start with
[Coming from the OCTRA manual](coming-from-octra.md).

This manual documents TRATT 2.4.x.
