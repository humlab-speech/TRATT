# Ordlista

TRATT:s ordförråd kommer från fonetik och talforskning. Den här sidan översätter
det till vanligt språk. Där gränssnittet fortfarande visar engelska anges den
engelska texten inom parentes.

| TRATT säger | Vilket betyder |
| --- | --- |
| **Transkriptionsenhet** | Ett stycke av inspelningen med egen text — ungefär ett yttrande, eller en undertextrad. Andra verktyg kallar det ett *segment*. Det är dessa Översikt räknar. |
| **Segment** | Samma sak. Orden används omväxlande i gränssnittet. |
| **Yttrande** | Också samma sak. Det är kolumnrubriken i Översikt. |
| **Gräns** (*boundary*) | Skiljelinjen mellan två transkriptionsenheter. Att lägga till en delar en enhet; att ta bort en slår ihop två. |
| **Paus** (`<P>`, knappen *Break*) | En enhet som inte innehåller tal. Att markera tystnad uttryckligen är hur TRATT skiljer "inget sades här" från "inte klart ännu". |
| **Beskärningsmärke** (*Crop mark*) | En gräns som infogas inifrån textfältet (**Alt + S**), och som delar enheten vid det aktuella uppspelningsläget. |
| **Nivå** / **tier** | Ett lager av annotering över inspelningen: en följd av transkriptionsenheter. Ett transkript kan ha flera — en översättning, en per talare. *Nivå* är gränssnittets ord; *tier* används i de nyare funktionerna. |
| **Länkad nivå** (*linked tier*) | En nivå vars gränser hålls i takt med en annan nivås. Översättningsnivåer fungerar så. |
| **Talaretikett** | Ett namn kopplat till en transkriptionsenhet som säger vem som talar. Visas som en färgad bricka. |
| **Markör** | En symbol som står för något som inte är ord: en paus, ett ljud, ett oförståeligt parti. |
| **Riktlinjer** | Projektets transkriptionskonventioner — stavnings- och skiljeteckensregler, och vad varje markör betyder. **Alt + 9**. |
| **Annotering** | Hela transkriptet: alla nivåer, enheter, text, markörer och talare. Det AnnotJSON lagrar. |
| **AnnotJSON** | TRATT:s eget filformat. Den enda exporten som bevarar allt. |
| **ASR** | *Automatic Speech Recognition* — en modell som gör tal till text. |
| **Diarisering** / **talarseparation** | Att räkna ut vem som talade när, utan att veta vem någon är. |
| **Whisper** | Familjen av taligenkänningsmodeller som TRATT kör lokalt. **KB-Whisper** är den svenskoptimerade varianten från Kungliga biblioteket. |
| **WebGPU** | En webbläsarfunktion som låter modeller använda ditt grafikkort. Om den finns avgör vilka modeller du kan köra och hur snabbt. |
| **WASM** | WebAssembly — reservvägen som kör modeller på processorn. Långsammare, fungerar överallt. |
| **Lokalt läge** | Att arbeta med dina egna filer i din egen webbläsare, utan server. Så används TRATT normalt. |
| **Onlineläge** | OCTRA:s serverstödda läge, där ett projekt tilldelar dig filer. Inte aktiverat i standardinstallationen av TRATT. |
| **MAUS** | En tvångsanpassningstjänst från LMU München som anpassar text till ljud på ordnivå. Kräver en konfigurerad leverantör och autentisering; normalt inaktiv i TRATT. |
| **Förstoringsglas** | Den förstorade remsan av vågform runt markören, för att placera gränser exakt. |
| **Uppspelningspekare** | Linjen som visar var uppspelningen befinner sig. *Följ uppspelningspekare* håller den i bild. |
| **Enkelt läge** | En inställning som tar bort knapptexter och tangentbordstips för ett kompakt gränssnitt. |
| **OCTRA** | Ursprungsprojektet som TRATT är avgrenat från, vid LMU München. |
