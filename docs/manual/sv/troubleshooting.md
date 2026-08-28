# Felsökning

---

## Att ladda in en fil

**"This file type is not supported." / "File format not supported."**
Filändelsen finns inte i TRATT:s lista. Konvertera till `.wav` eller `.mp3` och
försök igen. Se [filformat som stöds](loading-media.md#supported-file-formats).

**Ett storleksfel**
Två gränser gäller: 1,9 GB för `.wav` och 500 MB för allt annat. En lång
`.wav`-fil är den vanliga orsaken; konvertera den till FLAC eller MP3, eller dela
inspelningen.

**"Transkriptfilens namn matchar inte ljudfilens namn."**
TRATT parar ihop de två på namn. Byt namn på transkriptet så att dess basnamn
matchar ljudets, t.ex. `intervju3.wav` med `intervju3_annot.json`.

**Transkriptfilen bara ligger där med en snurra**
Den väntar på ljud. Släpp in mediefilen också — ett transkript ensamt går inte att
öppna.

**Att läsa in en video tar lång tid**
Förväntat: ljudet måste avkodas ur behållaren i webbläsaren. `.wav` läses in
snabbast.

---

## Automatisk transkription

<a id="automatic-transcription-is-greyed-out"></a>

**Kryssrutan Automatisk transkribering är inaktiverad, med en varning om Safari**
Safari och andra WebKit-webbläsare laddar om fliken mitt i stora
modellnedladdningar och förstör ditt arbete, så TRATT stänger av funktionen där.
Använd Chrome, Edge eller Firefox. Manuell transkribering i Safari påverkas inte.

**Kryssrutan saknas helt**
Den visas först när ljud har lästs in *och* ingen transkriptfil har lämnats in —
det finns inget utkast att skriva om du redan tagit med ett transkript.

**Modellerna Medium och Large är gråmarkerade — "Kräver WebGPU"**
Din webbläsare eller ditt grafikkort erbjuder inte WebGPU. Använd Tiny eller
Small, eller kör TRATT på en dator med ett separat grafikkort. I Chrome och Edge
kan du kontrollera på `chrome://gpu`.

**Modellnedladdningen hakar upp sig eller misslyckas**
Modellerna kommer från `huggingface.co`. Blockerar ditt nätverk den kan automatisk
transkription inte fungera; allt annat i TRATT fungerar ändå. På en långsam
förbindelse: börja med Tiny-modellen för att bekräfta att kedjan fungerar innan du
binder upp dig på flera gigabyte.

**Transkriptionen misslyckas halvvägs och nämner WebGPU**
Vissa drivrutiner klarar inte en lång WebGPU-körning. TRATT väljer WebGPU
automatiskt och har ingen egen omkopplare, så tvinga fram processorvägen genom att
stänga av WebGPU i webbläsaren (Chrome/Edge: `chrome://flags` → *WebGPU* →
**Disabled**, starta om) och ladda om. Allt körs då på WASM: långsammare, och bara
de mindre modellerna återstår.

**Det tar mycket lång tid**
Modellstorlek, inspelningens längd och hårdvaran multipliceras med varandra.
Talarseparation lägger till ännu mer, eftersom den modellen alltid körs på
processorn. Förloppsfältet visar var i inspelningen den är — rör det sig, arbetar
den. Behöver du en uppskattning, kör ett femminutersutdrag först.

**Talaretiketterna är fel**
Talarseparation är en gissning. Ange förväntat antal talare nästa gång, och rätta
etiketter med **Ctrl/Cmd + S** — se
[Nivåer och talare](tiers-and-speakers.md#fixing-speaker-labels).

---

## Ljuduppspelning

**Inget ljud, eller "Missing permissions"**
Webbläsaren blockerar automatisk uppspelning. TRATT visar lösningen för din
webbläsare: klicka på den överstrukna uppspelningsikonen till vänster i
adressfältet, sätt Autoplay till *Allow Audio and Video* och klicka **RELOAD** i
dialogen.

**"This transcription unit has to be visible to play the audio contained within it"**
Rulla enheten i synfältet först, eller sänk **Sekunder per rad** i Inställningar så
att fler enheter får plats.

---

## Gränser och redigering

**"Cannot set boundary in a transcription unit that is already transcribed."**
Din dragmarkering spänner över enheter som redan har text. Sätt en enskild gräns
med **S** i stället för att använda en markering, eller rensa texten först.

**"Cannot delete boundary because there are neighboring transcription units that are already transcribed."**
En sammanslagning skulle förstöra text. Töm en av de två enheterna först.

**"You can't apply undo & redo at the moment."**
En annan operation pågår fortfarande. Vänta en sekund och försök igen.

---

## Inspelning

**"Mikrofonbehörighet nekades." / "Ingen mikrofon hittades."**
Ge mikrofonåtkomst i webbläsarens webbplatsinställningar och ladda om. På macOS,
kontrollera också Systeminställningar → Integritet och säkerhet → Mikrofon för din
webbläsare.

**Enhetsnamnen är tomma**
Webbläsare döljer enhetsnamn tills tillstånd getts en gång. Klicka **Begär
åtkomst** och sedan **Uppdatera enheter**.

**"Din webbläsare stöder inte MP4-inspelning — sparar som WebM."**
Firefox. Ofarligt: TRATT accepterar båda.

**Volymlampan förblir röd**
Mikrofonen är för tyst eller är inte den du tror. Stoppa, välj en annan
inmatningsenhet, kontrollera systemets ingångsnivå och spela in igen. Det går inte
att laga i efterhand.

**Jag stängde fliken mitt i en inspelning**
Gå tillbaka till fliken Spela in nu. TRATT erbjuder *Oavslutad inspelning
återställd* med möjlighet att fortsätta, ladda ner det ofullständiga eller
kassera.

---

## Att förlora arbete

**Mitt transkript är borta**
TRATT håller det i den här webbläsarens lagring, i den här webbläsarprofilen. Det
försvinner om du rensar webbplatsdata, använder ett privat fönster och stänger
det, byter webbläsare eller dator, eller om ett städverktyg rensar IndexedDB.

**Jag släppte in filen igen men knappen sa "Starta ny transkription"**
Det betyder att TRATT inte känner igen filen som den som den sparade sessionen hör
till, och att klicka *kastar* det sparade transkriptet. Kontrollera att det är
samma fil, med samma namn, innan du klickar.

**Förebyggande:** exportera en AnnotJSON-fil i slutet av varje pass. Det är den
enda kopian som finns utanför webbläsaren.

---

<a id="the-maintenance-page"></a>

## Underhållssidan

Inte länkad från gränssnittet: lägg till `/help-tools` i TRATT:s adress — till
exempel `http://localhost:5321/help-tools`.

| Verktyg | Använd när |
| --- | --- |
| **Refresh App** | TRATT beter sig konstigt efter en uppdatering — tvingar omladdning och uppdaterar cachen |
| **Clear all Storage Data** | Du är klar på en delad dator, eller lagringen är trasig. Tar bort transkript, loggar och inställningar permanent. |
| **Stresstest** | Du vill kontrollera om den här webbläsaren och datorn klarar av det |
| **Backup local data** | Innan du rensar något, eller före en webbläsaruppdatering — laddar ned en zip med TRATT:s lokala data |
| **Restore local backup** | Du vill lägga tillbaka den zip-filen |

**Clear all Storage Data går inte att ångra.** Exportera ditt transkript, eller ta
en säkerhetskopia, först.

---

## Att rapportera ett problem

TRATT har ett inbyggt återkopplingsformulär (frågetecknet i den övre listen), men
det visas bara när appen är ansluten till en OCTRA-backend — vilket den lokala
standardinstallationen av TRATT inte är. Rapportera i så fall problem i projektets
ärendehanterare: <https://github.com/humlab-speech/TRATT/issues>.

Vilken väg du än använder är en felrapport sällan användbar utan:

- din webbläsare och version, och ditt operativsystem;
- om WebGPU var tillgängligt, och vilken modell du valde;
- inspelningens filformat och ungefärliga längd;
- vad du gjorde, vad du förväntade dig och vad som hände i stället;
- allt i webbläsarens utvecklarkonsol (F12 → Console).

Är formuläret tillgängligt, markera alternativet att skicka med protokollet —
loggen över vad appen gjorde. Det skapas ur din session, så läs det först om
materialet är känsligt.
