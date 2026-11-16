# Transcribing for a VISP project

**For:** anyone who opens Tratt from a project in VISP, to transcribe the
recording bundles the project owner has assigned to them.

Opened from VISP, Tratt is the [Workbench](workbench.md) with one difference
that changes everything else: the list on the left is your assignment in that
project, the recording bundles assigned to you in VISP's **Assign annotation
tasks** dialog. You do not add recordings, and your work goes back into the
project rather than into files on your computer.

When you open Tratt, VISP asks which annotation level of the project to
transcribe into. Only segment levels that are not linked to other levels can be
chosen; to work on another level, open Tratt from VISP again.

---

## What is different from the stand-alone Workbench

| | Stand-alone Workbench | Opened from VISP |
| --- | --- | --- |
| The list | The files you add | Your assignment in the project |
| Audio | Attached by you, again after a reload | Fetched from VISP whenever it is needed |
| Your transcript | Kept in the browser, exported as files | Saved into the project as you work |
| Adding and deleting | Drop, record, load a `.zip`, **Delete** | Not available: the list is your assignment |
| Tiers | Any you create | Only the annotation level you chose when opening Tratt |

Everything about transcribing itself is the same: the editors, the shortcuts and
the markers are the ones described in the rest of this manual.

---

## The list

The header reads **Assigned recording bundles**. Each recording bundle's row has
a small speech-bubble button. It opens:

- **Finished**, which tells the project owner you are done with it;
- **Comment**, a note to the project owner.

The bubble is filled when the recording bundle has a comment, and shows a check
mark when it is marked finished. **Finished** and **Comment** are what the
project owner sees in VISP. Saving them saves the recording bundle, transcript
included.

Select a recording bundle to open it. A recording bundle that has text in VISP
shows **Has text** before you open it; one without shows **Not transcribed**.

---

## Saving

Tratt saves your work into the project by itself: a couple of seconds after you
stop typing, when you select another recording bundle, and when you leave or hide
the Tratt tab. There is no save button, and the list stays quiet while it saves.

A recording bundle only speaks up when a save fails: it says what went wrong and
offers **Retry**. While VISP cannot be reached, or you are signed out of it, Tratt
also tries again by itself, and at once when you come back to the Tratt tab.

Until a save gets through, your changes are kept in this browser. Reloading Tratt,
or closing it and opening it again from VISP, does not lose them, and they are
saved once Tratt is open again. They are kept on this computer and in this
browser only.

> **Caution.** Clearing the browser's site data for Tratt deletes unsaved
> changes. What is saved to VISP is not affected.

---

## What Tratt writes into the project

Only the transcript, in the annotation level you chose when opening Tratt
(the *transcription level* below). Every other level
(a phonetic segmentation made in Artic, for example) and the links between them
are left exactly as they were. Inside the transcription level:

- a segment marked as a pause is saved as an empty segment;
- speaker names from speaker separation are saved only if the project has a
  place for them. Ask the project owner if you need them.

---

## When someone else changed it meanwhile

If the recording bundle was saved in VISP, in Artic or in another tab while you
worked on it, Tratt does not overwrite that. The recording bundle says:

> *This recording bundle was changed in VISP or in another tab while you worked
> on it. Your changes are kept in this browser. Keep your version (only the
> transcript is replaced), or use the VISP version and drop your changes.*

- **Keep my version** saves your transcript. Changes the other person made to
  other levels stay; changes they made to the transcript are replaced by yours.
- **Use the VISP version** drops your changes and shows what VISP has now.

Tratt checks this when you save, not continuously. Two people transcribing the
same recording bundle at the same time will still have to choose whose transcript
to keep.

---

## When the assignment changes

Tratt reads your assignment when it opens. If the project owner assigns or
unassigns recording bundles while Tratt is open, open Tratt from VISP again to
see the change. A recording bundle that is no longer assigned to you can no
longer be saved to VISP: saving it fails, and your changes stay in this browser.
Download the transcript if you need it.

It can no longer be saved to the project. Use **Export…** if you want to keep the
text, then **Delete**.

---

## Automatic transcription

**Transcribe** offers only the recording bundles that have no text in VISP, so it
never transcribes over work that is already in the project. The result goes into
the transcription level and is saved like anything you type. See
[Automatic draft transcription](automatic-transcription.md) for the settings.

---

## When something goes wrong

| What Tratt says | What to do |
| --- | --- |
| *You are no longer signed in to Visp. Your changes are kept in this browser: sign in again in Visp and Tratt saves them.* | Sign in to Visp again, in another tab or in the Visp page around Tratt. Tratt saves when you come back to it, and keeps trying meanwhile; no reload needed. |
| *You are not a member of this project. Ask the project owner to add you.* | Ask the project owner. |
| *The annotation level TRATT was opened with is not a segment level in this project, so TRATT cannot open its recording bundles. Open TRATT from VISP again and choose another level.* | The level was deleted or changed in VISP after you opened Tratt. Open Tratt from VISP again. |
| *The annotation level TRATT was opened with is linked to other levels, so TRATT cannot edit it safely. Open TRATT from VISP again and choose another level.* | The level was linked in VISP after you opened Tratt. Open Tratt from VISP again. |
| *VISP cannot be reached. Your changes are kept in this browser; try again in a moment.* | Wait: Tratt tries again by itself. **Retry** on the recording bundle tries at once. |
| *This TRATT installation is not configured for VISP.* | Shown instead of the Workbench. Tell whoever runs VISP. |
