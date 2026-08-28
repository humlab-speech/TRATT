# Tiers and speakers

**For:** transcribers working on conversations, or on material that needs more than
one layer of annotation.

---

## Tiers

A transcript can have several **tiers** (the interface calls the current one the
*selected level*). Each tier is an independent sequence of transcription units over
the same recording. You edit one at a time.

Reasons to have more than one:

- a **translation** alongside the original;
- **one speaker per tier**, which some analysis tools expect;
- a second pass at a different level of detail.

### Working with tiers

The tier menu sits in the top bar and shows the current tier's name.

| To | Do |
| --- | --- |
| Switch tier | Open the menu and click the tier's number |
| Rename a tier | Type in its name field and click away |
| Add an empty tier | **Add empty level** at the bottom of the menu |
| Add a translation tier | **Add translated tier…** — see below |
| Delete a tier | The bin icon on its row. TRATT asks for confirmation; the tier and its text are gone permanently. |

Only tiers of type SEGMENT can be selected for editing; others are shown greyed out.

### Translated tiers

**Add translated tier…** creates a new tier linked to a source tier: it copies the
boundaries and leaves the text empty, and the boundaries stay in sync with the
source from then on. Choose the source tier and the target language, then either
**Create empty** (you translate by hand) or **Create & translate** (a local
translation model fills it in).

Later, **Translate linked tier** fills in any segments that are still empty.
**Segments you have edited by hand are never overwritten**, so you can re-run it
after adding material without losing your corrections.

Translation happens on your machine, using models downloaded once and cached — see
[Automatic draft transcription](automatic-transcription.md#translating-the-transcript).

If the menu says *No eligible source tier found*, the transcript has no standalone
segment tier to translate from.

---

## Speakers

A **speaker label** is attached to individual transcription units, not to tiers.
Units with a label show a coloured badge; each speaker keeps the same colour
throughout so you can read turn-taking at a glance.

Labels get there in three ways: [speaker separation](automatic-transcription.md#speaker-separation)
during automatic transcription, import from a subtitle file that names speakers, or
by hand.

<a id="fixing-speaker-labels"></a>

### Fixing speaker labels

- **In the transcription window:** **Ctrl + S** (**Cmd + S**) cycles this unit's
  label to the next known speaker. Repeat to keep cycling. This is the fast way to
  repair a mis-assigned turn.
- **Clicking the badge** does the same thing.

If the unit belongs to a group of linked tiers, the change is applied to the
matching unit on every tier in the group at once, so a translation tier does not
drift out of sync.

### Managing the speaker list

The speaker menu in the top bar lists every speaker with its colour swatch.

| To | Do |
| --- | --- |
| Rename a speaker everywhere | Type a new name in its field and click away — every unit carrying the old label is updated |
| Add a speaker | The **+** row at the bottom. It becomes available for cycling even before any unit uses it. |
| Remove a speaker | The bin icon — **only offered for speakers that no unit is using**. Reassign the units first. |

Rename early. Turning `SPEAKER_00` and `SPEAKER_01` into `Interviewer` and
`Participant` before you start correcting makes every later pass easier to read, and
carries straight through to Word, ODT and subtitle export.

---

<a id="importing-material-that-already-has-speakers"></a>

## Importing material that already has speakers

Subtitle files often carry speaker names, and TRATT can pull them out on import.
Drop the file with the audio, then click the gear icon on its row.

**WebVTT** offers:

- *Extract speakers from voice tags* — reads `<v Name>` tags, or a `[Name]` prefix
  in the cue text, into a speaker label.
- *Move units with speaker label to separate levels* — one tier per speaker.

**SubRip (.srt)** offers:

- *Regular expression for speaker identification* — a pattern with one capture group
  matched against the start of each cue line; the captured text becomes the speaker
  name. Use this when your file writes speakers as `INTERVIEWER:` or `- Anna —`.
- *Move units with speaker label to separate levels*.
- *Combine empty units with max duration (ms) between units of the same speaker* —
  merges a short gap between two turns by the same person, so a single sentence
  broken across cues comes back together. Leave it blank to switch it off.

---

## Splitting speakers onto tiers later

If you did not split on import, the SRT and WebVTT **export** converters offer
*Move units with speaker label to separate annotation levels* — the same operation,
applied on the way out. Units with no speaker stay on the default tier.
