# Automatisk utkasttranskription

**För:** dig som hellre rättar ett utkast än skriver från ingenting.

Tratt kan köra en taligenkänningsmodell **på din egen dator, inne i
webbläsarfliken**, och öppna resultatet i redigeraren så att du kan rätta det.
Den kan också gissa vem som talade när, och översätta det färdiga transkriptet.

Det som produceras av dessa automatiska rutiner är dock bara ett utkast. Räkna med att rätta namn, siffror, överlappande tal och
allt som sagts tyst eller vid sidan av mikrofonen. Du sparar lite skrivandet genom att använda automatisk bearbetning, men sparar inte
in något lyssnande.

---

<a id="turning-it-on"></a>

## Slå på automatisk transkription

När du lägger till en inspelning blir funktionen tillgänglig. Tratt lägger inspelningen i kö
och en taligenkänningsmodell skriver ett utkast till transkription. Du behöver den här
sidan först när du vill ändra modellens inställningar, eller stoppa den helt.

Kontrollerna för modellen ligger i en dialog **Transkriptionsinställningar**. Öppna den med
**Ändra**, bredvid *Transkriptionsspråk* på den tomma startsidan, eller med
reglageknappen bredvid **Transkribera** när inspelningar ligger i listan.

![Dialogen Transkriptionsinställningar](../../assets/visp_tratt_auto_transcription_options.png)

1. **Transkribera nya inspelningspaket automatiskt**: Slår
   du av den går inspelningarna bara att transkribera för hand, till dess att du
   trycker **Transkribera**.
2. **Transkriptionsspråk**: det språk som talas på inspelningen. Ett hundratal
   språk erbjuds, listade med sina egna språknamn (*Svenska (Swedish, sv)*,
   *Suomi (Finnish, fi)*), med svenska först och resten i bokstavsordning. Tratt
   förvaljer det språk gränssnittet är inställt på, så byt om inspelningen är på
   något annat.
3. **Modell**: se tabellerna nedan. Listan ändras med språket.
4. **Speaker separation** (talarseparation, valfritt): se
   [Talarseparation](#speaker-separation).
5. **Översätt transkriptionen lokalt**: ett andra avsnitt, hopfällt tills du
   öppnar det. Se [Översätta transkriptionen](#translating-the-transcript).

**Klar** stänger dialogen och behåller det du valt, för den här inspelningen och
nästa.

Vill du lägga till en inspelning *utan* att köra någon modell, använd
**Transkribera för hand, utan AI** under drag-och-släpp-ytan på startsidan.

Medan en inspelning körs namnger dess rad i listan hur långt den har kommit i processen:
**Förbereder**, **Laddar modell**, **Transkriberar**, **Separerar talare**,
**Översätter**. Stopp-knappen på raden stoppar transkriptionen av just den inspelningen bara.

### Håll fliken öppen

Allt arbete sker i den öppna flikens minne. Stäng den inte, och var försiktig med att låta
datorn somna när du transkriberar långa inspelningar automatiskt. Att byta till en annan flik går dock bra.
Transkriptionen fortsätter då, även om vissa webbläsare kan begränsa hur mycket datorkraft flikar som inte är aktiverade får använda.

---

## Vilken modell ska man välja

Modellistan ändras med språket du valt, eftersom Tratt levererar specialiserade
modeller för de nordiska språken.

**Om din dator har WebGPU** (aktuell Chrome, Edge eller Firefox med ett hyggligt
grafikkort) är alla modeller tillgängliga och de större är mycket snabbare.
**Utan WebGPU** körs modellerna på huvud-processorn i stället. De som bara kan köras stabilt på ett
grafikkort gråmarkeras i listan och går inte att välja, och de som är kvar kan vara långsammare
men användbara.

### Svenska

Tratt använder **KB-Whisper** från Kungliga biblioteket när svenska transkriberas.

| Modell | WebGPU | Processor (WASM) | Anmärkning |
| --- | --- | --- | --- |
| Tiny | 96 MB | 120 MB | Snabbast, minst noggrann. Bra för att kontrollera att kedjan fungerar. |
| Small | 299 MB | 407 MB | Rimlig kompromiss |
| Medium | 679 MB | 679 MB | Noggrannare igen. Kräver WebGPU. |
| Large | 1,2 GB | 1,2 GB | Mest noggrann, ungefär halva hastigheten mot Medium. Kräver WebGPU. |

Tiny och Small är de enda modellerna som Tratt hämtar som ett 8-bitarsbygge på
processorn; med WebGPU används det mindre 4-bitarsbygget. Alla andra modeller är
samma 4-bitarsbygge på båda vägarna. Medium och Large kräver WebGPU för att köras stabilt, så deras
processorsiffror används aldrig vid en faktisk nedladdning.


### Finska och norska

Också finjusterade modeller. Finska erbjuder Tiny (ca 108 MB), Medium (ca
712 MB) och Large (ca 1,3 GB); norska har egna modeller, bland dem en
ordagrann som skriver det som faktiskt sades i stället för att städa upp det.
Norska Tiny är ca 108 MB, Small 324 MB, Medium 712 MB, Large 1,3 GB och den
ordagranna Large 1,2 GB. Allt över Tiny kräver WebGPU.

### Samiska

Nord-, lule- och sydsamiska har egna finjusterade modeller. De finns bara som
Large (ca 1,2 GB) och kräver därför WebGPU; på en dator utan det går språket
att välja men ingen modell.

### Alla andra språk

Använder OpenAI:s Whisper.

| Modell | Storlek (båda vägarna) | Anmärkning |
| --- | --- | --- |
| Tiny | 96 MB | Snabbast, minst noggrann |
| Small | 299 MB | **Förvald.** En rimlig kompromiss. |
| Large-v3-turbo | 759 MB | Snabb och noggrann. Kräver WebGPU. |
| Large-v3 | 1,2 GB | Långsammare än Turbo, ofta något noggrannare. Kräver WebGPU. |

Tratt förväljer Small. Har din dator WebGPU och kvaliteten i transkriptionen av inspelningen är viktig, byt till
**Large-v3-turbo**.

### Om nedladdningen

Modellen hämtas från `huggingface.co` första gången du använder den och sparas
sedan i webbläsaren, så nästa körning startar direkt. Ditt ljud skickas aldrig
någonstans. Se [Hur Tratt använder internet](privacy.md).

Om nedladdningen avbryts, försök igen. Om den fortsatt misslyckas är det troligt att 
nätverket blockerar `huggingface.co` och automatisk transkription är inte tillgänglig på
din dator där den står just nu. Du kan försöka byta nätverk och så om nedladdningen fungerar bättre då.

---

<a id="speaker-separation"></a>

## Talarseparation

Markerar du **Speaker separation** körs ytterligare en modell som delar upp
inspelningen efter talare och märker varje transkriptionsenhet med ett talar-ID.

- Lämna **Expected number of speakers** tomt så gissar den.
- Fyll i om du vet: `2` för en vanlig intervju. Att ange det verkliga antalet ger
  oftast ett renare resultat än automatisk detektering.

Modellen körs på processorn oavsett WebGPU, så du kommer att få räkna med en längre behandlingstid. Räkna med
märkbart längre bearbetning för en lång inspelning.

Resultatet är en god gissning, men kommer att innehålla fel. Talare som låter lika, prat i mun på
varandra och bakgrundsröster förvirrar den. Du kan justera etiketterna efteråt: se
[Nivåer och talare](tiers-and-speakers.md#fixing-speaker-labels).

---

<a id="translating-the-transcript"></a>

## Översätta transkriptet

Tratt kan också översätta transkriptioner, lokalt, med hjälp av små översättnings-modeller.

**På startsidan.** Så snart det finns ett transkript att arbeta med (antingen ett
du laddat in eller ett som automatisk transkription är på väg att skapa) dyker
rutan **Översätt transkriptionen lokalt** upp. Välj **Från** (ett trettiotal
språk) och **Till**. Listan **Till** erbjuder bara språk som modellerna faktiskt kan översätta till 
från ditt källspråk. Om översättningen går via engelska märks den som *(två steg)*. Tratt
talar sedan om vilken väg som används:

- *Direkt opus-mt-modell*: en modell, rakt från ditt språk till målspråket.
- *Översättning via engelska (två steg)*: ingen direktmodell finns, så den går via
  engelska. Två modeller kommer då att hämtas, ta längre tid att utföra, och kvaliteten blir
  något sämre.
- *Ingen lokal översättningsmodell hittades för detta språkpar*: det finns ingen väg att översätta från ditt källspråk till
   målspråket med hjälp av de små modellerna vi kan använda i Tratt. 

Översättningen körs på din dator och kan ta flera minuter. Står statusindikatorn stilla kan Tratt indikera *Modellinläsningen har fastnat*,
*Översättningen har fastnat, inga framsteg på 60 sekunder*, eller *Nedladdningen
har fastnat, troligen en lagringsgräns i webbläsaren*. Du kan försöka igen
med **Hoppa över webbläsarcache** markerat.

**Under arbetet.** I redigeraren erbjuder nivåmenyn **Add translated tier…**, som
skapar en länkad nivå vars gränser är de samma som källnivån, och
**Translate linked tier**, som fyller i de tomma segmenten med en översättning. Översättningar du har
redigerat för hand skrivs aldrig över. Se
[Nivåer och talare](tiers-and-speakers.md).

**Hoppa över webbläsarcache.** En kryssruta i alternativen. Vissa webbläsare når gränsen för vad som kan lagras 
när stora modeller ska cachas, vilket kan medföra att de fryser. Du kan markera detta alternativ för att lösa detta problem,
och effekten blir då att modellen aldrig lagras utan laddas ner varje session.

---

## När är automatisk transkription inte tillgänglig

**Safari och andra WebKit-webbläsare.** Kryssrutan är inaktiverad med en kort not om varför i dessa webbläsare.
Modellerna som ska laddas ner är stora nog att få Safari att ladda om fliken mitt i nedladdningen,
vilket riskerar att förstöra ditt arbete. Använd i stället Chrome, Edge eller Firefox för automatisk
transkription. Manuell transkribering i Safari påverkas inte på något sätt.

**Ingen WebGPU.** De modeller som kräver WebGPU gråmarkeras med texten
*Kräver WebGPU…* när datorn eller webbläsaren inte har fullt stöd för WebGPU-tillägget. De mindre modellerna kommer dock att fungera
fortfarande, men körs då direkt på datorns huvudprocessor.

**Fel.** Misslyckas transkriptionen medan den körs på WebGPU föreslår
felmeddelandet att du försöker igen utan. Tratt upptäcker WebGPU automatiskt och
har ingen egen omkopplare, så vägen till den långsammare men mer toleranta
processorvägen går genom webbläsarens inställningar (Chrome och Edge: `chrome://flags` →
*WebGPU* → **Disabled**, starta om) och en omladdning av Tratt. Alla modeller körs
då på WASM, och de största blir otillgängliga. Mer under
[Felsökning](troubleshooting.md).
