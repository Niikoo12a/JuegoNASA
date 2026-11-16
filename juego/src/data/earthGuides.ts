/** Línea de una guía: quién habla (TIERRA con retrato de antena; NARRA = narrador sin retrato), texto ES/EN y nota de honestidad opcional. */
export interface ScriptLine { who: 'TIERRA' | 'NARRA'; es: string; en: string; note?: { es: string; en: string }; fx?: 'dim' | 'whisper'; }
type Who = ScriptLine['who'];
/**
 * Guías de «Control Tierra» (ES/EN): una breve transmisión antes de cada minijuego que explica qué se hace y por qué ayuda a la misión.
 * Se muestran una vez por sesión (y se pueden saltar). Voz anónima de un equipo de Chile y EE. UU.; no se nombran instituciones.
 * Etiquetas: [REAL] dato verificable · [PROPUESTA] diseño del juego · [MODELO] simplificación. Fuentes: SOURCES.md, «Guías de Control Tierra».
 */
export type GuideKey = 'bio' | 'cosecha' | 'algas' | 'antena' | 'pedal' | 'curar' | 'biofirmas' | 'hielo' | 'panel' | 'polvo' | 'sellar';

const L = (who: Who, es: string, en: string, extra: Partial<ScriptLine> = {}): ScriptLine => ({ who, es, en, ...extra });
const T = (es: string, en: string, extra: Partial<ScriptLine> = {}): ScriptLine => L('TIERRA', es, en, extra);

export const GUIDES: Record<GuideKey, ScriptLine[]> = {
  bio: [
    T('Control Tierra a base lunar. Hoy les toca biología, y les va a gustar.', "Earth Control to lunar base. Today it's biology, and you'll like it."),
    T('Una cepa es como una «raza» de un microbio: la misma especie, pero cada cepa aguanta cosas distintas. Unas, el frío; otras, la radiación.', "A strain is like a 'breed' of microbe: the same species, but each strain handles different things. Some handle cold; others, radiation.", { note: { es: '[REAL] Una cepa es una variante de un microbio con rasgos propios. [PROPUESTA] Las cepas Brisa, Escudo y Polar son inventadas para el juego.', en: '[REAL] A strain is a variant of a microbe with its own traits. [PROPOSAL] The Brisa, Escudo and Polar strains are made up for the game.' } }),
    T('La biología sintética le suma a esa cepa un circuito de «papel»: un sensor que nota un problema, una función que responde y un interruptor que decide cuándo.', "Synthetic biology adds a 'paper' circuit to that strain: a sensor that notices a problem, a function that responds and a switch that decides when."),
    T('Piensen en un termostato con ojos: detecta, responde y se apaga cuando ya no hace falta, para no gastar energía.', 'Think of a thermostat with eyes: it detects, responds and switches off when it is no longer needed, so it does not waste energy.'),
    T('¿Y para qué sirve en la Luna? Mandar cada kilo desde la Tierra sale carísimo. Un microbio que fabrique su propio aire, comida o protección ahorra viajes.', 'And what is it for on the Moon? Sending every kilo from Earth costs a fortune. A microbe that makes its own air, food or protection saves trips.', { note: { es: '[REAL] Desde 2019 la NASA prueba en la Estación Espacial Internacional levadura modificada para producir nutrientes a pedido. Ver el Archivo científico.', en: '[REAL] Since 2019 NASA has tested modified yeast on the International Space Station to make nutrients on demand. See the Science Archive.' } }),
    T('Por eso se prueba en el espacio: la radiación y la microgravedad cambian cómo se portan los microbios. Chile ya mandó su primer laboratorio a la Estación Espacial.', 'That is why it is tested in space: radiation and microgravity change how microbes behave. Chile has already sent its first laboratory to the Space Station.', { note: { es: '[REAL] Primer laboratorio chileno en la Estación Espacial Internacional (2026): microorganismos extremófilos, ADN sintético y materiales, en microgravedad y radiación.', en: "[REAL] Chile's first laboratory on the International Space Station (2026): extremophile microorganisms, synthetic DNA and materials, in microgravity and radiation." } }),
    T('Su misión: elijan la cepa y armen el circuito que resuelve el problema de hoy. Mejor diseño, mejor cosecha para toda la tripulación.', "Your mission: pick the strain and build the circuit that solves today's problem. Better design, better harvest for the whole crew.", { note: { es: '[MODELO] Los costos y puntajes del Taller son del juego, no mediciones. Un diseño malo solo rinde menos: nunca causa un desastre.', en: '[MODEL] The Workshop costs and scores belong to the game, not measurements. A poor design only yields less: it never causes a disaster.' } }),
    L('NARRA', '* Las luces de la base parpadean un instante.', '* The base lights flicker for an instant.', { fx: 'dim' }),
    T('¿Todo bien por allá? Nuestros sensores marcaron una caída de luz de un segundo. Seguro es el panel solar. Seguro.', 'Everything okay up there? Our sensors logged a one-second drop in light. It must be the solar panel. Surely.', { fx: 'whisper' }),
  ],
  cosecha: [
    T('Para cosechar, toquen solo las plantas maduras: tienen el fruto grande y dorado, con una estrella. Las verdes y pequeñas todavía no.', 'To harvest, tap only the ripe plants: big golden fruit with a star. The small green ones are not ready.'),
    T('Tocar una verde les cuesta tiempo, y el reloj corre.', 'Tapping a green one costs you time, and the clock is running.'),
  ],
  algas: [
    T('Las algas son nuestras mini fábricas de aire y comida.', 'Algae are our mini factories of air and food.'),
    T('Mantengan apretada cada aguja hasta que quede en la franja verde; si se pasa, suéltenla. Ojo: la luz calienta el tanque, así que subirla los obliga a compensar.', 'Hold each needle down until it sits in the green band; if it overshoots, let go. Careful: light warms the tank, so raising it forces you to compensate.', { note: { es: '[MODELO] El equilibrio del tanque es una simplificación del juego.', en: '[MODEL] The tank balance is a simplification made for the game.' } }),
  ],
  antena: [
    T('La antena es nuestra voz: sin ella no podemos ayudarlos.', 'The antenna is our voice: without it we cannot help you.'),
    T('Conecten los cables del mismo símbolo. Si después llega estática, busquen el patrón que se repite para recuperar el mensaje.', 'Connect the cables with the same symbol. If static comes later, look for the repeating pattern to recover the message.'),
  ],
  pedal: [
    T('Pedalear genera energía para la base. Sigan el ritmo: toquen el pedal del lado por donde baja cada nota.', 'Pedaling makes energy for the base. Follow the rhythm: tap the pedal on the side where each note falls.'),
    T('Cada vez el ritmo es distinto, y a veces bajan dos notas a la vez.', 'The rhythm is different every time, and sometimes two notes fall together.'),
  ],
  curar: [
    T('Si alguien se lastima, atiéndanlo con calma: mantengan apretado cada punto hasta que se cierre el anillo.', 'If someone gets hurt, take care calmly: hold each spot down until the ring closes.'),
  ],
  biofirmas: [
    T('Una muestra de hielo puede traer indicios de vida… o solo orgánicos sin vida. Una sola prueba no basta: hagan al menos dos antes de informar.', 'An ice sample may carry hints of life… or just organics without life. One test is not enough: do at least two before reporting.', { note: { es: '[REAL] Los compuestos orgánicos solos no prueban vida; se necesitan varias pruebas independientes.', en: '[REAL] Organic compounds alone do not prove life; several independent tests are needed.' } }),
    T('Nunca decimos «hay vida». Decimos «indicio» o «sin indicio».', 'We never say "there is life". We say "hint" or "no hint".'),
  ],
  hielo: [
    T('Taladro de hielo: mantén apretado sobre el punto marcado hasta romper el hielo. Si te sales, la muestra sale peor.', 'Ice drill: hold down on the marked spot until the ice breaks. If you drift off it, the sample comes out worse.'),
  ],
  panel: [
    T('Los paneles solares son la energía de la base. Limpien el polvo y oriéntenlos al Sol.', 'The solar panels are the base\'s energy. Clean off the dust and aim them at the Sun.'),
    T('Afuera el traje gasta oxígeno: con calma, pero sin perder el tiempo.', 'Outside, the suit uses up oxygen: calmly, but without wasting time.'),
  ],
  polvo: [
    T('El polvo lunar es muy fino y se pega a todo. Límpienlo a mano, con cuidado.', 'Lunar dust is very fine and sticks to everything. Clean it by hand, carefully.'),
  ],
  sellar: [
    T('¡Alerta! Hay una fractura. Sigan la grieta con el sellador, sin soltarlo, hasta cubrirla entera.', 'Alert! There is a fracture. Follow the crack with the sealant, without letting go, until it is fully covered.'),
  ],
};

const seen = new Set<string>();
/** True la primera vez de la sesión que se pide esa guía (así no se repite en cada misión). */
export function takeGuide(key: GuideKey): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
