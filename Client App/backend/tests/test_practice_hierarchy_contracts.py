from backend import server


def route(path: str, method: str):
    return next(
        item
        for item in server.app.routes
        if item.path == path and method in getattr(item, "methods", set())
    )


def dependency_names(path: str, method: str) -> set[str]:
    item = route(path, method)
    return {
        dependency.call.__name__
        for dependency in item.dependant.dependencies
        if getattr(dependency, "call", None)
    }


def test_platform_and_practice_management_routes_are_registered():
    assert route("/api/platform/practices", "GET")
    assert route("/api/platform/practices", "POST")
    assert route("/api/platform/practices/{practice_id}", "PUT")
    assert route("/api/admin/practice", "GET")
    assert route("/api/admin/practice", "PUT")
    assert route("/api/admin/practice/members", "GET")
    assert route("/api/admin/practice/members", "POST")
    assert route("/api/admin/practice/members/{member_id}", "PUT")


def test_global_configuration_writes_require_platform_administration():
    assert "require_platform_admin" in dependency_names("/api/admin/integrations/{provider}/config", "PUT")
    assert "require_platform_admin" in dependency_names("/api/admin/integrations/quickbooks/config", "PUT")
    assert "require_platform_admin" in dependency_names("/api/admin/integrations/companies-house/config", "PUT")
    assert "require_platform_admin" in dependency_names("/api/admin/settings/smtp", "PUT")
    assert "require_platform_admin" in dependency_names("/api/admin/settings/openai", "PUT")


def test_tenant_columns_and_permissions_exist():
    assert "practice_id" in server.users.c
    assert "practice_id" in server.automation_workflows.c
    assert "practice_id" in server.automation_runs.c
    assert "practice_id" in server.automation_settings.c
    assert "practice_members.manage" in server.PRACTICE_PERMISSION_CATALOG
    assert "integrations.manage" in server.PRACTICE_PERMISSION_CATALOG


def test_practice_admin_receives_full_practice_permissions():
    user = {"role": "practice_admin"}
    assert server.user_permissions(user) == server.PRACTICE_PERMISSION_CATALOG


def test_staff_permissions_are_allow_listed():
    user = {
        "role": "practice_staff",
        "permissions_json": '{"permissions":["clients.manage","not.real"]}',
    }
    assert server.user_permissions(user) == {"clients.manage"}
