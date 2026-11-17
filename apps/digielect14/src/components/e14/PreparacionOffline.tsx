"use client";

/**
 * KIT e14-motor-offline-v1 — banner «Modo campo».
 *
 * Prepara el motor OCR para operar SIN conexión antes de salir al puesto.
 * La descarga es explícita (nunca 49 MB por sorpresa), verificable y
 * cancelable; si el equipo queda sin motor y sin red, lo dice en vez de
 * dejar que un acta válida se rechace por una lectura degradada.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BYTES_MOTOR,
  estadoMotorOffline,
  prepararMotorOffline,
  type ProgresoMotor,
} from "@/lib/e14/core/offline";
import { leerFlags } from "@/lib/e14/flags";

const OMITIR_KEY = "e14.motorOffline.omitir";
const MB = (bytes: number) => (bytes / 1_048_576).toFixed(1).replace(".", ",");

type Fase = "comprobando" | "incompleto" | "preparando" | "listo" | "error" | "sinRed";

export function PreparacionOffline() {
  const [visible, setVisible] = useState(false);
  const [fase, setFase] = useState<Fase>("comprobando");
  const [faltantes, setFaltantes] = useState(0);
  const [progreso, setProgreso] = useState<ProgresoMotor>({
    hechos: 0,
    total: 0,
    bytes: 0,
    bytesTotal: BYTES_MOTOR,
    actual: "",
  });
  const abortRef = useRef<AbortController | null>(null);
  const vivoRef = useRef(true);

  const comprobar = useCallback(async () => {
    const e = await estadoMotorOffline();
    if (!vivoRef.current) return;
    setFaltantes(e.faltantes.length);
    if (e.sinRed && !e.listo) {
      setFase("sinRed");
      setVisible(true);
      return;
    }
    if (e.listo) {
      setFase("listo");
      setVisible(false);
      return;
    }
    setFase("incompleto");
    setVisible(true);
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    if (!leerFlags().precargaMotorOffline) return;
    try {
      if (sessionStorage.getItem(OMITIR_KEY) === "1") return;
    } catch {
      /* modo privado */
    }
    void comprobar().catch(() => {
      // el estado real se re-verifica al volver la red; aquí solo se avisa
      if (!vivoRef.current) return;
      setFase("error");
      setVisible(true);
    });
    const alVolver = () => void comprobar().catch(() => undefined);
    window.addEventListener("online", alVolver);
    return () => {
      vivoRef.current = false;
      window.removeEventListener("online", alVolver);
      abortRef.current?.abort();
    };
  }, [comprobar]);

  const preparar = useCallback(async () => {
    if (abortRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setFase("preparando");
    setVisible(true);
    setProgreso({ hechos: 0, total: 0, bytes: 0, bytesTotal: BYTES_MOTOR, actual: "" });
    try {
      const e = await prepararMotorOffline({
        signal: ac.signal,
        onProgreso: (p) => {
          if (vivoRef.current) setProgreso(p);
        },
      });
      if (!vivoRef.current) return;
      if (ac.signal.aborted) {
        setFase("incompleto");
        setFaltantes(e.faltantes.length);
        return;
      }
      setFaltantes(e.faltantes.length);
      if (e.listo) {
        setFase("listo");
        window.setTimeout(() => vivoRef.current && setVisible(false), 5000);
      } else if (e.sinRed) {
        setFase("sinRed");
      } else {
        setFase("error");
      }
    } catch {
      // fallo del fetch o abort: la tarjeta de error lo muestra
      if (vivoRef.current && !ac.signal.aborted) setFase("error");
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, []);

  const omitir = useCallback(() => {
    try {
      sessionStorage.setItem(OMITIR_KEY, "1");
    } catch {
      /* modo privado */
    }
    setVisible(false);
  }, []);

  const cancelar = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (!visible) return null;

  const pct = progreso.bytesTotal > 0 ? Math.round((progreso.bytes / progreso.bytesTotal) * 100) : 0;
  const borde =
    fase === "listo"
      ? "border-[#10b981]/60"
      : fase === "error" || fase === "sinRed"
        ? "border-red-500/60"
        : "border-amber-500/50";

  return (
    <div
      className="fixed inset-x-3 top-3 z-[60] sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[26rem]"
      role="status"
      aria-live="polite"
    >
      <div
        className={`rounded-2xl border ${borde} bg-[#10161f]/95 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl`}
      >
        {fase === "incompleto" && (
          <>
            <h2 className="text-base font-bold">Modo campo</h2>
            <p className="mt-1 text-sm text-slate-300">
              Descarga el motor OCR completo (~{MB(BYTES_MOTOR)} MB) para escanear sin
              conexión. Hazlo antes de salir al puesto.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void preparar()}
                className="min-h-11 flex-1 rounded-xl bg-[#10b981] px-4 py-2.5 text-sm font-bold text-[#052e16] active:bg-[#0ea371]"
              >
                Preparar ahora
              </button>
              <button
                type="button"
                onClick={omitir}
                className="min-h-11 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 active:bg-white/5"
              >
                Ahora no
              </button>
            </div>
          </>
        )}

        {fase === "preparando" && (
          <>
            <h2 className="text-base font-bold">Preparando modo campo</h2>
            <p className="mt-1 text-sm text-slate-300">
              {progreso.hechos} de {progreso.total || "—"} recursos ·{" "}
              {MB(progreso.bytes)} de {MB(progreso.bytesTotal)} MB
            </p>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <button
              type="button"
              onClick={cancelar}
              className="mt-3 min-h-11 w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 active:bg-white/5"
            >
              Cancelar
            </button>
          </>
        )}

        {fase === "listo" && (
          <>
            <h2 className="text-base font-bold text-[#10b981]">Motor listo para campo</h2>
            <p className="mt-1 text-sm text-slate-300">
              Ya puedes escanear sin conexión. El equipo no volverá a descargar este
              paquete.
            </p>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="mt-3 min-h-11 w-full rounded-xl bg-[#10b981] px-4 py-2.5 text-sm font-bold text-[#052e16] active:bg-[#0ea371]"
            >
              Cerrar
            </button>
          </>
        )}

        {fase === "error" && (
          <>
            <h2 className="text-base font-bold text-red-400">No se pudo completar</h2>
            <p className="mt-1 text-sm text-slate-300">
              No se descargaron {faltantes || "algunos"} recursos del motor. Revisa la
              conexión y reintenta.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void preparar()}
                className="min-h-11 flex-1 rounded-xl bg-[#10b981] px-4 py-2.5 text-sm font-bold text-[#052e16] active:bg-[#0ea371]"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="min-h-11 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 active:bg-white/5"
              >
                Cerrar
              </button>
            </div>
          </>
        )}

        {fase === "sinRed" && (
          <>
            <h2 className="text-base font-bold text-red-400">Sin conexión y motor incompleto</h2>
            <p className="mt-1 text-sm text-slate-300">
              El motor OCR no está preparado. Conéctate a internet y prepara el equipo
              antes de salir: sin el motor, el análisis offline puede rechazar actas
              válidas.
            </p>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="mt-3 min-h-11 w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 active:bg-white/5"
            >
              Entendido
            </button>
          </>
        )}
      </div>
    </div>
  );
}
