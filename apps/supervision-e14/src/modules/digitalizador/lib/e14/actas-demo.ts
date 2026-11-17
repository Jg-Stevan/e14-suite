/**
 * actas-demo.ts — siembra del lote DEMO (botón «DEMO ×7»).
 *
 * QUÉ ES: las 7 imágenes SINTÉTICAS de la galería de simulación del
 * digitalizador (D86) — las mismas `sim-*.jpg` de `digielect14`
 * (`src/assets/simuladas/`), copiadas byte a byte a `assets-demo/simuladas`
 * (2026-11-17: el mantenedor pidió que la demo del panel use ESE lote).
 * Antes (hasta 2026-11-11) este lote eran 6 fotos REALES del consulado de El
 * Cairo — retiradas del HEAD por el hallazgo #1 de la auditoría y purgadas de
 * la historia con scripts/reescribir-historia-supervision-e14.sh (Fase 3).
 * Jamás vuelvas a commitear actas reales.
 *
 * Las 7 fotografían la MISMA acta con defectos distintos (normal, color,
 * rotada, inclinada, sombras, recortada por arriba y por abajo): el dedup
 * P-22 y el gate real las tratan como lo que son — re-fotos y recortes.
 *
 * El lote entra al módulo masiva por la MISMA puerta que cualquier archivo
 * soltado en la dropzone (`agregarFiles`): todo el pipeline real corre (QR
 * capa 0, dedup, OCR, score, gate, envío).
 */
import demoNormal from "@/modules/digitalizador/assets-demo/simuladas/sim-normal.jpg";
import demoColor from "@/modules/digitalizador/assets-demo/simuladas/sim-color.jpg";
import demoRotada from "@/modules/digitalizador/assets-demo/simuladas/sim-rotada.jpg";
import demoInclinada from "@/modules/digitalizador/assets-demo/simuladas/sim-inclinada.jpg";
import demoSombras from "@/modules/digitalizador/assets-demo/simuladas/sim-sombras.jpg";
import demoRecorteInf from "@/modules/digitalizador/assets-demo/simuladas/sim-recorte-inferior.jpg";
import demoRecorteSup from "@/modules/digitalizador/assets-demo/simuladas/sim-recorte-superior.jpg";

/** Las 7 muestras, en el orden de la galería (la limpia primero). `nombre`
 *  es el rótulo de la carpeta original — la bandeja los lista así. El import
 *  estático de Next es StaticImageData — `.src` resuelve el basePath. */
const ACTAS_DEMO: readonly { src: string; nombre: string }[] = [
  { src: demoNormal.src, nombre: "ACTA NORMAL.jpg" },
  { src: demoColor.src, nombre: "ACTA COLOR.jpg" },
  { src: demoRotada.src, nombre: "ACTA HORIZONTAL.jpg" },
  { src: demoInclinada.src, nombre: "PERSONA SIN EXPERIENCIA.jpg" },
  { src: demoSombras.src, nombre: "ACTA CON SOMBRAS.jpg" },
  { src: demoRecorteInf.src, nombre: "RECORTADA INFERIOR.jpg" },
  { src: demoRecorteSup.src, nombre: "RECORTE SUPERIOR.jpg" },
];

/** Fetch de los assets estáticos → File[] (image/jpeg) para `agregarFiles`. */
export async function fetchActasDemo(): Promise<File[]> {
  const archivos: File[] = [];
  for (const asset of ACTAS_DEMO) {
    const res = await fetch(asset.src);
    if (!res.ok) {
      throw new Error(`DEMO: no se pudo cargar la imagen incluida (${asset.nombre})`);
    }
    archivos.push(new File([await res.blob()], asset.nombre, { type: "image/jpeg" }));
  }
  return archivos;
}
