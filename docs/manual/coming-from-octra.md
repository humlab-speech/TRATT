# Coming from the OCTRA manual

**For:** people who found the [OCTRA 2.0 manual](https://clarin.phonetik.uni-muenchen.de/apps/octra/manuals/octra/2.0/)
— which the app itself still links to — and are trying to map it onto TRATT.

TRATT is a fork of OCTRA. The editing machinery is the same, so the OCTRA manual's
chapters on the GUI and the editors mostly still describe what you see. The
surrounding workflow is not the same at all.

---

## What TRATT adds that the OCTRA manual does not mention

| Feature | Where |
| --- | --- |
| **Local speech recognition.** Whisper models running in your browser, with Swedish, Finnish and Norwegian fine-tunes. | [Automatic draft transcription](automatic-transcription.md) |
| **Speaker separation.** Local diarization, with speaker labels, colours, renaming and cycling. | [Tiers and speakers](tiers-and-speakers.md) |
| **Local machine translation.** Translated tiers linked to a source tier. | [Automatic draft transcription](automatic-transcription.md#translating-the-transcript) |
| **Recording in the browser.** Microphone and camera capture with device selection, level metering and crash recovery. | [Loading a recording](loading-media.md#recording-in-the-browser) |
| **Word and OpenDocument export.** DOCX and ODT with speaker prefixes, timestamps and layout options. | [Exporting](exporting.md) |
| **WebVTT and Whisper JSON.** Import and export, including speaker extraction from voice tags. | [Exporting](exporting.md) |
| **Video display.** Browser-playable video shown beside the waveform in the transcription window. | [The editors](the-editors.md) |
| **Wider media support.** MP4, MOV, MKV, WebM, AVI, AMR and more, decoded in the browser. | [Loading a recording](loading-media.md#supported-file-formats) |

---

## What the OCTRA manual describes that TRATT does not do

**Online mode and the OCTRA backend.** The whole chapter on project login, assigned
jobs, sending transcripts to a server, quitting-and-releasing a task and the
transcription-end screen. TRATT ships with the backend disabled: there is no login,
no project, nothing is sent anywhere. If you need that, use
[upstream OCTRA](https://github.com/IPS-LMU/octra).

**Cloud ASR and MAUS word alignment.** The `R`, `M` and `W` keys and the ASR Options
panel. They need a provider configured by an administrator and an authenticated
session; the standard TRATT deployment configures none.
[Local transcription](automatic-transcription.md) is the replacement, and it does
not send your audio anywhere.

**URL mode and demo/embedding parameters.** Not part of TRATT's supported workflow.

**Administration, guidelines authoring and validation methods.** The configuration
files still exist and behave as documented upstream, but validation is off by
default in TRATT and the Overview will say *No validation methods found*.

**Search & replace.** Documented upstream under *Using Tools*; not exposed in
TRATT's interface.

---

## Things that changed name or behaviour

| OCTRA manual | In TRATT |
| --- | --- |
| "Segment" | Usually "transcription unit" in the interface, though both words appear |
| "Level" | Usually "tier", especially in the newer speaker and translation features |
| Three editors | Still three in the switcher: 2D, Dictaphone, Linear. A fourth, the **TRN-Editor**, exists in the code but is unfinished and not offered — see [The editors](the-editors.md#trn-editor--experimental) |
| The Tools dialog (combine units, cut audio) | Still present, but **not reachable from any button** in the current interface — see [Tools](using-tools.md) |
| Manual link in the navigation bar | Still points at the OCTRA manual rather than at this one |

---

## Still worth reading upstream

The OCTRA manual remains the better reference for the internals TRATT inherited
unchanged: the AnnotJSON data model, the structure of guidelines and validation
files, and project configuration options. If you are configuring an installation
rather than transcribing with one, start there.
