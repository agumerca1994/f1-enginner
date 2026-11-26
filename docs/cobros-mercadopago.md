# Cobros con Mercado Pago

Planes (definidos en `backend/app/billing/plans.py`):

| Plan | Precio | Incluye |
|---|---|---|
| Gratis | 0 | 3 carreras Pro de prueba (una vez), radio de avisos en 5 carreras por mes, todo lo que no usa la radio, 1 pantalla vinculada |
| Suscripción | 3,5 USD por mes | 3 carreras Pro por mes, radio de avisos sin límite, MCP, pantallas sin límite |
| 5 carreras | 5 USD | Ingeniero Pro en vivo, no vencen |
| 12 carreras | 10 USD | Ídem |
| Cortesía | sin cargo | Todo, para el dueño y los acuerdos (`scripts/plans.sh cortesia`) |

Dos ingenieros: la **radio de avisos** (reglas, frases cortas de eventos, no conversa) y el **ingeniero Pro** (IA: conversa, plan de carrera, memoria, curva por curva).

Una carrera es un bloque de hasta 45 minutos de una sesión del juego. Se descuenta la primera vez que el ingeniero habla en ese bloque; menús y sesiones sin llamadas no cuentan. Para el Pro se usan, en orden, las 3 del mes de la suscripción, la prueba y los paquetes. Sin carreras Pro habla la radio de avisos (dock: "Radio de avisos · pasar a Pro") y "Hablar" responde que hace falta una carrera Pro. En el plan gratis la radio de avisos cuenta 5 carreras por mes (`avisos` en `race_usages`); agotadas, la radio avisa una vez y se calla (dock: "Sin radio · ver planes"). Si se compra un paquete en medio de una carrera de avisos, ese bloque pasa a Pro y la carrera de avisos se devuelve.

Los precios se cobran en pesos con el dólar de referencia: `scripts/plans.sh dolar 1450`. Se redondean hacia arriba a la centena.

## Puesta en marcha

1. Entrar a https://www.mercadopago.com.ar/developers con la cuenta que va a cobrar y crear una aplicación (producto: pagos online, Checkout Pro y suscripciones).
2. En la aplicación, copiar el **Access Token de prueba** (credenciales de prueba).
3. En Easypanel → Entorno del servicio:
   - `MP_ACCESS_TOKEN` = el access token de prueba
   - `MP_SANDBOX` = `true`
   - `PLAN_LIMITS` sigue en `false` mientras se prueba; las cuentas de cortesía no lo necesitan.
4. Desplegar (`scripts/deploy.sh --yes`) y cargar el dólar: `scripts/plans.sh dolar <pesos>`.
5. Probar con una cuenta de comprador de prueba (Mercado Pago → Cuentas de prueba): comprar un paquete y una suscripción desde Ajustes → Plan. Al volver, la pantalla revisa el pago; las notificaciones llegan a `https://f1-api.imanzanastore.com.ar/api/billing/mp/webhook` (la URL va en cada cobro, no hace falta configurarla en el panel).
6. Para cobrar de verdad: cambiar `MP_ACCESS_TOKEN` por el de producción, `MP_SANDBOX=false`, darte cortesía (`scripts/plans.sh cortesia <tu mail>`) y recién ahí `PLAN_LIMITS=true`.

## Seguridad

Las notificaciones de Mercado Pago no se creen: el servidor vuelve a leer el pago o la suscripción con el access token y sólo acredita si la referencia externa es nuestra, la moneda es ARS y el monto alcanza. Cada pago se aplica una sola vez. La suscripción queda activa hasta el próximo cobro más 3 días de gracia; si se cancela, dura hasta el final de lo pagado.

## Pendiente de verificar en el sandbox

- El alta de la suscripción sin plan con `status: pending` y el `init_point` que devuelve.
- Los nombres de estado de la suscripción (`authorized`, `cancelled`) y la cancelación con `PUT /preapproval/{id}`.
- El aviso `subscription_authorized_payment` y su `preapproval_id`.
