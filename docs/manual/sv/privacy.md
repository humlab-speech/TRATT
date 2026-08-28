# Vad lämnar din dator

**För:** dig som hanterar intervjuer, kliniska inspelningar eller annat där
"vart tog ljudet vägen?" är en fråga du måste kunna besvara.

**Kort svar:** din inspelning och ditt transkript lämnar aldrig webbläsaren. Det
enda TRATT hämtar åt dig är själva applikationen och, om du slår på det, en
tal- eller översättningsmodell.

---

## Vad som stannar lokalt

| | Var det finns |
| --- | --- |
| Ljud- eller videofilen du laddar in | Endast i webbläsarflikens minne. Den läses från disk, avkodas och kastas när du stänger fliken. Den laddas aldrig upp och skrivs aldrig tillbaka till disk av TRATT. |
| Transkriptet du skapar | I webbläsarens egen databas (IndexedDB) på din dator. |
| Dina inställningar, gränssnittsspråk och loggade åtgärder | Samma lokala databas. |
| Utkastet från automatisk transkription | Skapas på din dator, av en modell som körs i din webbläsare. |

Eftersom ljudet bara hålls i minnet kan TRATT erbjuda sig att minnas ditt
transkript mellan sessioner, men inte din inspelning. När du kommer tillbaka drar
du in samma fil igen så väntar texten.

## Vad som hämtas över nätet

**1. Själva applikationen.** När sidan laddas hämtas TRATT:s egna filer från den
server som är värd för den. TRATT installerar en service worker, så efter första
lyckade laddningen körs appen från webbläsarens cache: du kan gå helt offline
och fortsätta transkribera. Webbläsaren hämtar en ny version när en sådan
publiceras; TRATT visar en avisering om uppdatering i stället för att ladda om
under fötterna på dig.

**2. Tal- och översättningsmodeller, bara om du ber om dem.** Att markera
**Automatisk transkribering med Whisper**, **Speaker separation** eller
**Översätt transkriptionen lokalt** laddar ned den valda modellen från
`huggingface.co` (mellan ungefär 100 MB och 3 GB beroende på modell). Modellen
sparas sedan i webbläsaren och återanvänds.

Ditt ljud skickas **inte** till Hugging Face eller någon annanstans. Trafiken går
åt ett håll: modellen kommer ned, inspelningen stannar.

Kan din dator eller ditt nätverk inte nå `huggingface.co` är automatisk
transkription helt enkelt inte tillgänglig; allt annat i TRATT fungerar ändå.

## Det enda undantaget

TRATT ärver OCTRA:s **molnbaserade taligenkänning och ordanpassning**: tangenterna
`R`, `M` och `W` i signalvisningen, och panelen **ASR Options** i Inställningar.
Den funktionen *skickar* ljudet från en transkriptionsenhet till en extern
taltjänst (BAS-webbtjänsterna vid LMU München), och kräver att du autentiserar
dig först.

Den fungerar bara om en administratör har konfigurerat en leverantör i
applikationens konfigurationsfil. **Standardinstallationen av TRATT konfigurerar
ingen**, så panelen ASR Options saknas helt och tangenterna gör ingenting.

Skulle din installation ändå lista leverantörer där ska du behandla funktionen
som en uppladdning: använd den inte på känsliga inspelningar. Allt under
[Automatisk utkasttranskription](automatic-transcription.md) är det lokala
alternativet och berörs inte.

## Rensa dina data

Öppna den dolda underhållssidan genom att lägga till `/help-tools` i TRATT:s
adress (till exempel `http://localhost:5321/help-tools`) och använd **Clear all
Storage Data**. Den tar bort lagrat transkript, loggar och inställningar från den
här webbläsaren permanent. Gör det på en delad dator när du är klar, efter att
du har exporterat ditt arbete. Samma sida kan också ta en zip-säkerhetskopia av
dina lokala TRATT-data och återställa en; se
[Felsökning](troubleshooting.md#the-maintenance-page).

Webbläsare rensar också IndexedDB när du rensar webbplatsdata, använder ett
privat fönster som du sedan stänger, eller kör städverktyg. Betrakta kopian i
webbläsaren som en arbetsbekvämlighet, inte som ditt arkiv:
[exportera en fil](exporting.md) varje gång du slutar.
