# Exportera

**För:** alla, i slutet av varje arbetspass.

Tratt håller ditt arbete i webbläsaren. **Att exportera en fil är
det enda sättet ditt transkript lämnar webbläsaren.** Exportera ditt arbete varje
gång du avslutar ett redigeringspass.

I [Arbetsbänken](workbench.md) klickar du på **Exportera…** under listan med
inspelningspaket. (Där Tratt inte har någon lista heter den **Exportera**,
nedladdningsikonen i sidhuvudet.) Dialogen heter *Exportera*:

1. **Vad som ska exporteras**: *Det här inspelningspaketet* (det som är öppet i
   redigeraren), *De markerade inspelningspaketen* eller *Alla inspelningspaket*.
   Den börjar på de markerade om du har markerat några, och visas inte när det
   bara finns en inspelning.
2. **Format**: markera ett eller flera. Ett markerat format visar sina
   [alternativ](#alternativ) under sig.
3. **Ta med ljudet**: lägger varje inspelnings ljud bredvid dess transkriptioner.
   Det erbjuds bara när något ljud är bifogat. I Arbetsbänkens exportdialog
   från listan är det markerat från början, och ljudet sparas som mono-Opus med
   32 kbit/s (`.opus`), video som `.mp4` med videon orörd. En `.webm` eller
   `.mp4` utan video blir också `.opus` (förhandsvisningen kan ändå visa
   `.mp4`), och en `.opus`-fil i mono med högst omkring 32 kbit/s behålls
   som den är. Exportknappen i sidhuvudet (utan lista) exporterar
   inget ljud alls, bara transkriptionen.
4. **Det här får du** visar resultatet fil för fil innan du laddar ned det.
5. **Ladda ned**.

**En fil eller en .zip.** Från Arbetsbänkens lista är en export alltid en
`.zip`, eftersom Tratts egen fil alltid ingår, om inte bara en fil exporteras:
den filen ensam, eller ljudet från en inspelning utan transkription, som laddas
ned som den `.opus`-filen (eller `.mp4`-filen). Från exportknappen i sidhuvudet
laddas exakt en fil, till exempel transkriptionen som DOCX, ned som den filen.
Allt mer (flera format, eller ett format med en nivå för en inspelning med
flera nivåer) kommer som en `.zip` med Tratts egen fil tillagd; se
[Att exportera ett arkiv](#exporting-an-archive).
Knappen säger vilket: **Ladda ned** eller **Ladda ned .zip**.

Tratt minns de format du markerade till nästa export.

![Exportdialogen](../../assets/visp_tratt_export_formats.png)

---

## Vilket format ska jag exportera till?

Dialogen delar in formaten i tre avsnitt och talar om för varje grupp om filen kan
läsas tillbaka in i Tratt.

### Allmänna utdataformat

För att läsa, dela och publicera. **Bara SRT kan läsas tillbaka in i Tratt.**

| Format | Fil | Bra för |
| --- | --- | --- |
| **DOCX** | `.docx` | MS Word. Det format de flesta faktiskt vill ha transkriptet i. |
| **ODT** | `.odt` | LibreOffice / OpenOffice. Samma alternativ som DOCX. |
| **SRT** | `.srt` | Undertexter, videospelare, och det enda formatet i gruppen som går att importera igen för att fortsätta ditt arbete senare |
| **PlainText** | `.txt` | Allt som läser text |

### Lingvistiska format

Alla dessa kan läsas tillbaka in i Tratt.

| Format | Fil | Bra för |
| --- | --- | --- |
| **Tratts eget format** (AnnotJSON) | `_annot.json` | Emu SDMS-kompatibelt. Behåller allt: nivåer, gränser, talare och markörer. I Arbetsbänkens exportdialog från listan är det alltid med och kan inte avmarkeras. |
| **TextGrid** | `.TextGrid` | Praats primära annoteringsformat |
| **ELAN** | `.eaf` | ELAN. Lägg `.eaf`-filen i samma mapp som ljudet, annars hittar ELAN inte mediet. |
| **PraatTextTable** | `.Table` | Praats tabellformat |

### Specialiserade tekniska format

| Format | Fil | Bra för |
| --- | --- | --- |
| **WebVTT** | `.vtt` | Undertexter för webbvideo |
| **BASPartitur** | `.par` | BAS-webbtjänsterna. Exporten skriver ORT- och TRN-rader ur transkriptionen. |
| **CTM** | `.ctm` | Verktyg för utvärdering av taligenkänning. Konfidensvärdet skrivs alltid som 1. Tratt håller inte reda på det. |

> **Behåll Tratts eget format.** DOCX och ODT är enkelriktade: de läses bra och
> importeras illa. Kan du behöva rätta transkriptet om ett halvår är det Tratts
> egen fil plus originalinspelningen som gör det möjligt. I
> Arbetsbänkens exportdialog från listan är den alltid med och kan inte
> avmarkeras, så med listan kommer en DOCX-export alltid som en `.zip` med den.

---

## Alternativ

### DOCX och ODT

| Alternativ | Effekt |
| --- | --- |
| **Each sentence on a separate line** / **Continuous text** | En transkriptionsenhet per rad, eller allt sammanskrivet som löpande text |
| **Markera talar-ID i början av meningar** | Sätter talaretiketten först i varje enhet |
| **Add timestamp at beginning of each sentence** | Sätter starttiden först i varje enhet |
| **Collect annotations according to transcription tier in the output** | Visas när en inspelning har fler än en nivå: grupperar utdata nivå för nivå i stället för att blanda |

Varje mening börjar med ett färgat streck i de exporterade Word- (DOCX) och
ODT-filerna, och en nyckelrad under tacktexten förklarar färgerna: ett
**grönt** `|` markerar en transkription du verifierat (lyssnat på dess del av
inspelningen, eller redigerat texten), ett **orange** `|` markerar en som
fortfarande bara innehåller den automatiska transkriptionen.

<a id="verification-marks"></a>

### Verifieringsmarkörer i tidsanpassade format

De tidsanpassade exportformaten (SRT, WebVTT, ELAN, TextGrid, PraatTable,
CTM, BAS Partitur, Whisper JSON) bär verifieringsstatusen i själva texten:
varje overifierad transkription slutar med ett **not-check-märke** (`⍻`,
U+237B). Verifierade meningar skrivs utan det. När du senare laddar en sådan
fil tillsammans med dess ljud läser Tratt tillbaka märket. Markerade meningar
kommer in som overifierade, omarkerade som verifierade.

### PlainText

| Alternativ | Effekt |
| --- | --- |
| **Markera talar-ID i början av meningar** | Som ovan |
| **Lägg till en radbrytning efter varje transkriptionsenhet** | En enhet per rad |
| **Separera transkriptionsenheter med läsbara tidsstämplar (HH:MM:SS.s)** | Läsbara tider mellan enheter |
| **Separera transkriptionsenheter med sampelpunkter** | Sampellägen mellan enheter, för att lägga texten mot signalen någon annanstans |
| **Collect annotations according to transcription tier in the output** | Visas när en inspelning har fler än en nivå |

Markerar du båda tidsalternativen infogas båda.

### SubRip och WebVTT

| Alternativ | Effekt |
| --- | --- |
| **Move units with speaker label to separate levels** | En nivå per talare i stället för en blandad nivå |
| **Combine empty units with max duration (ms) between units of the same speaker** *(SRT)* | Slår ihop en kort lucka mellan två turer av samma person. Tomt stänger av det. |

### Nivåer

Alla nivåer exporteras; det finns inget att välja. Det spelar bara roll när ett
transkript har mer än en nivå, till exempel en översättning.

- **Tratts eget format, TextGrid, PraatTextTable, ELAN** bär flera nivåer i sig
  själva: en fil med alla.
- **DOCX, ODT och PlainText** lägger alla nivåer i en fil. Alternativet *Collect
  annotations according to transcription tier* avgör om de grupperas nivå för
  nivå eller blandas.
- **SubRip, WebVTT, BASPartitur, CTM** rymmer en nivå och skriver därför en fil
  per nivå, namngiven efter den: `intervju-Transcript.srt` och
  `intervju-Swedish (sv).srt`. Med mer än en fil kommer exporten som en `.zip`.

### Metadata

När du exporterar inspelningspaketet som är öppet i redigeraren erbjuder dialogen
också, under *Mer för den här transkriptionen*, de metadata som loggats medan du
arbetade (**Protocol**). De finns bara om **Logga användaråtgärder** var på i
Inställningar. Det är ett
forskningsmaterial (tangent- och uppspelningshistorik), inte en del av
transkriptet.

---

<a id="exporting-an-archive"></a>

## Arkivet, och hur du tar vid där du slutade

När en export ger mer än en fil packar Tratt dem i en `.zip`. **Det är den enda
export som går att läsa in fullständigt igen**, och den är tänkt som sättet att
flytta arbete mellan datorer, lämna över till en kollega, eller helt enkelt
lägga undan en session och återuppta den nästa vecka.

### Vad som ligger i det

Namnet säger vad det innehåller och när det skrevs:
`tratt_12_20261008@1923.zip` är tolv inspelningspaket, skrivna den 8 oktober
2026 klockan 19:23 lokal tid.

```
tratt_2_20261119@1754.zip
├── bundles/
│   ├── interview-01/
│   │   ├── interview-01.opus         ljudet, om du markerade Inkludera ljudet
│   │   ├── interview-01_annot.json   Tratts eget format: transkriptionen
│   │   └── interview-01.docx         varje format du markerade
│   └── interview-02/
│       └── …
├── manifest.json
└── manifest.csv
```

Varje inspelning får en egen mapp under `bundles/`, och det är det som hindrar
två inspelningar med samma namn (`take.wav` och `take.wma`) från att skriva över
varandras transkriptioner.

De två **manifesten** i roten listar varje inspelningspaket med sökvägar och
uppgifter: källfilens namn, längd i sampel, samplingsfrekvens, modell och språk
som användes, vilka steg som kördes, antalet transkriptionsenheter och vilken
version av Tratt som skrev det. `manifest.csv` öppnas i ett kalkylprogram,
vilket gör den användbar som register över en korpus.

När ljudet konverteras räknar Tratts eget format och manifesten sampel vid
16 kHz, takten Tratt läser tillbaka ljudet i, medan själva `.opus`-filen är
48 kHz. Tiderna i sekunder stämmer överens.

<a id="loading-an-archive-back"></a>

### Att läsa in det igen

**Släpp `.zip`-filen på släppytan.** Det är hela proceduren — samma ruta som du
släpper inspelningar på, på startsidan eller ovanför listan. Tratt packar upp
den och lägger tillbaka varje inspelning i listan med

- sitt **ljud redan bifogat**, så att du kan spela upp och lägga om gränser
  direkt, ingenting att bifoga på nytt;
- sin **transkription** som du lämnade den, med nivåer, talare, markörer och
  verifieringsstatus.

Två saker att räkna med:

- **Automatisk transkribering och översättning slås av** när arkivet läses in,
  och en pågående kö stoppas. Transkriptionerna i ett arkiv är färdigt arbete,
  och Tratt kör ingen modell över dem bakom ryggen på dig. Slå på dem igen i
  [Transkriptionsinställningar](automatic-transcription.md#turning-it-on) när du
  vill transkribera något nytt.
- **En inspelning heter som filen i arkivet.** Eftersom ljudet konverterades på
  vägen ut kommer `interview-01.mp3` tillbaka som `interview-01.opus`.
  Transkriptionen, tiderna och manifestets `sourceFilename` minns originalet.

Allt annat i arkivet — Word-filerna, undertexterna, manifesten — är utdata.
Tratt bortser från det vid inläsning, så ett arkiv du har lagt till egna filer i
går ändå att läsa in.

Ett inspelningspaket vars ljud inte var bifogat när du exporterade har inget
ljud i arkivet, bara sin transkription. Att släppa arkivet läser in den
transkriptionen i inspelningspaketet med samma namn som redan ligger i listan;
bifoga ljudet där. Exportdialogen säger hur många inspelningar det gäller innan
du laddar ned, och rapporterar *Klar med varningar* i stället för att låta hela
exporten misslyckas.

---

<a id="formats-tratt-can-read"></a>

## Format Tratt kan läsa

Släpp dessa tillsammans med ditt ljud på startsidan för att fortsätta ett
befintligt arbete.

| Format | Anmärkning |
| --- | --- |
| **Tratt-arkiv** (`.zip`) | En hel session, ljud och transkriptioner tillsammans. Se [Att exportera ett arkiv](#exporting-an-archive). |
| **AnnotJSON** (`_annot.json`) | Fullständig beskrivning av transkriptet för en inspelning. |
| **WhisperJSON** (`.json`) | Utdata från Whisper / WhisperX kört någon annanstans. Bara tidsstämplar och text läses; allt annat ignoreras. |
| **SubRip** (`.srt`) | Med alternativ för talarextraktion, se [Nivåer och talare](tiers-and-speakers.md#importing-material-that-already-has-speakers) |
| **WebVTT** (`.vtt`) | Läser `<v Namn>`-taggar. STYLE-, REGION- och NOTE-block ignoreras; flerradiga textblock slås ihop. |
| **PlainText** (`.txt`) | |
| **TextGrid** (`.TextGrid`), **PraatTextTable** (`.Table`) | |
| **ELAN** (`.eaf`) | Bara nivåattributet `ANNOTATION` tolkas |
| **BASPartitur** (`.par`) | TRN- och ORT-rader slås ihop till en nivå av tidsanpassade enheter |
| **CTM** (`.ctm`) | |

Transkriptfilens namn måste matcha ljudfilens namn, annars avvisar Tratt den med
*Transkriptfilens namn matchar inte ljudfilens namn*.

DOCX- och ODT-filer kan inte importeras till Tratt.

---

## Egna tabeller

Har inget av ovanstående de kolumner du behöver, bygg din egen med
**Table-Configurator**, under *Mer för den här transkriptionen* längst ned i
exportdialogen när du exporterar inspelningspaketet som är öppet i redigeraren. Se
[Verktyg → Tabellkonfiguratorn](using-tools.md#table-configurator).
