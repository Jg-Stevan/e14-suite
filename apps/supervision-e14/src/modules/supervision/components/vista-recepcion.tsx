"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileText, Inbox, Pause, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
// R4 — CLASE_CHIP único (reporte 02-b §5.1: duplicado ×3).
import { CLASE_CHIP } from "@/shared/ui/tono";
import {
  asegurarSemilla,
  consultarRecepciones,
  esLlegadaViva,
  suscribirseRecepcion,
  type EntradaRecepcion,
  type EstadoRecepcion,
} from "../data/recepcion-log";
import { tiempoRelativo } from "./tiempo";
// D-32/D-33 (plan 2026-11-12) — LOTE DE PRUEBA y REINICIAR DEMO: las 7
// muestras sintéticas entran por la COLA MASIVA y las procesa el MOTOR REAL
// (mismo pipeline del lote ×7). El desenlace publicado —status, score y foto
// PROCESADA— es el del motor, nunca telemetría anclada; el origen "demo"
// solo sostiene el chip DEMO (D89-sup) y el alcance de «Reiniciar demo».
import { reiniciarDemoPanel } from "../data/actas-runtime";
import { purgarPorOrigen } from "../data/recepcion-log";
import { fetchActasDemo } from "@/modules/digitalizador/lib/e14/actas-demo";
import { publicarDesdeActa } from "@/modules/digitalizador/store/store-e14";
import { useMasivaStore } from "@/modules/digitalizador/lib/e14/masiva/store";
import { prescanYIniciar } from "@/modules/digitalizador/lib/e14/masiva/prescan-qr";
import { leerRegistro } from "@/modules/digitalizador/lib/e14/masiva/cola";
import type { EstadoEntrada } from "@/modules/digitalizador/lib/e14/masiva/tipos";
import { KpiCard } from "@/shared/ui/kpi-card";
import { Esqueleto } from "./esqueleto";
// E2E local — la tarjeta que sondea el hub del celular (flujo cel → compu).
import { HubLocalCard } from "./hub-local-card";
// Ronda C (R2/R3/R5) — métricas del feed + reloj vivo canónico (1 s).
import { calcularMetricasFeed, type TonoRitmo } from "../data/feed-metricas";
import { useRelojSegundos } from "./reloj-vivo";
// R-55 — decisiones de Recepción (APROBADA/RECHAZADA sobre ADVERTENCIA):
// registro append-only + TERCERA FUENTE del gate (actas-runtime).
import {
  consultarDecisionesRecepcion,
  registrarDecisionRecepcion,
  suscribirseDecisionesRecepcion,
  type DecisionRecepcion,
  type DecisionRegistrada,
} from "../data/decisiones-recepcion";
// R-53 — VENTANA DE FILAS del log (misma doctrina P-25 del monitor): lógica
// pura testada (ventana-scroll.ts); aquí el wiring de refs.
import {
  alturasDeFilas,
  alturaDeEspaciador,
  rangoVisible,
} from "./ventana-scroll";
import type { FormularioTipo } from "../domain/acta";

/**
 * VISTA RECEPCIÓN DE ACTAS (kit recepcion-actas-v1, D28) — el log EN VIVO
 * de todo lo que va llegando al monitor: cada página que la CARGA MASIVA
 * entrega aterriza aquí con su desenlace (PUBLICADA · CUARENTENA D25 ·
 * SIN JOIN), la foto recibida y su destino (idEnlace D22 · mesa).
 *
 * Datos: `recepcion-log.ts` (memoria de sesión, D8) por suscripción —
 * mismo patrón del store del shell. El sembrado del ancla estático
 * (ingesta-inicial) corre 1 vez al montar. Filtros por desenlace
 * (KPIs clickeables, gesto del monitor T3) y por formulario + búsqueda.
 * VER EN MONITOR: seam por props (D27) — filas PUBLICADAS y DUPLICADAS (la
 * duplicada abre la página original que ya está publicada).
 *
 * R-53 — el log está VIRTUALIZADO con ventana-scroll (misma doctrina P-25
 * del monitor: virtualizar sin paginar): la ventana monta SOLO las filas
 * del scrollport ± margen (±3, corrección sobre precisión) con DOS
 * espaciadores <li aria-hidden> que mantienen el scrollbar honesto (medidas
 * reales por ResizeObserver + estimación de 96 px). El snapshot de pausa,
 * el destello `frescas` y el scrollport max-h-[60vh] quedan intactos.
 * R-55 — las filas ADVERTENCIA (score 6.5–7.9) ofrecen Aprobar/Rechazar:
 * la decisión vive en `decisiones-recepcion.ts` (append-only) y alimenta la
 * tercera fuente del gate del monitor; los Records de EstadoRecepcion NO
 * cambian (la decisión NO es un desenlace del embudo).
 */

type FiltroEstado = "todas" | EstadoRecepcion;
type FiltroFormulario = "todos" | FormularioTipo;

// ─── R-53 — constantes de la VENTANA DE FILAS del log ────────────────────
// Estimación de FilaRecepcion típica (hora dual + miniatura h-13 + py-3 +
// borde ≈ 95 px): se redondea a 96 y se CORRIGE por fila con medición real
// (ResizeObserver — mismo gesto de alMedirAbierto de puestos-table).
const ALTURA_FILA_RECEPCION = 96;
/** Margen ±3 filas: CORRECCIÓN sobre precisión (decisión R-53). */
const MARGEN_VENTANA = 3;
const VENTANA_INICIAL = 24;

/** Snapshot de servidor de las decisiones (useSyncExternalStore — cero
 *  mismatch SSR; identidad estable entre mutaciones). */
const DECISIONES_VACIAS: ReadonlyMap<string, DecisionRegistrada> = new Map();

/** Píldora de desenlace (mismos términos del PublicacionChip del masiva). */
const ESTADO_PILDORA: Record<EstadoRecepcion, string> = {
  PUBLICADA: "border-(--success) text-(--success)",
  BLOQUEADA: "border-(--warning) text-(--warning)",
  SIN_JOIN: "border-border text-muted-foreground",
  // Reenvío del mismo contenido: no se reprocesa — tono neutro (no es alerta).
  DUPLICADA: "border-(--outline-variant) text-muted-foreground",
};

const ETIQUETA_ESTADO: Record<EstadoRecepcion, string> = {
  PUBLICADA: "Publicada",
  BLOQUEADA: "Cuarentena",
  SIN_JOIN: "Sin join",
  DUPLICADA: "Duplicada",
};

/** "17:44:29" — hora de RECEPCIÓN en Colombia (regla del mantenedor: LOCAL=COL,
 * ronda «reloj real»). TZ explícito: el supervisor puede estar en cualquier
 * huso; esta columna siempre muestra la hora colombiana. */
function horaColombia(fecha: number): string {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Bogota",
  }).format(fecha);
}

/** "19:44:29" — hora LOCAL del país emisor (zona IANA de zonas-emisor,
 * ronda C R6). Zona inválida → "—" (jamás inventar la hora). */
function horaEnZona(fecha: number, zona: string): string {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: zona,
    }).format(fecha);
  } catch {
    // Zona IANA inválida del país emisor: "—" es el hueco honesto (R6) — jamás inventar la hora ni romper la fila del feed.
    return "—";
  }
}

/** Ronda C (R2) — tono del chip RITMO (relativo al pico de la sesión).
 * Mapea el cálculo puro (feed-metricas) a tokens CSS del sistema. */
const TONO_RITMO: Record<
  TonoRitmo,
  { etiqueta: string; token: string; clase: string }
> = {
  OPTIMO: {
    etiqueta: "Ritmo óptimo",
    token: "var(--success)",
    clase: "border-(--success) text-(--success)",
  },
  ESTABLE: {
    etiqueta: "Ritmo estable",
    token: "var(--neutral-state)",
    clase: "border-border text-muted-foreground",
  },
  LENTO: {
    etiqueta: "Ritmo lento",
    token: "var(--warning)",
    clase: "border-(--warning) text-(--warning)",
  },
  SIN_DATOS: {
    etiqueta: "Sin datos",
    token: "var(--neutral-state)",
    clase: "border-border text-muted-foreground",
  },
};

function Miniatura({ entrada }: { entrada: EntradaRecepcion }) {
  if (!entrada.srcFoto) {
    // Sin foto → hueco honesto (jamás inventar binarios — D23/D27).
    return (
      <span
        aria-hidden
        className="flex h-13 w-10 shrink-0 items-center justify-center rounded-[4px] border border-border bg-(--surface-lowest) text-muted-foreground"
      >
        <FileText className="size-4" />
      </span>
    );
  }
  return (
    <img
      src={entrada.srcFoto}
      alt={`Página ${entrada.paginaIndex ?? 1} recibida${
        entrada.nombreArchivo ? ` (${entrada.nombreArchivo})` : ""
      }`}
      className="h-13 w-10 shrink-0 rounded-[4px] border border-border object-cover"
      loading="lazy"
    />
  );
}

function FilaRecepcion({
  entrada,
  nueva,
  onVerEnMonitor,
  alMedir,
  decision,
  onDecidir,
}: {
  entrada: EntradaRecepcion;
  nueva: boolean;
  // C-17 — el sobre trae el formulario y la página (`entrada.formulario`,
  // `entrada.paginaIndex`): viajan al visor para abrir el TIPO y la PÁGINA
  // correctos (no siempre TRANSMISION ni la 1).
  onVerEnMonitor?: (
    puestoId: string,
    mesaId: string,
    tipo?: FormularioTipo,
    pagina?: number
  ) => void;
  /** R-53 — mide la altura REAL de la fila (ResizeObserver) para que los
   *  espaciadores de la ventana mantengan el scrollbar honesto. Opcional:
   *  sin ella, la fila funciona con la estimación de 96 px. */
  alMedir?: (id: string, px: number) => void;
  /** R-55 — decisión ya registrada para esta entrada (undefined = pendiente). */
  decision?: DecisionRegistrada;
  /** R-55 — registra la decisión (append-only en el módulo; él notifica). */
  onDecidir?: (idEntrada: string, decision: DecisionRecepcion) => void;
}) {
  // Una DUPLICADA no crea página nueva, pero SÍ puede abrir la original que
  // ya está en el monitor (trazabilidad sin reproceso).
  const conJoin =
    (entrada.estado === "PUBLICADA" || entrada.estado === "DUPLICADA") &&
    entrada.idEnlace !== "—";
  // R-55 — SOLO las entradas con statusActa ADVERTENCIA (score 6.5–7.9)
  // ofrecen la decisión del supervisor (mínimo pactado: minimizar — ni
  // OPTIMA ni BLOQUEADA ni SIN_JOIN la ofrecen).
  const conDecision = entrada.statusActa === "ADVERTENCIA";
  // R-53 — medición REAL de la fila (mismo patrón P-25 de puestos-table:
  // medida inicial + ResizeObserver, que también cubre el cambio de altura
  // cuando la píldora de decisión R-55 aparece bajo los botones).
  const refFila = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!alMedir) return;
    const el = refFila.current;
    if (!el) return;
    const medir = () =>
      alMedir(entrada.id, Math.round(el.getBoundingClientRect().height));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [alMedir, entrada.id]);
  return (
    <li
      ref={refFila}
      className={cn(
        "border-b border-border px-4 py-3 last:border-b-0",
        nueva && "fila-llegada"
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* Miniatura */}
        <Miniatura entrada={entrada} />

        {/* Hora dual (ronda C R6): REC = hora de RECEPCIÓN en Colombia —
            C-15: en filas del hub se muestra la LLEGADA REAL AL HUB
            (`fechaRecepcionHub`, el `ts` que el hub estampa), y solo si falta
            (filas viejas / bandeja local) cae a `fecha` del sondeo. ORIGEN =
            escaneo en la hora local del país emisor; C-07: si la fila no trae
            `fechaOrigen`, se muestra «ORIGEN —» (honestidad — jamás
            proyectar la hora del escaneo). */}
        <span className="w-40 shrink-0">
          <span className="font-data block whitespace-nowrap text-[12px] leading-4">
            REC {horaColombia(entrada.fechaRecepcionHub ?? entrada.fecha)}{" "}
            <span className="text-muted-foreground">(COL)</span>
          </span>
          {entrada.fechaOrigen !== undefined && entrada.tzOrigen ? (
            <span
              className="font-data block truncate text-[11px] text-muted-foreground"
              title={
                entrada.pais
                  ? `Escaneado en hora local de ${entrada.pais} (${entrada.tzOrigen})`
                  : `Escaneado en ${entrada.tzOrigen}`
              }
            >
              ORIGEN {horaEnZona(entrada.fechaOrigen, entrada.tzOrigen)}
              {entrada.pais
                ? ` (${entrada.pais.replace(/^\d+\s*-\s*/, "")})`
                : ""}
            </span>
          ) : (
            <span
              className="font-data block truncate text-[11px] text-muted-foreground"
              title="El origen no reportó la hora de escaneo — no se inventa"
            >
              ORIGEN —
            </span>
          )}
          <span className="font-data block text-[11px] text-muted-foreground">
            {tiempoRelativo(entrada.fecha)}
          </span>
          <span
            className={cn(
              "label-caps mt-1.5 inline-block rounded-[4px] border px-1.5 py-0.5",
              ESTADO_PILDORA[entrada.estado]
            )}
          >
            {ETIQUETA_ESTADO[entrada.estado]}
          </span>
          {entrada.origen === "puente-local" && (
            <span
              className="label-caps mt-1.5 ml-1 inline-block rounded-[4px] border border-(--outline-variant) px-1.5 py-0.5 text-muted-foreground"
              title="Llegó por la red desde un celular, traída del hub local"
            >
              DEL CELULAR
            </span>
          )}
        </span>

        {/* Destino (idEnlace D22 · mesa) + lugar impreso */}
        <span className="min-w-0 flex-1">
          <span className="font-data block truncate text-[12px] leading-5 font-semibold">
            {entrada.idEnlace !== "—" ? (
              <>
                {entrada.idEnlace} · MESA {entrada.mesa}
              </>
            ) : (
              <>DESTINO SIN CONFIRMAR</>
            )}
          </span>
          <span className="body-md block truncate text-muted-foreground">
            {entrada.pais && entrada.lugar
              ? `${entrada.pais} — ${entrada.lugar}`
              : "Sin encabezado confiable (sin clasificación AUTO)"}
          </span>
          {/* U-2 (INFORME-PRUEBAS-Y-AUDITORIA) — trazabilidad del archivo:
              dos entradas con el mismo score/mesa son indistinguibles en el
              feed sin el nombre del archivo de origen; es el campo que
              permite correlacionar la entrada con la bandeja de Carga
              Masiva y el modal revisor (auditoría de origen). */}
          {entrada.nombreArchivo && (
            <span
              className="font-data block truncate text-[11px] text-muted-foreground/70"
              title={entrada.nombreArchivo}
            >
              {entrada.nombreArchivo}
            </span>
          )}
          {entrada.motivo && (
            <span
              className={cn(
                "body-md mt-0.5 block",
                entrada.estado === "BLOQUEADA"
                  ? "text-(--warning)"
                  : "text-muted-foreground"
              )}
            >
              {entrada.estado === "BLOQUEADA" ? "CUARENTENA (D25) — " : ""}
              {entrada.motivo}
            </span>
          )}
        </span>

        {/* Formulario · página · score */}
        <span className="w-40 shrink-0">
          <span className="body-md block">
            {entrada.formulario
              ? entrada.formulario === "TRANSMISION"
                ? "TRANSMISIÓN"
                : "CÓNSUL/EMBAJADOR"
              : "Formulario n/d"}
          </span>
          <span className="font-data block text-[11px] text-muted-foreground">
            {entrada.paginaIndex
              ? `PÁG ${entrada.paginaIndex}/${entrada.paginaTotal ?? "—"}`
              : "PÁG —"}
            {typeof entrada.score === "number"
              ? ` · SCORE ${entrada.score.toFixed(1)}`
              : ""}
          </span>
        </span>

        {/* Acciones: decisión del supervisor (R-55, SOLO ADVERTENCIA) +
            aterrizar el acta en el visor del monitor (seam D27). */}
        <span className="flex w-36 shrink-0 flex-col items-stretch gap-1.5">
          {conDecision && (
            <>
              <span className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="label-caps h-9 flex-1 border-(--success) px-2 text-(--success) shadow-none disabled:opacity-40"
                  disabled={decision !== undefined}
                  aria-label={`Aprobar acta de ${entrada.idEnlace} mesa ${entrada.mesa}`}
                  title="Aprobación del supervisor — suma la tercera fuente de visibilidad en el monitor (R-55)"
                  onClick={
                    onDecidir ? () => onDecidir(entrada.id, "APROBADA") : undefined
                  }
                >
                  Aprobar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="label-caps h-9 flex-1 border-(--danger) px-2 text-(--danger) shadow-none disabled:opacity-40"
                  disabled={decision !== undefined}
                  aria-label={`Rechazar acta de ${entrada.idEnlace} mesa ${entrada.mesa}`}
                  title="Rechazo del supervisor — no suma visibilidad en el monitor (R-55)"
                  onClick={
                    onDecidir ? () => onDecidir(entrada.id, "RECHAZADA") : undefined
                  }
                >
                  Rechazar
                </Button>
              </span>
              {decision && (
                <span
                  className={cn(
                    "label-caps inline-block self-start rounded-[4px] border px-1.5 py-0.5",
                    decision.decision === "APROBADA"
                      ? "border-(--success) text-(--success)"
                      : "border-(--danger) text-(--danger)"
                  )}
                  title={
                    decision.nota
                      ? `Nota del supervisor: ${decision.nota}`
                      : "Decisión del supervisor (append-only — no se sobre-decide)"
                  }
                >
                  {decision.decision === "APROBADA" ? "APROBADA" : "RECHAZADA"}
                </span>
              )}
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="label-caps h-11 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground disabled:opacity-40"
            disabled={!conJoin}
            title={
              !conJoin
                ? "Solo las publicadas aterrizan en el monitor"
                : entrada.estado === "DUPLICADA"
                  ? "Reenvío idéntico — abre la página que ya está publicada"
                  : "Ver el acta en el monitor"
            }
            aria-label={`Ver en monitor: ${entrada.idEnlace} mesa ${entrada.mesa}`}
            onClick={
              conJoin && onVerEnMonitor
                ? () =>
                    onVerEnMonitor(
                      entrada.idEnlace,
                      entrada.mesa,
                      // C-17 — el formulario del sobre manda; null (SIN_JOIN)
                      // no llega aquí (botón deshabilitado), pero undefined
                      // deja que el shell aplique su fallback honesto.
                      entrada.formulario ?? undefined,
                      // C-17 — la página observada, no la 1 por defecto.
                      entrada.paginaIndex ?? undefined
                    )
                : undefined
            }
          >
            <FileText className="size-4" aria-hidden />
            Ver en monitor
          </Button>
        </span>
      </div>
    </li>
  );
}

/** Ronda C (R3) — sparkline del FLUJO: 60 barritas (1 s c/u), altura
 * relativa al segundo más alto de la ventana. Los segundos vacíos pisan
 * la línea base (2 px) — el hueco también es información. */
function Sparkline({ buckets }: { buckets: readonly number[] }) {
  const max = Math.max(1, ...buckets);
  return (
    <div
      className="mt-2 flex h-14 items-end gap-px"
      role="img"
      aria-label={`Flujo de llegadas de los últimos 60 segundos; pico ${max} por segundo`}
    >
      {buckets.map((v, i) => (
        <span
          key={i}
          className={cn(
            "flex-1 rounded-[1px]",
            v > 0 ? "bg-(--success)" : "bg-(--surface-lowest)"
          )}
          style={{
            height: v > 0 ? `${Math.max(12, (v / max) * 100)}%` : "2px",
          }}
          aria-hidden
        />
      ))}
    </div>
  );
}

export function VistaRecepcion({
  onVerEnMonitor,
}: {
  // C-17 — misma firma que la vista Carga Masiva: el TIPO y la PÁGINA del
  // sobre viajan al visor.
  onVerEnMonitor?: (
    puestoId: string,
    mesaId: string,
    tipo?: FormularioTipo,
    pagina?: number
  ) => void;
}) {
  // null = primera carga (skeleton — T2/T3). Cero lecturas en render SSR.
  const [entradas, setEntradas] = useState<EntradaRecepcion[] | null>(null);
  // Ronda C (R4) — PAUSAR FEED: congela la vista (snapshot) SIN cortar la
  // ingesta: la suscripción sigue llenando `entradas` (y el badge del
  // sidebar cuenta); el render lee la copia congelada hasta reanudar.
  const [pausado, setPausado] = useState(false);
  const [congeladas, setCongeladas] = useState<EntradaRecepcion[] | null>(
    null
  );
  // Ronda C (R2/R3) — reloj vivo canónico (1 s): ritmo, buckets y el
  // frescor del log se re-miden cada segundo sin setState desde effects.
  const reloj = useRelojSegundos();
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");
  const [filtroFormulario, setFiltroFormulario] =
    useState<FiltroFormulario>("todos");
  const [busqueda, setBusqueda] = useState("");
  /** Ids de llegadas frescas (destello 1.6 s — .fila-llegada). */
  const [frescas, setFrescas] = useState<Set<string>>(() => new Set());
  const temporizadores = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  /** R4-lint — la lectura inicial corre UNA vez aunque el effect se monte
   * dos veces (StrictMode); el state persiste entre esos remontajes. */
  const leimosRef = useRef(false);
  /** R4-lint — ¿hay una instancia viva de la vista AHORA? (el microtask de
   * la lectura inicial consulta esto: nada de setState tras desmontar). */
  const montadoRef = useRef(false);

  // ─── D-32 (plan 2026-11-12) — LOTE DE PRUEBA (motor real) ───────────────
  // Encola las 7 muestras SINTÉTICAS en la cola masiva y deja que el MOTOR
  // las procese (decode → warp → completitud → gate → clasificación). Cada
  // fila LISTA se publica con su resultado REAL (status/score/foto
  // PROCESADA) por el embudo de siempre, con origen "demo" — el visor
  // muestra el acta con chip DEMO y SIN depender del teléfono.
  const [simulando, setSimulando] = useState(false);
  const simularRecepcion = useCallback(async () => {
    if (simulando) return;
    setSimulando(true);
    try {
      const archivos = await fetchActasDemo();
      const antes = new Set(useMasivaStore.getState().filas.map((f) => f.id));
      await useMasivaStore.getState().agregarFiles(archivos);
      const ids = useMasivaStore
        .getState()
        .filas.filter((f) => !antes.has(f.id))
        .map((f) => f.id);
      if (ids.length === 0) return;
      await prescanYIniciar();
      // Terminales del runner: LISTA se publica; ERROR/DUPLICADA/YA-ENVIADA
      // no tienen acta propia que publicar (honestidad: nada se inventa).
      const terminal = new Set<EstadoEntrada>([
        "LISTA",
        "ERROR",
        "DUPLICADA",
        "YA-ENVIADA",
      ]);
      const limite = Date.now() + 5 * 60_000;
      const publicadas = new Set<string>();
      while (Date.now() < limite) {
        const propias = ids
          .map((id) => useMasivaStore.getState().filas.find((f) => f.id === id))
          .filter((f) => f !== undefined);
        for (const fila of propias) {
          if (fila.estado !== "LISTA" || publicadas.has(fila.id)) continue;
          publicadas.add(fila.id);
          const registro = await leerRegistro(fila.id).catch(() => null);
          if (!registro?.acta) continue;
          void publicarDesdeActa(registro.acta, () => {}, "demo");
        }
        if (propias.every((f) => terminal.has(f.estado))) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (error) {
      // la corrida de prueba jamás rompe la vista (misma doctrina del embudo)
      console.info(`[e14] demo: corrida del motor falló (${String(error)})`);
    } finally {
      setSimulando(false);
    }
  }, [simulando]);

  // ─── D-33 (plan 2026-11-12) — REINICIAR DEMO del panel ──────────────────
  // Retira SOLO el rastro demo: actas runtime publicadas con origen "demo"
  // + filas "demo" del log. El puente real y las sembradas del ancla
  // (actas-mock) NO se tocan. Confirmación inline de 2 toques (kit §6),
  // rearme solo a los 3 s.
  const [resetDemoArmado, setResetDemoArmado] = useState(false);
  useEffect(() => {
    if (!resetDemoArmado) return;
    const t = setTimeout(() => setResetDemoArmado(false), 3000);
    return () => clearTimeout(t);
  }, [resetDemoArmado]);
  const reiniciarDemo = useCallback(() => {
    if (!resetDemoArmado) {
      setResetDemoArmado(true);
      return;
    }
    const retiradas = reiniciarDemoPanel();
    const filas = purgarPorOrigen("demo");
    setResetDemoArmado(false);
    console.info(`[e14] demo: reinicio del panel (actas ${retiradas} · filas ${filas})`);
  }, [resetDemoArmado]);

  useEffect(() => {
    let vivo = true;
    montadoRef.current = true;
    // R9 — fix del warning react-hooks (antes L245): el cleanup NO debe leer
    // `temporizadores.current` (el ref puede haber cambiado cuando corra).
    // Copia LOCAL del Set al entrar al effect: la instancia del ref nunca se
    // reasigna (solo se muta in place), así que la copia es la MISMA referencia
    // viva y add/delete/clear siguen operando el set real. Accesibilidad y
    // los 44px de toque intactos — cero cambio de comportamiento.
    const temporizadoresActivos = temporizadores.current;
    // El sembrado del ancla estático corre 1 vez (idempotente) ANTES de
    // la primera lectura — la vista abre con la ingesta inicial visible.
    asegurarSemilla();
    // R4-lint (vista-recepcion.tsx:208) — la primera lectura ya NO es un
    // setState sincrónico en el cuerpo del effect (react-hooks/
    // set-state-in-effect): se difiere a una microtarea. Mismo resultado
    // observable: el skeleton ya está pintado y el log aterriza una
    // microtask después; el ref evita la doble lectura en StrictMode.
    if (!leimosRef.current) {
      leimosRef.current = true;
      queueMicrotask(() => {
        if (montadoRef.current) setEntradas(consultarRecepciones());
      });
    }
    const desuscribir = suscribirseRecepcion((entrada) => {
      if (!vivo) return;
      // C-16 — `null` = cambio estructural sin llegada (purga tras reset del
      // hub): re-lee el log, sin destello (no es una llegada viva).
      setEntradas(consultarRecepciones());
      if (!entrada || !esLlegadaViva(entrada.origen)) return;
      setFrescas((prev) => new Set(prev).add(entrada.id));
      const t = setTimeout(() => {
        setFrescas((prev) => {
          const siguiente = new Set(prev);
          siguiente.delete(entrada.id);
          return siguiente;
        });
        temporizadoresActivos.delete(t);
      }, 1_700);
      temporizadoresActivos.add(t);
    });
    return () => {
      vivo = false;
      montadoRef.current = false;
      desuscribir();
      for (const t of temporizadoresActivos) clearTimeout(t);
      temporizadoresActivos.clear();
    };
  }, []);

  /** Ronda C (R4) — pausa/reanuda el feed VISUAL (la ingesta nunca para). */
  const alternarFeed = () => {
    if (pausado) {
      setPausado(false);
      setCongeladas(null);
    } else {
      setCongeladas(consultarRecepciones());
      setPausado(true);
    }
  };

  // Fuente del render: el snapshot congelado mientras el feed está en
  // pausa; el log vivo en cuanto se reanuda (y para TODAS las métricas).
  // Memoizada (lint react-hooks/exhaustive-deps): identidad estable entre
  // renders — los useMemo de métricas/lista no se invalidan de más.
  const fuente = useMemo(
    () => (pausado && congeladas ? congeladas : (entradas ?? [])),
    [pausado, congeladas, entradas]
  );

  /** Ronda C (R4) — llegadas registradas durante la pausa (ingesta viva). */
  const pendientes =
    pausado && entradas
      ? Math.max(0, entradas.length - (congeladas?.length ?? 0))
      : 0;

  const conteos = useMemo(() => {
    const lista = fuente;
    let publicadas = 0;
    let bloqueadas = 0;
    let sinJoin = 0;
    let duplicadas = 0;
    for (const e of lista) {
      if (e.estado === "PUBLICADA") publicadas += 1;
      else if (e.estado === "BLOQUEADA") bloqueadas += 1;
      else if (e.estado === "DUPLICADA") duplicadas += 1;
      else sinJoin += 1;
    }
    // Páginas DISTINTAS recibidas: los reenvíos idénticos no cuentan como
    // procesables (ese es justamente el punto del anti-reproceso).
    const unicas = lista.length - duplicadas;
    return { total: lista.length, publicadas, bloqueadas, sinJoin, duplicadas, unicas };
  }, [fuente]);

  // Ronda C (R2/R3/R5) — métricas del feed sobre la fuente del render.
  const metricas = useMemo(
    () => calcularMetricasFeed(fuente, reloj),
    [fuente, reloj]
  );

  const visibles = useMemo(() => {
    const lista = fuente;
    const aguja = busqueda.trim().toLowerCase();
    return lista.filter((e) => {
      if (filtroEstado !== "todas" && e.estado !== filtroEstado) return false;
      if (
        filtroFormulario !== "todos" &&
        e.formulario !== filtroFormulario
      ) {
        return false;
      }
      if (!aguja) return true;
      const paja = [
        e.idEnlace,
        e.mesa,
        e.clave ?? "",
        e.pais ?? "",
        e.lugar ?? "",
        e.nombreArchivo ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return paja.includes(aguja);
    });
  }, [fuente, filtroEstado, filtroFormulario, busqueda]);

  // ─── R-55 — decisiones de Recepción (store externo, patrón reloj-vivo) ──
  // UN solo suscriptor para toda la vista: el snapshot del módulo es el Map
  // (identidad nueva por mutación — Object.is de useSyncExternalStore);
  // cada fila recibe SU decisión por prop. Snapshot de servidor vacío:
  // cero mismatch SSR.
  const decisiones = useSyncExternalStore(
    suscribirseDecisionesRecepcion,
    () => consultarDecisionesRecepcion(),
    () => DECISIONES_VACIAS
  );
  /** Registra la decisión (append-only en el módulo — él notifica a la
   *  vista). El resultado rechazado va al log de consola, jamás throw. */
  const onDecidir = useCallback(
    (idEntrada: string, decision: DecisionRecepcion) => {
      const resultado = registrarDecisionRecepcion(idEntrada, decision);
      if (!resultado.ok) {
        console.info(
          `[e14] recepción: decisión no registrada (${resultado.motivo})`
        );
      }
    },
    []
  );

  // ─── R-53 — VENTANA DE FILAS del log (patrón P-25 de puestos-table) ─────
  /** Alturas REALES medidas por fila, POR ID (estables ante el reorden del
   *  log: las llegadas hacen prepend y desplazan los ÍNDICES, no los ids). */
  const [alturasPorId, setAlturasPorId] = useState<Map<string, number>>(
    () => new Map()
  );
  const alMedir = useCallback((id: string, px: number) => {
    setAlturasPorId((prev) => {
      if (prev.get(id) === px) return prev; // identidad estable si no cambia
      const siguiente = new Map(prev);
      siguiente.set(id, px);
      return siguiente;
    });
  }, []);
  const contenedorRef = useRef<HTMLUListElement | null>(null);
  const [ventana, setVentana] = useState({ desde: 0, hasta: VENTANA_INICIAL });
  const rafScrollRef = useRef<number | null>(null);

  /** Alturas por ÍNDICE de la lista visible: medición real donde la haya
   *  (alturasDeFilas las prefiere sobre la estimación), estimación de 96 px
   *  del resto. Ambas estimaciones van iguales: aquí TODAS las filas son
   *  "cerradas" — no hay subdetalles que abran. */
  const alturas = useMemo(() => {
    const medidos = new Set<number>();
    const reales = new Map<number, number>();
    visibles.forEach((e, i) => {
      const px = alturasPorId.get(e.id);
      if (px !== undefined && px > 0) {
        medidos.add(i);
        reales.set(i, px);
      }
    });
    return alturasDeFilas(
      visibles.length,
      medidos,
      reales,
      ALTURA_FILA_RECEPCION,
      ALTURA_FILA_RECEPCION
    );
  }, [visibles, alturasPorId]);

  /** Recalcular la ventana DESDE el scroll actual (montar, alturas nuevas o
   *  llegada — JAMÁS resetea el scroll del usuario). */
  const recalcularVentana = useCallback(() => {
    const el = contenedorRef.current;
    if (!el) return;
    const r = rangoVisible(alturas, el.scrollTop, el.clientHeight, MARGEN_VENTANA);
    setVentana((v) => (v.desde === r.desde && v.hasta === r.hasta ? v : r));
  }, [alturas]);

  useEffect(() => {
    // Diferido a rAF (regla lint del repo: nada de setState sincrónico en el
    // cuerpo del effect — misma regla que puestos-table).
    const raf = requestAnimationFrame(recalcularVentana);
    return () => cancelAnimationFrame(raf);
  }, [recalcularVentana]);

  // Filtro/búsqueda con identidad nueva → contenido distinto bajo el mismo
  // scroll: volver a 0 UNA vez (NO en cada llegada — el feed vivo jamás
  // arranca al usuario de donde estaba leyendo; el recálculo por alturas
  // re-sincroniza la ventana en el scroll actual).
  useEffect(() => {
    const el = contenedorRef.current;
    if (el) el.scrollTo({ top: 0 });
    const raf = requestAnimationFrame(() =>
      setVentana({ desde: 0, hasta: VENTANA_INICIAL })
    );
    return () => cancelAnimationFrame(raf);
  }, [filtroEstado, filtroFormulario, busqueda]);

  // Scroll → ventana (rAF-throttled: O(log n) por frame, jamás por tecla).
  const alScrollVentana = useCallback(() => {
    if (rafScrollRef.current !== null) return;
    rafScrollRef.current = requestAnimationFrame(() => {
      rafScrollRef.current = null;
      const el = contenedorRef.current;
      if (!el) return;
      const r = rangoVisible(alturas, el.scrollTop, el.clientHeight, MARGEN_VENTANA);
      setVentana((v) => (v.desde === r.desde && v.hasta === r.hasta ? v : r));
    });
  }, [alturas]);

  useEffect(() => {
    return () => {
      if (rafScrollRef.current !== null) cancelAnimationFrame(rafScrollRef.current);
    };
  }, []);

  if (entradas === null) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Esqueleto className="h-11 w-full max-w-md" />
        <Esqueleto className="h-96 w-full" />
      </div>
    );
  }

  const ultima = fuente[0];

  // R-53 — espaciadores + filas de la ventana (el scrollbar HONESTO: arriba
  // + ventana + abajo ≈ la altura total del log filtrado).
  const { arriba, abajo } = alturaDeEspaciador(
    alturas,
    ventana.desde,
    ventana.hasta
  );
  const filasVentana = visibles.slice(ventana.desde, ventana.hasta);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="headline-md">Recepción de actas</h2>
          <p className="body-md mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="relative flex size-2" aria-hidden>
              {pausado ? (
                <span className="relative inline-flex size-2 rounded-full bg-(--warning)" />
              ) : (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--success) opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-(--success)" />
                </>
              )}
            </span>
            {pausado
              ? `Feed pausado — ${conteos.total} página${
                  conteos.total === 1 ? "" : "s"
                } en el log`
              : `En vivo — ${conteos.total} página${
                  conteos.total === 1 ? "" : "s"
                } recibida${conteos.total === 1 ? "" : "s"} en esta sesión`}
            {conteos.duplicadas > 0
              ? ` · ${conteos.duplicadas} duplicada${conteos.duplicadas === 1 ? "" : "s"} (no se reprocesan)`
              : ""}
            {ultima && !pausado
              ? ` · última ${tiempoRelativo(ultima.fecha).toLowerCase()}`
              : ""}
            {/* Ronda C (R5) — latencia media rec vs origen. C-07: SOLO con
                pares reales (fechaOrigen presente → recibida) y con ≥ 2
                muestras: con menos, una «media» sería un invento (la fila
                se oculta — ni división por cero ni cifras fabricadas). */}
            {metricas.latenciaMedia !== null && metricas.latenciaMuestras >= 2 && (
              <span className="font-data label-caps text-[10px] text-muted-foreground">
                · Latencia media: {metricas.latenciaMedia.toFixed(1)}s
              </span>
            )}
          </p>
        </div>
        {/* Ronda C (R4) — estado del feed + PAUSAR/REANUDAR (44 px de toque). */}
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "label-caps inline-flex h-11 items-center rounded-[4px] border px-3",
              pausado
                ? "border-(--warning) text-(--warning)"
                : "border-(--success) text-(--success)"
            )}
          >
            {pausado
              ? pendientes > 0
                ? `Pausado · ${pendientes} en cola`
                : "Pausado"
              : "Feed: transmitiendo"}
          </span>
          {/* D-32 — LOTE DE PRUEBA: las 7 muestras las procesa el motor real. */}
          <Button
            variant="outline"
            size="sm"
            className="label-caps h-11 border-(--amber) text-(--amber) hover:bg-(--amber)/10"
            onClick={() => void simularRecepcion()}
            disabled={simulando}
            title="Procesa las 7 actas sintéticas con el MOTOR real (misma cola masiva) y publica el resultado real — sin depender del teléfono"
          >
            {simulando ? "Procesando…" : "Probar motor (7 actas)"}
          </Button>
          {/* D-33 — REINICIAR DEMO: 2 toques (kit §6); purga SOLO el rastro
              demo (actas runtime "demo" + filas "demo" del log) — jamás el
              puente real ni las sembradas del ancla. */}
          <Button
            variant={resetDemoArmado ? "destructive" : "outline"}
            size="sm"
            className="label-caps h-11"
            onClick={reiniciarDemo}
            title={resetDemoArmado ? "Confirma: retira las actas y filas del lote demo de esta sesión" : "Retira el rastro demo de esta sesión (2 toques)"}
          >
            {resetDemoArmado ? "¿SEGURO?" : "Reiniciar demo"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="label-caps h-11"
            onClick={alternarFeed}
            aria-pressed={pausado}
          >
            {pausado ? (
              <Play className="size-4" aria-hidden />
            ) : (
              <Pause className="size-4" aria-hidden />
            )}
            {pausado ? "Reanudar feed" : "Pausar feed"}
          </Button>
        </div>
      </header>

      {/* Ronda C (R1/R2/R3/R7) — métricas del feed: KPI TOTAL protagonista,
          RITMO/throughput con chip y pico, FLUJO (barritas de 60 s). */}
      <div className="grid gap-3 md:grid-cols-3">
        <div
          className="rounded-[4px] border border-border border-t-2 bg-card px-4 py-3"
          style={{ borderTopColor: "var(--success)" }}
        >
          <p className="label-caps flex items-center gap-2 text-muted-foreground">
            Recibidas
            <span className="font-data rounded-[4px] border border-(--outline-variant) px-1 py-0.5 text-[10px] tracking-normal text-muted-foreground">
              TOTAL
            </span>
          </p>
          <p className="stats-number text-[2rem] leading-10 text-(--success)">
            {conteos.total}
          </p>
          <p className="body-md mt-1 text-muted-foreground">
            {conteos.unicas > 0
              ? `${conteos.publicadas}/${conteos.unicas} páginas distintas transmitidas · ${Math.round((conteos.publicadas / conteos.unicas) * 100)}%`
              : "Sin llegadas todavía en esta sesión"}
          </p>
        </div>

        <div
          className="rounded-[4px] border border-border border-t-2 bg-card px-4 py-3"
          style={{ borderTopColor: TONO_RITMO[metricas.tono].token }}
        >
          <p className="label-caps text-muted-foreground">
            Ritmo en vivo / Throughput
          </p>
          <p
            className="stats-number text-[2rem] leading-10"
            style={{ color: TONO_RITMO[metricas.tono].token }}
          >
            {metricas.ritmo}
            <span className="body-md ml-1.5 font-normal text-muted-foreground">
              actas/min
            </span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "label-caps inline-block rounded-[4px] border px-1.5 py-0.5",
                TONO_RITMO[metricas.tono].clase
              )}
            >
              {TONO_RITMO[metricas.tono].etiqueta}
            </span>
            <span className="body-md text-muted-foreground">
              Pico: {metricas.pico} actas/min
            </span>
          </p>
        </div>

        <div
          className="rounded-[4px] border border-border border-t-2 bg-card px-4 py-3"
          style={{ borderTopColor: "var(--neutral-state)" }}
        >
          <p className="label-caps text-muted-foreground">
            Flujo en tiempo real
          </p>
          <Sparkline buckets={metricas.buckets} />
          <p className="body-md mt-1 text-muted-foreground">
            Últimos 60 s · 1 barra = 1 s
          </p>
        </div>
      </div>

      {/* KPIs = filtro de desenlace (mismo gesto del monitor, kit T3). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          titulo="Recibidas"
          valor={conteos.total}
          tono="neutral"
          activo={filtroEstado === "todas"}
          onClick={() => setFiltroEstado("todas")}
        />
        <KpiCard
          titulo="Publicadas"
          valor={conteos.publicadas}
          tono="success"
          activo={filtroEstado === "PUBLICADA"}
          onClick={() =>
            setFiltroEstado(filtroEstado === "PUBLICADA" ? "todas" : "PUBLICADA")
          }
        />
        <KpiCard
          titulo="Cuarentena (D25)"
          valor={conteos.bloqueadas}
          tono="warning"
          activo={filtroEstado === "BLOQUEADA"}
          onClick={() =>
            setFiltroEstado(filtroEstado === "BLOQUEADA" ? "todas" : "BLOQUEADA")
          }
        />
        <KpiCard
          titulo="Sin join"
          valor={conteos.sinJoin}
          tono="neutral"
          activo={filtroEstado === "SIN_JOIN"}
          onClick={() =>
            setFiltroEstado(filtroEstado === "SIN_JOIN" ? "todas" : "SIN_JOIN")
          }
        />
        {/* Anti-reproceso: reenvíos idénticos del móvil (misma página + misma
            huella SHA-256) — registrados con dupOf, NO republicados. */}
        <KpiCard
          titulo="Duplicadas"
          valor={conteos.duplicadas}
          tono="neutral"
          activo={filtroEstado === "DUPLICADA"}
          onClick={() =>
            setFiltroEstado(filtroEstado === "DUPLICADA" ? "todas" : "DUPLICADA")
          }
        />
      </div>

      {/* E2E local — el puente del celular entra al mismo embudo (D25/D22). */}
      <HubLocalCard />

      {/* Filtro por formulario + búsqueda */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label="Filtro por formulario"
        >
          {(
            [
              ["todos", "Todos los formularios"],
              ["TRANSMISION", "Transmisión"],
              ["DELEGADOS", "Cónsul/Embajador"],
            ] as [FiltroFormulario, string][]
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              className={cn(
                CLASE_CHIP,
                filtroFormulario === valor &&
                  "border-(--primary) bg-(--accent) text-foreground"
              )}
              aria-pressed={filtroFormulario === valor}
              onClick={() => setFiltroFormulario(valor)}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar idEnlace, mesa, país…"
            aria-label="Búsqueda en el log de recepción"
            className="h-11 border-border bg-(--input) pl-9 font-data text-[13px] shadow-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Log en vivo (alto tope + scroll fino). */}
      {visibles.length === 0 ? (
        <div className="rounded-[4px] border border-border bg-card px-4 py-10 text-center">
          <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="body-md mt-3 text-muted-foreground">
            {conteos.total === 0
              ? "Aún no llega nada. Envía actas desde CARGA MASIVA y aparecerán aquí en vivo."
              : "Nada coincide con estos filtros."}
          </p>
        </div>
      ) : (
        <div
          className="flex max-h-[60vh] flex-col overflow-hidden rounded-[4px] border border-border bg-card"
          aria-label="Log de recepción de actas"
          role="region"
        >
          {/* Encabezado (desktop) */}
          <div
            className="hidden items-center gap-4 border-b border-border px-4 py-2 md:flex"
            aria-hidden
          >
            <span className="w-10 shrink-0" />
            <span className="label-caps w-40 shrink-0 text-muted-foreground">
              Hora (REC · origen)
            </span>
            <span className="label-caps min-w-0 flex-1 text-muted-foreground">
              Destino (idEnlace · mesa)
            </span>
            <span className="label-caps w-40 shrink-0 text-muted-foreground">
              Formulario · pág
            </span>
            <span className="label-caps w-36 shrink-0 text-muted-foreground text-right">
              Acción
            </span>
          </div>
          <ul
            ref={contenedorRef}
            onScroll={alScrollVentana}
            className="scroll-panel flex-1 overflow-y-auto"
          >
            {/* R-53 — espaciadores HONESTOS: mantienen el scrollbar a la
                altura del log completo (medidas reales + estimación de las
                no montadas). aria-hidden: el lector jamás los anuncia. */}
            {arriba > 0 && <li aria-hidden style={{ height: arriba }} />}
            {filasVentana.map((e) => (
              <FilaRecepcion
                key={e.id}
                entrada={e}
                nueva={frescas.has(e.id)}
                onVerEnMonitor={onVerEnMonitor}
                alMedir={alMedir}
                decision={decisiones.get(e.id)}
                onDecidir={onDecidir}
              />
            ))}
            {abajo > 0 && <li aria-hidden style={{ height: abajo }} />}
          </ul>
        </div>
      )}
    </div>
  );
}
