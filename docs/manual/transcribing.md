# How transcribing works

**This document is for:** anyone who is going to spend real hours in Tratt. Read this once, and after
that, [Keyboard shortcuts](shortcuts.md) is all you need open.

---

## The model in your head

A Tratt document has three layers:

**The transcript** is a set of **tiers** (the interface also calls them *levels*).
Most work happens on one tier and you access them one at a time. A second tier might hold a translation, or a second 
speaker's turns. See [Tiers and speakers](tiers-and-speakers.md).

**A tier** is a sequence of **transcription units**: consecutive stretches of the
recording, each with its own text. Elsewhere these are called segments or
utterances. They never overlap and never leave gaps.  The whole recording is always
covered by units. Silent parts may have pause "<P>" mark in it (inserted by **Alt+p**)

**A boundary** is the line between two units. Adding a boundary splits a unit into
two, and deleting one merges two units into one. That is the only way the number of
units changes.

So there are exactly two kinds of work. The first is getting the boundaries in the right places, 
and the second is getting the right text into each unit. If a draft transcription is provided for you by a 
transcription model, most of your time goes into editing the texts and boundaries.

---

## The working loop

In the 2D-Editor (the default), the recording is drawn as a waveform across several
lines with each unit's text underneath.

1. **Hover** the unit you want and press **Enter**. The transcription then window opens
   with just that unit's audio and text.
2. **Tab** plays and pauses. **Esc** stops. **Shift + Backspace** jumps back to
   where playback last started. The keys **Shift + Tab** steps back half a second so
   you can re-hear the last words. Playing a unit for about 0.2 s also marks its
   transcription as [verified](checking-your-work.md#verified-transcriptions).
3. Type. Use markers for anything that is not a word.
4. **Alt + →** saves and opens the next unit. **Alt + ←** goes back one.
   **Alt + ↓** saves and closes the window.

You can also work without opening a popup window. The Dictaphone Editor puts one
text field and a player on screen, and the Overview window lets you edit rows in a
table. See [The editors](the-editors.md).

**Saving.** There is nothing to save. Every change goes into browser storage
immediately, and a small save icon flickers in the top bar as it does. What you do
still need to do is [export a file](exporting.md) before you finish for the day.

**Undo** is **Ctrl + Z** (**Cmd + Z** on a Mac), **redo** is **Ctrl + Y**
(**Shift + Cmd + Z**). It works both on text and on boundary changes. Occasionally
Tratt will tell you *You can't apply undo & redo at the moment*. That happens while
another operation is still being performed. Please then wait for a moment and try to do the change again.

---

<a id="boundaries"></a>

## Boundaries

All boundary happens on the waveform, with no text field focused.

| To | Do |
| --- | --- |
| Add a boundary | Move the mouse to the position and press **S** |
| Add two boundaries around a stretch | Drag across the waveform with the left button to select it, then press **S** |
| Delete a boundary and merge the two units | Select it and press **D** |
| Play just the selection | **C** |
| Nudge the cursor | **←** / **→** |

There are two restictions that apply to boundaries that you should be aware of:

- **Tratt refuses to split across units that already have text.** If your drag
  selection spans two units and either of them is already transcribed, you get
  *Cannot set boundary in a transcription unit that is already transcribed.* Clear
  the text first, or place single boundaries with **S** instead of using a selection.
- A boundary can not be placed at the very first sample of the recording.

### Setting a boundary from inside the text

Sometimes you notice mid-typing that a unit contains two utterances. Rather than
leaving the text field:

1. Play until the point where the split belongs and pause.
2. Put the text cursor at the matching place in the text.
3. Press **Alt + S** (the **crop mark**) to insert a boundary there.

The unit is split *at the playback position*, and the text is split *at your cursor*.

---

## Silence

A stretch with no speech gets marked as a **break** rather than left empty, so that
"nothing said here" is distinguishable from "not transcribed yet".

- On the waveform: hover the unit and press **A**.
- In the text field: **Alt + P**, or the **Break** button.

Breaks show as `<P>` in the transcript and are counted separately in the
[Overview](checking-your-work.md): *Silent transcription units*, as opposed to
*Empty transcription units*, which are the ones still waiting for you.

---

<a id="markers"></a>

## Markers

Markers record things that are not words. Buttons for them are found in the toolbar above the text
field and each has a shortcut:

| Marker | Button | Shortcut | Example use |
| --- | --- | --- | --- |
| `[~abc]` | `~abc` | **Alt + 1** | A word cut off at the *start* of the unit |
| `<nib>` | filled pause | **Alt + 2** | Hesitations: "ehm", "öh", "hm" |
| `[int]` | intermittent noise | **Alt + 3** | A door slam, a bump on the microphone |
| `[spk]` | speaker noise | **Alt + 4** | Noise made by the speaker: breathing, laughing, coughing |
| `[sta]` | stationary noise | **Alt + 5** | Continuous background: traffic, music, air conditioning |
| `**` | ** | **Alt + 6** | The following word is unintelligible, or is in another language |
| `[abc~]` | `abc~` | **Alt + 7** | A word cut off at the *end* of the unit |
| `<P>` | Break | **Alt + P** | This unit is silence |

Markers, their symbols, and their shortcuts come from the project's guidelines file,
so an installation configured for a particular project may show a different set.
What your installation actually uses is always visible in the toolbar and in
**Guidelines** (**Alt + 9**).

---

## Speakers

If speaker separation ran, or you loaded a subtitle file with speaker names, each
unit carries a **speaker label**. Labels are shown as coloured badges, and each
speaker keeps a consistent colour.

With the transcription window open, **Ctrl + S** (**Cmd + S** in MacOS) cycles that unit's
label to the next known speaker. This is the quickest way to fix a mis-assigned turn, and very useful for 
when you have used the automatic speaker assignment model, which may be very inaccurate. You
can also click the badge to cycle though the speakers labels.

How to add, rename and remove speakers, and splitting speakers onto separate tiers,
are covered in [Tiers and speakers](tiers-and-speakers.md).

---

## Preferences worth setting on day one

Open **Preferences** from the top bar (the gear icon).

| Setting | What it does | Suggested |
| --- | --- | --- |
| **Seconds per line** | How much audio each waveform line shows: 5, 10, 15, 20 or 60 s. Only shown while you are in the 2D-Editor. | 5 or 10 for detailed work; higher to scan |
| **Play on hover** | Plays audio as you move the mouse over the waveform | On, once you are used to it. It is much faster for finding a spot. Toggle it live with **H**. |
| **Follow playcursor** | Scrolls the view to keep the playback position visible | On |
| **Show magnifier** | A zoomed strip around the cursor, for placing boundaries precisely | On for detailed boundary work |
| **Easy Mode** | Hides button labels and keyboard hints (a compact, icon-only interface) | Off while you are learning |
| **Log user actions** | Records what you did, for method sections and studies. Stays on your machine; exported only if you ask for the meta data. | Your call |

---

## When you are done

Press **Alt + 0** for the [Overview](checking-your-work.md) and check that
*Empty transcription units* is zero, then
[export your work](exporting.md).
