# Prueba con IA real: Estándar contra Pro (2026-09-27)

Se corrió `scripts/engineer_eval.py` sobre la carrera real de Bakú de 18 vueltas. La grabación cubre las vueltas 1 a 9, con 13 llamadas por nivel. Todas las llamadas fueron a la API de Anthropic.

| Nivel | Modelos | Costo (13 llamadas) | Latencia mediana | Proyección, carrera de 18 vueltas |
|---|---|---|---|---|
| Estándar | Haiku 4.5 en cada vuelta, Sonnet 5 en eventos | US$ 0,15 | ~10 s (Haiku) / ~23 s (Sonnet) | ~US$ 0,30 |
| Pro | Sonnet 5 en cada vuelta, Opus 5 en eventos | US$ 0,43 | ~13 s (Sonnet) / ~20 s (Opus) | ~US$ 0,85 |

**Tokens reales:**
- El manual ocupa ~6.400 tokens. Se escribe en caché una vez y después se lee al 10 % del precio.
- Los datos de cada pedido ocupan ~3.000–4.400 tokens.
- Las respuestas ocupan 450–2.800 tokens, incluido el razonamiento del modelo.

## Calidad

**Safety car de la vuelta 4.** Los dos niveles dieron la llamada correcta, con Sonnet y con Opus: "¡Box, box, box!", parar y poner duros.

**Estándar: Haiku no alcanza para este rol.**
- En la vuelta 4 dio por hecho que el piloto ya había parado: "Segundo en pista con duros nuevos". Era falso.
- En las vueltas 5 y 6 planificó "gestionar los duros hasta el final".
- En la vuelta 8 se olvidó de la parada obligatoria y propuso "evaluar parar si Max ya paró", cuando Max ya había parado.
- Casi nunca habló por radio.

**Pro: consistente y con criterio de ingeniero.**
- Mientras duró el safety car insistió en entrar: "¡Todavía estás afuera! Entrá ya".
- Terminado el safety car, propuso parar en la vuelta 8 con blandos para atacar los últimos 11 giros, que es la misma conclusión que la referencia.
- Usó el dato de juegos de neumáticos: "blandas nuevas, seis décimas más rápidas".
- Error: una falsa alarma de "combustible crítico" en las vueltas 1 y 2, cuando sobraban 1,9 vueltas. Se debía a un campo ambiguo; ya está corregido con `vueltas_de_sobra` y `alcanza_hasta_el_final`.

## Conclusiones
1. **Haiku no sirve como ingeniero**: malinterpreta el estado de la carrera. El nivel Estándar debería usar Sonnet también en cada vuelta, con esfuerzo bajo.
2. **Latencia:** entre 10 y 25 s por llamada. Para la estrategia está bien, pero para un "box, box" bajo safety car es demasiado. Propuesta: en los eventos urgentes, un aviso inmediato por reglas y después la respuesta completa de la IA.
3. **Costo real:** entre US$ 0,30 y 0,85 por carrera de 18 vueltas, según el nivel.
