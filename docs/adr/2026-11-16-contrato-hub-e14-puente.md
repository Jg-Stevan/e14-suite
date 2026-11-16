# ADR — Contrato formal del hub `e14-puente` y registro de su exclusión

> **Estado:** VIGENTE (contrato publicado — la fuente sigue FUERA del monorepo)
> **Fecha:** 2026-11-16 · **Cierra:** R-32 (H-14 + matiz crítico 2 de la
> auditoría A, auditoría 2026-11-16) · **Decisiones relacionadas:** D99-dig
> (fuente del worker puente), D-puente (índice raíz), D92-sup (contención del
> hub local).

## Contexto

El componente más sensible del sistema — el Worker de Cloudflare que RECIBE y
SIRVE las fotos procesadas de las actas — no tiene fuente versionada en este
monorepo («paquete de remediación `e14-puente/`», citado por
`digielect14/src/lib/e14/puente/envio.ts`). Ninguna auditoría puede verificar
qué hace con las fotos, si aplica el anti-replay declarado o cuánto las
retiene. Este ADR publica el CONTRATO FORMAL verificable desde el cliente
(única parte auditable sin la fuente), registra la exclusión como deuda
explícita y fija el requisito de identidad de despliegue (SHA).

## El contrato (lo que el cliente exige y verifica)

### Escritura — `POST {hub}/v1/actas`

| Aspecto | Contrato |
|---|---|
| Cuerpo | `{ dispositivo: string, actas: EntradaPuente[] }` — tope **10** entradas por lote (el cliente envía de a **2** en gama baja) |
| Autenticación | Headers `x-e14-ts` (epoch ms del envío) + `x-e14-firma` = **HMAC-SHA256 base64** de `${ts}.${cuerpoRaw}` con la `CLAVE_JORNADA` provisionada en localStorage del operador (`firma.ts` — se RE-FIRMA en cada reintento; jamás se recicla firma) |
| Falla-cerrado | Sin clave de jornada provisionada el cliente **NO envía** nada a producción (cola intacta, tarjeta visible) |
| Respuesta | `{ ok, recibidas, publicadas, insertadas, duplicados, rechazadas[] }` |
| 410 | Contrato obsoleto → el cliente pausa la cola (banner «actualiza la PWA»), NUNCA marca actas como fallidas |
| 429 | Transitorio → reintento con backoff, cola intacta |
| Anti-replay | Basado en `x-e14-ts`: ventana declarada de **≤ 5 minutos** — se aplica EN EL WORKER (ver «lo no auditable») |
| WAF | Rate limit declarado (SECURITY.md 0.3): 30/min mutantes · 120/min lecturas |

### `EntradaPuente` (el sobre — tipos.ts)

| Campo | Tipo | Notas |
|---|---|---|
| `idEnlace` | string | DIVIPOLA `dept_mun_zona(3)_puesto(2)` — la clave de join |
| `mesa` | string | 3 dígitos |
| `formulario` | `TRANSMISION \| …` | Formulario del E-14 |
| `paginaIndex/paginaTotal` | number | 1-based |
| `srcFoto` | string \| null | **dataURL de la foto PROCESADA** — el único dato que sale del dispositivo |
| `impresion` | objeto | Encabezado IMPRESO verbatim (se muestra, no se interpreta) |
| `nombreArchivo` | string | Convención `E14_<idEnlace>_<mesa>_<FORM>-<pag>.png` |
| `score` | number | 0..10 |
| `statusActa` | string | Desenlace del gate |
| `hashSha256?` | hex 64 | SHA-256 de los BYTES de `srcFoto` (C-08) — ausente jamás relleno |
| `qrPayload?` | string | Payload exacto normalizado del código impreso (P-22, capa 2 anti-reproceso) |
| `dhash64?` | hex 16 | Hash perceptual de la foto (P-22, capa 3 — Hamming ≤ 6) |
| `tsEscaneo?` | epoch ms | Hora del gate en el móvil (C-07 — honestidad de latencias) |

Reservados del hub (el sobre NO puede pisarlos): `seq`, `ts`, `dispositivo`
en la respuesta, `hashHub`.

### Lectura — `GET {hub}/actas?desde=<seq>`

Autenticada con `Authorization: Bearer <token de lectura>` (0.2/H-2 — el
token lo pega el supervisor en Configuración; jamás en el bundle). Respuesta:
`{ ok, ahora, total, hay, proximoSeq, generacion, actas[] }` con cursor
exclusivo por SEQ. La foto se sirve por `fotoUrl` relativa.

## Lo que NO es auditable sin la fuente (declarado, no oculto)

1. **Retención y almacenamiento de las fotos en el Worker** — TTL, borrado,
   replicación: desconocidos desde el monorepo.
2. **La aplicación real del anti-replay de 5 min** — el cliente envía el ts;
   si el Worker lo valida con la ventana declarada es inobservable desde
   fuera.
3. **El tratamiento del token de lectura** (almacenamiento, rotación).

Estas tres incógnitas son la razón del requisito siguiente.

## Requisito de identidad de despliegue (SHA)

Todo despliegue del Worker a producción debe ser **identificable**:

- Cada `wrangler deploy` de `e14-puente` registra su **deployment ID** de
  Cloudflare (o el SHA del commit desplegado) en la tabla de abajo.
- El Worker expone `GET {hub}/__version` (o equivalente interno protegido)
  con `{ version, deploySha, deployTs }` — la fuente, al versionarse en el
  monorepo, lo derivará del SHA del commit en el pipeline.
- Un despliegue sin entrada en la tabla es un hallazgo de auditoría (no un
  silencio aceptable).

| Fecha | Deployment ID / SHA | Desplegado por | Nota |
|---|---|---|---|
| (histórico) | desconocido — pre-contrato | mantenedor | El Worker actual sirve `e14-puente.julistevan02.workers.dev` |

## Camino de cierre (D99-dig / D-puente)

La exclusión se cierra trayendo la fuente a `packages/e14-puente/`
(wrangler.toml, tests y CI de despliegue de mínimo privilegio). Mientras
tanto, este contrato es la frontera auditable: si el Worker cambia su
comportamiento frente a lo publicado aquí, el contrato del cliente
(`envio.test.ts` — que encodea este contrato completo) lo grita desde el
lado móvil.
