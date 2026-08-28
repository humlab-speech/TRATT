# Automatisk utkasttranskription

**För:** dig som hellre rättar ett utkast än skriver från ingenting.

TRATT kan köra en taligenkänningsmodell **på din egen dator, inne i
webbläsarfliken**, och öppna resultatet i redigeraren så att du kan rätta det.
Den kan också gissa vem som talade när, och översätta det färdiga transkriptet.

Ett utkast är ett utkast. Räkna med att rätta namn, siffror, överlappande tal och
allt som sagts tyst eller vid sidan av mikrofonen. Du sparar skrivandet, inte
lyssnandet.

---

## Slå på det

Ladda in mediefilen först — alternativen dyker upp först när TRATT har ljud och
du **inte** har lämnat in en egen transkriptfil.

Under släppytan markerar du **Automatisk transkribering med Whisper** och ställer
sedan in:

1. **Transkriptionsspråk** — det språk som faktiskt talas på inspelningen. Ett
   hundratal språk erbjuds, listade med sina egna namn (*Svenska (Swedish, sv)*,
   *Suomi (Finnish, fi)*), med svenska först och resten i bokstavsordning. TRATT
   förvaljer det språk gränssnittet är inställt på, så byt om inspelningen är på
   något annat. Detta är inte en översättningsinställning.
2. **Modell** — se tabellerna nedan.
3. **Speaker separation** (talarseparation, valfritt) — se
   [Talarseparation](#speaker-separation).

Klicka sedan **Starta ny transkription**. Du ser i tur och ordning:
modellnedladdningen med förloppsfält, *Transkriberar ljud…* med förfluten tid och
ett förloppsfält mot inspelningens längd, sedan *Identifierar talare…* om du bad
om det, och till sist *Transkription klar — förbereder redigerare…*.

**Avbryt** stoppar och lämnar dig kvar på startsidan.

### Håll fliken öppen

Arbetet sker i den här fliken. Stäng den inte, och var försiktig med att låta
datorn somna vid långa inspelningar. Att byta till en annan flik går bra;
transkriptionen fortsätter, även om vissa webbläsare bromsar bakgrundsflikar.

---

## Vilken modell ska man välja

Modellistan ändras med språket du valt, eftersom TRATT levererar specialiserade
modeller för de nordiska språken.

**Om din dator har WebGPU** (aktuell Chrome, Edge eller Firefox med ett hyggligt
grafikkort) är alla modeller tillgängliga och de större är mycket snabbare.
**Utan WebGPU** körs modellerna på processorn i stället: de största inaktiveras,
och resten är långsamma men användbara. TRATT talar om vilket läge du är i under
modellistan.

### Svenska

Använder **KB-Whisper** från Kungliga biblioteket, tränad på svenskt tal. Märkbart
bättre än den allmänna modellen för svenska.

| Modell | Ungefär | Anmärkning |
| --- | --- | --- |
| Tiny | 120 MB | Snabbast, minst noggrann. Bra för att kontrollera att kedjan fungerar. |
| Small | 400 MB | Rimlig kompromiss |
| Medium | 650 MB | Märkt *Vår jämförelsemodell*. Kräver WebGPU. |
| Large | 1,2 GB | Mest noggrann, ungefär halva hastigheten mot Medium. Kräver WebGPU. |

> Modellnamnen i det svenska gränssnittet är delvis felöversatta — flera visas som
> "Liten" oavsett storlek. Gå efter storleken i MB, som stämmer.

### Finska och norska

Också finjusterade modeller. Finska erbjuder Tiny / Medium / Large; norska (både
bokmål och nynorsk) erbjuder Tiny / Small / Medium / Large. Medium är märkt som
referensmodell i båda. Medium och Large kräver WebGPU. Beskrivningarna av dessa
modeller visas på engelska även i det svenska gränssnittet.

### Alla andra språk

Använder OpenAI:s Whisper.

| Modell | Ungefär | Anmärkning |
| --- | --- | --- |
| Tiny | 95 MB | Snabbast, minst noggrann |
| Small | 290 MB | **Förvald.** En rimlig kompromiss. |
| Large v3 Turbo | 700 MB | Märkt *vår valda referensmodell* — snabb och noggrann. Kräver WebGPU. |
| Large v3 | 3,1 GB | Långsammare än Turbo, ofta något noggrannare. Kräver WebGPU. |

TRATT förväljer Small här, inte referensmodellen — har din dator WebGPU och
inspelningen är viktig, byt till **Large v3 Turbo**.

### Om nedladdningen

Modellen hämtas från `huggingface.co` första gången du använder den och sparas
sedan i webbläsaren, så nästa körning startar direkt. Ditt ljud skickas aldrig
någonstans — se [Vad lämnar din dator](privacy.md).

Avbryts nedladdningen, försök igen; fortsätter den att misslyckas blockerar
nätverket `huggingface.co` och automatisk transkription är inte tillgänglig på
den datorn.

---

<a id="speaker-separation"></a>

## Talarseparation

Markerar du **Speaker separation** körs ytterligare en modell som delar upp
inspelningen efter talare och märker varje transkriptionsenhet med ett talar-ID.

- Lämna **Expected number of speakers** tomt så gissar den.
- Fyll i om du vet: `2` för en vanlig intervju. Att ange det verkliga antalet ger
  oftast ett renare resultat än automatisk detektering.

Modellen körs på processorn oavsett WebGPU, så den lägger till tid — räkna med
märkbart längre bearbetning för en lång inspelning.

Resultatet är en utgångspunkt, inte ett fynd. Talare som låter lika, prat i mun på
varandra och bakgrundsröster förvirrar den. Du kan rätta etiketterna efteråt: se
[Nivåer och talare](tiers-and-speakers.md#fixing-speaker-labels).

---

<a id="translating-the-transcript"></a>

## Översätta transkriptet

TRATT kan också översätta, lokalt, med Opus-MT-modeller.

**På startsidan.** Så snart det finns ett transkript att arbeta med — antingen ett
du laddat in eller ett som automatisk transkription är på väg att skapa — dyker
rutan **Översätt transkriptionen lokalt** upp. Välj **Från** (ett trettiotal
språk) och **Till**. Listan **Till** erbjuder bara språk som faktiskt går att nå
från din källa, och märker vägar som måste gå via engelska med *(två steg)*. TRATT
talar sedan om vilken väg som används:

- *Direkt opus-mt-modell* — en modell, ett steg.
- *Pivot via engelska (två opus-mt-modeller)* — ingen direktmodell finns, så det
  går via engelska. Långsammare, och kvaliteten blir något sämre.
- *Ingen lokal översättningsmodell hittades för detta språkpar* — det paret är
  inte möjligt.

Översättningen körs på din dator och kan ta flera minuter.

**Under arbetet.** I redigeraren erbjuder nivåmenyn **Add translated tier…**, som
skapar en länkad nivå vars gränser hålls i takt med källnivån, och
**Translate linked tier**, som fyller i de tomma segmenten. Översättningar du har
redigerat för hand skrivs aldrig över. Se
[Nivåer och talare](tiers-and-speakers.md).

**Hoppa över webbläsarcache.** En kryssruta i alternativen. Vissa webbläsare slår
i lagringskvoten när stora modeller ska cachas och fryser. Markeringen förbigår
cachen: modellen laddas ned varje gång, men frysningen försvinner. Använd den bara
om du drabbas av problemet.

---

## När det inte är tillgängligt

**Safari och andra WebKit-webbläsare.** Kryssrutan är inaktiverad med en varning.
Modellerna är stora nog att få Safari att ladda om fliken mitt i nedladdningen,
vilket förstör ditt arbete. Använd Chrome, Edge eller Firefox för automatisk
transkription. Manuell transkribering i Safari påverkas inte.

**Ingen WebGPU.** Modellerna Medium och Large gråmarkeras med texten
*Kräver WebGPU…*. De mindre modellerna fungerar fortfarande.

**Fel.** Misslyckas transkriptionen medan den körs på WebGPU föreslår
felmeddelandet att du försöker igen utan. TRATT upptäcker WebGPU automatiskt och
har ingen egen omkopplare, så vägen till den långsammare men mer toleranta
processorvägen går genom webbläsaren (Chrome och Edge: `chrome://flags` →
*WebGPU* → **Disabled**, starta om) och en omladdning av TRATT. Alla modeller körs
då på WASM, och de största blir otillgängliga. Mer under
[Felsökning](troubleshooting.md).
