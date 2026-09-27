# Prueba en seco del ingeniero: carrera en Bakú (2026-09-27)

Esta prueba corrió el motor del ingeniero (`scripts/engineer_dryrun.py`) sobre la grabación real de una carrera en Bakú: 18 vueltas, 26 % de recepción de telemetría y 18 minutos grabados, de la vuelta 1 a la 9. En cada momento en que el ingeniero habla, el motor genera el pedido exacto que recibiría la IA. Las respuestas de abajo las escribió Claude (nivel Pro) actuando como el modelo, a partir de esos pedidos.

Van a servir de **referencia de calidad** para comparar con las respuestas de los modelos reales por API (Estándar y Pro).

## Qué pasó en la carrera
- El piloto largó P16 con medios C4.
- En la vuelta 4, cuando iba P12, salió el safety car.
- 16 de los 19 rivales pararon a poner duros. El piloto **no paró** y quedó P2.
- Relargada en la vuelta 7. En la vuelta 9 pasa a liderar, con medios de 8 vueltas y 17 % de desgaste.
- **Todavía debe la parada obligatoria:** es carrera seca y solo usó un compuesto.

## Tamaño de los pedidos
- Instrucciones (manual del ingeniero, en caché): ~2.900 tokens.
- Datos por pedido: ~1.660 tokens de promedio.
- Pedidos en las 9 vueltas grabadas: 13, contando largada, vueltas y safety car. Una carrera de 18 vueltas completa rondaría los ~25.

## Respuestas del ingeniero

### 1. Largada (vuelta 1, P16)
```json
{
  "radio": "Arrancamos con medios y el plan es una parada entre la 8 y la 12 para poner duros. Primera vuelta con calma en la 1 y la 2, que en Bakú se pasa en la recta.",
  "prioridad": "info",
  "estrategia": {"plan": "Una parada medio → duro", "vuelta_box": null, "ventana_box": [8, 12],
                  "proximo_compuesto": "Hard", "alternativa": "Estirar los medios y terminar con blandos: se descarta porque el C4 se gasta más y con duros llegamos sin gestionar", "certeza": "media"},
  "manejo": ["ERS en Medium de base; guardá Overtake para la recta principal cuando tengas a alguien a tiro de DRS", "Margen de combustible +1,9 vueltas: podés atacar sin ahorrar"],
  "reglaje": [],
  "analisis": "Largamos P16 en una pista donde adelantar es fácil por la recta de más de 2 km. Tenemos que usar dos compuestos, así que la parada es obligatoria: la ventana del juego es de la vuelta 8 a la 17. Bakú tiene mucha probabilidad de safety car; si sale, es el momento ideal para parar."
}
```

### 2. Sale el safety car (vuelta 4, P12)
```json
{
  "radio": "¡Box, box, box! Safety car: paramos ahora por duros, la parada cuesta la mitad y cumplimos los dos compuestos.",
  "prioridad": "urgente",
  "estrategia": {"plan": "Parar ya bajo safety car, duros hasta el final (15 vueltas)", "vuelta_box": 4, "ventana_box": [4, 4],
                  "proximo_compuesto": "Hard", "alternativa": "Quedarse afuera: se gana posición en pista, pero la parada obligatoria después cuesta unos 22 s contra unos 11 s ahora, y los rivales van a tener gomas nuevas", "certeza": "alta"},
  "manejo": ["Entrá atento al límite de velocidad de boxes", "Salís con duros fríos: cuidá la tracción en la vuelta de salida"],
  "reglaje": [],
  "analisis": "Parar ahora cuesta unos 11 s en lugar de 22. Casi todo el pelotón va a parar en esta misma vuelta, así que la estimación de salir P20 es pesimista: si paran todos, volvemos cerca de donde estamos. Los duros hacen 15 vueltas sin problema (los medios gastan 1,5 %/vuelta como mucho). Quedarse afuera da una punta ficticia que se pierde con la parada obligatoria."
}
```

### 3. Vuelta 5 bajo safety car, sin haber parado (P2)
```json
{
  "radio": "Estamos P2 pero con la parada pendiente: seguimos afuera y, si sale otro safety car, entramos sí o sí.",
  "prioridad": "importante",
  "estrategia": {"plan": "Estirar el stint y abrir distancia; parar en otro safety car o al final", "vuelta_box": null, "ventana_box": [12, 16],
                  "proximo_compuesto": "Soft", "alternativa": "Parar en la próxima vuelta: sigue saliendo P17 y se pierde la ventaja de la parada barata que ya pasó", "certeza": "media"},
  "manejo": ["Batería al 99 %: tenela lista para la relargada", "Mantené temperatura en las gomas zigzagueando detrás del safety car"],
  "reglaje": [],
  "analisis": "16 rivales pararon y están con duros nuevos; nosotros tenemos medios de 5 vueltas con 11 % de desgaste. La posición es prestada: si paramos hoy salimos cerca del P17. Lo mejor ahora es sacar la máxima diferencia posible sobre los de atrás y esperar otro safety car, que en Bakú es frecuente."
}
```

### 4. Relargada (vuelta 7, P2)
```json
{
  "radio": "Relargada: Overtake en la recta para que no te chupen, y las gomas bajaron de temperatura, frená un poco antes en la 1.",
  "prioridad": "importante",
  "estrategia": {"plan": "Abrir distancia; parada obligatoria pendiente", "vuelta_box": null, "ventana_box": [12, 16],
                  "proximo_compuesto": "Soft", "alternativa": "Duros: más lentos para recuperar posiciones en las últimas vueltas", "certeza": "media"},
  "manejo": ["Overtake solo en la recta principal y después volvé a Medium", "Las gomas bajaron de ~80 a ~60 °C de promedio interno bajo safety car: dos curvas con cuidado"],
  "reglaje": [],
  "analisis": "Verstappen relarga delante con duros nuevos. Nuestros medios están sanos (12 % de desgaste máximo) pero fríos. El objetivo de estas vueltas es sumar segundos sobre el pelotón para que la parada obligatoria nos cueste menos posiciones."
}
```

### 5. Vuelta 8 completada, líder
```json
{
  "radio": "Batería al 6 %, pasá a modo None esta vuelta para recargar. Vamos más rápido que Verstappen: 106,2 contra 106,9.",
  "prioridad": "importante",
  "estrategia": {"plan": "Seguir afuera hasta la vuelta 12 esperando un safety car; si no sale, box en la 12 por blandos para atacar hasta el final", "vuelta_box": 12, "ventana_box": [12, 14],
                  "proximo_compuesto": "Soft", "alternativa": "Parar en la última vuelta: se pierden unas 15 posiciones sin vueltas para recuperarlas", "certeza": "media"},
  "manejo": ["ERS en None o Medium una vuelta para recargar: con 6 % no podés defenderte en la recta", "Traseras con más desgaste (13–16 %): tracción suave a la salida de las curvas lentas"],
  "reglaje": [],
  "analisis": "Estamos punteando con medios de 8 vueltas y un ritmo mejor que el de Verstappen con duros, pero la parada obligatoria nos manda hoy al P17. Sin un segundo safety car, la mejor opción es parar con margen por blandos nuevos: con 1–1,5 s por vuelta de ventaja y el DRS de Bakú, en 6 vueltas se recuperan varias posiciones. Esperar al final solo conviene si sale un safety car."
}
```

## Hallazgos de la prueba

### Errores de datos que se encontraron y corrigieron
- **Autos activos:** se contaban por cantidad y no por estado. Después de un abandono, el jugador (posición interna 19) quedaba afuera. También afectaba la tabla del dashboard.
- **Daño deshecho con flashback:** el ingeniero avisaba de un choque que el jugador había borrado. Ahora espera 8 s y lo descarta si hay flashback.
- **Posición al salir de boxes:** estaba calculada con los gaps del juego, que llegan con un sector de atraso. Ahora usa la distancia real recorrida por cada auto.
- **Temperaturas de neumáticos:** eran una foto instantánea, que en la recta de Bakú cae mucho. Ahora se usa el promedio por vuelta, y el manual dejó de dar valores absolutos de la F1 real, que no aplican en el juego.
- **Eventos:** llegaban con números de auto. Ahora llegan con nombres, y el piloto figura como "VOS".
- **Ritmo de los rivales:** incluía las vueltas bajo safety car. Ahora se excluyen.

### Pendientes para mejorar al ingeniero
- **Pérdida real en boxes por pista:** hoy es una estimación de 22 s. Hay que medirla con las paradas del piloto y guardarla por pista, igual que el trazado.
- **Estimación de salida bajo safety car:** hoy supone que nadie más para. Hay que agregar un escenario "si paran todos".
- **Juegos de neumáticos disponibles** (paquete TyreSets): nuevos y usados por compuesto, para decidir a qué gomas pasar.
- **Probabilidad de safety car por pista:** agregarla al manual como dato orientativo.
