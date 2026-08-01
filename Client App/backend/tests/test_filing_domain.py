from dataclasses import replace

import pytest

from backend.filing_domain import (
    FILING_DOMAIN_SCHEMA,
    FILING_DOMAIN_VERSION,
    FilingDomainModel,
    FilingFact,
    FilingState,
    InvalidFilingTransition,
    ProvenanceStep,
    SupportLevel,
    assess_support,
    cross_document_invariants,
    project_ct600_values,
    transition_filing_state,
)


def _fact(
    concept: str,
    value,
    *,
    ct600_box: str | None = None,
    taxonomy_concept: str | None = None,
) -> FilingFact:
    return FilingFact(
        fact_id=f"fact-{concept}-{ct600_box or 'none'}",
        concept=concept,
        value=value,
        value_type="money",
        period_kind="current",
        ct600_box=ct600_box,
        taxonomy_concept=taxonomy_concept,
        provenance=(
            ProvenanceStep(
                stage="source_ledger",
                source_type="journal",
                source_id="journal-1",
                operation="sum",
                value=str(value),
            ),
            ProvenanceStep(
                stage="statutory_value",
                source_type="accounts",
                source_id="accounts-1",
                operation="map",
                value=str(value),
            ),
        ),
    )


def _model() -> FilingDomainModel:
    return FilingDomainModel(
        schema=FILING_DOMAIN_SCHEMA,
        schema_version=FILING_DOMAIN_VERSION,
        model_id="model-1",
        client_id="client-1",
        pack_id="pack-1",
        snapshot_id="snapshot-1",
        company_identity={
            "legal_name": "Example Limited",
            "company_number": "12345678",
            "utr": "1234567890",
        },
        accounting_period={
            "from": "2025-05-01",
            "to": "2026-04-30",
            "comparative_from": None,
            "comparative_to": None,
        },
        accounting_standard="FRS_102_1A",
        entity_regime="small_full",
        trading_status="trading",
        trial_balance_facts=(_fact("trial_balance:4000", "100000.00"),),
        accounting_adjustments=tuple(),
        tax_adjustments=tuple(),
        capital_allowances=tuple(),
        losses_and_reliefs=tuple(),
        statutory_facts=(_fact("statutory:turnover", "100000.00"),),
        ct600_facts=(
            _fact("ct600:box:2", "12345678", ct600_box="2"),
            _fact("ct600:box:35", "2026-04-30", ct600_box="35"),
            _fact("ct600:box:145", "100000.00", ct600_box="145"),
        ),
        presentation_facts=(
            _fact(
                "statutory:turnover",
                "100000.00",
                taxonomy_concept="uk-gaap:TurnoverRevenue",
            ),
        ),
        unsupported_conditions=tuple(),
        support_assessment={"level": SupportLevel.EXPORT_ONLY.value},
        taxonomy_versions={"accounts": "frc-2026", "computations": "ct-2025"},
        created_at="2026-07-30T12:00:00Z",
    )


def test_model_is_versioned_canonical_and_hash_stable():
    model = _model()
    assert model.schema == FILING_DOMAIN_SCHEMA
    assert model.schema_version == FILING_DOMAIN_VERSION
    assert model.sha256() == _model().sha256()
    assert '"schema_version":"1.0.0"' in model.canonical_json()


def test_every_fact_requires_a_provenance_chain():
    model = _model()
    facts = (
        model.trial_balance_facts
        + model.statutory_facts
        + model.ct600_facts
        + model.presentation_facts
    )
    assert facts
    assert all(fact.provenance for fact in facts)
    assert all(fact.provenance[0].stage == "source_ledger" for fact in facts)


def test_ct600_projection_reads_only_model_facts():
    assert project_ct600_values(_model()) == {
        "2": "12345678",
        "35": "2026-04-30",
        "145": "100000.00",
    }


def test_cross_document_identity_and_period_invariants():
    assert cross_document_invariants(_model())["passed"] is True
    broken = replace(
        _model(),
        company_identity={
            "legal_name": "Example Limited",
            "company_number": "99999999",
            "utr": "1234567890",
        },
    )
    result = cross_document_invariants(broken)
    assert result["passed"] is False
    assert "company_number_mismatch" in {issue["code"] for issue in result["issues"]}


def test_initial_straightforward_company_slice_is_export_only():
    result = assess_support({
        "client_type": "limited_company",
        "standard": "FRS_102_1A",
        "format": "small_full",
        "trading_status": "trading",
        "period_length": "standard",
        "audit_basis": "audit_exempt_small_company",
    })
    assert result["level"] == SupportLevel.EXPORT_ONLY.value
    assert result["generation_allowed"] is True
    assert result["submission_allowed"] is False
    assert result["mandatory_professional_review"] is True


@pytest.mark.parametrize("box", ["95", "100", "105", "142"])
def test_specialist_ct600_selection_fails_closed(box):
    result = assess_support(
        {
            "client_type": "limited_company",
            "standard": "FRS_102_1A",
            "format": "small_full",
            "trading_status": "trading",
            "period_length": "standard",
            "audit_basis": "audit_exempt_small_company",
        },
        {box: True},
    )
    assert result["level"] == SupportLevel.UNSUPPORTED.value
    assert result["generation_allowed"] is False
    assert result["submission_allowed"] is False
    assert result["conditions"]


def test_non_zero_losses_fail_closed():
    result = assess_support(
        {
            "client_type": "limited_company",
            "standard": "FRS_102_1A",
            "format": "small_full",
            "trading_status": "trading",
            "period_length": "standard",
            "audit_basis": "audit_exempt_small_company",
        },
        {"160": "1.00"},
    )
    assert result["level"] == SupportLevel.UNSUPPORTED.value
    assert "complex_losses_gains_reliefs_or_group_amounts" in result["conditions"]


def test_state_machine_requires_explicit_authority_and_transport_stages():
    state = FilingState.DRAFT.value
    for target in (
        FilingState.INTERNALLY_VALIDATED,
        FilingState.AUTHORITY_VALIDATOR_PASSED,
        FilingState.AUTHORISED,
        FilingState.SUBMITTED,
        FilingState.TRANSPORT_ACKNOWLEDGED,
        FilingState.PROCESSING,
        FilingState.ACCEPTED,
    ):
        state = transition_filing_state(state, target.value)
    assert state == FilingState.ACCEPTED.value


def test_state_machine_rejects_draft_to_accepted_shortcut():
    with pytest.raises(InvalidFilingTransition):
        transition_filing_state(FilingState.DRAFT.value, FilingState.ACCEPTED.value)

