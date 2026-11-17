# PENDIENTES-TOKEN — secretos pendientes de configurar

Documento **vivo**. Dueño: mantenedor. Lista los secretos/tokens que los
workflows y despliegues del monorepo **esperan** y que aún NO están
configurados en el entorno remoto (GitHub Actions). Nada aquí es un valor:
solo nombres, estado y uso.

## Regla de seguridad (inviolable)

- El **valor** de un secreto JAMÁS se commitea — ni en este documento ni en
  ningún otro archivo del repo (los guards de CI — gitleaks — lo vigilan).
- Si un valor se filtra o se cree filtrado: **rotar inmediatamente** en el
  proveedor (Cloudflare/GitHub) y anotar aquí la rotación con fecha.
- Alcance mínimo: cada token solo con los permisos del objetivo que usa.

## Cloudflare (despliegues)

Estado al 2026-11-19: **PENDIENTE** — ningún secret de Cloudflare está
configurado en el repo remoto todavía.

| Secreto | Estado | Dónde se usa |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | PENDIENTE | `.github/workflows/deploy-movil.yml` (build + deploy de `apps/digielect14` vía `opennextjs-cloudflare`) · también lo consumen `deploy-movil-pages.yml` y `deploy-panel.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | PENDIENTE | Mismos workflows, mismos pasos |

**Cómo se usa:** los tres workflows de deploy lo inyectan como variables de
entorno desde `secrets.CLOUDFLARE_API_TOKEN` / `secrets.CLOUDFLARE_ACCOUNT_ID`
en los pasos `build` y `deploy` de `opennextjs-cloudflare` (el panel) y en la
subida a Cloudflare Pages (móvil Pages / panel). Sin los secrets configurados,
esos pasos fallan al autenticar contra la API de Cloudflare.

**Cómo se configura:** GitHub → Settings → Secrets and variables → Actions →
«New repository secret», uno por nombre. El token de API se crea en el panel
de Cloudflare (My Profile → API Tokens) con alcance de Pages/Workers para la
cuenta objetivo.

## Verificación

- `rg -n "secrets\." .github/workflows/` — cruza los secrets consumidos contra
  esta tabla; cualquier secret nuevo de despliegue entra aquí con su estado.
- Referenciado desde: `docs/adr/INDICE.md` y la cabecera de
  `.github/workflows/deploy-movil.yml`.
