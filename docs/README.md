# docs/ — índice y ciclo de vida documental

Cada documento del monorepo es **VIVO** o **CONGELADO**. La distinción manda
sobre las ediciones y sobre lo que cada documento puede citar. El ciclo de
vida lo gobierna el mantenedor: una edición de un doc vivo actualiza su
contenido y sus fechas; un congelado no se toca salvo para añadir notas de
archivo.

## VIVOS — se mantienen al día; citan solo lo que existe hoy

- `README.md` de la raíz y `CONTRIBUTING.md` (kit de bienvenida)
- `docs/adr/*` — decisiones del monorepo, con `docs/adr/INDICE.md` como
  fuente de estado de la consolidación
- `docs/PENDIENTES-TOKEN.md` — checklist de secretos pendientes en CI/despliegues
- `apps/*/README.md` — portada de cada app
- `apps/*/docs/DEUDA.md` — deuda y pendientes priorizados
- `apps/*/docs/ROADMAP.md` — trabajo pendiente ordenado
- `apps/*/docs/MEDICIONES.md` — números de rendimiento y calidad
- `docs/glosario-e14.md` — vocabulario compartido del dominio

## CONGELADOS — históricos; no se editan salvo para añadir notas de archivo

- `docs/remediacion/*` — informes de la remediación 2026-11 (plan, ejecución,
  verificaciones). Los artefactos de entrega que citan (`parches/*.patch`,
  `bundle/`, `COMO-APLICAR.md`) son externos al monorepo: se entregan junto a
  cada remediación y no se versionan aquí.
- `docs/archivo/*` y `apps/*/docs/archivo/*` — archivo documental (reportes,
  runbooks retirados, snapshots).

## Regla de las dos clases

1. **Doc vivo**: toda afirmación debe sostenerse sobre el estado actual del
   repo (archivo, línea, comando de regeneración o test que la congela). Lo
   que deja de existir se actualiza o se retira en la misma edición.
2. **Doc congelado**: se conserva tal cual fue escrito. La única edición
   permitida es añadir una nota visible al inicio (con fecha) que aclare el
   contexto actual — jamás se reescribe el cuerpo histórico.
