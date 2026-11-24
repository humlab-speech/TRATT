# Ladda in en inspelning

**För:** alla. Sidan beskriver de tre sätt material kommer in i Tratt, vilka
format som fungerar, och hur du fortsätter där du slutade.

---

## Ladda upp en fil

På den tomma startsidan visar fliken **Ladda upp fil** en streckad släppyta:
*Släpp en ljud- eller videofil här*, med **Välj en fil** under. När
inspelningar väl ligger i listan sitter samma ruta överst i listan och säger
*Släpp ljud- eller videofiler här, eller en .zip sparad från Tratt*.

Du kan släppa **mediefiler**, och valfritt **transkriptfiler** tillsammans med
dem, i vilken ordning som helst. En transkription måste heta som inspelningen
den hör till, eller släppas tillsammans med den. Tratt säger till om den inte
kan paras ihop. Tratt väntar tills det finns ljud innan något kan göras. Under
tiden visar transkriptfilen en snurra och texten *Waiting for audio file*.

Medan en fil läses ser du ett förloppsfält (för `.wav`) eller ett snurrande
kugghjul (för allt annat, som först måste avkodas). Sedan:

| Ikon | Betyder |
| --- | --- |
| ✓ | Inläst och användbar |
| ⚠ | Inläst, men med en reservation; hovra för att läsa varningen |
| ✗ | Avvisad; hovra för att läsa varför |
| ⚙ (kugghjul, klickbart) | Det här transkriptformatet har importalternativ. Klicka för att ställa in dem. |

Vanliga avvisningar: ett filformat som inte stöds, en fil över storleksgränsen,
eller ett transkript vars namn inte matchar ljudfilens namn.

<a id="dropping-an-archive"></a>

### Att släppa ett exporterat arkiv

En `.zip` som Tratt exporterat kan släppas rakt in igen. Det är det enda sättet
att få tillbaka ljud *och* transkriptioner i ett steg, eftersom arkivet bär båda.
Se [Att exportera ett arkiv](exporting.md#exporting-an-archive) för vad arkivet
innehåller.

### Transkriptfilen

Har du redan ett transkript (från en tidigare Tratt-session, från ett annat
verktyg eller från en undertextfil) släpper du in det tillsammans med ljudet, så
öppnar Tratt det för redigering i stället för att börja från noll. Formaten som
kan läsas listas under
[Exportera → format Tratt kan läsa](exporting.md#formats-tratt-can-read).

Vissa importfilter har alternativ som du kan välja bland, och kugghjulet intill filen öppnar dem. SubRip och
WebVTT kan till exempel plocka ut talarnamn ur texten och lägga varje talare på
en egen nivå. Se [Nivåer och talare](tiers-and-speakers.md).

---

<a id="recording-in-the-browser"></a>

## Spela in i webbläsaren

Fliken **Spela in nu** spelar in direkt i Tratt. Detta betyder att du inte behöver en separat inspelare, och inte behöver flytta runt filen för att göra en snabb inspelning.

1. Välj inspelningskälla med de två små ikonknapparna högst upp i panelen:
   **Endast ljud** (mikrofon) eller **Ljud + video** (kamera). De har ingen knapptext, så
   hovra för att se vilken som är vilken.
2. Öppna **Inmatningsenheter** för att välja en särskild mikrofon eller kamera.
   Är listan tom eller namnlös, klicka **Begär åtkomst**. Webbläsare döljer
   enhetsnamn tills du gett tillstånd en gång.
3. Klicka **Starta inspelning**. En nivålampa visar rött (*Låg volym, kontrollera
   mikrofonen*), gult (*Marginell volym*) eller grönt (*Bra volym*). Håll ögonen
   på den de första sekunderna; en röd lampa genom hela inspelningen går inte att
   rädda.
4. **Paus** / **Återuppta** vid behov, sedan **Stopp**.
5. **Använd inspelning** laddar in den i Tratt som om du hade laddat upp den.
   **Ladda ner** sparar en kopia på disk. **Kassera** slänger den.

Tratt spelar in video i MP4 där webbläsaren stöder det, och WebM annars (Firefox). Båda
fungerar som indata till Tratt.

**Återställning.** Kraschar fliken eller stänger du den mitt i en inspelning
erbjuds *Oavslutad inspelning återställd* vid nästa besök, med sessionens
starttid, ungefärliga längd och storlek, och möjlighet att fortsätta, ladda ner
det ofullständiga eller kassera.

**Varning när du lämnar.** Har du en inspelning som inte använts eller exporterats
varnar Tratt innan du navigerar bort. Ta varningen på allvar. En oexporterad
inspelning är borta när fliken stängs.

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

Laddar du en video arbetar Tratt med dess ljud. När formatet är ett som din
webbläsare kan spela upp direkt (**MP4 är säkrast, men WebM fungerar också bra**)
visas bilden bredvid vågformen i transkriptionsfönstret, vilket hjälper mycket
vid överlappande tal och gester. Format som webbläsaren inte kan spela upp
transkriberas ändå, bara utan bild.

---

## Att återvända till en session

Tratt behåller dina transkriptioner i webbläsaren men **behåller inte dina
mediefiler**.

När du kommer tillbaka ligger alltså inspelningarna kvar i listan, var och en
med sin transkription, och var och en ber om sitt ljud igen: raden säger *Ljudet
är inte bifogat* och erbjuder **Bifoga ljud…**. Välj samma fil från disken,
eller släpp den på listan, så fortsätter redigeringen där du slutade. Ingenting
går förlorat under tiden; du kan bara inte spela upp eller lägga om gränserna i
en inspelning vars ljud saknas.

Ser filen du väljer inte ut att vara den transkriptionen gjordes av stannar
Tratt och frågar först. Att ange fel fil skadar inte transkriptionen, men
gränserna kommer inte att ligga rätt mot ljudet.

Det beskrivs tillsammans med resten av listan under
[Arbeta med flera inspelningar](workbench.md#att-komma-tillbaka-senare). En
exporterad `.zip` innehåller ljudet och transkriptionerna tillsammans, så att
släppa tillbaka den på Tratt återställer bådadera på en gång och besparar dig
bifogandet.

> Exportera en fil innan du slutar för dagen. Webbläsarlagring är en bekvämlighet,
> inte ett arkiv. Se [Hur Tratt använder internet](privacy.md).
