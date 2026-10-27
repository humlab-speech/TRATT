# Vyerna

**För:** dig som ska bestämma hur du vill arbeta, eller undrar varför skärmen ser
annorlunda ut än hos en kollega.

Tratt erbjuder flera vyer över *samma* transkript. Att byta mellan dem ändrar
inte dina data. Du kan flytta mellan dem mitt i en fil, hur ofta du
vill, med knapparna till vänster i den övre listen.

Standardvyn använder **2D Vy**.

---

## 2D Vy

I den här vyn ritas inspelningen som en vågform uppdelad på rader (som text som
radbryts), med varje transkriptionsenhet skuggad och sin text tryckt under.

![2D Vy](../../assets/visp_tratt_2d_editor.png)

**Använd den när** du behöver se och ändra var enheter börjar och slutar, vilket
är det mesta av tiden.

- Hovra över en enhet och tryck **Enter** för att öppna
  **transkriptionsfönstret** för den.
- **S**, **A**, **D** och dra-markering sköter gränser direkt på vågformen
  ([Så fungerar transkribering](transcribing.md#boundaries)).
- **Sekunder per rad** i Inställningarna styr hur mycket ljud varje rad rymmer.
- Slå på **Visa förstoringsglas** för en förstorad remsa runt markören när du
  behöver placera en gräns exakt.

### Transkriptionsfönstret

Rutan du får med **Enter**. Den visar en enhet: dess vågform med återkoppling om vad som spelas, en spelare,
markörraden och ett textfält.

![Transkriptionsfönstret över 2D Vy](../../assets/visp_tratt_popup_editor_audio_only.png)

- **Tabb** / **Esc** spelar, pausar och stoppar. Att spela enheten i ungefär 0,2 s
  markerar den som [verifierad](checking-your-work.md#verified-transcriptions).
- **Alt + ←** och **Alt + →** sparar och stegar till föregående eller nästa
  enhet, snabbaste vägen genom en fil.
- **Alt + ↓** sparar och stänger.
- **Ctrl/Cmd + S** växlar talaretiketten.
- Har du läst in en videofil i ett format som webbläsaren kan spela upp direkt
  (MP4, WebM) visas videon ovanpå vågformen.

---

## Diktafon-vy

En spelare och ett enda textfält. Den visar ingen vågform och inga gränser.

![Diktafon-vyn](../../assets/visp_tratt_dictaphone_editor.png)

**Använd den när** inspelningen är kort, eller när gränserna redan är rätt och du
bara vill skriva. Den kan också vara den mildaste starten för någon som aldrig använt
ett annoteringsverktyg.

Uppspelningstangenterna är desamma som i de andra vyerna: **Tabb** spela/pausa, **Esc** stoppa,
**Skift + Backsteg** tillbaka till senaste startläge, **Skift + Tabb** stega
tillbaka i tid.

---

## Linjär vy

Det här är två staplade signalvisningar. Den övre visar hela inspelningen, och en
förstorad vy av det aktuella läget visas under.

![Linjär vy](../../assets/visp_tratt_linear_editor.png)

**Använd den när** du behöver fin kontroll över gränslägen men vill se en
överblick över filen som helhet.

De två visningarna har egna uppspelningstangenter, eftersom du oftast arbetar i
den ena medan du lyssnar på den andra:

| | Övre (överblick) | Nedre (förstorad) |
| --- | --- | --- |
| Spela / pausa | **Tabb** | **Skift + Blanksteg** |
| Stoppa | **Esc** | **Esc** |
| Tillbaka till senaste läge | **Skift + Backsteg** | **Skift + Enter** |
| Stega tillbaka i tid | **Skift + Tabb** | **Skift + \*** |

Gränstangenterna (**S**, **A**, **C**, **D**, **Enter**) verkar på den visning
musen befinner sig över.

---

Vill du ha en tabellvy över ditt transkript, använd
[Översikt](checking-your-work.md) (**Alt + 0**), som listar varje enhet och låter
dig redigera och spela rader på plats.
