# Att transkribera för ett Visp-projekt

**För:** dig som öppnar Tratt från ett projekt i Visp för att transkribera de
inspelningspaket som projektägaren har tilldelat dig.

Öppnad från Visp är Tratt [Arbetsbänken](workbench.md) med en skillnad som
påverkar allt annat: listan till vänster är din tilldelning i projektet, de
inspelningspaket som tilldelats dig i Visp:s dialog **Assign annotation tasks**.
Du lägger inte till inspelningar själv, och ditt arbete sparas i projektet i
stället för i filer på din dator.

När du öppnar Tratt frågar Visp vilken av projektets annoteringsnivåer du vill
transkribera i. Bara segmentnivåer som inte är länkade till andra nivåer kan
väljas; för att arbeta i en annan nivå öppnar du Tratt från Visp igen.

---

## Det här skiljer sig från den fristående Arbetsbänken

| | Fristående Arbetsbänk | Öppnad från Visp |
| --- | --- | --- |
| Listan | Filerna du lägger till | Din tilldelning i projektet |
| Ljudet | Kopplas av dig, igen efter omladdning | Hämtas från Visp när det behövs |
| Ditt transkript | Sparas i webbläsaren, exporteras som filer | Sparas i projektet medan du arbetar |
| Lägga till och ta bort | Släppa, spela in, läsa in `.zip`, **Ta bort** | Finns inte: listan är din tilldelning |
| Nivåer | Alla du skapar | Bara annoteringsnivån du valde när du öppnade Tratt |

Själva transkriberandet är detsamma: redigerarna, kortkommandona och markörerna
är de som beskrivs i resten av manualen.

---

## Listan

Rubriken lyder **Tilldelade inspelningspaket**. Varje inspelningspakets rad har
en liten pratbubbleknapp. Den öppnar:

- **Klar**, som talar om för projektägaren att du är färdig med det;
- **Kommentar**, en anteckning till projektägaren.

Bubblan är ifylld när inspelningspaketet har en kommentar och visar en bock när
det är markerat som klart. **Klar** och **Kommentar** är det projektägaren ser i
Visp. Sparar du dem sparas inspelningspaketet, transkriptet också.

Välj ett inspelningspaket för att öppna det. Ett inspelningspaket som har text i
Visp visar **Har text** redan innan du öppnat det; ett utan text visar
**Ej transkriberad**.

---

## Att spara

Tratt sparar ditt arbete i projektet av sig självt: ett par sekunder efter att du
slutat skriva, när du väljer ett annat inspelningspaket och när du lämnar eller
döljer fliken med Tratt. Det finns ingen sparaknapp, och listan är tyst medan
det sparas.

Ett inspelningspaket säger bara till när det inte gick att spara: det visar vad
som gick fel och erbjuder **Försök igen**. Medan Visp inte kan nås, eller du är
utloggad, försöker Tratt också igen av sig självt, och direkt när du kommer
tillbaka till Tratt-fliken.

Tills det har sparats finns ändringarna kvar i den här webbläsaren. Laddar du om
Tratt, eller stänger och öppnar det igen från Visp, försvinner de inte, och de
sparas när Tratt är öppet igen. De finns bara på den här datorn och i den här
webbläsaren.

> **Observera.** Rensar du webbläsarens webbplatsdata för Tratt försvinner
> osparade ändringar. Det som sparats till Visp påverkas inte.

---

## Det här skriver Tratt till projektet

Bara transkriptet, i annoteringsnivån du valde när du öppnade Tratt
(*transkriptionsnivån* nedan). Alla andra nivåer (till
exempel en fonetisk segmentering gjord i Artic) och länkarna mellan dem lämnas
precis som de var. Inom transkriptionsnivån gäller:

- ett segment som är markerat som paus sparas som ett tomt segment;
- talarnamn från talaruppdelningen sparas bara om projektet har en plats för
  dem. Fråga projektägaren om du behöver dem.

---

## När någon annan ändrat under tiden

Om inspelningspaketet sparades i Visp, i Artic eller i en annan flik medan du
arbetade med det, skriver Tratt inte över det. Inspelningspaketet säger:

> *Inspelningspaketet ändrades i Visp eller i en annan flik medan du arbetade med
> det. Dina ändringar finns kvar i den här webbläsaren. Behåll din version (bara
> transkriptet ersätts) eller använd versionen i Visp och släpp dina ändringar.*

- **Behåll min version** sparar ditt transkript. Den andras ändringar i andra
  nivåer finns kvar; ändringar i transkriptet ersätts av dina.
- **Använd versionen i Visp** släpper dina ändringar och visar det som finns i
  Visp nu.

Tratt kontrollerar detta när du sparar, inte hela tiden. Två personer som
transkriberar samma inspelningspaket samtidigt måste fortfarande välja vems
transkript som ska gälla.

---

## När tilldelningen ändras

Tratt läser din tilldelning när det öppnas. Tilldelar projektägaren eller tar
bort inspelningspaket medan Tratt är öppet, öppnar du Tratt från Visp igen för att
se ändringen. Ett inspelningspaket som inte längre är tilldelat dig kan inte
längre sparas till Visp: sparandet misslyckas och dina ändringar finns kvar i den
här webbläsaren. Ladda ner transkriptet om du behöver det.

Har du exporterat en uppsättning inspelningar kan den däremot inte längre sparas
tillbaka till projektet. Använd **Exportera…** bara om du behöver behålla ett
arkiv av texten.

---

## Automatisk transkription

**Transkribera** erbjuder bara de inspelningspaket som saknar text i Visp, så
den transkriberar aldrig över arbete som redan finns i projektet. Resultatet
hamnar i transkriptionsnivån och sparas som allt du skriver. Inställningarna beskrivs i
[Automatisk transkription](automatic-transcription.md).

---

## När något går fel

| Det här säger Tratt | Gör så här |
| --- | --- |
| *Du är inte längre inloggad i Visp. Dina ändringar finns kvar i den här webbläsaren: logga in igen i Visp så sparar Tratt dem.* | Logga in i Visp igen, i en annan flik eller på Visp-sidan runt Tratt. Tratt sparar när du kommer tillbaka till den, och försöker igen under tiden; du behöver inte ladda om. |
| *Du är inte medlem i det här projektet. Be projektägaren lägga till dig.* | Fråga projektägaren. |
| *Annoteringsnivån som Tratt öppnades med är inte en segmentnivå i projektet, så Tratt kan inte öppna dess inspelningspaket. Öppna Tratt från Visp igen och välj en annan nivå.* | Nivån togs bort eller ändrades i Visp efter att du öppnade Tratt. Öppna Tratt från Visp igen. |
| *Annoteringsnivån som Tratt öppnades med är länkad till andra nivåer, så Tratt kan inte redigera den säkert. Öppna Tratt från Visp igen och välj en annan nivå.* | Nivån länkades i Visp efter att du öppnade Tratt. Öppna Tratt från Visp igen. |
| *Visp kan inte nås. Dina ändringar finns kvar i den här webbläsaren; försök igen om en stund.* | Vänta: Tratt försöker igen av sig självt. **Försök igen** vid inspelningspaketet försöker direkt. |
| *This Tratt installation is not configured for Visp.* | Visas i stället för Arbetsbänken (meddelandet är ännu inte översatt). Säg till den som driver Visp. |
