from fastapi import HTTPException

from backend import server


def test_xero_and_sage_provider_contracts_are_registered():
    assert server.clean_provider("XERO") == "xero"
    assert server.clean_provider("sage") == "sage"
    assert "offline_access" in server.INTEGRATION_PROVIDER_META["xero"]["scope"]
    assert "accounting.contacts" in server.INTEGRATION_PROVIDER_META["xero"]["scope"]
    assert server.INTEGRATION_PROVIDER_META["sage"]["auth_url"].startswith("https://")


def test_unknown_accounting_provider_is_rejected():
    try:
        server.clean_provider("unsupported")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "Invalid integration provider"
    else:
        raise AssertionError("Expected an unsupported provider to be rejected")


def test_provider_collection_supports_xero_and_sage_shapes():
    assert server.provider_collection({"Contacts": [{"ContactID": "xero-1"}]}, "Contacts") == [
        {"ContactID": "xero-1"}
    ]
    assert server.provider_collection({"$items": [{"id": "sage-1"}]}) == [{"id": "sage-1"}]


def test_sage_contacts_are_split_into_supplier_and_customer_lists():
    assert server.sage_contact_is_type(
        {"contact_types": [{"id": "VENDOR"}]},
        "VENDOR",
    )
    assert server.sage_contact_is_type(
        {"contact_types": [{"id": "CUSTOMER"}]},
        "CUSTOMER",
    )
    assert server.sage_contact_is_type(
        {"contact_types": [{"id": "SUPPLIER"}]},
        "VENDOR",
    )


def test_provider_routes_include_connect_callback_sync_and_config():
    routes = {
        (route.path, method)
        for route in server.app.routes
        for method in getattr(route, "methods", set())
    }
    assert ("/api/admin/integrations/{provider}/config", "GET") in routes
    assert ("/api/admin/integrations/{provider}/config", "PUT") in routes
    assert ("/api/admin/integrations/clients/{client_id}/{provider}/connect", "GET") in routes
    assert ("/api/integrations/{provider}/callback", "GET") in routes
    assert ("/api/admin/integrations/clients/{client_id}/{provider}/sync", "POST") in routes
