# Fuentes científicas — Michinautas

Todo dato real del juego viene de una fuente oficial verificable. Los mismos enlaces aparecen dentro del juego en el **Archivo científico**, en cada ficha **¿Sabías qué?** y en la pantalla de fin de misión.

- Auditoría automática de enlaces: `cd juego && npm run check:sources`. Última corrida: 14-11-2026, 24 de 24 enlaces del juego responden 200.
- Auditoría automática de datos: `tests/unit/data.test.ts` comprueba que cada URL sea de un dominio oficial (nasa.gov, esa.int, noaa.gov, caltech.edu, dlr.de), que las llamaradas tengan una clase GOES válida y que caigan dentro de su semana, y que **nada se presente como "en vivo"**.

## 1. Clima espacial: llamaradas reales de las misiones

| Jornada | Semana real | Llamaradas usadas (pico UTC) | Verificación |
|---|---|---|---|
| Huerto lunar | 2–8 dic 2019 (mínimo solar) | ninguna M/X | [NASA: Solar Cycle 25 Is Here](https://www.nasa.gov/news-release/solar-cycle-25-is-here-nasa-noaa-scientists-explain-what-that-means/) |
| Hielo en la Luna | 29 sep – 5 oct 2024 | X7.1 (1 oct 22:20), X9.0 (3 oct 12:18) | [NASA Solar Cycle 25 blog](https://science.nasa.gov/blogs/solar-cycle-25/2024/10/03/sun-releases-strong-solar-flare-6/) |
| (guardada en el archivo; ninguna jornada la usa) | 4–10 sep 2017 | M5.5 (4 sep 20:33, SEP), X2.2 (6 sep 09:10), X9.3 (6 sep 12:02), X1.3 (7 sep 14:36), M8.1 (8 sep 07:49), X8.2 (10 sep 16:06, SEP) | [NASA SVS 12706](https://svs.gsfc.nasa.gov/12706) |
| Energía del Sol | 8–14 may 2024 | X1.0, X2.2, X1.1, X3.9, X5.8 (11 may 01:23), X1.5, X1.0, X8.7 (14 may 16:51) | [NASA Science: tormenta de mayo de 2024](https://science.nasa.gov/science-research/heliophysics/how-nasa-tracked-the-most-intense-solar-storm-in-decades/) |

**Estado honesto de verificación.** El 14-11-2026 la API DONKI (`api.nasa.gov`, DEMO_KEY) devolvió HTTP 429 (límite de consultas) y el espejo CCMC no respondió desde la red del equipo. Segundo intento, el 15-11-2026: `api.nasa.gov/DONKI/FLR` devolvió HTTP 404 (el servicio de origen no respondió) y el espejo CCMC (`kauai.ccmc.gsfc.nasa.gov`) agotó 60 s sin respuesta; el archivo sigue sin contrastar (`verifiedAgainstDonki: false`) y el juego lo dice en pantalla («NASA / NOAA, archivo histórico»). Por eso las horas y clases se tomaron de los reportes públicos de NASA y NOAA enlazados arriba, contrastados entre varias fuentes. Cada semana lleva `verifiedAgainstDonki: false`, y el juego dice "FUENTE: NASA / NOAA · archivo histórico (no en vivo)".
**Para verificar contra DONKI:** `NASA_API_KEY=<clave gratuita de api.nasa.gov> npm run data:donki`. El script reemplaza las llamaradas con los datos exactos de DONKI, marca la semana como verificada y el texto en pantalla pasa a "NASA DONKI".

Notas científicas:
- NOAA recalibró en 2020 el flujo de los satélites GOES anteriores a GOES-16, y con eso las clases antiguas suben (la X8.2 de 2017 queda como ~X11.9). El juego usa la clasificación publicada en su momento, que es la que aparece en las páginas de la NASA citadas.
- Hay pequeñas diferencias de minutos entre fuentes para algunas horas pico (p. ej. X8.2: 16:06 UTC en NASA y ESA, y otra hora en una página de SVS). Se usó la hora con más respaldo.
- Fuente base del clima espacial: [NASA Open APIs (DONKI)](https://api.nasa.gov/) · clases de llamaradas: [NOAA SWPC](https://www.swpc.noaa.gov/phenomena/solar-flares-radio-blackouts).

## 2. Constantes y datos físicos

| Dato | Valor | Dónde se usa | Fuente |
|---|---|---|---|
| Gravedad lunar | 1,62 m/s² | Salto del michi (`sim/physics.ts`) | [NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) |
| Gravedad de Marte | 3,72 m/s² | Archivo científico | [NASA Mars Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) |
| Gravedad terrestre | 9,81 m/s² | Comparación del salto | [NASA Earth Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html) |
| Día lunar (sinódico) | ≈ 29,5 días terrestres | Calendario de 7 jornadas: 3 día, 1 atardecer, 3 noche | [NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) |
| Radiación en la superficie lunar | 1 369 µSv/día (ISS: 731 µSv/día) | Radiación de fondo; refugio | Zhang et al. 2020, *Science Advances* 6: eaaz1334, [doi:10.1126/sciadv.aaz1334](https://doi.org/10.1126/sciadv.aaz1334) · resumen: [DLR](https://www.dlr.de/en/latest/news/2020/03/20200925_how-intense-and-dangerous-is-cosmic-radiation-on-the-moon) |
| Demora Tierra–Luna | ~1,28 s por sentido (384 400 km / c) | Antena y pronóstico responden tras 2,56 s | [NASA: Communicating with Missions](https://www.nasa.gov/communicating-with-missions/) |
| Clases de llamaradas | A·B·C·M·X, cada una 10× la anterior | Dosis por llamarada (`sim/flares.ts`) | [NOAA SWPC](https://www.swpc.noaa.gov/phenomena/solar-flares-radio-blackouts) |

## 3. Vida en el espacio y misiones (Archivo científico)

- OSDR es **solo lectura recomendada**: ningún valor del juego sale de ese repositorio (la ficha del Archivo lo dice así).
- Radiación y blindaje: [NASA Space Radiation](https://www.nasa.gov/humans-in-space/space-radiation/)
- Cuerpo humano en el espacio: [NASA](https://www.nasa.gov/humans-in-space/the-human-body-in-space/) · datos abiertos: [NASA OSDR](https://osdr.nasa.gov/bio/)
- Algas que producen oxígeno: [ESA MELiSSA](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Research/A_decade-long_quest_to_build_an_ecosystem_in_a_room)
- Cultivos en el espacio: [NASA](https://www.nasa.gov/exploration-research-and-technology/growing-plants-in-space/)
- Polvo lunar: [NASA Science](https://science.nasa.gov/moon/moon-dust/)
- Artemis: [NASA](https://www.nasa.gov/humans-in-space/artemis/) · Perseverance: [NASA Science](https://science.nasa.gov/mission/mars-2020-perseverance/) · Webb: [NASA Science](https://science.nasa.gov/mission/webb/) · Voyager: [NASA Science](https://science.nasa.gov/mission/voyager/)
- Puntos de Lagrange: [NASA Science](https://science.nasa.gov/resource/what-is-a-lagrange-point/) · Cinturón de Kuiper: [NASA Science](https://science.nasa.gov/solar-system/kuiper-belt/)
- Exoplanetas: [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) · TRAPPIST-1: [NASA Science](https://science.nasa.gov/exoplanets/trappist1/)
- Efemérides (referencia para futuras misiones orbitales): [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- Biología sintética (taller de «ADN de papel»): [NASA, Space Synthetic Biology (SynBio)](https://www.nasa.gov/space-synthetic-biology-synbio/): BioNutrients, levadura modificada para producir nutrientes a pedido, en la ISS desde 2019 · apoyo: [What is BioNutrients?](https://www.nasa.gov/general/what-is-bionutrients/)
- Biofirma posible (minijuego «Analizar la muestra»): [NASA Science, What is a Potential Biosignature?](https://science.nasa.gov/resource/what-is-a-potential-biosignature/) · apoyo: [NASA/JPL, Will We Know Life When We See It?](https://www.jpl.nasa.gov/news/nasa-asks-will-we-know-life-when-we-see-it/)
- Microbio resistente a la radiación (*Deinococcus radiodurans*, ~500 veces la dosis humana): [NASA Astrobiology, Life in the Extreme: Radiation](https://astrobiology.nasa.gov/news/life-in-the-extreme-radiation/)

## 4. Contexto chileno (fichas «Desde Chile» del Archivo)

Lo ocurrido en Chile no está en sitios de agencias espaciales: estas fichas citan a ESO y, donde no hay fuente oficial, prensa o divulgación con fecha. Las de cooperación Chile–EE. UU. (capa «Laboratorio Chile») citan a la NASA, al Departamento de Estado y a NOIRLab. Los mensajes de la Dra. Almendra que abren cada capítulo son **[RECREACIÓN]**: el personaje es ficticio.

| Dato | Dónde se usa | Fuente |
|---|---|---|
| Paranal a 2 635 m y ALMA a unos 5 000 m, en el desierto de Atacama, uno de los lugares más secos de la Tierra | Ficha «El cielo de Chile» | [ESO, Observatorio Paranal](https://www.eso.org/public/teles-instr/paranal-observatory/) · [ALMA](https://www.almaobservatory.org/en/about-alma/) |
| La NASA alargó la pista de Mataveri (Rapa Nui) como aterrizaje de emergencia del transbordador; se inauguró en agosto de 1987 y nunca se usó para eso | Ficha «Una pista para el transbordador en Rapa Nui» y rótulo de la fase de planeo de «Casa» | [UPI, 17-08-1987](https://www.upi.com/Archives/1987/08/17/Emergency-space-shuttle-landing-strip-opened/9293556171200/) (el sitio bloquea clientes automáticos: revisar a mano) |
| Auroras australes en Punta Arenas el 10 de mayo de 2024, durante la tormenta geomagnética G5 | Ficha «Auroras en el sur de Chile» y descripción de la jornada «Energía del Sol» | [Meganoticias, 10-05-2024](https://www.meganoticias.cl/nacional/447271-tormenta-solar-auroras-australes-boreales-polares-punta-arenas-brk-10-5-2024.html) |
| La güiña (*Leopardus guigna*) es el felino silvestre más pequeño de América; vive en Chile y Argentina | Ficha «La güiña» y tripulante Güiña | [Mongabay, 2018](https://news.mongabay.com/2018/01/smallest-wild-cat-in-the-americas-faces-big-problems-but-hope-exists/) |
| Chile firmó los Acuerdos Artemis el 25 de octubre de 2024 (país n.º 47) | Ficha «Chile y los Acuerdos Artemis», capítulo 4 y cartel del Puente | [NASA, 2024](https://www.nasa.gov/news-release/nasa-welcomes-chile-as-newest-artemis-accords-signatory) |
| La red Minitrack tuvo una estación en Santiago; la NASA la heredó en 1958 | Ficha «Una antena en Chile para seguir satélites», capítulo 2 y cartel de la Esclusa | [NASA, History of the Networks](https://www.nasa.gov/communicating-with-missions/history-of-the-networks/) |
| El Telescopio Cosmológico de Atacama (6 m, Cerro Toco) observó hasta 2022; sus mapas son públicos | Ficha «Un telescopio del desierto, con datos para todos» y capítulo 3 | [NASA LAMBDA](https://lambda.gsfc.nasa.gov/product/act/) |
| ARADS: la NASA probó en Atacama un róver que perfora y busca vida | Ficha «ARADS», capítulo 1 y cartel del Invernadero (Huerto lunar) | [NASA](https://www.nasa.gov/?p=427586) |
| Tras el terremoto de 1960, EE. UU. envió por aire 2 hospitales de campaña y 10 helicópteros | Ficha «Ayuda por aire tras el terremoto de 1960» y cartel de la Enfermería | [Office of the Historian, FRUS 1958–60](https://history.state.gov/historicaldocuments/frus1958-60v05mSupp/ch_d37) |
| Cerro Tololo: elegido en 1962, inaugurado en noviembre de 1967 | Ficha «Cerro Tololo» y cartel de la Esclusa | [NOIRLab, Timeline](https://noirlab.edu/public/about/timeline) |

## 5. Qué es simulado (y se dice en el juego)

- La **escala de recursos** (0–100) y la **dosis de juego** de cada llamarada son simplificaciones. La dosis crece de forma logarítmica con el flujo real de rayos X (`flareDose`) para que una X9 pese más que una M5 sin volverse imposible. La barra de radiación es "% del límite de la misión", no mSv.
- La base **Estación Central** es ficticia (silueta inspirada en Lunar Palace 1, sin nombre ni logos reales).
- 7 jornadas comprimen un día lunar completo; el atardecer y la noche siguen la proporción real.
- **ADN de papel y biofirmas:** los costos de cada pieza (10/15/15 %, «solo cuando detecta» 40 %), el bonus de cosecha (hasta +25 %) y las tres pruebas de biofirma son diseño propio **[MODELO]**; las piezas protectoras se *inspiran* en microbios extremos, las algas del huerto no son esos microbios.
- No se usan logos ni insignias de la NASA (14 CFR 1221). Créditos: "Usa datos e imágenes abiertas de la NASA; la NASA no respalda este proyecto."


## Objetos de la estación (referencias reales de los dibujos)
Los sprites de `herramientas/props_detallados.py` se inspiran en equipo real; son dibujos propios, no copias de imágenes.
- **Reciclador de CO₂:** unidad de remoción de CO₂ de la ISS (lechos de sorbente) y generación de oxígeno por electrólisis. NASA, *Environmental Control and Life Support System (ECLSS)*: https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss
- **Rack de plantas y algas:** Veggie y Advanced Plant Habitat (LED rojos, azules y verdes, "almohadillas" con semillas y depósito de agua). NASA Space Biology: https://science.nasa.gov/biological-physical/programs/space-biology/plant-biology/experiments
- **Cocina de la nave:** galera de la ISS con calentador de comida tipo maletín y estación de rehidratación con agua caliente y fría. NASA OCHMO, *Food and Nutrition*: https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-013-food-and-nutrition.pdf
- **Limpieza de polvo:** escudo electrodinámico de polvo (EDS) y "Moon duster". NASA: https://science.nasa.gov/technology/technology-highlights/new-moon-duster-will-help-clean-nasa-assets-in-space
- **Taladro y hielo:** taladro TRIDENT de PRIME-1 y VIPER. NASA PRIME-1: https://www.nasa.gov/?p=558300
- **Enfermería:** equipo de salud de la tripulación de la ISS (CHeCS: monitor, botiquín, sujeción). NASA ISS guide (2008).
- **Clima espacial:** clases de llamaradas C, M y X del GOES (NOAA SWPC).


## Misión «Casa» y minijuegos nuevos (referencias; marcar `[verificar]` antes de mostrarlas en pantalla)
- **Giro de 360° (R-bar Pitch Maneuver):** NASA JSC-63400 (rendezvous del transbordador), tras el Columbia: giro a 0,75 °/s con fotografía del vientre desde la ISS. Se usa como Fase 1 de «Casa»; el reingreso real es otra cosa. **[REAL]**
- **Reingreso, calor y planeo:** interfaz de entrada, ángulo de ataque, duración del apagón de plasma y velocidad de aterrizaje del transbordador son aproximaciones **[verificar]**; el modelo de «Casa» es educativo **[MODELO]**. Fuente a revisar: informe CAIB en nasa.gov.
- **Electrólisis y energía por noche lunar:** H₂O → 2 H₂ + O₂ (relación 2:1) y noche lunar de ~14 días terrestres **[REAL]**.
- **Tamaños y avisos de clima espacial:** Miteva et al. y Buzulukova y Tsurutani (tiempos de llamaradas, partículas y eyecciones de masa coronal; caso Carrington ~17 h 40 min) **[REAL]**; no se muestran en pantalla todavía.
- **Biofirmas:** los orgánicos solos no prueban vida; se necesitan varias pruebas independientes **[MODELO]**.
- **Opportunity (2018):** la tormenta de polvo bloqueó la luz solar; no afirmar que "cubrió los paneles" **[verificar]**.


## Imágenes del Archivo científico

Las fotos del Archivo están en `juego/public/game/archive/` (reducidas a 960 px). Las de la NASA son de dominio público; se cita a la NASA y al centro o fotógrafo. Las de Chile son de Wikimedia Commons con licencia libre y se muestra el autor y la licencia dentro del juego.

| Ficha | Imagen | Crédito | Licencia | Enlace |
|---|---|---|---|---|
| algae-oxygen | Photobioreactor | NASA / JSC · Nick Hague | NASA (dominio público) | [original](https://images.nasa.gov/details/iss059e114346) |
| artemis | Artemis I FD 17 Orion and a Crescent Moon | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/Artemis%20I%20FD%2017%20Orion%20and%20a%20Crescent%20Moon) |
| body-in-space | Kuipers exercises on the ARED in the Node 3 | NASA / JSC · Andre Kuipers | NASA (dominio público) | [original](https://images.nasa.gov/details/iss030e148403) |
| chile-auroras | Aurora Australis on Puerto Williams, Chile | Mat Austro | CC BY 4.0 | [original](https://commons.wikimedia.org/wiki/File:Aurora_Australis_on_Puerto_Williams,_Chile.jpg) |
| chile-sky | Paranal and the Pacific at sunset (dsc4088, retouched, cropped) | ESO/G. Hüdepohl (atacamaphoto.com) | CC BY 4.0 | [original](https://commons.wikimedia.org/wiki/File:Paranal_and_the_Pacific_at_sunset_(dsc4088,_retouched,_cropped).jpg) |
| chile-sky-alma | ALMA antennas on Chajnantor | ESO/B. Tafreshi (twanight.org) | CC BY 4.0 | [original](https://commons.wikimedia.org/wiki/File:ALMA_antennas_on_Chajnantor.jpg) |
| comm-delay | A New Antenna for NASA's Deep Space Network | NASA/JPL-Caltech | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA25136) |
| donki | CME Blow Out | NASA / GSFC | NASA (dominio público) | [original](https://images.nasa.gov/details/cme-blow-out_18529951894_o) |
| exoplanets | Kepler-90 System Compared to Our Solar System (Artist's Concept) | NASA/Ames Research Center/Wendy Stenzel | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA22193) |
| flare-classes | Two X Flares in Quick Succession | NASA / GSFC | NASA (dominio público) | [original](https://images.nasa.gov/details/GSFC_20171208_Archive_e001050) |
| guina | Leopardus guigna | Mauro Tammone | CC BY 3.0 | [original](https://commons.wikimedia.org/wiki/File:Leopardus_guigna.jpeg) |
| kuiper | New Horizons Encountering 2014 MU69 (Artist's Impression) | NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute/Steve Gribben | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA22190) |
| lagrange | From a Million Miles Away, NASA Camera Shows Moon Crossing Face of Ear | NASA / GSFC · NOAA | NASA (dominio público) | [original](https://images.nasa.gov/details/from-a-million-miles-away-nasa-camera-shows-moon-crossing-face-of-earth_20129140980_o) |
| lunar-day | Panoramic view of Station 5 (Camelot Crater) during Apollo 17 EVA-2 | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/as17-145-22183) |
| mars-gravity | Curiosity Low-Angle Self-Portrait at Buckskin Drilling Site on Mount S | NASA/JPL-Caltech/MSSS | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA19807) |
| mataveri | Chile-03721 - Mataveri International Airport (49073235787) | Dennis G. Jarvis | CC BY-SA 2.0 | [original](https://commons.wikimedia.org/wiki/File:Chile-03721_-_Mataveri_International_Airport_(49073235787).jpg) |
| may-2024 | MAVEN Detects Auroras During Solar Storm in 2024 | NASA/University of Colorado/LASP | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA26304) |
| moon-dust | Astronaut Eugene Cernan inside the lunar module on lunar surface after | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/AS17-145-22224) |
| moon-gravity | Astronaut John Young leaps from lunar surface to salute flag | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/as16-113-18339) |
| moon-radiation | Astronaut Alan Bean deploys Lunar Surface Magnetometer on lunar surfac | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/as12-46-6813) |
| oct-2024 | Giant Sunspot Erupts on October 24, 2014 | NASA / GSFC | NASA (dominio público) | [original](https://images.nasa.gov/details/GSFC_20171208_Archive_e000920) |
| osdr | Astronaut Nick Hague works on space biology research | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/iss072e146315) |
| perseverance | Perseverance's Selfie with Ingenuity | NASA/JPL-Caltech/MSSS | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA24542) |
| plants-space | Veggie Ponds experiment Initiation | NASA / JSC · David Saint-Jacques | NASA (dominio público) | [original](https://images.nasa.gov/details/iss059e035668) |
| sep-2017 | Major Solar Flare | NASA/GSFC/Solar Dynamics Observatory | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA21949) |
| solar-min | Spotless Sun | NASA / JPL | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA21582) |
| trappist | Illustration of TRAPPIST-1 Planets as of Feb. 2018 | NASA/JPL-Caltech | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA22097) |
| voyager | Artist Concept of Voyager | NASA/JPL | NASA (dominio público) | [original](https://images.nasa.gov/details/PIA04495) |
| water-shield | Personal Radiation Shielding Garment | NASA / JSC | NASA (dominio público) | [original](https://images.nasa.gov/details/iss053e238888) |
| webb | James Webb Space Telescope Revealed | NASA / GSFC | NASA (dominio público) | [original](https://images.nasa.gov/details/GSFC_20171208_Archive_e000355) |

## Guías de Control Tierra y cepas
- **[PROPUESTA]** Las cepas Brisa, Escudo y Polar, sus rasgos y la voz de «Control Tierra» son diseño del juego. Los costos y puntajes del Taller de ADN son un **[MODELO]**: un diseño malo solo rinde menos, nunca causa un desastre.
- **[REAL]** Una cepa es una variante de un microbio con rasgos propios (concepto de microbiología).
- **[REAL]** Levadura modificada para producir nutrientes a pedido, probada por la NASA en la Estación Espacial Internacional (ver «Archivo científico»).
- **[REAL]** Primer laboratorio chileno en la ISS (2026): fuentes oficiales y código del proyecto (ATE220057) en la sección de la misión chilena de este archivo, si ya está integrada.
- **[REAL]** Los orgánicos solos no prueban vida; se necesitan varias pruebas independientes (guía de biofirmas).
- El parpadeo de luz (1–2 s) de la guía de biología es un recurso narrativo, no un dato científico; se omite en modo calmado.
