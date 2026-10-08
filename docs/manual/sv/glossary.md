# Ordlista

TRATT:s ordförråd kommer från fonetik och talforskning. Den här sidan översätter
det till vanligt språk. Där gränssnittet fortfarande visar engelska anges den
engelska texten inom parentes.

| TRATT säger | Vilket betyder |
| --- | --- |
| **Transkriptionsenhet** | Ett stycke av inspelningen med egen text, ungefär ett yttrande eller en undertextrad. Andra verktyg kallar det ett *segment*. Det är dessa Översikt räknar. |
| **Segment** | Samma sak. Orden används omväxlande i gränssnittet. |
| **Yttrande** | Också samma sak. Det är kolumnrubriken i Översikt. |
| **Gräns** (*boundary*) | Skiljelinjen mellan två transkriptionsenheter. Att lägga till en delar en enhet; att ta bort en slår ihop två. |
| **Paus** (`<P>`, knappen *Break*) | En enhet som inte innehåller tal. Att markera tystnad uttryckligen är hur TRATT skiljer "inget sades här" från "inte klart ännu". |
| **Beskärningsmärke** (*Crop mark*) | En gräns som infogas inifrån textfältet (**Alt + S**), och som delar enheten vid det aktuella uppspelningsläget. |
| **Nivå** / **tier** | Ett lager av annotering över inspelningen: en följd av transkriptionsenheter. Ett transkript kan ha flera: en översättning, en per talare. *Nivå* är gränssnittets ord; *tier* används i de nyare funktionerna. |
| **Länkad nivå** (*linked tier*) | En nivå vars gränser hålls i takt med en annan nivås. Översättningsnivåer fungerar så. |
| **Talaretikett** | Ett namn kopplat till en transkriptionsenhet som säger vem som talar. Visas som en färgad bricka. |
| **Markör** | En symbol som står för något som inte är ord: en paus, ett ljud, ett oförståeligt parti. |
| **Riktlinjer** | Projektets transkriptionskonventioner: stavnings- och skiljeteckensregler, och vad varje markör betyder. **Alt + 9**. |
| **Annotering** | Hela transkriptet: alla nivåer, enheter, text, markörer och talare. Det AnnotJSON lagrar. |
| **AnnotJSON** | TRATT:s eget filformat. Den enda exporten som bevarar allt. |
| **Diarisering** / **talarseparation** | Att räkna ut vem som talade när, utan att veta vem någon är. |
| **Whisper** | Familjen av taligenkänningsmodeller som TRATT kör lokalt. **KB-Whisper** är den svenskoptimerade varianten från Kungliga biblioteket. |
| **WebGPU** | En webbläsarfunktion som låter modeller använda ditt grafikkort. Om den finns avgör vilka modeller du kan köra och hur snabbt. |
| **WASM** | WebAssembly, reservvägen som kör modeller på processorn. Långsammare, fungerar överallt. |
| **Lokalt läge** | Att arbeta med dina egna filer i din egen webbläsare, utan server. Så används TRATT normalt. |
| **Onlineläge** | OCTRA:s serverstödda läge, där ett projekt tilldelar dig filer. Inte aktiverat i standardinstallationen av TRATT. |
| **Förstoringsglas** | Den förstorade remsan av vågform runt markören, för att placera gränser exakt. |
| **Uppspelningspekare** | Linjen som visar var uppspelningen befinner sig. *Följ uppspelningspekare* håller den i bild. |
| **Enkelt läge** | En inställning som tar bort knapptexter och tangentbordstips för ett kompakt gränssnitt. |
| **Arbetsbänken** (*Workbench*) | Sidan `/workbench`: en lista med många inspelningar och en transkriptionskö. En förhandsversion som inte finns i varje bygge. Se [Arbetsbänken](workbench.md). |
| **Bundle** | En inspelning i Arbetsbänkens lista tillsammans med sin transkription. Ordet dyker upp i några meddelanden och i sökvägarna i exporterade arkiv. |
| **Pipeline** | Det som körs på en inspelning automatiskt: taligenkänning, och valfritt talarseparation och översättning. Arbetsbänkens **Pipelineinställningar** är samma kontroller som startsidans. |
| **Kö** | Ordningen Arbetsbänken arbetar sig genom inspelningarna i. En i taget. |
| **Arkiv** | En `.zip` skriven av **Exportera alla**, med varje inspelnings ljud och transkription plus de format du markerat. Den enda exporten som kan läsas in igen i sin helhet. |
| **Katalogexport** | Dialogen som skriver det arkivet. |
| **Manifest** | `manifest.json` och `manifest.csv` i arkivets rot: en rad per inspelning, med sökvägar och uppgifter. |
| **Arbetsminne** | Avkodat ljud som hålls i webbläsarfliken. Arbetsbänken mäter det, eftersom det, och inte disklagringen, begränsar hur många inspelningar du kan ha bifogade samtidigt. |
| **OCTRA** | Ursprungsprojektet som TRATT är avgrenat från, vid LMU München. |
