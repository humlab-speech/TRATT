# Att transkribera för ett VISP-projekt

**För:** dig som öppnar Tratt från ett projekt i VISP för att transkribera de
inspelningspaket som projektägaren har tilldelat dig.

Öppnad från VISP är Tratt [Arbetsbänken](workbench.md) med en skillnad som
påverkar allt annat: listan till vänster är din tilldelning i projektet, de
inspelningspaket som tilldelats dig i VISP:s dialog **Assign annotation tasks**.
Du lägger inte till inspelningar själv, och ditt arbete sparas i projektet i
stället för i filer på din dator.

---

## Det här skiljer sig från den fristående Arbetsbänken

| | Fristående Arbetsbänk | Öppnad från VISP |
| --- | --- | --- |
| Listan | Filerna du lägger till | Din tilldelning i projektet |
| Ljudet | Kopplas av dig, igen efter omladdning | Hämtas från VISP när det behövs |
| Ditt transkript | Sparas i webbläsaren, exporteras som filer | Sparas i projektet med **Spara till VISP** |
| Lägga till och ta bort | Släppa, spela in, läsa in `.zip`, **Ta bort** | Finns inte; **Uppdatera** läser tilldelningen igen |
| Nivåer | Alla du skapar | Bara projektets transkriptionsnivå |

Själva transkriberandet är detsamma: redigerarna, kortkommandona och markörerna
är de som beskrivs i resten av manualen.

---

## Listan

Rubriken lyder **Tilldelade inspelningspaket**, med **Uppdatera** bredvid. Under
varje inspelningspakets namn finns:

- dess läge: **Sparad**, **Osparade ändringar**, **Sparar…** eller **Inte sparad**;
- **Spara till VISP**, som skriver transkriptet till projektet;
- **Klar**, som talar om för projektägaren att du är färdig med det;
- **Kommentar**, en anteckning till projektägaren.

**Klar** och **Kommentar** är det projektägaren ser i VISP. Ändrar du någon av
dem sparas inspelningspaketet, transkriptet också.

Välj ett inspelningspaket för att öppna det. Ett inspelningspaket som har text i
VISP visar **Har text** redan innan du öppnat det; ett utan text visar
**Ej transkriberad**.

---

## Att spara

Ditt arbete sparas i projektet på två sätt:

- med **Spara till VISP** i listan, när du vill;
- automatiskt, när du väljer ett annat inspelningspaket medan det du lämnar har
  **Osparade ändringar**.

Fram till dess finns ändringarna kvar i den här webbläsaren. Laddar du om Tratt,
eller stänger och öppnar det igen från VISP, försvinner de inte:
inspelningspaketet kommer tillbaka med **Osparade ändringar**. De finns bara på
den här datorn och i den här webbläsaren, så spara innan du byter dator.

> **Observera.** Rensar du webbläsarens webbplatsdata för Tratt försvinner
> osparade ändringar. Det som sparats till VISP påverkas inte.

---

## Det här skriver Tratt till projektet

Bara transkriptet, i projektets transkriptionsnivå. Alla andra nivåer (till
exempel en fonetisk segmentering gjord i Artic) och länkarna mellan dem lämnas
precis som de var. Inom transkriptionsnivån gäller:

- ett segment som är markerat som paus sparas som ett tomt segment;
- talarnamn från talaruppdelningen sparas bara om projektet har en plats för
  dem. Fråga projektägaren om du behöver dem.

---

## När någon annan ändrat under tiden

Om inspelningspaketet sparades i VISP, i Artic eller i en annan flik medan du
arbetade med det, skriver Tratt inte över det. Inspelningspaketet säger:

> *Inspelningspaketet ändrades i VISP eller i en annan flik medan du arbetade med
> det. Dina ändringar finns kvar i den här webbläsaren. Behåll din version (bara
> transkriptet ersätts) eller använd versionen i VISP och släpp dina ändringar.*

- **Behåll min version** sparar ditt transkript. Den andras ändringar i andra
  nivåer finns kvar; ändringar i transkriptet ersätts av dina.
- **Använd versionen i VISP** släpper dina ändringar och visar det som finns i
  VISP nu.

Tratt kontrollerar detta när du sparar, inte hela tiden. Två personer som
transkriberar samma inspelningspaket samtidigt måste fortfarande välja vems
transkript som ska gälla.

---

## När tilldelningen ändras

**Uppdatera** läser din tilldelning igen. Nytilldelade inspelningspaket dyker upp
i listan. Inspelningspaket som inte längre är tilldelade dig försvinner, utom ett
med osparade ändringar, som blir kvar med:

> *Inte längre tilldelat dig. Dina osparade ändringar finns kvar här tills du tar
> bort inspelningspaketet; ladda ner transkriptet först om du behöver det.*

Det kan inte längre sparas till projektet. Använd **Ladda ned transkriptionen** om du
vill behålla texten och sedan **Ta bort**.

---

## Automatisk transkription

**Transkribera** erbjuder bara de inspelningspaket som saknar text i VISP, så
den transkriberar aldrig över arbete som redan finns i projektet. Resultatet
hamnar i transkriptionsnivån och sparas som allt du skriver: det visar
**Osparade ändringar** tills du sparar. Inställningarna beskrivs i
[Automatisk transkription](automatic-transcription.md).

---

## När något går fel

| Det här säger Tratt | Gör så här |
| --- | --- |
| *Du är inte längre inloggad i VISP. Logga in igen i VISP och ladda om TRATT.* | Dina ändringar finns kvar. Logga in i VISP i en annan flik och ladda sedan om Tratt. |
| *Du är inte medlem i det här projektet. Be projektägaren lägga till dig.* | Fråga projektägaren. |
| *Projektet saknar transkriptionsnivå, så TRATT kan inte öppna dess inspelningspaket. Be projektägaren lägga till en i VISP.* | Listan visar din tilldelning med namn, men inget kan öppnas förrän projektet har en transkriptionsnivå. |
| *Transkriptionsnivån är länkad till andra nivåer, så TRATT kan inte redigera den säkert. Be projektägaren ta bort länkarna.* | Fråga projektägaren. |
| *VISP kan inte nås. Dina ändringar finns kvar i den här webbläsaren; försök igen om en stund.* | Vänta och tryck sedan på **Spara till VISP** eller **Uppdatera** igen. |
| *This TRATT installation is not configured for VISP.* | Visas i stället för Arbetsbänken (meddelandet är ännu inte översatt). Säg till den som driver VISP. |
