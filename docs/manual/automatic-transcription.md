# Automatic draft transcription


TRATT can run a speech-recognition model **on your own computer, inside the browser
tab**, and open the result in the editor for you to revise. It can also make an initial 
guess on who in a conversation said each utterance, and the interface also allows a
rough translation of the draft transcription to be made.

All three automatic annotation procedures produces draft annotations. The user should 
be prepared to make revisions to the draft annotation later.

---

## Turning it on

Load your media file first. The options only appear once TRATT has audio and you
have **not** supplied a transcript file of your own.

Under the drop zone, tick **Auto-transcribe with Whisper**, then set:

1. **Transcription language**: the language actually spoken on the recording.
   A hundred languages are offered, listed by their own names
   (*Svenska (Swedish, sv)*, *Suomi (Finnish, fi)*), with Swedish first and the rest
   alphabetical. TRATT preselects the language your interface is set to, so change
   it if the recording is in something else. This is not a translation setting.
2. **Model**: see the tables below.
3. **Speaker separation** (optional): see [Speaker separation](#speaker-separation).

Then click **Start new transcription**. You will see, in order: the model download
with a progress bar, *Transcribing audio…* with elapsed time and a progress bar
against the recording's length, then *Identifying speakers…* if you asked for it,
then *Transcription complete, preparing editor…*.

**Cancel** stops it and leaves you on the start page.

### Keep the tab open

The work happens in this tab. Do not close it, and be careful with laptop sleep on
long recordings. Switching to another tab is fine; the transcription keeps running,
though some browsers slow background tabs down.

---

## Which model to pick

The model list changes with the language you chose, because TRATT ships specialised
models for the Nordic languages.

**If your machine has WebGPU** (recent Chrome, Edge or Firefox with a reasonable
graphics card), all models are available and the larger ones are much faster.
**Without WebGPU** the models run on the CPU instead: the biggest ones are
disabled, and the rest are slow but usable. TRATT tells you which situation you are
in under the model list.

### Swedish

Uses **KB-Whisper** from the National Library of Sweden, trained on Swedish speech.
Noticeably better than the general model for Swedish.

| Model | Roughly | Notes |
| --- | --- | --- |
| Tiny | 120 MB | Fastest, least accurate. Good for checking that the pipeline works. |
| Small | 400 MB | Reasonable compromise |
| Medium | 650 MB | Labelled *our reference model*. Needs WebGPU. |
| Large | 1.2 GB | Most accurate, about half the speed of Medium. Needs WebGPU. |

### Finnish and Norwegian

Also fine-tuned models. Finnish offers Tiny / Medium / Large; Norwegian (both
Bokmål and Nynorsk) offers Tiny / Small / Medium / Large. Medium is labelled the
reference model in both. Medium and Large need WebGPU.

### Every other language

Uses OpenAI's Whisper.

| Model | Roughly | Notes |
| --- | --- | --- |
| Tiny | 95 MB | Fastest, least accurate |
| Small | 290 MB | **Preselected.** A reasonable compromise. |
| Large v3 Turbo | 700 MB | Labelled *our selected reference model*: fast and accurate. Needs WebGPU. |
| Large v3 | 3.1 GB | Slower than Turbo, often a little more accurate. Needs WebGPU. |

TRATT preselects Small here, not the reference model. If your machine has WebGPU
and the recording matters, switch to **Large v3 Turbo**.

### About the download

The model comes from `huggingface.co` the first time you use it and is then cached
in your browser, so the second run starts immediately. Your audio is never sent
anywhere; see [What leaves your computer](privacy.md).

If the download is interrupted, retry; if it keeps failing, the network is blocking
`huggingface.co` and automatic transcription will not be available on that machine.

---

<a id="speaker-separation"></a>

## Speaker separation

Ticking **Speaker separation** runs a second model that divides the recording by
speaker and labels each transcription unit with a speaker ID.

- Leave **Expected number of speakers** blank to let it guess.
- Set it if you know: `2` for a typical interview. Giving the real number usually
  produces a cleaner result than auto-detection.

This model runs on the CPU regardless of WebGPU, so it adds time. Allow for
noticeably longer processing on a long recording.

The result is a starting point, not a finding. Speakers who sound alike, crosstalk
and background voices all confuse it. You can fix labels afterwards: see
[Tiers and speakers](tiers-and-speakers.md#fixing-speaker-labels).

---

<a id="translating-the-transcript"></a>

## Translating the transcript

TRATT can also translate, locally, using Opus-MT models.

**On the start page.** Once there is a transcript to work with, either one you
loaded or one auto-transcription is about to produce, a **Translate transcript
locally** box appears. Pick **From** (about thirty languages) and **To**. The
**To** list only offers languages actually reachable from your source, and marks
routes that have to go through English as *(two steps)*. TRATT then tells you which
path it will use:

- *Direct opus-mt model*: one model, one step.
- *Pivot via English (two steps)*: no direct model exists, so it goes through
  English. Slower, and quality suffers a little.
- *No local translation model found for this language pair*: that pair is not
  possible.

Translation runs on your machine and can take several minutes.

**While working.** In the editor, the tier menu offers **Add translated tier…**,
which creates a linked tier whose boundaries stay in sync with the source tier, and
**Translate linked tier**, which fills in the empty segments. Translations you have
edited by hand are never overwritten. See
[Tiers and speakers](tiers-and-speakers.md).

**Skip browser cache.** A checkbox in the options. Some browsers hit storage quota
limits when caching large models and freeze. Ticking this bypasses the cache: the
model is re-downloaded every time, but the freeze goes away. Use it only if you hit
the problem.

---

## When it is not available

**Safari and other WebKit browsers.** The checkbox is disabled with a warning. The
models are large enough to make Safari reload the tab mid-download, which loses your
work. Use Chrome, Edge or Firefox for automatic transcription. Manual transcription
in Safari is fine.

**No WebGPU.** The Medium and Large models are greyed out with the note *Requires
WebGPU*. The smaller models still work.

**Errors.** If transcription fails while running on WebGPU, the error box suggests
retrying without it. TRATT detects WebGPU automatically and has no switch of its
own, so the way to force the slower, more tolerant CPU path is to turn WebGPU off
in the browser itself (in Chrome and Edge: `chrome://flags` → *Unsafe WebGPU
Support* / *WebGPU* → **Disabled**, then restart) and reload TRATT. All models then
run on WASM, and the largest ones become unavailable. More in
[Troubleshooting](troubleshooting.md).
