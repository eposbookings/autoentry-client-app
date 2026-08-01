# Payroll compatibility workspace

This directory is the parallel conversion target. It is intentionally kept inside Payroll 2 until the complete system passes the cutover gate in `docs/epos-compatible-target.md`.

- `frontend/` matches the EPOS React/CRA/CRACO runtime.
- `backend/` is the EPOS FastAPI authentication, entitlement and proxy boundary.
- the complete tested payroll API/data engine is packaged as a private worker at cutover; it is never exposed directly.
- `contracts/` records the complete source inventory and the only allowed host boundary.

Do not copy this directory into EPOS Accountancy while any inventory item is incomplete. The existing application remains the reference implementation throughout conversion.
