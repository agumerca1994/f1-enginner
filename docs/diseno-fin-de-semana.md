# Diseño: el ingeniero durante todo el fin de semana

**Estado:** propuesta (2026-09-27), pendiente de aprobación.

## El problema

Hoy el ingeniero trabaja carrera por carrera. En la F1 real el trabajo del ingeniero empieza antes, en las prácticas:
- propone un **reglaje base** según la pista y el clima;
- lo **ajusta tanda a tanda** con lo que muestra el auto;
- **mide** el desgaste de cada compuesto, el consumo y el ritmo;
- define el **reglaje de clasificación y de carrera**, que queda fijo en parque cerrado;
- llega a la carrera con una **estrategia basada en lo medido**, no en supuestos.

El fin de semana puede ser completo o parcial: de 1 a 3 prácticas, sin clasificación, clasificación a una vuelta, clasificación corta, o Q1, Q2 y Q3. El ingeniero tiene que adaptarse a la estructura que tocó.

## Lo que da el juego (verificado con las grabaciones)

En cada paquete Session vienen:
- `weekend_link_identifier`: el mismo en todas las sesiones de un fin de semana, para agruparlas;
- `session_link_identifier`: se mantiene aunque la sesión se reinicie. Las dos carreras de Bakú grabadas tienen el mismo, así que un reinicio se puede unir en lugar de verse como una sesión nueva;
- `season_link_identifier`: la temporada, útil para el modo carrera;
- `weekend_structure` y `num_sessions_in_weekend`: la estructura planificada. En la grabación: práctica corta, Q1, Q2, Q3 y carrera;
- `parc_ferme_rules`: si rige parque cerrado.

Además:
- **CarSetups:** el reglaje completo, del que se puede detectar cada cambio entre tandas.
- **TyreSets:** los juegos por compuesto, con la sesión recomendada para cada uno, el desgaste y la vida útil.
- **LapData → `driver_status`:** en garaje, vuelta lanzada, vuelta de entrada, vuelta de salida o en pista. Con eso se detecta cada **tanda**: salida del garaje → vueltas → vuelta al garaje.

## Modelo de datos

- **`weekends`**: tenant, `weekend_link_id`, `season_link_id`, pista, estructura planificada, fechas.
- **`game_sessions`** suma `weekend_id` y `session_link_id`. Los reinicios con el mismo `session_link_id` se agrupan como intentos de una misma sesión.
- **`runs`** (tandas): sesión, número, compuesto y edad, combustible al salir, `setup_hash` y reglaje completo. Métricas:
  - mejor vuelta y promedio de vueltas limpias;
  - mejores sectores y velocidad punta;
  - desgaste por vuelta por rueda y temperaturas promedio por rueda;
  - consumo.

  También guarda la sensación del piloto, si la da, y el veredicto del ingeniero.
- **Libreta del ingeniero, una por fin de semana** (JSON):
  - reglaje base propuesto y los cambios probados con su resultado;
  - modelo por compuesto: degradación en s/vuelta y desgaste en %/vuelta, medidos en tandas largas;
  - ritmo de clasificación, consumo por vuelta y pérdida en boxes;
  - reglaje de clasificación y de carrera, y la estrategia planificada.

  Es lo que "recuerda" el ingeniero de una sesión a la siguiente, y va resumida en el contexto de cada pedido a la IA.

## Qué hace el ingeniero en cada tipo de sesión

### Inicio del fin de semana (primera sesión)
- **Programa de trabajo** según la estructura:
  - con 3 prácticas: P1 para el reglaje aerodinámico y mecánico base, P2 para tandas largas de carrera, P3 para preparar la clasificación;
  - con 1 práctica: todo comprimido, con prioridad en el reglaje y una tanda larga corta;
  - sin práctica: reglaje base conservador y estrategia con márgenes.
- **Reglaje base:** según las características de la pista (tabla del manual), el pronóstico y el reglaje actual. Cambios concretos con dirección y magnitud respecto del reglaje actual.

### Práctica
- **Al terminar cada tanda** (nuevo momento: `tanda_terminada`), el ingeniero:
  - compara la tanda contra las anteriores, sabiendo qué cambió en el reglaje;
  - lee los síntomas en los datos (temperaturas y desgaste por rueda, sectores, velocidad punta) y la sensación del piloto;
  - propone **uno o dos cambios** para la próxima tanda y **qué tipo de tanda** hacer: simulación de clasificación con blandos y poco combustible, o tanda larga con el combustible de carrera.
- En las tandas largas mide la degradación y el consumo de cada compuesto y lo anota en la libreta.

### Clasificación
- **Formato:** a una vuelta, corta, o Q1-Q2-Q3.
- **Qué juegos usar en cada segmento**, según TyreSets y la sesión recomendada por el juego.
- **Cuándo salir:** evolución de la pista y tráfico. Preparación de la vuelta: calentar gomas, batería llena, combustible justo.
- **Entre segmentos:** si hace falta gastar blandos nuevos para pasar de ronda.
- **Al entrar en parque cerrado:** registra el reglaje de carrera como definitivo.

### Carrera
- Arranca con la **estrategia planificada desde la libreta**: degradación medida por compuesto, pérdida en boxes, consumo, posición de largada y pronóstico.
- Durante la carrera funciona como ahora, pero comparando lo real con lo previsto: "degradamos más que en la P2, adelantemos la parada".

### Contrarreloj
- Trabajo de reglaje y de vuelta: sectores contra el mejor propio y el rival (paquete TimeTrial), y dónde se pierde tiempo.

## La sensación del piloto
El reglaje se ajusta mucho mejor sabiendo qué siente el piloto. Antes de tener voz (P4) propongo **botones rápidos en el dashboard** al terminar una tanda:
- "subvira en lenta" / "subvira en rápida";
- "sobrevira en la entrada" / "sobrevira en la salida";
- "bloquea frenos";
- "le falta velocidad en recta";
- "estable".

Es un solo toque, y le da al ingeniero información que la telemetría sola no tiene. Mientras tanto, el ingeniero también infiere síntomas de los datos: temperaturas y desgaste delante contra detrás, sectores lentos contra rápidos, velocidad punta.

## Costo
Las prácticas generan pocos pedidos: uno por tanda más el inicio, unos 5 a 10 por práctica. Un fin de semana completo (3 prácticas, clasificación y carrera de 18 vueltas) sumaría unos **60 pedidos**:
- nivel **Estándar**: US$ 0,50–0,70;
- nivel **Pro**: US$ 1,50–2.

La libreta agrega unos 500–1.000 tokens por pedido.

## Fases propuestas
1. **Agrupar el fin de semana:** tabla `weekends`, identificadores de fin de semana y de sesión, reinicios unidos, y vista por fin de semana en Sesiones.
2. **Tandas y reglaje:** detectar tandas y cambios de reglaje, calcular métricas por tanda y sumar el momento "tanda terminada" con propuestas de reglaje.
3. **Libreta y modelo de compuestos:** medir en tandas largas, persistir y usarlo en la estrategia de carrera.
4. **Clasificación:** formatos, juegos por segmento y parque cerrado.
5. **Sensación del piloto:** botones en el dashboard, y después por voz en P4.

## Para probarlo
Hacen falta grabaciones de un fin de semana con prácticas y clasificación: al menos una práctica con dos o tres tandas y un cambio de reglaje en el medio, más la clasificación. Con el bridge encendido se graban solas.
