# Kontrollera ditt arbete

**För:** dig som transkriberar, vid den punkt där filen är "i princip klar".

---

## Översiktsfönstret

Tryck **Alt + 0**, eller klicka **Översikt** i verktygsraden under den övre
listen.

![Översiktsfönstret](../../assets/visp_tratt_overview_edit.png)

Det har tre delar.

### Statistik

| Kolumn | Betyder |
| --- | --- |
| **Totalt transkriptionsenheter** | Hur många enheter den aktuella nivån har |
| **Transkriberade enheter** | Enheter med text i sig |
| **Tysta transkriptionsenheter** | Enheter markerade som paus (`<P>`) |
| **Tomma transkriptionsenheter** | Enheter med varken text eller paus — ditt återstående arbete |

Sikta på **Tomma transkriptionsenheter = 0** innan du exporterar. Är siffran inte
noll, klicka på den: TRATT markerar vad som saknas.

### Validering

Namnger projektets riktlinjefil ett valideringsskript listar det här avsnittet
varje nivå med sitt antal fel — normalt *Inga fel hittade* — och den felande
texten stryks under i redigeraren. Är ingen validering konfigurerad står det
i stället *No validation methods found*. Båda är normalt; standardriktlinjerna i
TRATT innehåller bara stavnings- och skiljeteckensregler, så i praktiken säger det
här avsnittet sällan något.

### Transkript

Varje enhet som en tabellrad: nummer, text, talare (när transkriptet har talare)
och en knapp **Play segment**. ▶ i kolumnrubriken är **Toggle play all**, som
spelar enheterna i följd.

Tabellen går att redigera. Klicka på en rad så öppnas textfältet på plats,
komplett med markörraden — för en sista genomläsning är det ofta snabbare än att
stega genom vågformen, eftersom du kan läsa sammanhängande och bara stanna där
något ser fel ut. Klicka ▶ på den misstänkta raden, rätta, gå vidare.

---

## Riktlinjer

**Alt + 9**, eller **Riktlinjer** i verktygsraden, öppnar
transkriptionskonventionerna för projektet: stavnings- och skiljeteckensregler,
och betydelsen av varje markör med exempel.

TRATT:s standardriktlinjer är medvetet tunna — korrekt stavning, inga
skiljetecken — eftersom de är tänkta att ersättas. Har ditt projekt egna
konventioner hör de hemma i riktlinjefilen, så att de är ett tangenttryck bort för
alla som arbetar med materialet, i stället för i ett dokument som ingen öppnar.

---

## En checklista för sista genomgången

1. **Alt + 0** → *Tomma transkriptionsenheter* är 0.
2. Skumma transkripttabellen uppifrån och ned. Siffror, namn och platser är där
   automatisk transkription är svagast — kontrollera dem särskilt mot ljudet.
3. Använde du talarseparation, kontrollera talarkolumnen där samtalets tempo
   ändras; det är där modellen brukar byta för sent eller för tidigt.
4. Kontrollera att oklara partier är markerade (`**`) i stället för gissade.
5. [Exportera](exporting.md) — och exportera **AnnotJSON** vid sidan av ditt
   arbetsformat, så att en senare rättelse inte betyder att börja om.
