# Vyerna

**För:** dig som ska bestämma hur du vill arbeta, eller undrar varför skärmen ser
annorlunda ut än hos en kollega.

TRATT erbjuder flera vyer över *samma* transkript. Att byta mellan dem ändrar
ingenting annat än din vy — du kan flytta mellan dem mitt i en fil, hur ofta du
vill, med knapparna till vänster i den övre listen.

Standard är **2D Vy**.

---

## 2D Vy

Arbetshästen. Inspelningen ritas som en vågform uppdelad på rader — som text som
radbryts — med varje transkriptionsenhet skuggad och sin text tryckt under.

![2D Vy med transkriptionsfönstret öppet](../../assets/visp_tratt_popup_editor_audio_only.png)

**Använd den när** du behöver se och ändra var enheter börjar och slutar, vilket
är det mesta av tiden.

- Hovra över en enhet och tryck **Enter** för att öppna
  **transkriptionsfönstret** för den.
- **S**, **A**, **D** och dra-markering sköter gränser direkt på vågformen
  ([Så fungerar transkribering](transcribing.md#boundaries)).
- **Sekunder per rad** i Inställningar styr hur mycket ljud varje rad rymmer.
- Slå på **Visa förstoringsglas** för en förstorad remsa runt markören när du
  behöver placera en gräns exakt.

### Transkriptionsfönstret

Rutan du får med **Enter**. Den visar en enhet: dess egen vågform, en spelare,
markörraden och ett textfält.

- **Tabb** / **Esc** spelar, pausar och stoppar.
- **Alt + ←** och **Alt + →** sparar och stegar till föregående eller nästa
  enhet — snabbaste vägen genom en fil.
- **Alt + ↓** sparar och stänger.
- **Ctrl/Cmd + S** växlar talaretiketten.
- Är din mediefil ett format som webbläsaren kan spela upp direkt (MP4, WebM)
  visas videon bredvid vågformen.

---

## Diktafon-vy

En spelare och ett enda textfält. Ingen vågform, inga gränser.

**Använd den när** inspelningen är kort, eller när gränserna redan är rätt och du
bara vill skriva. Den är också den mildaste starten för någon som aldrig använt
ett annoteringsverktyg.

Uppspelningstangenterna är desamma överallt: **Tabb** spela/pausa, **Esc** stoppa,
**Skift + Backsteg** tillbaka till senaste startläge, **Skift + Tabb** stega
tillbaka i tid.

---

## Linjär vy

Två signalvisningar staplade: hela inspelningen överst, och en förstorad vy av det
aktuella läget under.

**Använd den när** du behöver fin kontroll över gränslägen men samtidigt vill
behålla överblicken över filen som helhet.

De två visningarna har egna uppspelningstangenter, eftersom du oftast arbetar i
den ena medan du lyssnar på den andra:

| | Övre (överblick) | Nedre (lupp) |
| --- | --- | --- |
| Spela / pausa | **Tabb** | **Skift + Blanksteg** |
| Stoppa | **Esc** | **Esc** |
| Tillbaka till senaste läge | **Skift + Backsteg** | **Skift + Enter** |
| Stega tillbaka i tid | **Skift + Tabb** | **Skift + \*** |

Gränstangenterna (**S**, **A**, **C**, **D**, **Enter**) verkar på den visning
musen befinner sig över.

---

<a id="trn-editor--experimental"></a>

## TRN-Editor — experimentell

En tabellvy över hela transkriptet, med operationer per talare (slå ihop segment
med samma talaretikett, ersätta permutationer).

**Du kommer inte att se den.** Standardkonfigurationen i TRATT erbjuder bara de
tre vyerna ovan, och TRN-Editor är ändå inte färdig — dess tangentbordsgenvägar
är inte inkopplade och att öppna ett segment gör ingenting. Den beskrivs här bara
så att du vet vad namnet syftar på om du möter det i koden eller i
OCTRA-manualen.

Vill du ha en tabellvy över ditt transkript som *fungerar*, använd
[Översikt](checking-your-work.md) (**Alt + 0**), som listar varje enhet och låter
dig redigera och spela rader på plats.
