# Transcribing for a VISP project

**For:** anyone who opens Tratt from a project in VISP, to transcribe the
recording bundles the project owner has assigned to them.

Opened from VISP, Tratt is the [Workbench](workbench.md) with one difference
that changes everything else: the list on the left is your assignment in that
project, the recording bundles assigned to you in VISP's **Assign annotation
tasks** dialog. You do not add recordings, and your work goes back into the
project rather than into files on your computer.

---

## What is different from the stand-alone Workbench

| | Stand-alone Workbench | Opened from VISP |
| --- | --- | --- |
| The list | The files you add | Your assignment in the project |
| Audio | Attached by you, again after a reload | Fetched from VISP whenever it is needed |
| Your transcript | Kept in the browser, exported as files | Saved into the project with **Save to VISP** |
| Adding and removing | Drop, record, load a `.zip`, **Remove** | Not available; **Refresh** re-reads the assignment |
| Tiers | Any you create | Only the project's transcription level |

Everything about transcribing itself is the same: the editors, the shortcuts and
the markers are the ones described in the rest of this manual.

---

## The list

The header reads **Assigned recording bundles**, with **Refresh** next to it.
Under each recording bundle's name are:

- its state: **Saved**, **Unsaved changes**, **Saving…** or **Not saved**;
- **Save to VISP**, which writes its transcript into the project;
- **Finished**, which tells the project owner you are done with it;
- **Comment**, a note to the project owner.

**Finished** and **Comment** are what the project owner sees in VISP. Changing
either one saves the recording bundle, transcript included.

Select a recording bundle to open it. A recording bundle that has text in VISP
shows **Has text** before you open it; one without shows **Not transcribed**.

---

## Saving

Your work is saved into the project in two ways:

- **Save to VISP** in the list, whenever you like;
- automatically, when you select another recording bundle while the one you
  leave has **Unsaved changes**.

Until then your changes are kept in this browser. Reloading Tratt, or closing it
and opening it again from VISP, does not lose them: the recording bundle comes
back with **Unsaved changes**. They are kept on this computer and in this browser
only, so save before you move to another one.

> **Caution.** Clearing the browser's site data for Tratt removes unsaved
> changes. What is saved to VISP is not affected.

---

## What Tratt writes into the project

Only the transcript, in the project's transcription level. Every other level
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

**Refresh** reads your assignment again. Newly assigned recording bundles appear
in the list. Recording bundles no longer assigned to you disappear, except one
with unsaved changes, which stays with:

> *No longer assigned to you. Your unsaved changes are kept here until you remove
> this recording bundle; download the transcript first if you need it.*

It can no longer be saved to the project. Use **Download transcript** if you
want to keep the text, then **Remove**.

---

## Automatic transcription

**Transcribe** offers only the recording bundles that have no text in VISP, so it
never transcribes over work that is already in the project. The result goes into
the transcription level and is saved like anything you type: it shows
**Unsaved changes** until you save it. See
[Automatic draft transcription](automatic-transcription.md) for the settings.

---

## When something goes wrong

| What Tratt says | What to do |
| --- | --- |
| *You are no longer signed in to VISP. Sign in again in VISP, then reload TRATT.* | Your changes are kept. Sign in to VISP in another tab, then reload Tratt. |
| *You are not a member of this project. Ask the project owner to add you.* | Ask the project owner. |
| *This project has no transcription level, so TRATT cannot open its recording bundles. Ask the project owner to add one in VISP.* | The list shows your assignment by name, but nothing can be opened until the project has a transcription level. |
| *The transcription level is linked to other levels, so TRATT cannot edit it safely. Ask the project owner to unlink it.* | Ask the project owner. |
| *VISP cannot be reached. Your changes are kept in this browser; try again in a moment.* | Wait, then press **Save to VISP** or **Refresh** again. |
| *This TRATT installation is not configured for VISP.* | Shown instead of the Workbench. Tell whoever runs VISP. |
