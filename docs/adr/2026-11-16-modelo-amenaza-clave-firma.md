# ADR — Modelo de amenaza de la clave HMAC del puente (la firma protege integridad y origen, NO confidencialidad)

> **Estado:** VIGENTE
> **Fecha:** 2026-11-16 · **Cierra:** R-40 (hueco compartido §6.5, auditoría
> 2026-11-16) · **Decisiones relacionadas:** contrato del hub
> (`2026-11-16-contrato-hub-e14-puente.md`, R-32), D-puente (índice raíz),
> H-2 (token de lectura del panel).

## Contexto

La escritura hacia el hub (`POST {hub}/v1/actas`) se autentica con
HMAC-SHA256 (`x-e14-ts` + `x-e14-firma`) sobre `${ts}.${cuerpoRaw}` usando la
**clave de jornada**, que vive en `localStorage["e14-clave-jornada"]` del
navegador del operador (`digielect14/src/lib/e14/puente/firma.ts`). La
auditoría señaló el punto y este ADR lo pone negro sobre blanco: la clave está
al alcance de cualquier código que corra en ese navegador — un XSS la lee y
produce firmas válidas. La firma protege **integridad y origen, no
confidencialidad**, y eso nunca se había declarado. **No cambia nada del
código** (`firma.ts`, `envio.ts` y sus tests siguen siendo el contrato): lo
que cambia es que el modelo de amenaza explícito existe y el trade-off de
`localStorage` queda registrado como decisión, no como omisión.

## Qué protege la firma — y qué NO

**Protege:**

1. **Integridad del sobre.** El HMAC va sobre el string EXACTO que sale por la
   red (S-1: serializar UNA vez, firmar esos bytes, enviar esos mismos bytes —
   jamás re-serializar). Un atacante **sin la clave** no puede FABRICAR un
   sobre válido ni MODIFICAR uno en tránsito: cualquier cambio del cuerpo
   rompe la firma y el hub rechaza. La integridad no depende de que TLS esté
   bien: es una segunda red independiente.
2. **Origen del dispositivo.** Solo un dispositivo con la clave provisionada
   publica. Sin clave el cliente ni siquiera envía — falla cerrado
   (`SIN_CLAVE_JORNADA`, cola intacta, motivo visible en la tarjeta del
   puente), y ese comportamiento lo exige la suite (`envio.test.ts`) y el e2e
   (`e2e/humo.spec.ts`: «provisiona la clave de jornada»).

**NO protege:**

1. **Confidencialidad.** La foto viaja LEGIBLE dentro del sobre (dataURL de la
   foto procesada en `EntradaPuente.srcFoto`). Quien pueda leer el cuerpo —
   quien termine el TLS, el propio hub, un XSS en el dispositivo — ve el acta.
   La confidencialidad la dan TLS en el transporte y el control de acceso del
   hub en la lectura (Bearer de lectura, una credencial DISTINTA por diseño —
   `token-lectura.ts` del panel). La firma no cifra nada ni pretende hacerlo:
   HMAC es autenticación de mensaje, no cifrado.
2. **Contra el robo de la clave.** Quien lee `localStorage` lee la clave y
   firma sobres válidos como si fuera el dispositivo. La cadena de firma queda
   comprometida **para ese dispositivo** desde ese momento.

## Modelo de amenaza explícito (atacantes considerados)

| # | Atacante | Qué intenta | Qué lo detiene | Estado |
|---|---|---|---|---|
| A1 | Observador de red (Wi-Fi del puesto, MITM) | leer o alterar sobres en tránsito | TLS (obligatorio: `normalizarHubUrl` rechaza `http://` fuera de la LAN) **+** HMAC (alterar el cuerpo rompe la firma aunque TLS caiga) | **bloqueado** |
| A2 | Otro dispositivo de la LAN | publicar sobres propios, suplantar al puesto | Sin la clave de jornada no puede fabricar firma válida (401). El hub de producción es un Worker de Cloudflare — no está en la LAN; el hub local de LAN (`hub-local.mjs`) es mismo-equipo y su contrato sin firma ya está declarado en `envio.ts` | **bloqueado** (firma + topología) |
| A3 | Malware/XSS en el navegador del operador | leer la clave, firmar sobres válidos, leer las fotos | **La firma no lo detiene** — este ADR lo declara en vez de esconderlo | **residual aceptado** (abajo) |

**Mitigaciones existentes contra A3** (reducen la probabilidad, no la cierran):
CSP deny-by-default (`default-src 'self'`, `connect-src` solo self + el hub,
`object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` —
`public/_headers` del digitalizador), **cero third-parties** (sin CDNs, sin
analítica, sin iframes externos: motor y assets son same-origin vendidos en el
repo) y aislamiento de origen cruzado (COOP/COEP — el mismo SW/headers de COI
que exige el WASM multihilo). Nota honesta: `script-src` conserva
`'unsafe-inline'` y `'unsafe-eval'` (export estático de Next + OpenCV
emscripten — ver `_headers`), así que la frontera real frente a XSS es la
cadena de suministro del bundle (deps pinnadas, sin scripts de terceros), no
la CSP sola.

**Riesgo residual aceptado (A3):** compromiso del navegador del operador =
confianza perdida **en ese dispositivo**. Dos amortiguaciones declaradas:

- El atacante que ejecuta código ahí ya puede leer las fotos y la cola ANTES
  de que exista firma — la clave no es el activo más sensible del dispositivo
  comprometido.
- La clave es **POR JORNADA**: expira de facto al re-provisionar en la
  siguiente jornada (`fijarClaveJornada` — rotación al re-provisionar), y la
  respuesta a incidente del lado del hub ya existe (rotar `CLAVE_JORNADA` YA,
  gracia con `CLAVE_JORNADA_PREVIA`, purga de lo inyectado — `SECURITY.md`
  del digitalizador, §Respuesta a incidentes).

## Por qué `localStorage` y no WebCrypto no-extraíble

El trade-off fue consciente, no un descuido:

1. **La clave debe poder re-firmar reintentos** (cada reenvío RE-FIRMA el body
   con ts fresco — S-1 y la ventana de anti-replay) **y ser provisionada por
   el operador sin infraestructura de servidor**: la app es una PWA estática,
   sin backend que inyecte nada. El provisionado es por canal aparte (config
   local del operador, QR presencial) y la clave JAMÁS viaja en el bundle
   (que es público — `firma.ts` 0.1.1).
2. **Una `CryptoKey` no-extraíble no resiste el ataque que importa.** Un XSS
   que PIDE firmas a `crypto.subtle` firma **por proxy** sin robar nada: saca
   la clave del tablero y el resultado es el mismo — sobres válidos emitidos
   desde el dispositivo comprometido. **La extrabilidad no es la frontera
   real; el XSS lo es.** Mover la clave a no-extraíble cambia el vector
   («roba la clave») por otro equivalente («pide firmas») y cuesta el ritual
   de provisionado a mano que hoy funciona sin infraestructura.
3. Lo único que compraría `extractable: false`: que el robo no PERSISTA tras
   cerrarse la ventana del XSS (el atacante se lleva la clave vs. se queda
   sin ella). Ganancia marginal y acotada por la rotación por jornada: el
   atacante que ya ejecutó código drenó la cola y leyó las fotos durante su
   ventana.

## Evaluación de largo plazo (registro honesto)

- **Derivación por jornada (la recomendación del plan): ya es por jornada.**
  La clave se provisiona por jornada y rota al re-provisionar (`firma.ts`
  0.1.1, `SECURITY.md` la llama «rota por jornada»). No queda trabajo ahí
  salvo mantener el ritual documentado.
- **WebCrypto no-extraíble ganaría poco.** El XSS firma por proxy (punto
  anterior): NO cierra el hueco que la auditoría señaló. Si algún día se
  quiere, el cambio es local a `firma.ts` (`importKey` con `extractable:
  false` + un provisionado que derive la clave en el dispositivo en vez de
  recibirla) — registrado aquí como evaluado y descartado, no como pendiente
  olvidado.
- **Lo que SÍ movería la aguja:** cerrar **D-puente** — versionar la fuente
  del Worker en `packages/e14-puente/`. Con la fuente se vuelve auditable el
  anti-replay (R-32 lo declaró inobservable desde el cliente) y la rotación
  real de claves del lado que VALIDA las firmas. Este ADR cubre el emisor; el
  receptor sigue siendo la mitad no auditable.

## Cross-refs

- **Anti-replay del Worker (R-32):** `2026-11-16-contrato-hub-e14-puente.md`
  — ventana declarada ≤ 5 min sobre `x-e14-ts`, aplicada EN el Worker (no
  auditable sin la fuente). El ts fresco por reintento del cliente mantiene
  cada reenvío dentro de la ventana.
- **D-puente:** la recomendación de cierre (fuente a `packages/e14-puente/`)
  sigue vigente; este ADR no la reemplaza — la complementa del lado del
  emisor.
- **Token de lectura (H-2):** `token-lectura.ts` del panel — el análogo de
  LECTURA: mismo trade-off de `localStorage`, misma frontera XSS, ya declarado
  en su cabecera. Este ADR lo cita, no lo duplica.
- **Contrato del cliente:** `envio.ts` (falla cerrado, re-firma por
  reintento), `envio.test.ts` (lo encodea), `e2e/humo.spec.ts` (falla cerrado
  visible), `SECURITY.md` del digitalizador (respuesta a incidente con
  rotación).
