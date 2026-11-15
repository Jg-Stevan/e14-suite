/**
 * Tests de render — KpiCard compartido (src/shared/ui/kpi-card.tsx).
 *
 * El re-export temporal de modules/supervision/components se retiró (R2):
 * shared es ahora la única implementación, así que ya no hay paridad que
 * comparar; se conserva la cobertura del markup.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { KpiCard as KpiCardShared } from "@/shared/ui/kpi-card";

describe("KpiCard (shared/ui)", () => {
  test("render estático (sin onClick — div)", () => {
    const htmlShared = renderToStaticMarkup(
      <KpiCardShared titulo="TOTAL PUESTOS" valor={12} tono="neutral" />,
    );
    expect(htmlShared).toContain("TOTAL PUESTOS");
    expect(htmlShared).toContain("stats-number");
    expect(htmlShared).toContain("text-muted-foreground"); // apagado por neutral
    expect(htmlShared).toContain("var(--neutral-state)");
    expect(htmlShared.startsWith("<div")).toBe(true);
  });

  test("render estático idéntico (con onClick — button aria-pressed)", () => {
    const html = renderToStaticMarkup(
      <KpiCardShared titulo="ENVIADAS" valor={7} tono="success" onClick={() => {}} activo />,
    );
    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Quitar filtro"); // activo=true → label de quitar
    expect(html).toContain("var(--success)");
  });

  test("render estático idéntico (onClick sin activo — label de filtrar)", () => {
    const html = renderToStaticMarkup(
      <KpiCardShared titulo="ENVIADAS" valor={7} tono="success" onClick={() => {}} />,
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Filtrar por este estado");
  });
});
