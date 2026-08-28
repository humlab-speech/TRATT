# Nivåer och talare

**För:** dig som transkriberar samtal, eller material som behöver mer än ett lager
av annotering.

---

## Nivåer

Ett transkript kan ha flera **nivåer** (gränssnittet kallar den aktuella
*Transcription level*, och nyare funktioner säger *tier*). Varje nivå är en
självständig följd av transkriptionsenheter över samma inspelning. Du redigerar
en i taget.

Skäl att ha fler än en:

- en **översättning** vid sidan av originalet;
- **en talare per nivå**, som vissa analysverktyg förväntar sig;
- en andra genomgång på en annan detaljnivå.

### Att arbeta med nivåer

Nivåmenyn sitter i den övre listen och visar den aktuella nivåns namn.

| För att | Gör |
| --- | --- |
| Byta nivå | Öppna menyn och klicka på nivåns nummer |
| Byta namn på en nivå | Skriv i dess namnfält och klicka utanför |
| Lägga till en tom nivå | **Add empty level** längst ned i menyn |
| Lägga till en översättningsnivå | **Add translated tier…**: se nedan |
| Ta bort en nivå | Papperskorgsikonen på dess rad. TRATT frågar först; nivån och dess text försvinner permanent. |

Bara nivåer av typen SEGMENT kan väljas för redigering; övriga visas gråmarkerade.

> Menyalternativen **Add empty level** och **Add translated tier…** är ännu inte
> översatta och visas på engelska även i det svenska gränssnittet.

### Översatta nivåer

**Add translated tier…** skapar en ny nivå länkad till en källnivå: den kopierar
gränserna och lämnar texten tom, och gränserna hålls därefter i takt med källan.
Välj källnivå och målspråk, och sedan antingen **Create empty** (du översätter för
hand) eller **Create & translate** (en lokal översättningsmodell fyller i).

Senare fyller **Translate linked tier** i de segment som fortfarande är tomma.
**Segment du har redigerat för hand skrivs aldrig över**, så du kan köra om den
efter att ha lagt till material utan att förlora dina rättelser.

Översättningen sker på din dator, med modeller som laddas ned en gång och sparas:
se
[Automatisk utkasttranskription](automatic-transcription.md#translating-the-transcript).

Säger menyn *No eligible source tier found* har transkriptet ingen fristående
segmentnivå att översätta från.

---

## Talare

En **talaretikett** hör till enskilda transkriptionsenheter, inte till nivåer.
Enheter med etikett visar en färgad bricka; varje talare behåller samma färg
genom hela transkriptet så att du kan läsa turtagningen med blicken.

Etiketter uppstår på tre sätt:
[talarseparation](automatic-transcription.md#speaker-separation) vid automatisk
transkription, import från en undertextfil som namnger talare, eller för hand.

<a id="fixing-speaker-labels"></a>

### Rätta talaretiketter

- **I transkriptionsfönstret:** **Ctrl + S** (**Cmd + S**) växlar enhetens
  etikett till nästa kända talare. Upprepa för att fortsätta växla. Det är det
  snabba sättet att rätta en felplacerad tur.
- **Att klicka på brickan** gör samma sak.

Hör enheten till en grupp länkade nivåer tillämpas ändringen på motsvarande enhet
på alla nivåer i gruppen samtidigt, så att en översättningsnivå inte glider ur
takt.

### Att sköta talarlistan

Talarmenyn i den övre listen listar varje talare med sin färgruta.

| För att | Gör |
| --- | --- |
| Byta namn på en talare överallt | Skriv ett nytt namn i fältet och klicka utanför. Varje enhet med den gamla etiketten uppdateras |
| Lägga till en talare | Raden med **+** längst ned. Talaren blir valbar redan innan någon enhet använder den. |
| Ta bort en talare | Papperskorgsikonen: **erbjuds bara för talare som ingen enhet använder**. Flytta om enheterna först. |

Byt namn tidigt. Att göra `SPEAKER_00` och `SPEAKER_01` till `Intervjuare` och
`Deltagare` innan du börjar rätta gör varje senare genomgång lättare att läsa, och
följer med rakt igenom till export i Word, ODT och undertexter.

---

<a id="importing-material-that-already-has-speakers"></a>

## Att importera material som redan har talare

Undertextfiler bär ofta talarnamn, och TRATT kan plocka ut dem vid import. Släpp
filen tillsammans med ljudet och klicka sedan på kugghjulet på dess rad.

**WebVTT** erbjuder:

- *Extract speakers from voice tags*: läser `<v Namn>`-taggar, eller ett
  `[Namn]`-prefix i texten, till en talaretikett.
- *Move units with speaker label to separate levels*: en nivå per talare.

**SubRip (.srt)** erbjuder:

- *Regular expression for speaker identification*: ett mönster med en fångstgrupp
  som matchas mot början av varje textrad; det fångade blir talarnamnet. Använd
  det när din fil skriver talare som `INTERVJUARE:` eller `- Anna —`.
- *Move units with speaker label to separate levels*.
- *Combine empty units with max duration (ms) between units of the same speaker*:
  slår ihop en kort lucka mellan två turer av samma person, så att en mening som
  brutits över flera textblock blir hel igen. Lämna tomt för att stänga av det.

---

## Att dela upp talare på nivåer i efterhand

Delade du inte upp vid import erbjuder **exportfiltren** för SRT och WebVTT
*Move units with speaker label to separate annotation levels*: samma operation,
tillämpad på vägen ut. Enheter utan talare stannar på standardnivån.
