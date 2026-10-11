"""Tests tranche 2 : rôle serveur, TOTP prévu désactivé par défaut (F)."""

from django.test import TestCase

from accounts.models import User


class UserTest(TestCase):
    def test_role_et_totp_prevu(self):
        u = User.objects.create_user(username="agent1", password="x", phone="+22370000001", role="agent")
        self.assertEqual(u.role, "agent")
        self.assertEqual(u.totp_secret, "")
        self.assertFalse(u.totp_enabled)
