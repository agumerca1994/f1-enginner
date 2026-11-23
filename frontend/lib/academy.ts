/**
 * The setup "academy": what each setting does, in plain words, when to move it
 * and what it trades away. Keys match the setup values the API sends.
 */

export type AcademyEntry = {
  key: string;
  title: string;
  group: string;
  range?: [number, number]; // the game's range, when known
  unit?: string;
  what: string;
  up: string; // what raising it does
  down: string; // what lowering it does
  when: string[]; // symptom -> direction, as the driver feels it
  related: { key: string; text: string }[];
};

export const GROUPS = ["Aerodinámica", "Transmisión", "Geometría", "Suspensión", "Frenos", "Neumáticos"] as const;

export const ACADEMY: AcademyEntry[] = [
  {
    key: "aleron_delantero",
    title: "Alerón delantero",
    group: "Aerodinámica",
    range: [0, 50],
    what: "Cuánta carga aerodinámica genera la trompa. Es lo que hace que el auto obedezca cuando girás el volante en las curvas medias y rápidas.",
    up: "El auto gira mejor y con más precisión. Perdés un poco de velocidad en las rectas y la cola se vuelve más nerviosa.",
    down: "El auto gira menos (más subviraje) pero la cola queda más tranquila. Ganás algo de velocidad en las rectas.",
    when: [
      "Si en las curvas rápidas el auto sigue derecho aunque gires, subilo uno o dos puntos.",
      "Si la cola se escapa en cuanto girás en curvas rápidas, bajalo un poco.",
    ],
    related: [
      { key: "aleron_trasero", text: "Van juntos: el balance del auto sale de la relación entre los dos. Si bajás el trasero para ganar velocidad en las rectas, bajá el delantero en una medida parecida para que el auto no quede con la cola suelta." },
      { key: "barra_antivuelco_del", text: "El alerón ayuda a girar en curvas rápidas; en las lentas casi no influye. Para el subviraje en curvas lentas tocá la barra delantera." },
    ],
  },
  {
    key: "aleron_trasero",
    title: "Alerón trasero",
    group: "Aerodinámica",
    range: [0, 50],
    what: "Cuánta carga genera la cola. Da estabilidad y agarre atrás en las curvas rápidas, y es lo que más pesa en la velocidad punta.",
    up: "La cola queda pegada al piso en las curvas rápidas y tracciona mejor. Perdés velocidad en las rectas.",
    down: "Ganás velocidad punta. La cola se mueve más en las curvas rápidas y patina antes al acelerar.",
    when: [
      "Si el auto es inestable atrás en curvas rápidas, se desliza o se te va la cola, subilo: te ayuda a estabilizarlo pero perdés velocidad en las rectas.",
      "Si te pasan en todas las rectas y el auto va cómodo en las curvas, bajalo un poco.",
    ],
    related: [
      { key: "aleron_delantero", text: "Si subís o bajás este valor, mové el delantero en el mismo sentido y en una medida parecida para mantener el balance." },
      { key: "diferencial_acelerando_pct", text: "Si el problema es que patina al acelerar en curvas lentas, el diferencial lo resuelve sin costarte velocidad punta." },
    ],
  },
  {
    key: "diferencial_acelerando_pct",
    title: "Diferencial al acelerar",
    group: "Transmisión",
    range: [10, 100],
    unit: "%",
    what: "Qué tan unidas giran las dos ruedas traseras cuando acelerás. Alto: giran casi juntas. Bajo: cada una gira a su velocidad.",
    up: "Más tracción en línea recta. El auto gira peor mientras acelerás y, cuando se escapa, patina de golpe.",
    down: "El auto gira mejor al acelerar y patina menos en curva. Pierde algo de tracción en salidas muy lentas y rectas.",
    when: [
      "Si patina o se cruza al acelerar en la salida de las curvas, bajalo de a 5 o 10 puntos.",
      "Si en la salida el auto sigue de largo cuando acelerás (subviraje a la salida), bajalo también.",
      "Si en las salidas lentas la rueda interna patina sola y no avanza, subilo.",
    ],
    related: [
      { key: "suspension_tras", text: "Una suspensión trasera más blanda también mejora la tracción: si ya bajaste mucho el diferencial, probá por ahí." },
      { key: "barra_antivuelco_tras", text: "La barra trasera más blanda ayuda a la tracción en curvas lentas, igual que bajar el diferencial." },
    ],
  },
  {
    key: "diferencial_soltando_pct",
    title: "Diferencial al soltar",
    group: "Transmisión",
    range: [10, 100],
    unit: "%",
    what: "Lo mismo que el anterior, pero cuando levantás el pie del acelerador: sobre todo en la frenada y la entrada a la curva.",
    up: "El auto entra más estable y derecho a las curvas, pero gira menos en la entrada.",
    down: "El auto rota mejor al entrar, pero la cola puede moverse al soltar el acelerador.",
    when: [
      "Si al levantar el pie para entrar a la curva la cola se mueve, subilo.",
      "Si el auto no quiere girar en la entrada de las curvas lentas, bajalo.",
    ],
    related: [
      { key: "freno_motor_pct", text: "El freno motor también actúa al soltar: si la cola se mueve al levantar, bajá el freno motor o subí este valor." },
      { key: "reparto_frenada_pct", text: "Un reparto más atrás hace que el auto rote más en la frenada; combinalo con cuidado con un diferencial bajo." },
    ],
  },
  {
    key: "camber_del",
    title: "Camber delantero",
    group: "Geometría",
    range: [-3.5, -2.5],
    unit: "°",
    what: "La inclinación de las ruedas delanteras vista desde adelante. Más negativo: la parte de arriba de la rueda se inclina hacia adentro.",
    up: "Hacia cero (menos negativo): mejor frenada y menos desgaste, pero menos agarre en el medio de la curva.",
    down: "Más negativo: más agarre adelante con el auto apoyado en la curva. Más desgaste y temperatura en el borde interno, y frenada un poco peor.",
    when: [
      "Si te falta agarre adelante en el medio de las curvas largas, hacelo más negativo.",
      "Si las delanteras se gastan rápido o bloquean en las frenadas fuertes, llevalo hacia cero.",
    ],
    related: [
      { key: "convergencia_del", text: "Los dos afectan el desgaste y la temperatura: si subís uno, no subas el otro al máximo." },
      { key: "presion_del_izq", text: "Más camber calienta más la goma: si las delanteras se recalientan, compensá bajando un poco la presión." },
    ],
  },
  {
    key: "camber_tras",
    title: "Camber trasero",
    group: "Geometría",
    range: [-2.2, -0.7],
    unit: "°",
    what: "La inclinación de las ruedas traseras vista desde atrás.",
    up: "Hacia cero: mejor tracción en línea recta y menos desgaste.",
    down: "Más negativo: más agarre atrás en el medio de la curva, peor tracción al salir y más desgaste.",
    when: [
      "Si patina en las salidas en línea recta, llevalo hacia cero.",
      "Si la cola se va en el medio de las curvas largas, hacelo más negativo.",
    ],
    related: [
      { key: "convergencia_tras", text: "La convergencia trasera también estabiliza la cola; mové de a uno para saber cuál sirvió." },
    ],
  },
  {
    key: "convergencia_del",
    title: "Convergencia delantera",
    group: "Geometría",
    range: [0, 0.5],
    unit: "°",
    what: "Hacia dónde apuntan las ruedas delanteras vistas desde arriba. En este juego un valor más alto las abre hacia afuera.",
    up: "El auto responde más rápido al primer giro del volante. Más desgaste y temperatura, y algo menos de velocidad punta.",
    down: "Respuesta más suave y menos desgaste.",
    when: [
      "Si el auto tarda en reaccionar al girar en las chicanas, subilo un poco.",
      "Si las delanteras se recalientan o se gastan mucho, bajalo.",
    ],
    related: [
      { key: "camber_del", text: "Juntos definen cuánto trabaja la goma delantera: si subís uno, vigilá el desgaste." },
    ],
  },
  {
    key: "convergencia_tras",
    title: "Convergencia trasera",
    group: "Geometría",
    range: [0.1, 0.5],
    unit: "°",
    what: "Hacia dónde apuntan las ruedas traseras vistas desde arriba. Un valor más alto las cierra hacia adentro.",
    up: "Más estabilidad en la recta y en la salida de las curvas. Más desgaste y algo menos de velocidad punta.",
    down: "El auto rota más fácil, con la cola algo más suelta, y gasta menos goma.",
    when: [
      "Si la cola se mueve al acelerar en recta o en las curvas rápidas, subilo.",
      "Si las traseras se gastan muy rápido, bajalo.",
    ],
    related: [
      { key: "camber_tras", text: "Los dos estabilizan la cola a costa de desgaste: tocá uno por vez." },
    ],
  },
  {
    key: "suspension_del",
    title: "Suspensión delantera",
    group: "Suspensión",
    range: [1, 41],
    what: "La dureza de los resortes delanteros.",
    up: "Más dura: el auto responde más rápido y la trompa se mantiene a la altura justa para la aerodinámica. Peor sobre pianos y baches.",
    down: "Más blanda: más agarre mecánico en curvas lentas y sobre pianos, pero el auto cabecea más al frenar.",
    when: [
      "Si el auto rebota o se descontrola al pisar pianos, ablandala.",
      "Si la trompa se hunde mucho al frenar y toca el piso, endurecela.",
    ],
    related: [
      { key: "altura_del", text: "Si la ablandás, la trompa baja más al frenar: subí un poco la altura delantera para que no toque el piso." },
      { key: "barra_antivuelco_del", text: "Los dos definen qué tan firme está adelante: una suspensión dura con barra dura deja el auto muy nervioso." },
    ],
  },
  {
    key: "suspension_tras",
    title: "Suspensión trasera",
    group: "Suspensión",
    range: [1, 41],
    what: "La dureza de los resortes traseros.",
    up: "Más dura: respuesta más rápida y cola más firme, pero patina antes al acelerar.",
    down: "Más blanda: mejor tracción al acelerar y sobre baches, con un auto que se mueve más.",
    when: [
      "Si patina al salir de las curvas lentas, ablandala unos puntos.",
      "Si la cola se hunde y el auto se vuelve lento de reacciones, endurecela.",
    ],
    related: [
      { key: "altura_tras", text: "Más blanda hace que la cola baje más al acelerar: compensá con un poco más de altura trasera si toca el piso." },
      { key: "diferencial_acelerando_pct", text: "Para el patinaje al acelerar, el diferencial es el primer ajuste a probar." },
    ],
  },
  {
    key: "barra_antivuelco_del",
    title: "Barra antivuelco delantera",
    group: "Suspensión",
    range: [1, 21],
    what: "Una barra que une las dos ruedas delanteras y frena el balanceo del auto en las curvas.",
    up: "Más dura: menos balanceo y respuesta más rápida, pero más subviraje en curvas lentas.",
    down: "Más blanda: el tren delantero agarra más en las curvas lentas. El auto se inclina más y responde un poco más lento.",
    when: [
      "Si el auto no gira en las curvas lentas y medias, bajala uno o dos puntos.",
      "Si la trompa es demasiado nerviosa y el auto sobrevira al entrar, subila.",
    ],
    related: [
      { key: "barra_antivuelco_tras", text: "Lo que importa es la relación entre las dos barras: delantera más dura que la trasera = auto más subvirador. Si bajás una, la otra pasa a pesar más." },
      { key: "aleron_delantero", text: "Para el subviraje en curvas rápidas, el alerón delantero es mejor herramienta." },
    ],
  },
  {
    key: "barra_antivuelco_tras",
    title: "Barra antivuelco trasera",
    group: "Suspensión",
    range: [1, 21],
    what: "La misma barra pero atrás: une las ruedas traseras.",
    up: "Más dura: el auto rota más en las curvas (más sobreviraje).",
    down: "Más blanda: más agarre atrás y mejor tracción en curvas lentas.",
    when: [
      "Si la cola se va en el medio de las curvas lentas, bajala.",
      "Si el auto no gira en ninguna curva y la cola va pegada, subila un punto.",
    ],
    related: [
      { key: "barra_antivuelco_del", text: "Si subís una, para mantener el balance tenés que pensar en la otra: el auto responde a la diferencia entre las dos." },
      { key: "diferencial_acelerando_pct", text: "Si el problema aparece sólo al acelerar, probá antes con el diferencial." },
    ],
  },
  {
    key: "altura_del",
    title: "Altura delantera",
    group: "Suspensión",
    what: "A qué distancia del piso va la trompa. Cuanto más baja, más trabaja el fondo plano del auto.",
    up: "Más alta: más estable sobre pianos y baches, menos carga aerodinámica.",
    down: "Más baja: más carga y más velocidad, pero si toca el piso el auto pierde agarre de golpe.",
    when: [
      "Si escuchás o sentís que el auto toca el piso en las rectas o al frenar, subila.",
      "Si el auto está estable y querés más carga, bajala de a un punto.",
    ],
    related: [
      { key: "altura_tras", text: "La diferencia entre la altura trasera y la delantera (el \"rake\") cambia el balance: cola más alta que la trompa = el auto gira más." },
      { key: "suspension_del", text: "Con suspensión más blanda la trompa baja más al frenar: si bajás la altura, no ablandes también la suspensión." },
    ],
  },
  {
    key: "altura_tras",
    title: "Altura trasera",
    group: "Suspensión",
    what: "A qué distancia del piso va la cola.",
    up: "Más alta: el auto gira más y entra mejor en las curvas lentas, pero se vuelve menos estable en las rápidas y pierde velocidad punta.",
    down: "Más baja: más estable en las rápidas y más velocidad, con un auto que gira menos.",
    when: [
      "Si la cola es inestable en las curvas rápidas, bajala un poco.",
      "Si el auto no quiere girar en las lentas, subila un punto.",
    ],
    related: [
      { key: "altura_del", text: "Si subís la trasera para que el auto gire más, vigilá que la trompa no quede tan baja que toque el piso." },
    ],
  },
  {
    key: "presion_frenos_pct",
    title: "Presión de frenos",
    group: "Frenos",
    range: [80, 100],
    unit: "%",
    what: "Cuánta fuerza de frenado sale con el pedal a fondo.",
    up: "Frenás más corto, pero las ruedas se bloquean con más facilidad.",
    down: "Más fácil dosificar sin bloquear, pero necesitás frenar antes o pisar más.",
    when: [
      "Si bloqueás seguido aunque frenes con cuidado, bajala de a 2 o 3 puntos.",
      "Si nunca bloqueás y te cuesta frenar corto, subila.",
    ],
    related: [
      { key: "reparto_frenada_pct", text: "El reparto decide qué eje bloquea primero; la presión decide cuándo. Si bloqueás sólo adelante, tocá primero el reparto." },
    ],
  },
  {
    key: "reparto_frenada_pct",
    title: "Reparto de frenada",
    group: "Frenos",
    range: [50, 70],
    unit: "%",
    what: "Qué parte del frenado hacen las ruedas delanteras. 57 % quiere decir 57 adelante y 43 atrás.",
    up: "Más adelante: el auto frena estable y derecho, pero las delanteras bloquean antes.",
    down: "Más atrás: el auto rota más en la frenada, pero la cola se puede volver inestable y bloquear atrás.",
    when: [
      "Si bloqueás adelante en las frenadas fuertes, bajalo uno o dos puntos.",
      "Si la cola se mueve o bloquea atrás al frenar, subilo.",
    ],
    related: [
      { key: "presion_frenos_pct", text: "Si movés el reparto y seguís bloqueando en los dos ejes, el problema es la presión." },
      { key: "freno_motor_pct", text: "El freno motor también frena las traseras: con mucho freno motor, un reparto atrás bloquea más fácil." },
    ],
  },
  {
    key: "freno_motor_pct",
    title: "Freno motor",
    group: "Frenos",
    range: [0, 100],
    unit: "%",
    what: "Cuánto frena el motor solo cuando levantás el acelerador. Actúa sobre las ruedas traseras.",
    up: "El auto frena más solo al levantar, pero la cola se mueve más en la entrada.",
    down: "Entrada más estable y menos bloqueos atrás; el auto frena un poco menos al soltar.",
    when: [
      "Si bloqueás atrás o la cola se mueve al bajar cambios, bajalo.",
    ],
    related: [
      { key: "diferencial_soltando_pct", text: "Los dos actúan al soltar el acelerador: si la entrada es inestable, probá uno y después el otro." },
    ],
  },
  {
    key: "presion_del_izq",
    title: "Presión de neumáticos delanteros",
    group: "Neumáticos",
    range: [22.5, 29.5],
    unit: " psi",
    what: "El aire de las gomas delanteras. El juego deja ajustar cada rueda, pero lo normal es mover las dos juntas.",
    up: "Más presión: menos resistencia y algo más de velocidad, pero menos agarre y la goma se calienta más.",
    down: "Menos presión: más agarre y la goma trabaja más fría, con un poco más de resistencia.",
    when: [
      "Si las delanteras se recalientan, bajala unas décimas.",
      "Si las delanteras no llegan a temperatura en una pista fría, subila.",
    ],
    related: [
      { key: "camber_del", text: "El camber también calienta la goma: si bajás la presión por temperatura, no subas el camber al mismo tiempo." },
    ],
  },
  {
    key: "presion_tras_izq",
    title: "Presión de neumáticos traseros",
    group: "Neumáticos",
    range: [20.5, 26.5],
    unit: " psi",
    what: "El aire de las gomas traseras.",
    up: "Más presión: más velocidad, menos agarre y la goma se calienta más.",
    down: "Menos presión: más tracción y la goma trabaja más fría.",
    when: [
      "Si las traseras se recalientan o patinan al final de la tanda, bajala unas décimas.",
    ],
    related: [
      { key: "diferencial_acelerando_pct", text: "El patinaje calienta las traseras: si bajás el diferencial, quizás no haga falta tocar la presión." },
    ],
  },
];

/** Advice keys that point at a pair of wheels map to the academy entry for that axle. */
export const ACADEMY_ALIAS: Record<string, string> = {
  presion_del: "presion_del_izq",
  presion_del_der: "presion_del_izq",
  presion_tras: "presion_tras_izq",
  presion_tras_der: "presion_tras_izq",
};

export function academyEntry(key: string): AcademyEntry | undefined {
  const k = ACADEMY_ALIAS[key] ?? key;
  return ACADEMY.find((e) => e.key === k);
}

/** Symptoms the driver can pick: the settings worth looking at, most useful first. */
export const SYMPTOMS: { label: string; keys: string[] }[] = [
  { label: "No gira en curvas lentas", keys: ["barra_antivuelco_del", "diferencial_soltando_pct", "altura_tras"] },
  { label: "No gira en curvas rápidas", keys: ["aleron_delantero", "aleron_trasero"] },
  { label: "Se va de cola en curvas rápidas", keys: ["aleron_trasero", "altura_tras", "convergencia_tras"] },
  { label: "Patina al acelerar", keys: ["diferencial_acelerando_pct", "suspension_tras", "barra_antivuelco_tras"] },
  { label: "Inestable al entrar a la curva", keys: ["diferencial_soltando_pct", "freno_motor_pct", "reparto_frenada_pct"] },
  { label: "Bloquea al frenar", keys: ["reparto_frenada_pct", "presion_frenos_pct"] },
  { label: "Lento en las rectas", keys: ["aleron_trasero", "aleron_delantero", "altura_del"] },
  { label: "Rebota en los pianos", keys: ["suspension_del", "suspension_tras", "altura_del"] },
  { label: "Gomas recalentadas", keys: ["presion_del_izq", "presion_tras_izq", "camber_del"] },
];
