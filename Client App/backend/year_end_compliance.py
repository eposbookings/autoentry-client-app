"""Authoritative specification registry for UK year-end filing artefacts.

This module deliberately does not call a generated document "compliant".
Compliance is an outcome of all local and destination validation gates for the
exact versioned artefacts recorded here.
"""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parent

HMRC_CT600_V1994 = {
    "authority": "HMRC",
    "product": "Corporation Tax Online",
    "release": "CT600 V3 (2026) artefacts V1.994",
    "version": "1.994",
    "namespace": "http://www.govtalk.gov.uk/taxation/CT/5",
    "published": "2025-10-10",
    "source_url": "https://www.gov.uk/government/publications/corporation-tax-technical-specifications-ct600-rim-artefacts",
    "archive_url": "https://assets.publishing.service.gov.uk/media/68e8a35c1c8b2a3b5069080c/HMRC-CT-2014-v1-994.zip",
    "archive_sha256": "504c9dc643195bb5b9ab25a86b9cff59c6312de36ade035be01ca848d0b81bed",
    "directory": BACKEND_DIR / "compliance_specs" / "hmrc" / "ct600" / "2026-v1.994",
    "archive": "HMRC-CT-2014-v1-994.zip",
    "xsd": "artefacts/HMRC-CT-2014-v1-994/CT-2014-v1-994.xsd",
    "schematron": "artefacts/HMRC-CT-2014-v1-994/CT-2014-v1-994.sch",
    "envelope_xsd": "artefacts/HMRC-CT-2014-v1-994/envelope-v2-0-HMRC.xsd",
    "specification": "artefacts/HMRC-CT-2014-v1-994/CT-specDoc-v1-994.xml",
}

COMPANIES_HOUSE_ACCOUNTS_TIS_59 = {
    "authority": "Companies House",
    "product": "Software Filing - Accounts",
    "release": "Technical Interface Specification for accounts 5.9",
    "version": "5.9",
    "published": "2026-04-01",
    "source_url": "https://www.gov.uk/government/publications/technical-interface-specifications-for-companies-house-software",
    "document_url": "https://assets.publishing.service.gov.uk/media/69c5421c23fcbcd838a6f78f/Companies_House_technical_interface_specification__TIS__for_accounts_5.9__003_.odt",
    "directory": BACKEND_DIR / "compliance_specs" / "companies_house" / "accounts" / "tis-5.9",
    "document": "companies-house-accounts-tis-5.9.odt",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def year_end_specification_status() -> dict[str, Any]:
    """Return verifiable specification provenance and implementation gates."""
    hmrc_dir = HMRC_CT600_V1994["directory"]
    archive_path = hmrc_dir / HMRC_CT600_V1994["archive"]
    xsd_path = hmrc_dir / HMRC_CT600_V1994["xsd"]
    sch_path = hmrc_dir / HMRC_CT600_V1994["schematron"]
    envelope_path = hmrc_dir / HMRC_CT600_V1994["envelope_xsd"]
    ch_document = (
        COMPANIES_HOUSE_ACCOUNTS_TIS_59["directory"]
        / COMPANIES_HOUSE_ACCOUNTS_TIS_59["document"]
    )

    archive_hash = _sha256(archive_path) if archive_path.exists() else None
    schema_version = None
    schema_namespace = None
    schematron_assertions = 0
    if xsd_path.exists():
        root = ET.parse(xsd_path).getroot()
        schema_version = root.attrib.get("version")
        schema_namespace = root.attrib.get("targetNamespace")
    if sch_path.exists():
        schematron_root = ET.parse(sch_path).getroot()
        schematron_assertions = len(
            schematron_root.findall(".//{http://purl.oclc.org/dsdl/schematron}assert")
        )

    hmrc_integrity = bool(
        archive_hash == HMRC_CT600_V1994["archive_sha256"]
        and schema_version == HMRC_CT600_V1994["version"]
        and schema_namespace == HMRC_CT600_V1994["namespace"]
        and sch_path.exists()
        and envelope_path.exists()
        and schematron_assertions
    )

    return {
        "status": "prototype_not_validated",
        "compliance_claim": False,
        "hmrc": {
            **{
                key: value
                for key, value in HMRC_CT600_V1994.items()
                if key not in {"directory"}
            },
            "artefacts_present": all(
                path.exists()
                for path in (archive_path, xsd_path, sch_path, envelope_path)
            ),
            "integrity_verified": hmrc_integrity,
            "archive_sha256_actual": archive_hash,
            "schema_assertions": schematron_assertions,
        },
        "companies_house": {
            **{
                key: value
                for key, value in COMPANIES_HOUSE_ACCOUNTS_TIS_59.items()
                if key not in {"directory"}
            },
            "specification_present": ch_document.exists(),
            "specification_sha256": _sha256(ch_document) if ch_document.exists() else None,
        },
        "release_gates": [
            {"id": "source_data", "label": "Approved immutable accounts and tax dataset", "status": "not_passed"},
            {"id": "hmrc_xsd", "label": "HMRC CT600 XML Schema validation", "status": "not_implemented"},
            {"id": "hmrc_schematron", "label": "HMRC CT600 Schematron business rules", "status": "not_implemented"},
            {"id": "ixbrl_specs", "label": "XBRL 2.1, Dimensions 1.0 and Inline XBRL 1.1", "status": "not_implemented"},
            {"id": "frc_taxonomy", "label": "Period-valid FRC taxonomy and full tagging", "status": "not_implemented"},
            {"id": "joint_filing", "label": "HMRC/Companies House joint filing checks", "status": "not_implemented"},
            {"id": "render_equivalence", "label": "Human-readable and tagged fact equivalence", "status": "not_implemented"},
            {"id": "hmrc_test", "label": "HMRC LTS/TPVS destination validation", "status": "not_connected"},
            {"id": "companies_house_test", "label": "Companies House iXBRL validator/test filing", "status": "not_connected"},
            {"id": "production_approval", "label": "Versioned approval, credentials and immutable package", "status": "not_passed"},
        ],
    }


def filing_generation_allowed() -> bool:
    """Production filing generation stays disabled until every gate passes."""
    status = year_end_specification_status()
    return bool(
        status["compliance_claim"]
        and all(gate["status"] == "passed" for gate in status["release_gates"])
    )
