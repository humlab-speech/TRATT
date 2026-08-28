# Så fungerar transkribering

**För:** dig som ska tillbringa riktiga timmar i TRATT. Läs den här sidan en gång;
därefter räcker [Tangentbordsgenvägar](shortcuts.md) uppslagen.

---

## Modellen i huvudet

Ett TRATT-dokument har tre lager:

**Transkriptet** består av **nivåer** (gränssnittet säger *nivå*, nyare
funktioner säger *tier*). Det mesta arbetet sker på en nivå. En andra nivå kan
innehålla en översättning, eller en talares turer. Se
[Nivåer och talare](tiers-and-speakers.md).

**En nivå** är en följd av **transkriptionsenheter** — sammanhängande stycken av
inspelningen, vart och ett med sin egen text. På andra håll kallas de segment
eller yttranden. De överlappar aldrig och lämnar aldrig luckor: hela inspelningen
täcks alltid av enheter, även de tysta delarna.

**En gräns** är linjen mellan två enheter. Att lägga till en gräns delar en enhet
i två; att ta bort en slår ihop två enheter till en. Det är det enda sättet
antalet enheter ändras.

Det finns alltså exakt två sorters arbete: att få gränserna på rätt ställen, och
att få rätt text i varje enhet. Har en utkasttranskription satt gränserna åt dig
går det mesta av din tid till det andra.

---

## Arbetsslingan

I 2D Vy (standard) ritas inspelningen som en vågform över flera rader med varje
enhets text under.

1. **Hovra** över enheten du vill åt och tryck **Enter** — transkriptionsfönstret
   öppnas med just den enhetens ljud och text.
2. **Tabb** spelar och pausar. **Esc** stoppar. **Skift + Backsteg** hoppar
   tillbaka dit uppspelningen senast startade; **Skift + Tabb** stegar tillbaka
   ett par sekunder så att du kan höra de sista orden igen.
3. Skriv. Använd markörer för allt som inte är ord.
4. **Alt + →** sparar och öppnar nästa enhet. **Alt + ←** går tillbaka en.
   **Alt + ↓** sparar och stänger fönstret.

Du kan också arbeta utan att öppna fönstret alls: Diktafon-vyn sätter ett
textfält och en spelare på skärmen, och Översikt låter dig redigera rader i en
tabell. Se [Vyerna](the-editors.md).

**Att spara.** Det finns inget att spara. Varje ändring hamnar direkt i
webbläsarlagringen, och en liten sparikon blinkar till i den övre listen när det
sker. Det du ändå måste göra är att [exportera en fil](exporting.md) innan du
slutar för dagen.

**Ångra** är **Ctrl + Z** (**Cmd + Z** på Mac), **gör om** är **Ctrl + Y**
(**Skift + Cmd + Z**). Det fungerar både på text och på gränsändringar. Ibland
säger TRATT att ångra och gör om inte kan användas för tillfället — det händer
medan en annan operation pågår; vänta ett ögonblick och försök igen.

---

<a id="boundaries"></a>

## Gränser

Allt detta sker på vågformen, utan att något textfält har fokus.

| För att | Gör |
| --- | --- |
| Lägga till en gräns | Flytta muspekaren till läget och tryck **S** |
| Lägga till två gränser runt ett stycke | Dra över vågformen med vänster musknapp för att markera det, tryck sedan **S** |
| Ta bort en gräns och slå ihop enheterna | Markera den och tryck **D** |
| Spela bara markeringen | **C** |
| Flytta markören | **←** / **→** |

Två regler som förr eller senare biter dig:

- **TRATT vägrar dela över enheter som redan har text.** Spänner din markering
  över två enheter och någon av dem redan är transkriberad får du
  *Cannot set boundary in a transcription unit that is already transcribed.*
  Rensa texten först, eller sätt enskilda gränser med **S** i stället för att
  använda en markering.
- En gräns kan inte placeras på inspelningens allra första sampel.

### Sätta en gräns inifrån texten

Ibland märker du mitt i skrivandet att en enhet innehåller två yttranden. I
stället för att lämna textfältet:

1. Spela till punkten där delningen hör hemma och pausa.
2. Sätt textmarkören på motsvarande ställe i texten.
3. Tryck **Alt + S** — **Beskärningsmärke** — för att infoga en gräns där.

Enheten delas vid uppspelningsläget, och texten delas vid din markör.

---

## Tystnad

Ett stycke utan tal markeras som **paus** i stället för att lämnas tomt, så att
"inget sades här" går att skilja från "inte transkriberat ännu".

- På vågformen: hovra över enheten och tryck **A**.
- I textfältet: **Alt + P**, eller knappen **Break**.

Pauser visas som `<P>` i transkriptet och räknas separat i
[Översikt](checking-your-work.md) — *Tysta transkriptionsenheter*, till skillnad
från *Tomma transkriptionsenheter*, som är de som fortfarande väntar på dig.

---

<a id="markers"></a>

## Markörer

Markörer noterar sådant som inte är ord. De ligger i verktygsraden ovanför
textfältet och har var sin genväg. Knapptexterna visas på engelska även i det
svenska gränssnittet, eftersom riktlinjefilen ännu inte är översatt:

| Markör | Knapp | Genväg | Används för |
| --- | --- | --- | --- |
| `[~abc]` | `~abc` | **Alt + 1** | Ett ord avhugget i *början* av enheten |
| `<nib>` | filled pause | **Alt + 2** | Tvekljud — "öh", "hm" |
| `[int]` | intermittent noise | **Alt + 3** | En dörr som smäller, en stöt mot mikrofonen |
| `[spk]` | speaker noise | **Alt + 4** | Ljud från talaren själv — andning, skratt, hosta |
| `[sta]` | stationary noise | **Alt + 5** | Kontinuerlig bakgrund — trafik, musik, ventilation |
| `**` | ** | **Alt + 6** | Följande ord är oförståeligt, eller på ett annat språk |
| `[abc~]` | abc~ | **Alt + 7** | Ett ord avhugget i *slutet* av enheten |
| `<P>` | Break | **Alt + P** | Enheten är tystnad |

Markörerna, deras symboler och genvägar kommer från projektets riktlinjefil, så en
installation som konfigurerats för ett visst projekt kan visa en annan uppsättning.
Vad din installation faktiskt använder syns alltid i verktygsraden och under
**Riktlinjer** (**Alt + 9**).

---

## Talare

Har talarseparation körts, eller har du laddat in en undertextfil med talarnamn,
bär varje enhet en **talaretikett**. Etiketter visas som färgade brickor, och
varje talare behåller sin färg.

Med transkriptionsfönstret öppet växlar **Ctrl + S** (**Cmd + S**) enhetens
etikett till nästa kända talare — snabbaste sättet att rätta en felplacerad tur.
Du kan också klicka på brickan.

Att lägga till, byta namn på och ta bort talare, och att dela upp talare på
separata nivåer, beskrivs under [Nivåer och talare](tiers-and-speakers.md).

---

## Inställningar värda att sätta dag ett

Öppna **Inställningar** i den övre listen (kugghjulsikonen).

| Inställning | Vad den gör | Förslag |
| --- | --- | --- |
| **Sekunder per rad** | Hur mycket ljud varje vågformsrad visar: 5, 10, 15, 20 eller 60 s. Visas bara medan du är i 2D Vy. | 5 eller 10 för detaljarbete; högre för att skumma |
| **Spela vid hovring** | Spelar ljud när du för musen över vågformen | På, när du vant dig — det är mycket snabbare för att hitta ett ställe. Växla direkt med **H**. |
| **Följ uppspelningspekare** | Rullar vyn så att uppspelningsläget syns | På |
| **Visa förstoringsglas** | En förstorad remsa runt markören, för att placera gränser exakt | På vid noggrant gränsarbete |
| **Enkelt läge** | Döljer knapptexter och tangentbordstips — ett kompakt gränssnitt med bara ikoner | Av medan du lär dig |
| **Logga användaråtgärder** | Registrerar vad du gjort, för metodavsnitt och studier. Stannar på din dator; exporteras bara om du ber om metadata. | Du avgör |

---

## När du är klar

Tryck **Alt + 0** för [Översikt](checking-your-work.md) och kontrollera att
*Tomma transkriptionsenheter* är noll, och
[exportera sedan ditt arbete](exporting.md).
