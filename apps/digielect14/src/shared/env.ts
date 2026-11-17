/**
 * Capa shared (R-46) — fuente única del entorno en digielect14 (mismo patrón
 * que supervision-e14/src/shared/env.ts).
 *
 * PUBLIC_BASE único: la expresión `process.env.NEXT_PUBLIC_BASE_PATH ?? ""`
 * estaba duplicada inline en el árbol de la app (flags.ts · heartbeat.client.ts
 * · pwa.ts — R-46 la unifica aquí). El paquete scanner-core la recibe además
 * POR INYECCIÓN en su bootstrap (`configurarPublicBase(PUBLIC_BASE)` —
 * packages/scanner-core/src/dominio/entorno.ts), de modo que app y núcleo
 * comparten la MISMA fuente sin que el paquete importe env de la app (regla
 * §0: app → núcleo, nunca al revés).
 *
 * MISMA expresión, nueva casa (patrón «mover sin cambiar» — doctrina
 * qr-pixeles/DICTAMEN-e73 §3.1). Cero dependencias. SSR/node-safe: en el
 * servidor Next resuelve la env var; sin ella → "" (rutas relativas).
 */
export const PUBLIC_BASE: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
