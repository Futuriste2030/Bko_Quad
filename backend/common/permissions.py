"""Permissions rôles vérifiées serveur."""

from rest_framework.permissions import BasePermission


class HasRole(BasePermission):
    allowed_roles = []

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        return getattr(request.user, "role", None) in self.allowed_roles


def role_permission(*roles):
    return type("RolePerm", (HasRole,), {"allowed_roles": list(roles)})


AgentRoles = role_permission("agent", "responsable", "admin")
GuideRoles = role_permission("guide", "responsable", "admin")
ManagerRoles = role_permission("responsable", "admin")
AdminRoles = role_permission("admin")
CashRoles = role_permission("agent", "guide", "responsable", "admin")
