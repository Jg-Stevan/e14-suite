/**
 * R-46 — Inyección del publicBase del paquete (dominio/entorno.ts).
 *
 * Contrato verificado línea a línea (mapa v2.3 §3.3 + R-46):
 *  · SIN configurar: publicBaseEfectivo()/urlAssetPublico() caen al env del
 *    core (`NEXT_PUBLIC_BASE_PATH ?? ""`) — default histórico byte-idéntico
 *    al que leían las consts/inline que R-46 retiró (identidad-qr · ocr ·
 *    detector-client).
 *  · CON configurarPublicBase(): la INYECCIÓN GANA al env — este test
 *    documenta el bug corregido (las lecturas directas del env ignoraban la
 *    configuración de la app anfitriona, y las consts module-level además
 *    congelaban el valor AL IMPORTAR, antes de que la app pudiera configurar).
 *  · Estado restaurado tras cada caso (beforeEach/afterEach con
 *    restablecerPublicBaseParaTest + env) para no contaminar otros tests
 *    del mismo proceso de bun.
 *
 * Corre en `bun test packages/scanner-core` (gate de ambas apps — ver
 * catches-guard.test.ts L21-23).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  configurarPublicBase,
  publicBaseEfectivo,
  restablecerPublicBaseParaTest,
  urlAssetPublico,
} from "../src/dominio/entorno";

const CLAVE_ENV = "NEXT_PUBLIC_BASE_PATH";

describe("R-46 · inyección publicBase (dominio/entorno)", () => {
  let envOriginal: string | undefined;

  beforeEach(() => {
    restablecerPublicBaseParaTest(); // estado SIN configurar (null ≠ "")
    envOriginal = process.env[CLAVE_ENV];
  });

  afterEach(() => {
    // Restaura el env EXACTO (ausente ≠ vacío — delete si no existía).
    if (envOriginal === undefined) delete process.env[CLAVE_ENV];
    else process.env[CLAVE_ENV] = envOriginal;
    restablecerPublicBaseParaTest();
  });

  test("Caso 1 · sin configurar: urlAssetPublico respeta el fallback del env", () => {
    process.env[CLAVE_ENV] = "/env-base";
    expect(publicBaseEfectivo()).toBe("/env-base");
    expect(urlAssetPublico("/wasm/x.wasm")).toBe("/env-base/wasm/x.wasm");
  });

  test("Caso 2 · configurarPublicBase GANA al env (bug corregido por R-46)", () => {
    // El env está seteado PERO la app configuró su publicBase: la inyección
    // manda (antes, las lecturas directas del env ganaban — bug documentado).
    process.env[CLAVE_ENV] = "/env-que-debe-perder";
    configurarPublicBase("/panel");
    expect(publicBaseEfectivo()).toBe("/panel");
    expect(urlAssetPublico("/wasm/x.wasm")).toBe("/panel/wasm/x.wasm");
  });

  test("Caso 3 · restaurar estado: la configuración se puede revertir a null", () => {
    configurarPublicBase("/panel");
    expect(publicBaseEfectivo()).toBe("/panel");
    restablecerPublicBaseParaTest();
    // Vuelta al estado SIN configurar: si el env existe, manda el env;
    // `configurarPublicBase("")` NO lograba esto ("" configurado suprime
    // legítimamente el fallback del env — por eso existe el reset de test).
    delete process.env[CLAVE_ENV];
    expect(publicBaseEfectivo()).toBe("");
    process.env[CLAVE_ENV] = "/env-base";
    expect(publicBaseEfectivo()).toBe("/env-base");
  });

  test("Caso 4 · sin base y sin env: url relativa pura (con y sin barra inicial)", () => {
    delete process.env[CLAVE_ENV];
    expect(publicBaseEfectivo()).toBe("");
    expect(urlAssetPublico("/wasm/x.wasm")).toBe("/wasm/x.wasm");
    // Normalización de barra: ruta relativa se referencia con "/" inicial.
    expect(urlAssetPublico("wasm/x.wasm")).toBe("/wasm/x.wasm");
  });
});
