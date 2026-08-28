# Tools

**For:** transcribers with a specific mechanical job to do: reshaping units,
cutting the audio into pieces, or producing a table of their own design.

> **Note on availability.** The **Tools** dialog described in the first two
> sections below (*Combine transcription units* and *Cut audio file*) is present in
> TRATT but is **not currently reachable from any button in the interface** in this
> version. The Table Configurator, in the third section, *is* reachable: it lives
> inside the Export dialog. If you need the first two, ask whoever maintains your
> installation.

---

<a id="tratt-combine-units"></a>

## Combining transcription units

**The problem it solves.** Automatic transcription, and word-level segmentation in
particular, tends to produce far more units than a human wants to work with: one
per word, or one per short phrase, split at every small pause. Stepping through them
one at a time is miserable.

**What it does.** Units whose content is silence shorter than a threshold are merged
with their neighbours, so short phrases separated by a breath become one unit.

**Settings**

| Setting | Meaning |
| --- | --- |
| **Minimal length of silence** | Silences *longer* than this are left alone as real boundaries. Silences shorter are treated as joins. |
| **Maximal number of words** | After merging, no unit will exceed this many words. `0` means no limit. This only works properly when the input has one word per unit. |

**Before you run it.** The word limit only behaves as documented on a
word-segmented annotation. And although the operation is undoable with
**Ctrl + Z** / **Cmd + Z**, it touches the whole tier at once. Export an
AnnotJSON copy first if the transcript matters.

---

<a id="cutting-audio-files"></a>

## Cutting the audio file

**The problem it solves.** You need each utterance as its own sound file: for a
perception experiment, for a corpus, for sharing individual clips without the rest
of the interview.

**What it does.** Writes one audio file per transcription unit, plus optional
annotation files alongside them, and hands you the collection as a download.

**Everything is converted to WAVE PCM 16-bit mono** at the recording's sample rate.
That is lossless relative to what TRATT decoded, but it is not a copy of your
original encoding.

**Settings**

- **Naming convention**: build the output file names by dragging the parts you
  want (original file name, unit number, unit text, timestamps) into the order you
  want. You must include at least one variable part, or every file would have the
  same name.
- **Append meta files**: also write an annotation file per clip, in the formats you
  tick.

Cutting a long recording takes a while and shows a progress bar; you can stop it
partway.

---

<a id="table-configurator"></a>

## The Table Configurator: custom table export

**Where it is:** open **Export transcriptions**, then look under **Custom formats**
at the bottom of the dialog.

**The problem it solves.** None of the built-in formats has exactly the columns your
analysis script wants.

**What it does.** You build a table column by column, see a live preview, and
download it.

**Available columns**

| Column | Contents |
| --- | --- |
| Line number | A running count |
| Unit start | When the unit begins |
| Unit end | When it ends |
| Unit duration | How long it lasts |
| Transcript | The text |
| Tier | The tier's name |
| Sample rate | The recording's sample rate |

**Options**

- **Time format**: *Timestamp* (`01:30:02.234`), *Seconds*, or *Samples*. Choose
  Samples if you are going to line the table up against the signal in another tool;
  choose Seconds for statistics.
- **Divider**: tab, semicolon or comma.
- **File extension**: `.csv`, `.txt`, `.table` or `.tsv`.
- **Add header to the table**: a header row with your column titles.
- **Include line numbers**.

Column titles are editable (type your analysis script's expected header names
directly), and columns can be dragged into a different order.

---

## Related

- Ordinary export formats: [Exporting](exporting.md)
- Merging turns by the same speaker (a different operation, in the TRN-Editor):
  [The editors](the-editors.md#trn-editor--experimental)
