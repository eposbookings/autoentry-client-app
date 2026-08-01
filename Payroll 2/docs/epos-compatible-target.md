# EPOS-compatible Payroll target

This is the replacement architecture for Payroll 2. The current Vinext/D1 application remains the working reference until the replacement reaches full feature and data parity. Nothing from this target is copied into EPOS Accountancy before that gate passes.

## Target technology

| Layer | Payroll 2 today | Compatibility target |
|---|---|---|
| UI | Vinext/Next-style routes, React 19.2, TypeScript | React 19.0, JavaScript/JSX, React Router 7.15, CRA/CRACO |
| API boundary | Vinext route handlers | FastAPI gateway mounted below `/api/payroll` |
| Payroll engine | Vinext route handlers | Private, containerised TypeScript worker behind the FastAPI gateway |
| Data access | Drizzle ORM | Isolated worker persistence; no ORM is imported into EPOS frontend/backend |
| Database | Cloudflare D1 / SQLite | Dedicated payroll SQLite volume, kept separate from EPOS MySQL |
| Authentication | Payroll-owned administrator sessions | EPOS Accountancy session and practice role only |
| Client gate | Payroll employer membership | EPOS client `services.payroll.enabled` entitlement |

## Final module boundary

The completed module has exactly two host dependencies:

1. an authenticated EPOS practice session containing the user and role;
2. an active EPOS client whose Payroll service is enabled.

The frontend receives a verified launch context and renders the entire payroll workspace. The backend repeats the same authorization and entitlement checks on every payroll request. Hiding the menu is a convenience, never the security boundary.

The header action is labelled **Return to EPOS Accountancy** and returns to the originating client/practice screen. It does not create a second sign-in or a second application shell.

## Loading and routing

EPOS Accountancy will own the route and lazy boundary:

```jsx
const PayrollModule = lazy(() => import("./modules/payroll/PayrollModule"));
```

The import is referenced only by the guarded `/admin/payroll/:clientId` route. The sidebar item is rendered only when the selected client has Payroll enabled. Direct navigation is also guarded, and the backend rejects every request if the entitlement is absent or disabled.

## Persistence boundary

The safest cutover preserves the tested payroll ledger instead of rewriting statutory calculations and immutable filing evidence at the same time as the application merge. Payroll therefore runs as a private worker and keeps its own database volume. EPOS MySQL stores clients and service entitlements; the worker stores payroll records and an immutable mapping from the EPOS client UUID to its internal employer ID.

- `practice_id` and `client_id` are signed into each short-lived gateway request;
- `epos_client_mappings` permanently binds one EPOS client UUID to one payroll employer;
- the worker is not published by nginx and accepts only gateway-signed requests;
- every proxy request validates the authenticated practice, client ownership, active client status and Payroll service entitlement;
- immutable filing, calculation and audit evidence remains unchanged.

No payroll tables are added to the accountancy database. The complete 71-migration payroll database is moved with the worker and checked with SQLite integrity, row-count and functional reconciliation before cutover. A later MySQL data conversion can be rehearsed independently without blocking or weakening this merge.

## Conversion sequence

1. Freeze and inventory the current 278-test behavior, 38 API areas and 70 migrations.
2. Port framework-neutral calculation and evidence libraries to JavaScript modules with parity tests.
3. Port the complete UI into one `frontend/src/modules/payroll` tree using React Router-compatible navigation and host-provided context.
4. Put every API area behind one FastAPI gateway with shared EPOS authorization and service-entitlement dependencies.
5. Add the signed EPOS client mapping and package the complete tested API/data engine as a private worker.
6. Copy the complete payroll database with an integrity and reconciliation report.
7. Run UI, API, calculation, authorization, entitlement, backup and migration parity tests.
8. Only after every gate passes, move the complete module into EPOS and connect the single lazy route/menu entry.

## Cutover gate

The module is ready to move only when all conditions are true:

- every existing Payroll test has an equivalent passing target test;
- all API areas are present behind the authenticated FastAPI gateway;
- all payroll tables and 71 migrations are packaged in the private worker;
- a disabled Payroll service hides navigation and returns `403` from every payroll API;
- users cannot select or infer another practice/client through URL or payload changes;
- the migrated React UI contains no Next/Vinext, D1, Drizzle or standalone-auth imports;
- the copied payroll database passes integrity and row-count reconciliation;
- the final target can be copied as one module, not as selected fragments.
