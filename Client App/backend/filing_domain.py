"""Versioned, filing-neutral domain model for UK statutory filings.

The model in this module is the authoritative boundary between accounting/tax
data and destination artefacts.  CT600 XML/PDF, accounts iXBRL, computations
iXBRL and the Companies House filing copy must be projections from one frozen
instance of this model.

This module intentionally contains no rendering or gateway code.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Iterable


FILING_DOMAIN_SCHEMA = "uk.epos.filing-domain"
FILING_DOMAIN_VERSION = "1.0.0"


class SupportLevel(str, Enum):
    SUPPORTED = "supported"
    MANDATORY_REVIEW = "supported_with_mandatory_review"
    EXPORT_ONLY = "export_only"
    UNSUPPORTED = "unsupported"


class FilingState(str, Enum):
    DRAFT = "draft"
    INTERNALLY_VALIDATED = "internally_validated"
    AUTHORITY_VALIDATOR_PASSED = "authority_validator_passed"
    AUTHORISED = "authorised"
    SUBMITTED = "submitted"
    TRANSPORT_ACKNOWLEDGED = "transport_acknowledged"
    PROCESSING = "processing"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"
    AMENDED = "amended"


FILING_STATE_TRANSITIONS: dict[FilingState, set[FilingState]] = {
    FilingState.DRAFT: {FilingState.INTERNALLY_VALIDATED},
    FilingState.INTERNALLY_VALIDATED: {
        FilingState.DRAFT,
        FilingState.AUTHORITY_VALIDATOR_PASSED,
    },
    FilingState.AUTHORITY_VALIDATOR_PASSED: {
        FilingState.DRAFT,
        FilingState.AUTHORISED,
    },
    FilingState.AUTHORISED: {
        FilingState.DRAFT,
        FilingState.SUBMITTED,
    },
    FilingState.SUBMITTED: {
        FilingState.TRANSPORT_ACKNOWLEDGED,
        FilingState.PROCESSING,
        FilingState.REJECTED,
    },
    FilingState.TRANSPORT_ACKNOWLEDGED: {
        FilingState.PROCESSING,
        FilingState.ACCEPTED,
        FilingState.REJECTED,
    },
    FilingState.PROCESSING: {
        FilingState.ACCEPTED,
        FilingState.REJECTED,
    },
    FilingState.ACCEPTED: {
        FilingState.SUPERSEDED,
        FilingState.AMENDED,
    },
    FilingState.REJECTED: {
        FilingState.DRAFT,
        FilingState.AMENDED,
    },
    FilingState.SUPERSEDED: set(),
    FilingState.AMENDED: {FilingState.INTERNALLY_VALIDATED},
}


class InvalidFilingTransition(ValueError):
    """Raised when a filing state is moved through an invalid transition."""


def transition_filing_state(current: str, target: str) -> str:
    try:
        current_state = FilingState(current)
        target_state = FilingState(target)
    except ValueError as error:
        raise InvalidFilingTransition(f"Unknown filing state: {error}") from error
    if target_state not in FILING_STATE_TRANSITIONS[current_state]:
        raise InvalidFilingTransition(
            f"Cannot move a filing from {current_state.value} to {target_state.value}."
        )
    return target_state.value


@dataclass(frozen=True)
class ProvenanceStep:
    stage: str
    source_type: str
    source_id: str
    operation: str
    value: str
    actor: str | None = None
    evidence_reference: str | None = None


@dataclass(frozen=True)
class FilingFact:
    fact_id: str
    concept: str
    value: str | bool | None
    value_type: str
    period_kind: str
    provenance: tuple[ProvenanceStep, ...]
    dimensions: dict[str, str] = field(default_factory=dict)
    taxonomy_concept: str | None = None
    ct600_box: str | None = None
    user_override: bool = False
    override_reason: str | None = None


@dataclass(frozen=True)
class FilingAdjustment:
    adjustment_id: str
    adjustment_type: str
    description: str
    amount: str
    source_fact_ids: tuple[str, ...]
    evidence_reference: str | None = None
    approved_by: str | None = None


@dataclass(frozen=True)
class FilingDomainModel:
    schema: str
    schema_version: str
    model_id: str
    client_id: str
    pack_id: str
    snapshot_id: str
    company_identity: dict[str, str]
    accounting_period: dict[str, str | None]
    accounting_standard: str
    entity_regime: str
    trading_status: str
    trial_balance_facts: tuple[FilingFact, ...]
    accounting_adjustments: tuple[FilingAdjustment, ...]
    tax_adjustments: tuple[FilingAdjustment, ...]
    capital_allowances: tuple[FilingAdjustment, ...]
    losses_and_reliefs: tuple[FilingAdjustment, ...]
    statutory_facts: tuple[FilingFact, ...]
    ct600_facts: tuple[FilingFact, ...]
    presentation_facts: tuple[FilingFact, ...]
    unsupported_conditions: tuple[str, ...]
    support_assessment: dict[str, Any]
    taxonomy_versions: dict[str, str | None]
    created_at: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def canonical_json(self) -> str:
        return json.dumps(
            self.as_dict(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def fact(self, concept: str) -> FilingFact | None:
        return next(
            (
                fact
                for fact in (
                    self.ct600_facts
                    + self.statutory_facts
                    + self.presentation_facts
                    + self.trial_balance_facts
                )
                if fact.concept == concept
            ),
            None,
        )


INITIAL_SUPPORT_MATRIX: tuple[dict[str, Any], ...] = (
    {
        "client_type": "limited_company",
        "standard": "FRS_105",
        "format": "micro",
        "trading_status": "trading",
        "level": SupportLevel.EXPORT_ONLY.value,
        "reason": "Initial straightforward-company slice; authority validation and tax computation are incomplete.",
    },
    {
        "client_type": "limited_company",
        "standard": "FRS_102_1A",
        "format": "small_full",
        "trading_status": "trading",
        "level": SupportLevel.EXPORT_ONLY.value,
        "reason": "Initial straightforward-company slice; authority validation and tax computation are incomplete.",
    },
    {
        "client_type": "limited_company",
        "standard": "*",
        "format": "dormant",
        "trading_status": "dormant",
        "level": SupportLevel.EXPORT_ONLY.value,
        "reason": "Dormant accounts may be prepared for review; destination validation is not connected.",
    },
    {
        "client_type": "limited_company",
        "standard": "FRS_102",
        "format": "full",
        "trading_status": "*",
        "level": SupportLevel.UNSUPPORTED.value,
        "reason": "Full accounts disclosures, cash flow/equity decisions and auditor workflow are incomplete.",
    },
    {
        "client_type": "limited_company",
        "standard": "IFRS",
        "format": "full",
        "trading_status": "*",
        "level": SupportLevel.UNSUPPORTED.value,
        "reason": "Complex UK-adopted IFRS filing is outside the initial production scope.",
    },
)


SPECIALIST_CT600_BOXES = {
    "95": "loans_to_participators",
    "96": "creative_industries",
    "100": "overseas_or_hybrid_complexity",
    "105": "group_or_consortium_relief",
    "110": "insurance",
    "115": "charity_or_casc",
    "120": "tonnage_tax",
    "125": "northern_ireland_regime",
    "130": "cross_border_royalties",
    "135": "ring_fence_trade",
    "140": "avoidance_disclosure",
    "141": "restitution_tax",
    "142": "research_and_development_relief",
    "143": "freeport_or_investment_zone",
    "144": "residential_property_developer_tax",
}


def _matrix_match(rule: dict[str, Any], profile: dict[str, str]) -> bool:
    return all(
        rule.get(key) in {"*", profile.get(key)}
        for key in ("client_type", "standard", "format", "trading_status")
    )


def assess_support(
    profile: dict[str, str],
    ct600_values: dict[str, Any] | None = None,
    extra_conditions: Iterable[str] = (),
) -> dict[str, Any]:
    """Return a fail-closed support assessment for a filing combination."""
    ct600_values = ct600_values or {}
    conditions = set(str(value) for value in extra_conditions if value)
    conditions.update(
        condition
        for box, condition in SPECIALIST_CT600_BOXES.items()
        if ct600_values.get(box) is True
    )
    if any(
        _decimal_non_zero(ct600_values.get(box))
        for box in ("160", "210", "215", "220", "230", "240", "250", "260", "263",
                    "265", "275", "285", "310", "312", "650", "653", "655", "780",
                    "785", "790", "795", "800", "805", "810", "815", "820", "825",
                    "830", "835", "840", "850", "855")
    ):
        conditions.add("complex_losses_gains_reliefs_or_group_amounts")
    if profile.get("period_length") not in {None, "", "standard"}:
        conditions.add("non_standard_accounting_period")
    if profile.get("audit_basis", "").startswith("audited_"):
        conditions.add("audited_accounts")

    rule = next(
        (candidate for candidate in INITIAL_SUPPORT_MATRIX if _matrix_match(candidate, profile)),
        None,
    )
    if not rule:
        rule = {
            "level": SupportLevel.UNSUPPORTED.value,
            "reason": "This filing combination is not present in the machine-enforced support matrix.",
        }
    level = rule["level"]
    reasons = [rule["reason"]]
    if conditions:
        level = SupportLevel.UNSUPPORTED.value
        reasons.append(
            "Detected conditions outside the controlled initial slice: "
            + ", ".join(sorted(conditions))
            + "."
        )
    return {
        "level": level,
        "generation_allowed": level != SupportLevel.UNSUPPORTED.value,
        "submission_allowed": level == SupportLevel.SUPPORTED.value,
        "mandatory_professional_review": level in {
            SupportLevel.MANDATORY_REVIEW.value,
            SupportLevel.EXPORT_ONLY.value,
            SupportLevel.UNSUPPORTED.value,
        },
        "conditions": sorted(conditions),
        "reasons": reasons,
        "matrix_version": FILING_DOMAIN_VERSION,
    }


def _decimal_non_zero(value: Any) -> bool:
    if value in {None, "", False}:
        return False
    try:
        return Decimal(str(value).replace(",", "")) != 0
    except (InvalidOperation, ValueError):
        return True


def project_ct600_values(model: FilingDomainModel) -> dict[str, Any]:
    """Project CT600 box values only from facts held in the frozen model."""
    return {
        str(fact.ct600_box): fact.value
        for fact in model.ct600_facts
        if fact.ct600_box
    }


def cross_document_invariants(model: FilingDomainModel) -> dict[str, Any]:
    """Check high-value facts agree across the model's output projections."""
    issues: list[dict[str, str]] = []
    ct600_by_box = project_ct600_values(model)
    concept_values: dict[tuple[str, str], set[str]] = {}
    for fact in model.statutory_facts + model.presentation_facts:
        concept_values.setdefault((fact.concept, fact.period_kind), set()).add(str(fact.value))
    for (concept, period_kind), values in concept_values.items():
        if len(values) > 1:
            issues.append({
                "code": "cross_document_fact_mismatch",
                "message": f"{concept} ({period_kind}) has inconsistent values across output projections.",
            })
    expected_company_number = model.company_identity.get("company_number", "")
    if str(ct600_by_box.get("2") or "") != expected_company_number:
        issues.append({
            "code": "company_number_mismatch",
            "message": "Company number differs between the filing identity and CT600 box 2.",
        })
    expected_end = model.accounting_period.get("to") or ""
    if str(ct600_by_box.get("35") or "") != expected_end:
        issues.append({
            "code": "period_end_mismatch",
            "message": "Period end differs between the filing period and CT600 box 35.",
        })
    return {"passed": not issues, "issues": issues}
