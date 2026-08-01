from payroll.contracts import payroll_service_enabled


def test_payroll_service_must_be_explicitly_enabled():
    assert payroll_service_enabled({"services": {"payroll": {"enabled": True}}})
    assert payroll_service_enabled({"serviceSettings": {"payroll": True}})
    assert not payroll_service_enabled({"services": {"payroll": {"enabled": False}}})
    assert not payroll_service_enabled({"services": {}})
    assert payroll_service_enabled({"service_settings": '{"payroll":{"enabled":true}}'})
    assert not payroll_service_enabled({"service_settings": "not-json"})
