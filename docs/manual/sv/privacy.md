# Hur Tratt använder internet

**Viktig information för:** dig som hanterar intervjuer, kliniska inspelningar eller annat där det
finns integritetsfrågor eller andra hänsyn att ta kring inspelningen.

**I korthet:** Tratt använder internet för att hämta *sig själv* och, om du ber om
automatisk transkription, en språkmodell. Den skickar inte din inspelning eller
din transkription någonstans. Undantaget är när du arbetar mot ett
[Visp-projekt](visp-projects.md), där det är nödvändigt att transkriptionen
skickas tillbaka till Visp-servern.

---

<a id="every-connection"></a>

## Varje uppkoppling Tratt gör

| Vad | När | Vart | Vad som färdas |
| --- | --- | --- | --- |
| **Appens egna filer** | Vid första laddningen, och igen när en ny version publiceras | Servern som är värd för Tratt | Ingenting av ditt |
| **En tal-, talarseparations- eller översättningsmodell** | Första gången den modellen körs | `huggingface.co` | Ingenting av ditt. Innan en översättningsmodell laddas ned frågar Tratt först om språkparet finns över huvud taget. |
| **Ett underhållsmeddelande** | Vid start | Servern som är värd för Tratt | Ingenting av ditt |
| **Ditt material** | Bara i ett [Visp-projekt](visp-projects.md) | Det projektets server | Transkriptionen du arbetar med, och det projektet ber dig skicka |

## Vad som aldrig lämnar din dator

- **Inspelningen.** Den läses från disk in i flikens minne, avkodas och kastas
  när du stänger fliken. Tratt laddar inte upp den någonstans eller skriver den
  till disk.
- **Transkriptionen**, utanför ett Visp-projekt. Den ligger i den här
  webbläsarens lagring så att du kan återvända till den.
- **Dina inställningar**, inklusive valet av ljust eller mörkt läge (**Växla
  mellan ljust och mörkt läge** i sidhuvudet, sparat under `tratt.theme`).

## Att arbeta offline

Tratt installerar en service worker, så efter första lyckade laddningen körs
appen från webbläsarens cache. När du har laddat ned de modeller du tänker
använda kan du koppla ned dig helt och fortsätta transkribera. Ingenting i
redigeringen, exporten eller lagringen behöver nätet.

Kan din dator eller ditt nätverk inte nå `huggingface.co` är automatisk
transkription och översättning helt enkelt inte tillgängliga. Allt annat i Tratt
fungerar ändå, inklusive att transkribera för hand och varje exportformat.

---

## Var dina data ligger i stället

| | Var det finns |
| --- | --- |
| Ljud- eller videofilen du arbetar med | Endast i webbläsarflikens minne |
| Utkastet från en modell | I den här webbläsarens lagring på din dator |
| Transkriptionen du redigerar | I den här webbläsarens lagring på din dator |
| Dina inställningar och färgtemat | I den här webbläsarens lagring på din dator |

Eftersom ljudet bara hålls i minnet minns Tratt din transkription mellan
sessioner men inte din inspelning. När du kommer tillbaka bifogar du samma
mediefil igen och fortsätter.

**Förlita dig inte för tungt på Tratts lagring.** Webbläsarlagring är en
bekvämlighet och ett litet extra skyddsnät, men
inte ett arkiv. Gör det till en vana att [exportera](exporting.md) efter en
session.

## Rensa dina data

**Radera all data permanent**, längst ned i **Lagring och minne** i listan, är
den korta vägen. Tratt frågar först — *Radera alla transkriptioner, loggar och
inställningar i den här webbläsaren? Detta går inte att ångra.* — och vid **Ja**
töms den här webbläsarens lagring och Tratt laddas om, så att du står på den
tomma startsidan utan att något är kvar. Exportera ditt arbete innan du gör detta:
se [Arkivet, och hur du tar vid där du slutade](exporting.md#exporting-an-archive).

Gör det på en delad dator när du är klar.

Den dolda underhållssidan gör samma sak och lite till: lägg till `/help-tools` i
Tratt:s adress (till exempel
`https://tratt.visp.humlab.umu.se/help-tools`) och använd **Clear all Storage
Data**. Den sidan kan också ta en zip-säkerhetskopia av dina lokala Tratt-data
och återställa en; se [Felsökning](troubleshooting.md#the-maintenance-page).

Webbläsare rensar också IndexedDB när du rensar webbplatsdata, använder ett
privat fönster som du sedan stänger, eller kör städverktyg. Betrakta kopian i
webbläsaren som en arbetsbekvämlighet, inte som ditt arkiv:
[exportera en fil](exporting.md) varje gång du slutar.
