from backend import server


def test_automation_routes_are_registered():
    routes = {(route.path, method) for route in server.app.routes for method in getattr(route, "methods", set())}

    assert ("/api/admin/automation", "GET") in routes
    assert ("/api/admin/automation/workflows", "POST") in routes
    assert ("/api/admin/automation/workflows/{workflow_id}", "PUT") in routes
    assert ("/api/admin/automation/workflows/{workflow_id}/execute", "POST") in routes
    assert ("/api/admin/automation/settings", "PUT") in routes


def test_native_automation_inventory_distinguishes_live_and_test_only_behaviour():
    inventory = {item["id"]: item for item in server.NATIVE_AUTOMATION_INVENTORY}

    assert inventory["submitted_items_ai_prefill"]["kind"] == "ai_assisted"
    assert inventory["submitted_items_native_publish"]["status"] == "live"
    assert inventory["bank_match_suggestions"]["status"] == "live"
    assert inventory["vat_closed_period_adjustment"]["safeguard"]
    assert inventory["custom_workflow_engine"]["status"] == "test_only"
    assert "never change accounting data" in inventory["custom_workflow_engine"]["safeguard"]


def test_automation_catalog_ids_are_unique():
    for catalog in (
        server.AUTOMATION_TRIGGER_CATALOG,
        server.AUTOMATION_ACTION_CATALOG,
        server.AUTOMATION_CONDITION_CATALOG,
    ):
        ids = [item["id"] for item in catalog]
        assert len(ids) == len(set(ids))


def test_manual_rule_runs_are_serialized_as_tests():
    run = server.serialize_automation_run(
        {
            "id": "run-1",
            "trigger_payload_json": '{"manual": true, "mode": "test"}',
            "actions_taken_json": '[{"type": "request_approval", "status": "validated"}]',
        }
    )

    assert run["execution_mode"] == "test"
    assert run["actions_taken"][0]["status"] == "validated"
