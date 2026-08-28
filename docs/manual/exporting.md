# Exporting

**For:** everyone, at the end of every session.

TRATT keeps your work in the browser, not on disk. **Exporting a file is the only
way your transcript leaves the browser.** Do it before you stop, every time.

Click **Export** (the download icon in the top bar, or the button along the bottom
of the editor). The dialog is headed *Export transcriptions*. Click a format to
expand its options, then **Download**.

![The export dialog](../assets/visp_tratt_export_formats.png)

---

## Which format?

The dialog groups formats into three sections, and tells you for each group whether
you can load the file back into TRATT later.

### General output formats

For reading, sharing and publishing. **Only SRT can be loaded back into TRATT.**

| Format | File | Good for |
| --- | --- | --- |
| **DOCX** | `.docx` | Word. The format most people actually want the transcript in. |
| **ODT** | `.odt` | LibreOffice / OpenOffice. Same options as DOCX. |
| **SubRip** | `.srt` | Subtitles, video players — and the one format in this group you can re-import |
| **Plain text** | `.txt` | Anything that reads text |

### Linguistic formats

All of these can be loaded back into TRATT.

| Format | File | Good for |
| --- | --- | --- |
| **AnnotJSON** | `_annot.json` | **TRATT's own format.** Keeps everything — tiers, boundaries, speakers, markers. Export this alongside whatever else you need. |
| **TextGrid** | `.TextGrid` | Praat |
| **ELAN** | `.eaf` | ELAN. Put the `.eaf` in the same folder as the audio or ELAN will not find the media. |
| **Praat Table** | `.Table` | Praat's table format |

### Specialist technical formats

| Format | File | Good for |
| --- | --- | --- |
| **WebVTT** | `.vtt` | Web video subtitles |
| **BAS Partitur** | `.par` | BAS web services. Export writes ORT and TRN lines from the transcription. |
| **CTM** | `.ctm` | Speech-recognition scoring tools. Confidence is always written as 1 — TRATT does not track it. |

> **Always take an AnnotJSON copy.** DOCX and ODT are one-way: they read well and
> import badly. If you might need to correct the transcript in six months, the
> AnnotJSON file plus the original recording is what lets you.

---

## Options

### DOCX and ODT

| Option | Effect |
| --- | --- |
| **Each sentence on a separate line** / **Continuous text** | One transcription unit per line, or everything run together as prose |
| **Mark speaker ID at the beginning of sentences** | Prefixes each unit with its speaker label |
| **Add timestamp at beginning of each sentence** | Prefixes each unit with its start time |
| **Collect annotations according to transcription tier in the output** | Shown when you have selected more than one tier: groups the output tier by tier instead of interleaving |

### Plain text

| Option | Effect |
| --- | --- |
| **Mark speaker ID at the beginning of sentences** | As above |
| **Add a line break after each transcription unit** | One unit per line |
| **Separate transcription units by readable timestamps (HH:MM:SS.s)** | Human-readable times between units |
| **Separate transcription units by sample points** | Sample positions between units — for lining up against the signal elsewhere |
| **Collect annotations according to transcription tier in the output** | Shown when more than one tier is selected |

Ticking both time options inserts both.

### SubRip and WebVTT

| Option | Effect |
| --- | --- |
| **Move units with speaker label to separate levels** | One tier per speaker instead of one mixed tier |
| **Combine empty units with max duration (ms) between units of the same speaker** *(SRT)* | Merges a short gap between two turns by the same person. Blank switches it off. |

### Choosing tiers

This only comes up when your transcript has more than one tier.

- **AnnotJSON, TextGrid, Praat Table, ELAN** carry several tiers natively and export
  the whole transcript. No choice to make.
- **SubRip, WebVTT, BAS Partitur, CTM** hold one tier, and ask you to
  **Select one tier**.
- **DOCX, ODT and plain text** show **Select tiers to include** with a checkbox per
  tier. The *Collect annotations according to transcription tier* option then
  decides whether the output is grouped tier by tier or interleaved.

### Meta data

The dialog also offers the meta data logged while you worked. It is only available
if **Log user actions** was on in Preferences. It is a research artefact — keystroke
and playback history — not part of the transcript.

---

<a id="formats-tratt-can-read"></a>

## Formats TRATT can read

Drop these alongside your audio on the start page to continue existing work.

| Format | Notes |
| --- | --- |
| **AnnotJSON** (`_annot.json`) | Complete round trip. Prefer this. |
| **WhisperJSON** (`.json`) | Output from Whisper / WhisperX run elsewhere. Only timestamps and text are read; everything else is ignored. |
| **SubRip** (`.srt`) | With speaker-extraction options — see [Tiers and speakers](tiers-and-speakers.md#importing-material-that-already-has-speakers) |
| **WebVTT** (`.vtt`) | Reads `<v Name>` voice tags. STYLE, REGION and NOTE blocks are ignored; multi-line cues are merged. |
| **Plain text** (`.txt`) | |
| **TextGrid** (`.TextGrid`), **Praat Table** (`.Table`) | |
| **ELAN** (`.eaf`) | Only the tier attribute `ANNOTATION` is parsed |
| **BAS Partitur** (`.par`) | TRN and ORT lines are combined into one tier of time-aligned units |
| **CTM** (`.ctm`) | |

The transcript file's name must match the audio file's name, or TRATT rejects it
with *Transcript filename does not match the audio filename*.

DOCX and ODT cannot be imported. Neither can Bundle JSON — it appears in the code
but export is disabled.

---

## Custom tables

If none of the above has the columns you need, build your own in the
**Custom formats** section at the bottom of the export dialog. See
[Tools → The Table Configurator](using-tools.md#table-configurator).
