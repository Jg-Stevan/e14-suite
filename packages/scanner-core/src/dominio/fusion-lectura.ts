/**
 * Adaptador lectura cruda → contrato de fusión (KIT fusion-evidencia-divipol-v1, D89).
 *
 * Traduce la lectura CRUDA del OCR (`leerCamposCrudos`, mismas anclas §3.2 del
 * clasificador) al contrato `LecturaActa` del motor. Sin etiqueta de calidad
 * por campo, presente = legible y ausente = ilegible: la fusión ya degrada
 * por vías (una lectura con ruido entra como legible y se resuelve por
 * permutación/fuzzy).
 *
 * R-25 (H-20 — fin del duplicado byte a byte): este adaptador vivía copiado
 * A MANO en las dos apps (`digielect14/src/lib/e14/fusion-lectura.ts` y
 * `supervision-e14/.../digitalizador/lib/e14/fusion-lectura.ts`) con diff
 * byte a byte VACÍO (verificado por la auditoría 2026-11-12 y re-verificado
 * en la absorción). Su única dependencia son los módulos de dominio del
 * paquete (clasificador + fusion-tipos), así que su sitio es el motor:
 * junto a fusion.ts, que es el único al que alimenta. Las apps lo consumen
 * por subpath (`@jg-stevan/scanner-core/dominio/fusion-lectura`).
 */
import type { CamposCrudosE14 } from "./clasificador";
import type { CampoLeido, LecturaActa } from "./fusion-tipos";

function campo(valor: string | null): CampoLeido {
  return valor ? { valor, calidad: "legible" } : { valor: "", calidad: "ilegible" };
}

export function lecturaParaFusion(campos: CamposCrudosE14): LecturaActa {
  return {
    departamento: campo(campos.departamento),
    paisCodigo: campo(campos.paisCodigo),
    paisNombre: campo(campos.paisNombre),
    zona: campo(campos.zona),
    puesto: campo(campos.puesto),
    mesa: campo(campos.mesa),
    lugar: campo(campos.lugar),
    barcode: campo(campos.barcode),
    verpag: campo(campos.verpag),
    tipoBanner: campo(campos.tipoBanner),
  };
}
