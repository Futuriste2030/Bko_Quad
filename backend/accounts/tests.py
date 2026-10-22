"""Tests tranche 2 : rôle serveur, TOTP prévu désactivé par défaut (F)."""

from django.test import TestCase

from accounts.models import User
from accounts.totp import _code, random_secret
import time


class UserTest(TestCase):
    def test_role_et_totp_prevu(self):
        u = User.objects.create_user(username="agent1", password="x", phone="+22370000001", role="agent")
        self.assertEqual(u.role, "agent")
        self.assertEqual(u.totp_secret, "")
        self.assertFalse(u.totp_enabled)

    def test_superadmin_est_compte_systeme(self):
        root = User.objects.create_user(
            username="root", password="x", phone="+22370000002", role="superadmin")
        self.assertTrue(root.is_superuser)
        self.assertTrue(root.is_staff)
        self.assertEqual(root.role, "superadmin")
        legacy = User.objects.create_user(
            username="legacy", password="x", phone="+22370000004", is_superuser=True)
        self.assertEqual(legacy.role, "superadmin")


class AdminUsersTest(TestCase):
    def setUp(self):
        self.root = User.objects.create_user(
            username="root", password="x", phone="+22370000000", role="superadmin")
        self.admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001", role="admin")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_superadmin_cree_user_et_reset(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.root)
        r = client.post("/api/v1/users/", {
            "username": "guide1", "phone": "+22370000003",
            "role": "guide", "password": "secret123",
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["role"], "guide")
        u = User.objects.get(username="guide1")
        self.assertTrue(u.check_password("secret123"))
        r2 = client.post(f"/api/v1/users/{u.id}/reset_password/", {"password": "nouveau123"})
        self.assertEqual(r2.status_code, 200)
        u.refresh_from_db()
        self.assertTrue(u.check_password("nouveau123"))

    def test_admin_ne_gere_pas_les_users(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.get("/api/v1/users/").status_code, 403)
        r = client.post("/api/v1/users/", {
            "username": "guide2", "phone": "+22370000005",
            "role": "guide", "password": "secret123",
        })
        self.assertEqual(r.status_code, 403)

    def test_agent_ne_gere_pas_les_users(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        self.assertEqual(client.get("/api/v1/users/").status_code, 403)

    def test_desactivation_reactivation_et_garde_soi_meme(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.root)
        r = client.patch(f"/api/v1/users/{self.agent.id}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200)
        self.agent.refresh_from_db()
        self.assertFalse(self.agent.is_active)
        # Auto-désactivation refusée (verrouillage du Hub).
        r2 = client.patch(f"/api/v1/users/{self.root.id}/", {"is_active": False}, format="json")
        self.assertEqual(r2.status_code, 403)
        self.root.refresh_from_db()
        self.assertTrue(self.root.is_active)
        # Réactivation.
        r3 = client.patch(f"/api/v1/users/{self.agent.id}/", {"is_active": True}, format="json")
        self.assertEqual(r3.status_code, 200)
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.is_active)

    def test_password_change_et_totp(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        r = client.post("/api/v1/auth/password/", {"old_password": "x", "new_password": "longsecret"})
        self.assertEqual(r.status_code, 200)
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.check_password("longsecret"))
        e = client.post("/api/v1/auth/totp/enroll/")
        self.assertEqual(e.status_code, 201)
        secret = e.data["secret"]
        code = _code(secret, int(time.time() // 30))
        v = client.post("/api/v1/auth/totp/verify/", {"code": code})
        self.assertEqual(v.status_code, 200)
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.totp_enabled)
        self.assertEqual(
            client.post("/api/v1/auth/totp/verify/", {"code": "000000"}).status_code, 400)
        self.assertTrue(random_secret())


class Login2faTest(TestCase):
    """Connexion : mot de passe + code TOTP si 2FA activée (F, pilote)."""

    def setUp(self):
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.auth = APIClient()
        self.agent = User.objects.create_user(
            username="agent1", password="longsecret", phone="+22370000009", role="agent")

    def login(self, **extra):
        return self.client.post(
            "/api/v1/auth/token/",
            {"username": "agent1", "password": "longsecret", **extra}, format="json")

    def _activate_2fa(self):
        """Enrôlement + vérification via un client authentifié."""
        self.auth.force_authenticate(user=self.agent)
        e = self.auth.post("/api/v1/auth/totp/enroll/")
        self.assertEqual(e.status_code, 201)
        v = self.auth.post("/api/v1/auth/totp/verify/",
                           {"code": _code(e.data["secret"], int(time.time() // 30))})
        self.assertEqual(v.status_code, 200)
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.totp_enabled)
        return e.data["secret"]

    def test_login_sans_2fa_issue_les_jetons(self):
        r = self.login()
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertIn("refresh", r.data)

    def test_mauvais_identifiants(self):
        r = self.client.post("/api/v1/auth/token/",
                             {"username": "agent1", "password": "faux"}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("totp_required", r.data)

    def test_2fa_active_exige_le_code(self):
        secret = self._activate_2fa()
        # Sans code : refusé, drapeau pour le front.
        r1 = self.login()
        self.assertEqual(r1.status_code, 401)
        self.assertTrue(r1.data["totp_required"])
        # Code faux : refusé.
        r2 = self.login(otp="000000")
        self.assertEqual(r2.status_code, 401)
        self.assertTrue(r2.data["totp_required"])
        # Code juste : jetons.
        r3 = self.login(otp=_code(secret, int(time.time() // 30)))
        self.assertEqual(r3.status_code, 200)
        self.assertIn("access", r3.data)

    def test_code_precedent_accepte_fenetre(self):
        """Fenêtre ±30 s tolérée (décalage d'horloge du téléphone)."""
        secret = self._activate_2fa()
        r = self.login(otp=_code(secret, int(time.time() // 30) - 1))
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)


class ProfileFieldsTest(TestCase):
    def setUp(self):
        from catalogue.models import Site

        self.site = Site.objects.create(name="Bamako", city="Bamako")
        self.root = User.objects.create_user(
            username="root", password="x", phone="+22370000000", role="superadmin")
        self.agent = User.objects.create_user(
            username="agent1", password="x", phone="+22370000009", role="agent")

    def test_creation_avec_identite_et_site(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.root)
        r = client.post("/api/v1/users/", {
            "username": "guide1", "phone": "+22370000003", "role": "guide",
            "password": "secret123", "first_name": "Moussa", "last_name": "Keïta",
            "site": self.site.id,
        })
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["first_name"], "Moussa")
        self.assertEqual(r.data["site_name"], "Bamako")
        u = User.objects.get(username="guide1")
        self.assertEqual(u.site_id, self.site.id)

    def test_profil_patch_et_doublon_tel_refuse(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.agent)
        r = client.patch("/api/v1/auth/me/", {
            "first_name": "Awa", "last_name": "Diallo", "phone": "+22371111111",
        }, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["first_name"], "Awa")
        self.agent.refresh_from_db()
        self.assertEqual(self.agent.phone, "+22371111111")
        r2 = client.patch("/api/v1/auth/me/", {"phone": self.root.phone}, format="json")
        self.assertEqual(r2.status_code, 400)


class RoleSeparationTest(TestCase):
    """Super admin système et admin de direction : périmètres distincts."""

    def setUp(self):
        from catalogue.models import Site

        self.site = Site.objects.create(name="Bamako", city="Bamako")
        self.root = User.objects.create_user(
            username="root", password="x", phone="+22370000000", role="superadmin")
        self.admin = User.objects.create_user(
            username="boss", password="x", phone="+22370000001",
            role="admin", site=self.site)
        self.guide = User.objects.create_user(
            username="guide1", password="x", phone="+22370000003",
            role="guide", site=self.site)

    def test_annuaire_rh_exclut_le_superadmin(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        r = client.get("/api/v1/hr/accounts/")
        self.assertEqual(r.status_code, 200)
        ids = {u["id"] for u in r.data}
        self.assertIn(self.admin.id, ids)
        self.assertIn(self.guide.id, ids)
        self.assertNotIn(self.root.id, ids)

    def test_admin_peut_avoir_un_dossier_salarie_superadmin_non(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        r = client.post("/api/v1/employees/", {
            "name": "Direction", "role": "admin", "user": self.admin.id,
        })
        self.assertEqual(r.status_code, 201)

        client.force_authenticate(user=self.root)
        r2 = client.post("/api/v1/employees/", {
            "name": "Système", "role": "superadmin", "user": self.root.id,
        })
        self.assertEqual(r2.status_code, 400)
