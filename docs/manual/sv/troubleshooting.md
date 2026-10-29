# Felsökning

---

## Att ladda in en fil

**"This file type is not supported." / "File format not supported."**
Filändelsen finns inte i Tratts lista. Konvertera till `.wav` eller `.mp3` och
försök igen. Se [filformat som stöds](loading-media.md#supported-file-formats).

**Ett storleksfel**
Webbläsarbaserade program har två gränser. Dels finns ett övergripande tak på 3000 MB
för hur mycket lagring programmet kan använda. Dels gäller gränser per fil: 1,9 GB för
`.wav` och 500 MB för allt annat. Har du problem att läsa in en inspelning,
konvertera den till FLAC eller MP3, eller dela inspelningen i två.

**"Transkriptfilens namn matchar inte ljudfilens namn."**
Tratt förutsätter att ljudfilen och transkriptfilen med tidsinformation har identiska namn utom filändelsen.
Byt namn på transkriptet så att dess basnamn matchar ljudets, t.ex. `intervju3.wav`
med `intervju3.srt`. Undantaget är *annotJSON*-filer, där programmet förutsätter att filerna heter
som `intervju3.wav` och `intervju3_annot.json`.

**Transkriptfilen bara ligger där med en snurra**
Den väntar på ljud. Släpp in mediefilen också. Ett transkript kan inte öppnas
utan en mediefil med samma namn (se ovan).

**Att läsa in en video tar lång tid**
Det är väntat. När en videofil läses in måste ljudet avkodas ur behållaren i webbläsaren.
Använd ett enklare ljudformat, helst `.wav`, om det går mycket långsamt.

---

## Automatisk transkription

<a id="automatic-transcription-is-greyed-out"></a>

**Kryssrutan Automatisk transkribering är inaktiverad, med en varning om Safari**
Safari och andra WebKit-webbläsare laddar om fliken mitt i stora
modellnedladdningar och förstör ditt arbete, så Tratt stänger av funktionen i dessa webbläsare.
Använd Chrome, Edge eller Firefox. Manuell transkribering i Safari påverkas inte.

**Kryssrutan saknas helt**
Den visas först när ljud har lästs in *och* ingen transkriptfil har lämnats in.
Det finns inget utkast att skriva om du redan tagit med ett transkript.

**De största modellerna är gråmarkerade: "Kräver WebGPU"**
Din webbläsare eller ditt grafikkort erbjuder inte WebGPU. Vilka modeller det gäller
beror på vilket språk du valt. Använd Tiny eller
Small, eller kör Tratt på en dator med ett separat grafikkort. I Chrome och Edge
kan du kontrollera om du har WebGPU på `chrome://gpu`.

**Modellnedladdningen hakar upp sig eller misslyckas**
Modellerna laddas ned från `huggingface.co`. Blockerar ditt nätverk den kan automatisk
transkription inte fungera. Du kan då fortfarande transkribera manuellt. På en långsam
förbindelse kan du börja med Tiny-modellen för att bekräfta att kedjan fungerar innan du
binder upp dig på flera gigabyte.

**Transkriptionen misslyckas halvvägs och nämner WebGPU**
Vissa drivrutiner klarar inte en lång WebGPU-körning. Tratt väljer WebGPU
automatiskt och har ingen egen omkopplare, så tvinga fram processorvägen genom att
stänga av WebGPU i webbläsaren (Chrome/Edge: `chrome://flags` → *WebGPU* →
**Disabled**, och starta om webbläsaren) och ladda om programmet.
Programmet använder då WebAssembly-kedjan, som är långsammare men kan fungera bättre.

**Det tar mycket lång tid**
Modellstorlek, inspelningens längd och din hårdvara avgör hur snabbt bearbetningen går.
Talarseparation lägger till ännu mer tid, eftersom den modellen alltid körs utan
WebGPU-acceleration. Förloppsfältet visar var i inspelningen den är. Rör det sig
pågår arbete och du får vänta. Behöver du en uppskattning av hur lång tid bearbetningen tar, kör ett femminutersutdrag först.

**Talaretiketterna är fel**
Att avgöra talarbyten och tilldela enheter till rätt talare är mycket felbenäget. Du kan ge
den vägledning genom att ange förväntat antal talare, men räkna med att du behöver rätta
etiketter med **Ctrl/Cmd + S** i din manuella granskning. Se
[Nivåer och talare](tiers-and-speakers.md#fixing-speaker-labels).

---

## Ljuduppspelning

**Inget ljud, eller "Missing permissions"**
I så fall blockerar webbläsaren automatisk uppspelning. Tratt visar lösningen för din
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
Du försöker göra en sammanslagning som skulle förstöra text. Töm en av de två enheterna först.

**"You can't apply undo & redo at the moment."**
En annan operation pågår fortfarande. Vänta en sekund och försök igen.

---

## Inspelning

**"Mikrofonbehörighet nekades." / "Ingen mikrofon hittades."**
Ge mikrofonåtkomst i webbläsarens inställningar och ladda om. På macOS,
kontrollera också Systeminställningar → Integritet och säkerhet → Mikrofon för din
webbläsare.

**Enhetsnamnen är tomma**
Webbläsare döljer enhetsnamn tills tillstånd getts en gång. Klicka **Begär
åtkomst** och sedan **Uppdatera enheter**.

**"Din webbläsare stöder inte MP4-inspelning — sparar som WebM."**
Det gäller Firefox. Ändringen är ofarlig, eftersom Tratt accepterar båda formaten.

**Volymlampan förblir röd**
Mikrofonen är för tyst eller är inte den du tror. Stoppa, välj en annan
inmatningsenhet, kontrollera systemets ingångsnivå och försök igen. Det kan vara omöjligt
att rädda en inspelning som gjorts med för låg inspelningsnivå.

**Jag stängde fliken mitt i en inspelning**
Gå tillbaka till fliken Spela in nu. Tratt erbjuder *Oavslutad inspelning
återställd* med möjlighet att fortsätta, ladda ner det ofullständiga eller
kassera.

---

<a id="the-workbench"></a>

## Arbetsbänken

**En fil misslyckades med "Minnet tog slut"**
Du har bifogat för mycket avkodat ljud till sessionen samtidigt. Mätaren **Arbetsminne (uppskattat)**
visar hur mycket som används. Exportera det som är klart,
**Rensa klara** för att frigöra minnet, och bifoga sedan de nästkommande
inspelningarna. En mindre transkriptionsmodell hjälper också.

**En fil misslyckades med "Kunde inte läsa ljudet"**
Du läser in en mediefil i ett format som inte stöds, eller så är filen skadad. Prova den
ensam på startsidan, och konvertera den till `.wav` eller `.mp3` om den fortfarande fallerar.

**En fil misslyckades med "Kunde inte ladda modellen"**
Modellnedladdningen blev inte klar. Kontrollera nätverket och tryck **Försök
igen** på den raden. Resten av kön påverkas inte.

**Allt står som "Avbruten"**
Sidan stängdes eller laddades om medan kön körde. Bifoga
ljudet igen och kör kön på nytt. I de flesta fall går ingenting förlorat.

**Transkribera-knappen är gråmarkerad**
Ingen pipeline är inställd. Öppna **Pipelineinställningar** och markera
**Automatisk transkribering med Whisper** först.

**Alla filer säger "Bifoga fil…"**
Normalt efter en omladdning. Tratt behåller en kopia av transkriptionerna i sin lagring, men inte media. Därför
behöver varje inspelning få sitt ljud bifogat från din dator igen. Ett
[exporterat arkiv](exporting.md#exporting-an-archive) innehåller allt och återställer båda på en gång.

**Allt blev orange**
Avsiktligt. Transkriptioner som sparades före version 3.2, och alla som byggdes om
vid återupptagning före 3.2-fixarna, läses in som overifierade. Tratt kan inte veta
vem som kontrollerat dem. Lyssna på en enhet eller redigera den så blir den grön. Se
[Verifierade transkriptioner](checking-your-work.md#verified-transcriptions).

**"Det här ser inte ut att vara samma fil"**
Filen du valde skiljer sig från den posten skapades av. Dialogen visar båda, så att du
kan jämföra dem. När bara ändringstiden skiljer sig rör det sig oftast om en kopia
eller omexporterat ljud och **Använd ändå** är tryggt.

**Startsidan ersatte en inspelning som låg i Arbetsbänkens lista**
De delar en sparad sessionsplats, och Tratt varnar innan det sker. Använd den ena
eller den andra vägen för ett givet material.

---

## Att förlora arbete

**Mitt transkript är borta**
Tratt håller en kopia av transkript i den här webbläsarens lagring. Du kan få problem
om du rensar webbplatsdata, använder ett privat fönster och stänger
det, byter webbläsare eller dator, eller om ett städverktyg rensar IndexedDB.

**Jag släppte in filen igen men knappen sa "Starta ny transkription"**
Det betyder att Tratt inte känner igen filen som den som den sparade sessionen hör
till, och att klicka *kastar* det sparade transkriptet. Kontrollera att det är
samma fil, med samma namn, innan du klickar på knappen för att starta en ny transkription.

---

<a id="the-maintenance-page"></a>

## Underhållssidan

Sidan är inte länkad från gränssnittet: lägg till `/help-tools` i Tratts adress, till
exempel `https://tratt.demo.humlab.umu.se/help-tools`.

| Verktyg | Använd när |
| --- | --- |
| **Refresh App** | Tratt beter sig konstigt efter en uppdatering. Tvingar omladdning och uppdaterar cachen |
| **Clear all Storage Data** | Du är klar på en delad dator, eller lagringen är trasig. Tar bort transkript, loggar och inställningar permanent. |
| **Stresstest** | Du vill kontrollera om den här webbläsaren och datorn klarar av det |
| **Backup local data** | Innan du rensar något, eller före en webbläsaruppdatering. Laddar ned en zip med Tratts lokala data |
| **Restore local backup** | Du vill återställa det tidigare tillståndet från en zip-fil |

**Clear all Storage Data går inte att ångra.** Exportera ditt transkript, eller ta
en säkerhetskopia, först.

---

## Att rapportera ett problem

Tratt har ett inbyggt återkopplingsformulär (frågetecknet i sidhuvudet), men
det visas bara när appen är ansluten till en OCTRA-backend, vilket den lokala
standardinstallationen av Tratt inte är. Rapportera i så fall problem i projektets
ärendehanterare: <https://github.com/humlab-speech/TRATT/issues>.

Vilken väg du än använder är en felrapport sällan användbar utan:

- din webbläsare och version, och ditt operativsystem;
- om WebGPU var tillgängligt, och vilken modell du valde;
- inspelningens filformat och ungefärliga längd;
- vad du gjorde, vad du förväntade dig och vad som hände i stället;
- allt i webbläsarens utvecklarkonsol (F12 → Console).

Är formuläret tillgängligt, markera alternativet att skicka med protokollet:
loggen över vad appen gjorde. Det skapas ur din session, så läs det först om
materialet är känsligt.
