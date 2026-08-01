# Filing-domain architecture

Status: implemented foundation, release level A in progress  
Schema: `uk.epos.filing-domain` version `1.0.0`

## Non-negotiable boundary

The frozen filing-domain model is the single source for every statutory output:

```text
ledger / trial balance
  -> accounting adjustments
  -> tax adjustments, allowances, losses and reliefs
  -> statutory facts
  -> taxonomy presentation facts
  -> CT600 box facts
  -> destination projections
```

CT600, accounts iXBRL, computations iXBRL and the Companies House filing copy
must not introduce independent calculations. Each generated output records the
same `filing_domain_model_id` and SHA-256 model hash.

Every fact contains an ordered provenance chain. User overrides are explicit
facts with an override flag and reason; they do not overwrite their source
silently.

## Initial support scope

The support matrix is code, not guidance. It is evaluated before filing
readiness is reported.

| Combination | Current level |
|---|---|
| FRS 105 micro trading company | Export only |
| FRS 102 Section 1A small trading company | Export only |
| UK GAAP dormant company | Export only |
| Full FRS 102 accounts | Unsupported |
| UK-adopted IFRS full accounts | Unsupported |
| Unlisted combinations | Unsupported |

Supplementary CT600 regimes, complex losses/gains/reliefs, groups, audited
accounts and non-standard periods fail closed. “Export only” means a draft can
be prepared for mandatory professional review, but submission is disabled.

No combination is marked `supported` until the applicable computation engine,
recognised XBRL validation and authority test gateway have passed.

## Filing state

The allowed state sequence is explicit:

```text
draft
  -> internally_validated
  -> authority_validator_passed
  -> authorised
  -> submitted
  -> transport_acknowledged
  -> processing
  -> accepted | rejected
  -> superseded | amended
```

The implementation rejects shortcuts such as `draft -> accepted`. An
acknowledgement is not acceptance.

## Release gates

- Level A — generation complete
- Level B — validator complete
- Level C — test-gateway complete
- Level D — controlled production pilot

Production filing remains disabled until every release gate is passed.

Local and authority-integration test suites are reported separately. A local
green build must never imply that HMRC or Companies House tests ran.

## Next controlled slice

The next implementation should be the straightforward trading-company
Corporation Tax calculation:

1. profit before tax from the frozen statutory facts;
2. reviewed add-backs and deductions;
3. taxable trading profit;
4. tax rate and period apportionment;
5. CT600 box projections;
6. computation taxonomy projections;
7. reconciliations and worked golden cases;
8. explicit unsupported-condition detection.

Capital allowances, losses, group relief, loan relationships, property,
chargeable gains and specialist regimes should be separate subsequent slices.

