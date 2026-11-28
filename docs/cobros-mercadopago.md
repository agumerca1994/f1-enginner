# Cobros con Mercado Pago

Planes (definidos en `backend/app/billing/plans.py`):

| Plan | Precio | Incluye |
|---|---|---|
| Gratis | 0 | 1 carrera con el ingeniero Pro de regalo (una vez), radio de avisos en 5 carreras por mes, todo lo que no usa la radio, 1 pantalla vinculada |
| Suscripción | 3,5 USD por mes | 5 carreras con el ingeniero Pro por mes, radio de avisos sin límite, MCP, pantallas sin límite |
| 5 carreras | 5 USD | Ingeniero Pro en vivo, no vencen |
| 12 carreras | 10 USD | Ídem |
| Cortesía | sin cargo | Todo, para el dueño y los acuerdos (`scripts/plans.sh cortesia`) |

Dos ingenieros: la **radio de avisos** (reglas, frases cortas de eventos, no conversa) y el **ingeniero Pro** (IA: conversa, plan de carrera, memoria, curva por curva).

Una carrera es un bloque de hasta 45 minutos de una sesión del juego. Se descuenta la primera vez que el ingeniero habla en ese bloque; menús y sesiones sin llamadas no cuentan. Para el Pro se usan, en orden, las 3 del mes de la suscripción, la prueba y los paquetes. Sin carreras Pro habla la radio de avisos (dock: "Radio de avisos · pasar a Pro") y "Hablar" responde que hace falta una carrera Pro. En el plan gratis la radio de avisos cuenta 5 carreras por mes (`avisos` en `race_usages`); agotadas, la radio avisa una vez y se calla (dock: "Sin radio · ver planes"). Si se compra un paquete en medio de una carrera de avisos, ese bloque pasa a Pro y la carrera de avisos se devuelve.

Los precios se cobran en pesos con el dólar de referencia: `scripts/plans.sh dolar 1450`. Se redondean hacia arriba a la centena.

## Puesta en marcha

Las "credenciales de prueba" de la cuenta real dan "Hubo un error" dentro del checkout. Se prueba con una cuenta vendedora de prueba y sus credenciales de producción:

1. En https://www.mercadopago.com.ar/developers, con la cuenta real, crear una aplicación (pagos online, Checkout Pro y suscripciones) y en *Cuentas de prueba* crear un **vendedor** y un **comprador**, los dos de Argentina.
2. En una ventana de incógnito, entrar a Mercado Pago con el **vendedor de prueba** (usuario `TESTUSER…`, su contraseña; si pide código, los últimos 6 dígitos de su User ID). En el panel de desarrolladores de esa cuenta crear una aplicación y copiar su **Access Token de producción**.
3. En Easypanel → Entorno del servicio:
   - `MP_ACCESS_TOKEN` = ese token
   - `MP_SANDBOX` = `false`
   - `PLAN_LIMITS` sigue en `false`.
4. Desplegar y cargar el dólar: `scripts/plans.sh dolar <pesos>`.
5. En otra ventana de incógnito, comprar desde Ajustes → Plan y pagar entrando con el **comprador de prueba**, con tarjeta de prueba (titular `APRO`). Las notificaciones llegan a `https://f1-api.imanzanastore.com.ar/api/billing/mp/webhook` (la URL va en cada cobro).
6. Para cobrar de verdad: `MP_ACCESS_TOKEN` = el de producción de la cuenta real, darte cortesía (`scripts/plans.sh cortesia <tu mail>`) y recién ahí `PLAN_LIMITS=true`.

## Suscripción

La suscripción usa un plan de Mercado Pago (`/preapproval_plan`), creado solo la primera vez para cada precio y guardado en `billing_settings` (`mp_plan_<pesos>`). El jugador se suscribe con la cuenta de Mercado Pago que quiera, sin mandarle un email. Al volver, Mercado Pago agrega `preapproval_id` a `/planes`; la página llama a `POST /api/billing/subscription/confirm`, que lee la suscripción, comprueba que sea de un plan nuestro y que no esté atada a otra cuenta, y la ata a la del jugador. Las renovaciones llegan por las notificaciones y se buscan por `mp_preapproval_id`.

## Seguridad

Las notificaciones de Mercado Pago no se creen: el servidor vuelve a leer el pago o la suscripción con el access token y sólo acredita si la referencia externa es nuestra, la moneda es ARS y el monto alcanza. Cada pago se aplica una sola vez. La suscripción queda activa hasta el próximo cobro más 3 días de gracia; si se cancela, dura hasta el final de lo pagado.

## Pendiente de verificar en el sandbox

- El alta por plan y que la vuelta traiga `preapproval_id`.
- Los nombres de estado de la suscripción (`authorized`, `cancelled`) y la cancelación con `PUT /preapproval/{id}`.
- El aviso `subscription_authorized_payment` y su `preapproval_id`.
