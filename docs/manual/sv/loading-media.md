# Ladda in en inspelning

**För:** alla. Sidan beskriver de tre sätt material kommer in i TRATT, vilka
format som fungerar, och hur du fortsätter där du slutade.

---

## Ladda upp en fil

På startsidan visar fliken **Ladda upp fil** en streckad släppyta:
*Dra och släpp en ljudfil (+ en valfri transkriptfil) här eller klicka här.*

Du kan släppa **en mediefil**, och valfritt **en transkriptfil** tillsammans med
den, i vilken ordning som helst. TRATT väntar tills det finns ljud innan något
kan göras — under tiden visar transkriptfilen en snurra och texten
*Waiting for audio file*.

Medan en fil läses ser du ett förloppsfält (för `.wav`) eller ett snurrande
kugghjul (för allt annat, som först måste avkodas). Sedan:

| Ikon | Betyder |
| --- | --- |
| ✓ | Inläst och användbar |
| ⚠ | Inläst, men med en reservation — hovra för att läsa varningen |
| ✗ | Avvisad — hovra för att läsa varför |
| ⚙ (kugghjul, klickbart) | Det här transkriptformatet har importalternativ. Klicka för att ställa in dem. |

Vanliga avvisningar: ett filformat som inte stöds, en fil över storleksgränsen,
eller ett transkript vars namn inte matchar ljudfilens namn.

### Transkriptfilen

Har du redan ett transkript — från en tidigare TRATT-session, från ett annat
verktyg eller från en undertextfil — släpper du in det tillsammans med ljudet, så
öppnar TRATT det för redigering i stället för att börja från noll. Formaten som
kan läsas listas under
[Exportera → format TRATT kan läsa](exporting.md#formats-tratt-can-read).

Vissa importfilter har alternativ; kugghjulet intill filen öppnar dem. SubRip och
WebVTT kan till exempel plocka ut talarnamn ur texten och lägga varje talare på
en egen nivå. Se [Nivåer och talare](tiers-and-speakers.md).

---

<a id="recording-in-the-browser"></a>

## Spela in i webbläsaren

Fliken **Spela in nu** spelar in direkt i TRATT — ingen separat inspelare, ingen
fil att flytta runt.

1. Välj inspelningskälla med de två små ikonknapparna högst upp i panelen —
   **Endast ljud** (mikrofon) eller **Ljud + video** (kamera). De har ingen text;
   hovra för att se vilken som är vilken.
2. Öppna **Inmatningsenheter** för att välja en särskild mikrofon eller kamera.
   Är listan tom eller namnlös, klicka **Begär åtkomst** — webbläsare döljer
   enhetsnamn tills du gett tillstånd en gång.
3. Klicka **Starta inspelning**. En nivålampa visar rött (*Låg volym — kontrollera
   mikrofonen*), orange (*Marginell volym*) eller grönt (*Bra volym*). Håll ögonen
   på den de första sekunderna; en röd lampa genom hela inspelningen går inte att
   rädda.
4. **Paus** / **Återuppta** vid behov, sedan **Stopp**.
5. **Använd inspelning** laddar in den i TRATT som om du hade laddat upp den.
   **Ladda ner** sparar en kopia på disk. **Kassera** slänger den.

TRATT spelar in i MP4 där webbläsaren stöder det, och WebM annars (Firefox); båda
fungerar som indata.

**Återställning.** Kraschar fliken eller stänger du den mitt i en inspelning
erbjuds *Oavslutad inspelning återställd* vid nästa besök, med sessionens
starttid, ungefärliga längd och storlek, och möjlighet att fortsätta, ladda ner
det ofullständiga eller kassera.

**Varning när du lämnar.** Har du en inspelning som inte använts eller exporterats
varnar TRATT innan du navigerar bort. Ta varningen på allvar — en oexporterad
inspelning är borta när fliken är det.

---

<a id="supported-file-formats"></a>

## Filformat som stöds

| Filändelse | Anmärkning | Största storlek |
| --- | --- | --- |
| `.wav` | Läses direkt; snabbast och mest exakt | 1,9 GB |
| `.mp3`, `.m4a`, `.flac`, `.ogg` | Längden i sampel uppskattas och kan skilja sig något från andra program | 500 MB |
| `.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.avi`, `.3gp`, `.mka`, `.wma`, `.opus`, `.aac`, `.mp2`, `.amr` | Avkodas i webbläsaren; tar längre tid att läsa in | 500 MB per fil |

Appen anger samma gränser som *Max. file size: 500 MB · WAV up to 1.9 GB*. Hela
listan finns i appen: klicka **Filformat som stöds** ovanför släppytan.

### Video

Laddar du en video arbetar TRATT med dess ljud. När formatet är ett som din
webbläsare kan spela upp direkt — **MP4 är säkrast, WebM fungerar också bra** —
visas bilden bredvid vågformen i transkriptionsfönstret, vilket hjälper mycket
vid överlappande tal och gester. Format som webbläsaren inte kan spela upp
transkriberas ändå, bara utan bild.

---

## Att återvända till en session

TRATT behåller ditt transkript i webbläsaren men **behåller aldrig din mediefil**.

När du kommer tillbaka visar startsidan att det finns data från en tidigare
transkription, tillsammans med namn, storlek och datum för filen du arbetade med.
Dra in samma fil igen och klicka **Fortsätt transkription** för att fortsätta där
du slutade.

Knappen under släppytan talar om vilket av de två som är på väg att hända:

| Knapp | Vad den gör |
| --- | --- |
| **Fortsätt transkription** (blå) | Filen du angav matchar den sparade sessionen. Ditt sparade transkript öppnas igen. |
| **Starta ny transkription** (röd) | Filen matchar inte den sparade sessionen, eller så finns ingen. Klickar du **kastas det sparade transkriptet** och du börjar om — utan ytterligare bekräftelse och utan möjlighet att ångra. |

TRATT avgör vilken knapp som ska visas genom att jämföra filen du släppte med den
som finns i den sparade sessionen (på namn och storlek, och på basnamn så att
samma inspelning i ett annat format ändå räknas som en träff). Förväntade du dig
*Fortsätt* men fick den röda *Starta ny* har du angett en annan fil — kontrollera
den innan du klickar.

> Exportera en fil innan du slutar för dagen. Webbläsarlagring är en bekvämlighet,
> inte ett arkiv — se [Vad lämnar din dator](privacy.md).
