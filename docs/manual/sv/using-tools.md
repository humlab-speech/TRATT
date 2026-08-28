# Verktyg

**För:** dig som har ett bestämt mekaniskt arbete att göra — forma om enheter,
klippa ljudet i bitar, eller skapa en tabell av egen design.

> **Om tillgänglighet.** Dialogen **Verktyg**, som beskrivs i de två första
> avsnitten nedan (*Kombinera transkriptionsenheter* och *Klipp ljudfil*), finns i
> TRATT men går i den här versionen **inte att nå från någon knapp i
> gränssnittet**. Tabellkonfiguratorn i det tredje avsnittet *går* att nå — den
> ligger inne i exportdialogen. Behöver du de två första, hör av dig till den som
> förvaltar din installation.

---

<a id="tratt-combine-units"></a>

## Kombinera transkriptionsenheter

**Problemet det löser.** Automatisk transkription — och särskilt segmentering på
ordnivå — brukar producera långt fler enheter än en människa vill arbeta med: en
per ord, eller en per kort fras, delade vid varje liten paus. Att stega genom dem
en i taget är olidligt.

**Vad det gör.** Enheter vars innehåll är tystnad kortare än ett tröskelvärde slås
ihop med sina grannar, så att korta fraser åtskilda av ett andetag blir en enhet.

**Inställningar**

| Inställning | Betydelse |
| --- | --- |
| **Minimal längd på tystnad** | Tystnader *längre* än detta lämnas i fred som verkliga gränser. Kortare tystnader behandlas som skarvar. |
| **Maximalt antal ord** | Efter sammanslagningen överskrider ingen enhet så här många ord. `0` betyder ingen gräns. Detta fungerar bara ordentligt när indata har ett ord per enhet. |

**Innan du kör det.** Ordgränsen beter sig bara som beskrivet på en
ordsegmenterad annotering. Och även om operationen går att ångra med
**Ctrl + Z** / **Cmd + Z** rör den hela nivån på en gång — exportera en
AnnotJSON-kopia först om transkriptet betyder något.

---

<a id="cutting-audio-files"></a>

## Klippa ljudfilen

**Problemet det löser.** Du behöver varje yttrande som en egen ljudfil — för ett
perceptionsexperiment, för en korpus, för att dela enskilda klipp utan resten av
intervjun.

**Vad det gör.** Skriver en ljudfil per transkriptionsenhet, plus valfria
annoteringsfiler vid sidan av, och ger dig samlingen som en nedladdning.

**Allt konverteras till WAVE PCM 16-bitars mono** i inspelningens samplingsfrekvens.
Det är förlustfritt i förhållande till vad TRATT avkodade, men det är inte en kopia
av din ursprungliga kodning.

**Inställningar**

- **Namngivningskonvention** — bygg utdatafilernas namn genom att dra de delar du
  vill ha (ursprungligt filnamn, enhetsnummer, enhetens text, tidsstämplar) i den
  ordning du vill ha dem. Minst en varierande del måste ingå, annars skulle alla
  filer få samma namn.
- **Lägg till metafiler** — skriv också en annoteringsfil per klipp, i de format
  du markerar.

Att klippa en lång inspelning tar en stund och visar ett förloppsfält; du kan
avbryta halvvägs.

---

<a id="table-configurator"></a>

## Tabellkonfiguratorn — egen tabellexport

**Var den finns:** öppna **Exportera transkriptioner** och titta under
**Egna format** längst ned i dialogen.

**Problemet den löser.** Inget av de inbyggda formaten har precis de kolumner ditt
analysskript vill ha.

**Vad den gör.** Du bygger en tabell kolumn för kolumn, ser en förhandsvisning i
realtid och laddar ned den.

**Tillgängliga kolumner**

| Kolumn | Innehåll |
| --- | --- |
| Radnummer | En löpande räknare |
| Enhetens start | När enheten börjar |
| Enhetens slut | När den slutar |
| Enhetens längd | Hur länge den varar |
| Transkript | Texten |
| Nivå | Nivåns namn |
| Samplingsfrekvens | Inspelningens samplingsfrekvens |

**Alternativ**

- **Tidsformat** — *Timestamp* (`01:30:02.234`), *Seconds* eller *Samples*. Välj
  Samples om du ska lägga tabellen mot signalen i ett annat verktyg; välj Seconds
  för statistik.
- **Avgränsare** — tabb, semikolon eller komma.
- **Filändelse** — `.csv`, `.txt`, `.table` eller `.tsv`.
- **Lägg till rubrik till tabellen** — en rubrikrad med dina kolumnnamn.
- **inkludera radnummer**.

Kolumnrubrikerna går att redigera — skriv in de rubriknamn ditt analysskript
förväntar sig — och kolumner kan dras i annan ordning.

---

## Se även

- Vanliga exportformat: [Exportera](exporting.md)
- Att slå ihop turer av samma talare (en annan operation, i TRN-Editor):
  [Vyerna](the-editors.md#trn-editor--experimental)
