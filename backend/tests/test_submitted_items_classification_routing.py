from backend import server


def test_unclassified_submission_does_not_default_to_purchase():
    submission = {
        "id": "sub-1",
        "type": None,
        "document_direction": None,
        "ai_document_type": "sales_invoice",
    }

    assert server.submission_route(submission) == "unclassified"


def test_confirmed_classification_controls_route():
    assert server.submission_route({"type": "sales", "document_direction": "sales"}) == "sales"
    assert server.submission_route({"type": "purchase", "document_direction": "purchase"}) == "purchase"
    assert server.submission_route({}, {"document_type": "customer_credit_note"}) == "sales"
    assert server.submission_route({}, {"document_type": "supplier_credit_note"}) == "purchase"


def test_unclassified_published_status_does_not_become_ap():
    assert server.normalize_submission_review_status("published", "unclassified", {}) == "needs_review"
    assert server.normalize_submission_review_status("reviewed", "unclassified", {}) == "needs_review"


def test_classification_map_sets_native_destinations():
    assert server.CLASSIFICATION_MAP["sales_invoice"]["accounting_destination"] == "epos_native_ar"
    assert server.CLASSIFICATION_MAP["sales_invoice"]["review_status"] == "sales_review"
    assert server.CLASSIFICATION_MAP["purchase_invoice"]["accounting_destination"] == "epos_native_ap"
    assert server.CLASSIFICATION_MAP["purchase_invoice"]["review_status"] == "purchase_review"
    assert server.CLASSIFICATION_MAP["needs_more_information"]["route"] == "unclassified"
