# Arbetsbänken

**För:** dig som har en mapp med inspelningar snarare än en enda fil.
Arbetsbänken transkriberar en hel omgång utan tillsyn och låter dig redigera varje
resultat utan att ladda in filerna en i taget.

> **Så kommer du dit.** Arbetsbänken (*Workbench*) har ingen egen post i
> navigeringslisten. Du kommer dit genom att skriva `/workbench` i TRATT:s
> adress, till exempel `http://localhost:5321/workbench`, och adressen är värd
> att bokmärka. Den ingår i släppta byggen; ett bygge från innan den kom leder
> adressen till den vanliga startsidan i stället.
>
> Väl där öppnar både **Manual** i navigeringslisten och **Hjälp** i
> verktygsraden det här kapitlet i stället för manualens förstasida.
>
> Gränssnittet i Arbetsbänken är översatt till svenska, men sidan har inget eget
> namn i gränssnittet. Manualen kallar den Arbetsbänken; adressen är engelsk.

---

<a id="when-to-use-it"></a>

## När den passar, och när den inte gör det

| | Startsidan (`/local`) | Arbetsbänken (`/workbench`) |
| --- | --- | --- |
| Inspelningar | En | Många |
| Automatisk transkription | En körning, du väntar på den | En kö som arbetar sig genom listan |
| Byta mellan inspelningar | Ladda om sidan, ladda nästa fil | Klicka på en fil i listan |
| Export | En fil i taget | En fil, eller alla som ett arkiv |
| Passar för | En enskild intervju, en snabb rättelse | Ett helt projekts material, en omgång över natten |

Allt annat är detsamma. Vyerna, genvägarna, markörerna, nivåerna och
exportformaten är de som beskrivs i resten av manualen. Arbetsbänken ändrar hur
material kommer in och hur du rör dig mellan inspelningar, inte hur du
transkriberar.

**De delar en sparad session.** TRATT håller en enda aktuell inspelning i
webbläsarlagringen, och Arbetsbänkens fillista använder samma plats. Att starta en
ny transkription på startsidan kan därför ersätta en fil som ligger i
Arbetsbänkens lista, och TRATT varnar när det är på väg att hända. Välj ett av de
två arbetssätten för ett givet material och håll dig till det.

---

## Så ser den ut

Fyra saker ligger till vänster, uppifrån och ned:

1. **Filer** med antalet inspelningar, och knapparna **Exportera alla**,
   **Rensa klara** och **Ta bort**.
2. Flikarna **Ladda upp fil** och **Spela in nu** över en släppyta:
   *Släpp ljudfiler eller tidigare exporterat arkiv här*.
3. **Pipelineinställningar**: vad som händer med en fil automatiskt, och knappen
   som startar kön.
4. Två kapacitetsmätare: **Webbläsarlagring** och **Arbetsminne (uppskattat)**.

Resten av fönstret är den inspelning du valt: namn och uppgifter, vyväljaren,
verktygsraden med **Genvägar**, **Översikt** och **Hjälp**, och själva vyn.

---

## Att lägga till inspelningar

Släpp så många ljud- eller videofiler du vill på släppytan samtidigt, eller klicka
på den och välj dem. Varje fil blir en egen post i listan med sin egen
transkription. Format och storleksgränser är desamma som överallt annars och
listas under
[Ladda in en inspelning](loading-media.md#supported-file-formats).

**En transkriptfil** hör till sin inspelning: släpp den tillsammans med ljudet,
eller efter att ljudet redan ligger i listan. TRATT parar ihop de två på namn och
säger till när det inte går:

- *Ingen inspelning heter "x". Släpp transkriptionen tillsammans med ljudfilen,
  eller döp den som inspelningen.*
- *Bifoga ljudet för "x" först och släpp sedan transkriptionen igen.*
- Att ersätta en transkription som redan har text kräver en bekräftelse, eftersom
  dina ändringar i den skulle gå förlorade.

**Filer som redan ligger i listan** läggs inte till igen; TRATT namnger dem som
hoppades över.

**Spela in nu** spelar in direkt i Arbetsbänken, precis som på startsidan. Se
[Spela in i webbläsaren](loading-media.md#recording-in-the-browser).

<a id="loading-an-archive"></a>

### Att läsa in ett exporterat arkiv

Släpp en `.zip` som TRATT exporterat tidigare på samma släppyta och den packas
upp: varje inspelnings ljud och dess `_annot.json` hamnar tillbaka i listan,
ihopparade. Att läsa in ett arkiv stoppar kön och stänger **av** automatisk
transkribering och översättning, så att återställt material inte transkriberas
över.

Allt annat i arkivet (Word-filer, undertexter, manifesten) är utdata och ignoreras
på vägen in.

Går arkivet inte att läsa får du *Kunde inte läsa arkivet*, och ett arkiv utan
inspelningar rapporterar *Det innehåller inga inspelningar*.

---

## Pipelinen

**Pipelineinställningar** beskriver på en rad vad som händer med en fil när den
körs. Utan något inställt står det **Automatisk transkribering av**, och *Nya filer
transkriberas inte automatiskt*. Klicka på reglageikonen för att öppna
inställningarna.

Inställningarna är samma kontroller som på startsidan: modellen,
transkriptionsspråket, talarseparation och lokal översättning. De beskrivs under
[Automatisk utkasttranskription](automatic-transcription.md). Stäng dialogen med
**Klar** så visar sammanfattningsraden vad du valt, till exempel:

> Automatisk transkribering på · Whisper Medium · Svenska · 2 talare · → Engelska

**Med automatisk transkribering på transkriberas filer när de kommer in.** Du kan
släppa tjugo inspelningar och gå därifrån.

**Med den av** händer ingenting förrän du trycker på knappen längst ned i panelen.
Den heter **Transkribera N fil(er)** och kör kön över de filer som ännu inte har
någon transkription. Medan kön körs blir samma knapp **Pausa kön**; en paus låter
filen som pågår bli klar och håller resten.

Är knappen inaktiverad förklarar dess hjälptext varför: *Inga
transkriptionsalternativ inställda, aktivera automatisk transkribering först.*

---

## Att följa arbetet

Varje rad i **Filer** visar hur långt den inspelningen har kommit.

| Status | Betyder |
| --- | --- |
| **I kö** | Väntar på sin tur |
| **Körs** | Arbetas med nu, med aktuellt steg och ett förloppsfält |
| **Klar** | Färdig |
| **Misslyckades** | Stoppade på ett fel, med **Försök igen** på raden |
| **Avbruten** | Sidan stängdes eller laddades om halvvägs |

En fil som körs namnger sitt steg: **Förbereder**, **Laddar modell**,
**Transkriberar**, **Separerar talare**, **Översätter**. Knappen på raden avbryter
just den filen (*Avbryt transkriberingen av den här filen*) och lämnar resten av
kön i fred.

En misslyckad fil säger vad som gick fel i vanliga ord: *Kunde inte läsa ljudet*,
*Kunde inte ladda modellen*, *Minnet tog slut*, *Avbruten*, eller bara
*Misslyckades*. **Minnet tog slut** är den att göra något åt, se
[Kapacitet](#capacity) nedan.

---

## Att redigera ett resultat

Klicka på en inspelning i listan för att öppna den. Rubriken ovanför vyn ger namn
och uppgifter, till exempel `interview_a.mp3 · 1:45 · 16 kHz mono · 3.369 MB`.

Därefter är du i den vanliga redigeringsmiljön: välj 2D Vy, Diktafon-vy eller
Linjär vy i väljaren och arbeta som beskrivs under
[Så fungerar transkribering](transcribing.md). **Genvägar** (Alt + 8) och
**Översikt** (Alt + 0) finns i verktygsraden. Riktlinjefönstret erbjuds inte här.

Ändringar sparas medan du skriver, per inspelning. Att byta till en annan fil i
listan förlorar ingenting.

---

## Att komma tillbaka senare

TRATT minns listan men aldrig mediefilerna, så när du återvänder finns alla
inspelningar kvar och var och en erbjuder **Bifoga fil…**. Välj samma fil från
disken och redigeringen fortsätter där du slutade. Till dess säger vyn *Ljudet för
den här filen är inte inläst i den här sessionen.*

Ser filen du väljer inte ut att vara den posten skapades från stannar TRATT och
frågar: *Det här ser inte ut att vara samma fil*, med vad du valde och vad som
förväntades sida vid sida, och **Använd ändå**. När bara ändringstiden skiljer sig
sägs det uttryckligen, eftersom det brukar vara en kopia eller omexporterat ljud
snarare än fel inspelning.

Du kan också exportera ett arkiv innan du slutar och
[läsa in det igen](#loading-an-archive) nästa gång, vilket återställer ljudet och
transkriptionerna tillsammans och inte kräver någon ny bifogning.

---

<a id="capacity"></a>

## Kapacitet

De två mätarna mäter olika saker, och bara den ena begränsar hur mycket du kan ha
igång.

**Webbläsarlagring** är det TRATT behåller på disken: nedladdade modeller och dina
transkriptioner. Noten under den uppskattar båda, till exempel *modeller ca 210 MB
för nuvarande pipeline + annoteringar ca 221 MB*. **Media skrivs aldrig till
lagringen**, och därför fyller en mapp med stora inspelningar inte upp den. Vissa
webbläsare rapporterar inte användning alls, och siffran är då otillgänglig.

**Arbetsminne (uppskattat)** är avkodat ljud som hålls i fliken, och **det är den
verkliga gränsen**. Varje inspelning vars ljud är bifogat tar minne så länge det
är bifogat. Är du nära taket, eller misslyckas en fil med *Minnet tog slut*, arbeta
igenom materialet i mindre grupper: exportera och
[Rensa klara](#housekeeping), bifoga sedan de nästkommande.

---

## Att få ut resultaten

**En inspelning.** Med en transkription på skärmen öppnar **Exportera den här
transkriptionen** i rubriken den vanliga exportdialogen, som beskrivs under
[Exportera](exporting.md). Den fungerar även när ljudet inte är bifogat. Den är
dold tills det finns något att exportera.

**Alla.** **Exportera alla** i Filer-rubriken öppnar **Exportera katalog**: markera
de format du vill ha, och TRATT skriver ett arkiv med varje markerad inspelning,
eller alla när du inte markerat någon. Den visar förloppet, listar inspelningar
som måste hoppas över under *Klar med varningar*, och avslutar med *Klar, N
fil(er) arkiverade*.

Vad arkivet innehåller, och hur du läser in det igen, beskrivs under
[Att exportera ett arkiv](exporting.md#exporting-an-archive).

---

<a id="housekeeping"></a>

## Att hålla ordning

**Rensa klara** tar bort de färdiga inspelningarna ur listan. **Ta bort** tar bort
dem du markerat, och kryssrutan i Filer-rubriken markerar alla.

Båda är permanenta: *Ta bort N fil(er) från listan? Deras transkriptioner och
ändringar raderas och kan inte återställas.* Exportera innan du rensar.
