# Från OCTRA-manualen

**För:** dig som hittat
[OCTRA 2.0-manualen](https://clarin.phonetik.uni-muenchen.de/apps/octra/manuals/octra/2.0/)
(som appen själv länkade till tidigare) och försöker överföra den till TRATT.

TRATT är en avgrening av OCTRA. Redigeringsmotorn är densamma, så
OCTRA-manualens kapitel om gränssnittet och vyerna beskriver i stort sett
fortfarande det du ser. Arbetsflödet runtomkring är inte alls detsamma.

---

## Vad TRATT lägger till som OCTRA-manualen inte nämner

| Funktion | Var |
| --- | --- |
| **Lokal taligenkänning.** Whisper-modeller som körs i din webbläsare, med finjusteringar för svenska, finska och norska. | [Automatisk utkasttranskription](automatic-transcription.md) |
| **Talarseparation.** Lokal diarisering, med talaretiketter, färger, namnbyte och växling. | [Nivåer och talare](tiers-and-speakers.md) |
| **Lokal maskinöversättning.** Översatta nivåer länkade till en källnivå. | [Automatisk utkasttranskription](automatic-transcription.md#translating-the-transcript) |
| **Inspelning i webbläsaren.** Mikrofon- och kamerainspelning med enhetsval, nivåmätning och krascháterställning. | [Ladda in en inspelning](loading-media.md#recording-in-the-browser) |
| **Export till Word och OpenDocument.** DOCX och ODT med talarprefix, tidsstämplar och layoutalternativ. | [Exportera](exporting.md) |
| **WebVTT och Whisper JSON.** Import och export, inklusive talarextraktion ur voice-taggar. | [Exportera](exporting.md) |
| **Videovisning.** Video som webbläsaren kan spela upp visas bredvid vågformen i transkriptionsfönstret. | [Vyerna](the-editors.md) |
| **Bredare mediestöd.** MP4, MOV, MKV, WebM, AVI, AMR med flera, avkodade i webbläsaren. | [Ladda in en inspelning](loading-media.md#supported-file-formats) |

---

## Vad OCTRA-manualen beskriver som TRATT inte gör

**Onlineläge och OCTRA-backenden.** Hela kapitlet om projektinloggning, tilldelade
uppdrag, att skicka transkript till en server, att avsluta-och-släppa en uppgift
och avslutningsskärmen. TRATT levereras med backenden avstängd: ingen inloggning,
inget projekt, ingenting skickas någonstans. Behöver du det, använd
[OCTRA i original](https://github.com/IPS-LMU/octra).

**URL-läge och demo-/inbäddningsparametrar.** Ingår inte i TRATT:s arbetsflöde.

**Administration, att skriva riktlinjer och valideringsmetoder.**
Konfigurationsfilerna finns kvar och beter sig som dokumenterat i ursprunget, men
validering är avstängd som standard i TRATT och Översikt säger då
*No validation methods found*.

**Sök och ersätt.** Dokumenterad i ursprunget under *Using Tools*; exponeras inte i
TRATT:s gränssnitt.

---

## Sådant som bytt namn eller beteende

| OCTRA-manualen | I TRATT |
| --- | --- |
| "Segment" | Oftast "transkriptionsenhet" i gränssnittet, även om båda orden förekommer |
| "Level" | "Nivå", och "tier" i de nyare talar- och översättningsfunktionerna |
| Tre vyer | Fortfarande tre i väljaren: 2D Vy, Diktafon-vy, Linjär vy. En fjärde, **TRN-Editor**, finns i koden men är ofärdig och erbjuds inte, se [Vyerna](the-editors.md#trn-editor--experimental) |
| Verktygsdialogen (kombinera enheter, klipp ljud) | Finns kvar, men **går inte att nå från någon knapp** i det nuvarande gränssnittet, se [Verktyg](using-tools.md) |
| Manual-länken i navigeringslisten | Pekar numera på den här manualen, på gränssnittets språk |

---

## Fortfarande värt att läsa i ursprungsmanualen

OCTRA-manualen är fortfarande den bättre referensen för de inre delar TRATT ärvt
oförändrade: datamodellen AnnotJSON, strukturen på riktlinje- och
valideringsfiler, samt projektkonfigurationens alternativ. Ska du konfigurera en
installation snarare än transkribera med en, börja där.
