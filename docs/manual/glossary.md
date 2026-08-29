# Glossary

TRATT's vocabulary comes from phonetics and speech research. This page translates it
into ordinary language.

| TRATT says | Which means |
| --- | --- |
| **Transcription unit** | One stretch of the recording with its own text: roughly one utterance, or one subtitle line. Other tools call this a *segment*. The Overview counts these. |
| **Segment** | The same thing. The two words are used interchangeably in the interface. |
| **Utterance** | Also the same thing. It is the column heading in the Overview. |
| **Boundary** | The dividing line between two transcription units. Adding one splits a unit; deleting one merges two. |
| **Break** (`<P>`) | A unit that contains no speech. Marking silence explicitly is how TRATT tells "nothing was said here" from "not done yet". |
| **Crop mark** | A boundary inserted from inside the text field (**Alt + S**), splitting the unit at the current playback position. |
| **Tier** / **Level** | One layer of annotation over the recording: a sequence of transcription units. A transcript can have several, such as a translation or one per speaker. *Level* is the older word; the two mean the same. |
| **Linked tier** | A tier whose boundaries are kept in sync with another tier's. Translation tiers work this way. |
| **Speaker label** | A name attached to a transcription unit saying who is talking. Shown as a coloured badge. |
| **Marker** | A symbol standing for something that is not a word: a pause, a noise, an unintelligible passage. |
| **Guidelines** | The project's transcription conventions: spelling and punctuation rules, and what each marker means. **Alt + 9**. |
| **Annotation** | The whole transcript: all tiers, units, text, markers and speakers. What AnnotJSON stores. |
| **AnnotJSON** | TRATT's own file format. The only export that preserves everything. |
| **Diarization** / **Speaker separation** | Working out who spoke when, without knowing who anybody is. |
| **Whisper** | The family of speech-recognition models TRATT runs locally. **KB-Whisper** is the Swedish-optimised variant from the National Library of Sweden. |
| **WebGPU** | A browser feature that lets models use your graphics card. Its presence decides which models you can run and how fast they are. |
| **WASM** | WebAssembly: the fallback that runs models on the CPU. Slower, works everywhere. |
| **Local mode** | Working on your own files in your own browser, with no server. This is how TRATT is normally used. |
| **Online mode** | OCTRA's server-backed mode, where a project assigns you files. Not enabled in the standard TRATT deployment. |
| **Magnifier** | The zoomed strip of waveform around the cursor, for placing boundaries precisely. |
| **Playcursor** | The line showing where playback has reached. *Follow playcursor* keeps it on screen. |
| **Easy Mode** | A preference that strips button labels and keyboard hints for a compact interface. |
| **OCTRA** | The upstream project TRATT is forked from, at LMU Munich. |
