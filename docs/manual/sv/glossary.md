# Ordlista

Tratt:s ordförråd kommer från fonetik och talforskning. Den här sidan översätter
det till vanligt språk. Där gränssnittet fortfarande visar engelska anges den
engelska texten inom parentes.

| Tratt säger | Vilket betyder |
| --- | --- |
| **Transkriptionsenhet** | Ett stycke av inspelningen med egen text, ungefär ett yttrande eller en undertextrad. Andra verktyg kallar det ett *segment*. Det är dessa Översikt räknar. |
| **Segment** | Samma sak. Orden används omväxlande i gränssnittet. |
| **Yttrande** | Också samma sak. Det är kolumnrubriken i Översikt. |
| **Verifierad** / **overifierad** | Om en människa har kontrollerat en transkription: genom att lyssna på dess del av inspelningen eller redigera texten. Visas som ett grönt (verifierad) eller orange (overifierad) `|`-streck i Översikt och i Word-exporter. Se [Verifierade transkriptioner](checking-your-work.md#verified-transcriptions). |
| **Not-check-märke** (`⍻`) | Symbolen som läggs efter overifierad text i tidsanpassade exporter (SRT, ELAN med flera), så att statusen överlever en ny inläsning. |
| **Gräns** (*boundary*) | Skiljelinjen mellan två transkriptionsenheter. Att lägga till en delar en enhet; att ta bort en slår ihop två. |
| **Paus** (`<P>`, knappen *Break*) | En enhet som inte innehåller tal. Att markera tystnad uttryckligen är hur Tratt skiljer "inget sades här" från "inte klart ännu". |
| **Beskärningsmärke** (*Crop mark*) | En gräns som infogas inifrån textfältet (**Alt + S**), och som delar enheten vid det aktuella uppspelningsläget. |
| **Nivå** / **tier** | Ett lager av annotering över inspelningen: en följd av transkriptionsenheter. Ett transkript kan ha flera: en översättning, en per talare. *Nivå* är gränssnittets ord; *tier* används i de nyare funktionerna. |
| **Länkad nivå** (*linked tier*) | En nivå vars gränser hålls i takt med en annan nivås. Översättningsnivåer fungerar så. |
| **Talaretikett** | Ett namn kopplat till en transkriptionsenhet som säger vem som talar. Visas som en färgad bricka. |
| **Markör** | En symbol som står för något som inte är ord: en paus, ett ljud, ett oförståeligt parti. |
| **Riktlinjer** | Projektets transkriptionskonventioner: stavnings- och skiljeteckensregler, och vad varje markör betyder. **Alt + 9**. |
| **Annotering** | Hela transkriptet: alla nivåer, enheter, text, markörer och talare. Det AnnotJSON lagrar. |
| **AnnotJSON** | Tratt:s eget filformat. Den enda exporten som bevarar allt. |
| **Diarisering** / **talarseparation** | Att räkna ut vem som talade när, utan att veta vem någon är. |
| **Whisper** | Familjen av taligenkänningsmodeller som Tratt kör lokalt. **KB-Whisper** är den svenskoptimerade varianten från Kungliga biblioteket. |
| **WebGPU** | En webbläsarfunktion som låter modeller använda ditt grafikkort. Om den finns avgör vilka modeller du kan köra och hur snabbt. |
| **WASM** | WebAssembly, reservvägen som kör modeller på processorn. Långsammare, fungerar överallt. |
| **Lokalt läge** | Att arbeta med dina egna filer i din egen webbläsare, utan server. Så används Tratt normalt. |
| **Onlineläge** | Ett serverstött läge, där ett projekt tilldelar dig filer. I Tratt betyder det ett [Visp-projekt](visp-projects.md); den vanliga lokala Tratt kör det inte. |
| **Förstoringsglas** | Den förstorade remsan av vågform runt markören, för att placera gränser exakt. |
| **Uppspelningspekare** | Linjen som visar var uppspelningen befinner sig. *Följ uppspelningspekare* håller den i bild. |
| **Enkelt läge** | En inställning som tar bort knapptexter och tangentbordstips för ett kompakt gränssnitt. |
| **Arbetsbänken** (*Workbench*) | Själva arbetsytan: listan med inspelningspaket till vänster och redigeraren bredvid, med en transkriptionskö. Det är ingen egen sida, utan hur Tratt ser ut så fort en inspelning är inne. Se [Arbeta med flera inspelningar](workbench.md). |
| **Bundle** | En inspelning i Arbetsbänkens lista tillsammans med sin transkription. Ordet dyker upp i några meddelanden och i sökvägarna i exporterade arkiv. |
| **Pipeline** | Det som körs på en inspelning automatiskt: taligenkänning, och valfritt talarseparation och översättning. **Transkriptionsinställningar** är där du ändrar det. |
| **Kö** | Ordningen Arbetsbänken arbetar sig genom inspelningarna i. En i taget. |
| **Arkiv** | Den `.zip` en export ger när den har mer än en fil: varje inspelningspakets transkription i Tratts eget format, de format du markerat, och ljudet om du tog med det. Den enda exporten som kan läsas in igen i sin helhet. |
| **Manifest** | `manifest.json` och `manifest.csv` i arkivets rot: en rad per inspelning, med sökvägar och uppgifter. |
| **Arbetsminne** | Avkodat ljud som hålls i webbläsarfliken. Arbetsbänken mäter det, eftersom det, och inte disklagringen, begränsar hur många inspelningar du kan ha bifogade samtidigt. |
| **OCTRA** | Ursprungsprojektet som Tratt är avgrenat från, vid LMU München. |
