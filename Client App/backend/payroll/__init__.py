"""EPOS-compatible payroll module package."""

from .router import create_payroll_router, payroll_service_enabled

__all__ = ["create_payroll_router", "payroll_service_enabled"]
