"""Tests paie façon Hub Digi : fiche mensuelle unique, numéro auto, cachet requis,
clôture verrouillée, versements en caisse, suppression brouillon seul."""

import base64
import io
import shutil
import tempfile
from datetime import date

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from accounts.models import User
from catalogue.models import Site
from common.models import CompanyProfile
from finance.models import CashAdvance, CashbookEntry
from finance.services import add_entry
from payroll.models import (
    DocumentSignature, HRLetter, Contract, Employee, PayrollSheet,
)
from payroll.services import (
    PayrollError, close_sheet, delete_sheet, fill_team, generate_payslip, open_sheet,
    pay_payslip, set_base_amount,
)


class SheetTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", password="x", phone="+22370000001", role="admin")
        add_entry(day=date(2026, 10, 1), category="recette_reservation",
                  label="Fonds", direction="in", amount=500000, created_by=self.admin)
        self.emp = Employee.objects.create(name="A. Diallo", role="guide")
        Contract.objects.create(employee=self.emp, start=date(2026, 1, 1), base_salary=150000)

    def test_fiche_unique_par_mois(self):
        open_sheet(2026, 10)
        with self.assertRaises(PayrollError):
            open_sheet(2026, 10)
        self.assertEqual(PayrollSheet.objects.count(), 1)

    def test_ligne_numero_auto_et_avances(self):
        CashAdvance.objects.create(employee_name="A. Diallo", date=date(2026, 10, 3),
                                   voucher="202610-001", reason="Urgence", amount=30000)
        sheet = open_sheet(2026, 10)
        slip = generate_payslip(sheet_id=sheet.id, employee_id=self.emp.id,
                                bonuses=[("Prime sortie", 20000)],
                                legal_deductions=[("ITS", 10000)])
        self.assertEqual(slip.number, "PAIE-2026-10-001")
        self.assertEqual(slip.position, "guide")
        self.assertEqual(slip.gross, 170000)
        # 10000 ITS + 30000 avance = 40000 retenues -> net 130000.
        self.assertEqual(slip.net, 130000)

    def test_cloture_exige_cachet_puis_verrouille(self):
        sheet = open_sheet(2026, 10)
        slip = generate_payslip(sheet_id=sheet.id, employee_id=self.emp.id)
        with self.assertRaises(PayrollError):
            close_sheet(sheet_id=sheet.id, actor=self.admin)
        sheet.stamp = "paie/cachet.png"
        sheet.save()
        close_sheet(sheet_id=sheet.id, actor=self.admin)
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, "closed")
        # Versement possible après clôture, décaissé en caisse.
        pay_payslip(payslip_id=slip.id, amount=50000, paid_by=self.admin)
        self.assertEqual(CashbookEntry.objects.filter(category="salaire").count(), 1)
        with self.assertRaises(PayrollError):
            pay_payslip(payslip_id=slip.id, amount=200000, paid_by=self.admin)

    def test_suppression_brouillon_seul(self):
        sheet = open_sheet(2026, 10)
        delete_sheet(sheet_id=sheet.id)
        self.assertEqual(PayrollSheet.objects.count(), 0)
        sheet = open_sheet(2026, 10)
        slip = generate_payslip(sheet_id=sheet.id, employee_id=self.emp.id)
        sheet.stamp = "paie/cachet.png"
        sheet.save()
        close_sheet(sheet_id=sheet.id, actor=self.admin)
        with self.assertRaises(PayrollError):
            delete_sheet(sheet_id=sheet.id)
        self.assertEqual(PayrollSheet.objects.count(), 1)

    def test_ligne_depuis_compte_et_base_saisie_libre(self):
        u = User.objects.create_user(
            username="guide1", password="x", phone="+22370000009", role="guide",
            first_name="Moussa", last_name="Keïta")
        sheet = open_sheet(2026, 10)
        # Sans contrat : base 0, tout est saisi.
        slip = generate_payslip(sheet_id=sheet.id, user_id=u.id)
        self.assertEqual(slip.employee.name, "Moussa Keïta")
        self.assertEqual(slip.position, "guide")
        self.assertEqual(slip.base_amount, 0)
        set_base_amount(payslip_id=slip.id, amount=150000)
        slip.refresh_from_db()
        self.assertEqual(slip.gross, 150000)
        self.assertEqual(slip.net, 150000)
        self.assertEqual(slip.number, "PAIE-2026-10-001")

    def test_fill_team_depuis_comptes(self):
        User.objects.create_user(
            username="guide1", password="x", phone="+22370000009", role="guide",
            first_name="Moussa", last_name="Keïta")
        sheet = open_sheet(2026, 10)
        # admin1 (setUp) + guide1 = 2 lignes.
        self.assertEqual(fill_team(sheet_id=sheet.id), 2)
        self.assertEqual(fill_team(sheet_id=sheet.id), 0)  # idempotent


class SheetApiTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", password="x", phone="+22370000001", role="admin")
        self.comptable = User.objects.create_user(
            username="compta1", password="x", phone="+22370000002", role="comptable")
        self.compte = User.objects.create_user(
            username="guide1", password="x", phone="+22370000009", role="guide",
            first_name="Moussa", last_name="Keïta")
        emp = Employee.objects.create(name="Moussa Keïta", role="guide")
        Contract.objects.create(employee=emp, start=date(2026, 1, 1), base_salary=150000)

    def test_cycle_complet_api(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.admin)
        c = client.post("/api/v1/sheets/create_sheet/", {"year": 2026, "month": 11})
        self.assertEqual(c.status_code, 201)
        sheet_id = c.data["id"]
        doublon = client.post("/api/v1/sheets/create_sheet/", {"year": 2026, "month": 11})
        self.assertEqual(doublon.status_code, 400)
        f = client.post(f"/api/v1/sheets/{sheet_id}/fill_team/", {})
        self.assertEqual(f.status_code, 200)
        # admin + comptable + Moussa Keïta (contrat 150 000).
        self.assertEqual(f.data["created"], 3)
        detail = client.get(f"/api/v1/sheets/{sheet_id}/")
        self.assertEqual(detail.data["total"], 150000)
        numero = detail.data["slips"][0]["number"]
        self.assertTrue(numero.startswith("PAIE-2026-11-"))
        # Clôture bloquée sans cachet.
        self.assertEqual(client.post(f"/api/v1/sheets/{sheet_id}/close/", {}).status_code, 400)
        self.assertEqual(client.get(f"/api/v1/sheets/{sheet_id}/").data["status"], "draft")

    def test_comptable_lecture_seule(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.comptable)
        self.assertEqual(client.get("/api/v1/sheets/").status_code, 200)
        self.assertEqual(client.post("/api/v1/sheets/create_sheet/",
                                     {"year": 2026, "month": 11}).status_code, 403)


class HRWorkflowTest(TestCase):
    """Contrats/courriers : brouillon, envoi signé entreprise, signature salarié,
    verrouillage, PDF, permissions et application des augmentations."""

    @classmethod
    def setUpClass(cls):
        cls._media = tempfile.mkdtemp()
        cls._override = override_settings(MEDIA_ROOT=cls._media)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media, ignore_errors=True)

    def setUp(self):
        self.site = Site.objects.create(name="Konibabougou")
        self.other_site = Site.objects.create(name="Bamako")
        self.admin = User.objects.create_user(
            username="rh-admin", password="x", phone="+22370001001", role="admin")
        self.comptable = User.objects.create_user(
            username="rh-compta", password="x", phone="+22370001002", role="comptable")
        self.responsable = User.objects.create_user(
            username="rh-resp", password="x", phone="+22370001003", role="responsable",
            site=self.site)
        self.guide_user = User.objects.create_user(
            username="rh-guide", password="x", phone="+22370001004", role="guide",
            site=self.site, first_name="Moussa", last_name="Keita")
        self.other_guide = User.objects.create_user(
            username="rh-guide2", password="x", phone="+22370001005", role="guide",
            site=self.other_site, first_name="Awa", last_name="Traore")
        self.client_user = User.objects.create_user(
            username="rh-client", password="x", phone="+22370001006", role="client")
        self.employee = Employee.objects.create(
            name="Moussa Keita", role="guide", site=self.site, user=self.guide_user)
        self.other_employee = Employee.objects.create(
            name="Awa Traore", role="guide", site=self.other_site, user=self.other_guide)
        self.profile, _ = CompanyProfile.objects.update_or_create(
            pk=1, defaults={"name": "BKO Quad", "signature_name": "La Direction"})
        buf = io.BytesIO()
        Image.new("RGB", (120, 50), "white").save(buf, format="PNG")
        self.png = buf.getvalue()
        self.profile.signature.save(
            "signature.png", SimpleUploadedFile("signature.png", self.png,
                                                content_type="image/png"),
            save=True)
        self.signature_url = "data:image/png;base64," + base64.b64encode(
            self.png).decode("ascii")

    def api(self, user):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def create_contract(self, employee=None, **overrides):
        payload = {
            "employee": (employee or self.employee).id,
            "start": "2026-01-01",
            "base_salary": 150000,
            "contract_type": "cdi",
            "weekly_hours": 40,
        }
        payload.update(overrides)
        response = self.api(self.admin).post("/api/v1/contracts/", payload)
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def send(self, contract_id, user=None):
        return self.api(user or self.admin).post(f"/api/v1/contracts/{contract_id}/send/")

    def sign(self, contract_id, user=None, name="Moussa Keita", consent=True,
             signature=None):
        return self.api(user or self.guide_user).post(
            f"/api/v1/contracts/{contract_id}/sign/",
            {"full_name": name, "signature": signature or self.signature_url,
             "consent": consent}, format="json")

    def test_contract_defaults_and_draft_edition(self):
        contract = self.create_contract()
        self.assertTrue(contract["reference"].startswith("CTR-"))
        self.assertEqual(contract["status"], "draft")
        self.assertIn("CONTRAT DE TRAVAIL", contract["content"])
        self.assertEqual(contract["job_title"], "guide")
        self.assertEqual(contract["workplace"], "Konibabougou")
        self.assertFalse(contract["has_pdf"])
        self.assertEqual(DocumentSignature.objects.count(), 0)
        regenerated = self.api(self.admin).patch(
            f"/api/v1/contracts/{contract['id']}/",
            {"base_salary": 175000}, format="json")
        self.assertEqual(regenerated.status_code, 200)
        self.assertIn("175 000", regenerated.data["content"])
        update = self.api(self.admin).patch(
            f"/api/v1/contracts/{contract['id']}/",
            {"content": "Article 1 - Texte personnalise."}, format="json")
        self.assertEqual(update.status_code, 200)
        self.assertIn("Texte personnalise", update.data["content"])
        blank = self.api(self.admin).patch(
            f"/api/v1/contracts/{contract['id']}/",
            {"content": "   "}, format="json")
        self.assertEqual(blank.status_code, 200)
        self.assertIn("CONTRAT DE TRAVAIL", blank.data["content"])
        self.assertNotIn("Texte personnalise", blank.data["content"])

    def test_rich_text_content_is_sanitized_and_rendered(self):
        contract = self.create_contract(content=(
            "<h2>Article 1</h2>"
            "<p><strong>Texte enrichi</strong> et <em>important</em>.</p>"
            "<script>alert('xss')</script>"
            "<p><a href=\"javascript:alert(1)\">Lien dangereux</a></p>"
        ))
        self.assertIn("<strong>Texte enrichi</strong>", contract["content"])
        self.assertNotIn("<script", contract["content"])
        self.assertNotIn("javascript:", contract["content"])
        preview = self.api(self.admin).get(
            f"/api/v1/contracts/{contract['id']}/pdf/")
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(b"".join(preview.streaming_content).startswith(b"%PDF"))

    def test_html_empty_content_regenerates_default_model(self):
        contract = self.create_contract(content="<p><strong>Personnalisé</strong></p>")
        blank = self.api(self.admin).patch(
            f"/api/v1/contracts/{contract['id']}/",
            {"content": "<p><br></p>"}, format="json")
        self.assertEqual(blank.status_code, 200)
        self.assertIn("CONTRAT DE TRAVAIL", blank.data["content"])
        self.assertNotIn("Personnalisé", blank.data["content"])


    def test_send_requires_signature_and_account(self):
        contract = self.create_contract()
        self.profile.signature.delete(save=True)
        missing = self.send(contract["id"])
        self.assertEqual(missing.status_code, 400)
        self.assertIn("Signature de l'entreprise", missing.data["detail"])
        self.profile.signature.save(
            "signature.png", SimpleUploadedFile("signature.png", self.png,
                                                content_type="image/png"),
            save=True)
        orphan = Employee.objects.create(name="Sans compte", role="guide", site=self.site)
        contract2 = self.create_contract(employee=orphan)
        no_account = self.send(contract2["id"])
        self.assertEqual(no_account.status_code, 400)
        self.assertIn("compte de connexion", no_account.data["detail"])

    def test_full_signature_workflow_and_pdf(self):
        contract = self.create_contract()
        sent = self.send(contract["id"])
        self.assertEqual(sent.status_code, 200, sent.data)
        self.assertEqual(sent.data["status"], "pending_signature")
        self.assertIsNotNone(sent.data["sent_at"])
        self.assertIsNotNone(sent.data["company_signed_at"])
        self.assertEqual(DocumentSignature.objects.filter(role="company").count(), 1)
        # Signature de l'entreprise figée, le document n'est plus modifiable.
        self.assertEqual(self.api(self.admin).patch(
            f"/api/v1/contracts/{contract['id']}/",
            {"base_salary": 200000}, format="json").status_code, 403)
        preview = self.api(self.admin).get(f"/api/v1/contracts/{contract['id']}/pdf/")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(preview.streaming_content).startswith(b"%PDF"))
        # Mauvais nom, consentement absent puis bonne signature.
        self.assertEqual(self.sign(contract["id"], name="Autre Nom").status_code, 400)
        self.assertEqual(self.sign(contract["id"], consent=False).status_code, 400)
        signed = self.sign(contract["id"])
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["status"], "signed")
        self.assertEqual(len(signed.data["signed_hash"]), 64)
        self.assertTrue(signed.data["has_pdf"])
        self.assertIsNotNone(signed.data["employee_signed_at"])
        self.assertEqual(DocumentSignature.objects.filter(role="employee").count(), 1)
        # Rejouer la signature et supprimer le document sont refusés.
        self.assertEqual(self.sign(contract["id"]).status_code, 400)
        self.assertEqual(self.api(self.admin).delete(
            f"/api/v1/contracts/{contract['id']}/").status_code, 400)
        final = self.api(self.guide_user).get(f"/api/v1/contracts/{contract['id']}/pdf/")
        self.assertEqual(final.status_code, 200)
        self.assertTrue(b"".join(final.streaming_content).startswith(b"%PDF"))
        # Une signature existante est append-only.
        signature = DocumentSignature.objects.first()
        with self.assertRaises(RuntimeError):
            signature.delete()
        signature.user_agent = "modifie"
        with self.assertRaises(RuntimeError):
            signature.save()

    def test_only_employee_can_sign(self):
        contract = self.create_contract()
        self.assertEqual(self.send(contract["id"]).status_code, 200)
        refused = self.sign(contract["id"], user=self.admin)
        self.assertEqual(refused.status_code, 403)
        self.assertIn("salarié concerné", refused.data["detail"])
        other = self.sign(contract["id"], user=self.other_guide)
        self.assertEqual(other.status_code, 404)
        self.assertEqual(self.send(contract["id"]).status_code, 400)

    def test_letter_augmentation_applies_to_contract(self):
        contract = self.create_contract()
        response = self.api(self.admin).post("/api/v1/hr-letters/", {
            "employee": self.employee.id,
            "contract": contract["id"],
            "kind": "augmentation",
            "new_salary": 180000,
            "effective_date": "2026-02-01",
        })
        self.assertEqual(response.status_code, 201, response.data)
        letter = response.data
        self.assertTrue(letter["reference"].startswith("LET-"))
        self.assertIn("180 000", letter["content"])
        self.assertEqual(self.api(self.admin).post(
            f"/api/v1/hr-letters/{letter['id']}/send/").status_code, 200)
        signed = self.api(self.guide_user).post(
            f"/api/v1/hr-letters/{letter['id']}/sign/",
            {"full_name": "Moussa Keita", "signature": self.signature_url,
             "consent": True}, format="json")
        self.assertEqual(signed.status_code, 200, signed.data)
        contract_obj = Contract.objects.get(pk=contract["id"])
        self.assertEqual(contract_obj.base_salary, 180000)
        self.assertEqual(HRLetter.objects.get(pk=letter["id"]).status, "signed")

    def test_promotion_updates_contract_and_role(self):
        contract = self.create_contract()
        letter = self.api(self.admin).post("/api/v1/hr-letters/", {
            "employee": self.employee.id,
            "contract": contract["id"],
            "kind": "promotion",
            "new_job_title": "Chef guide",
            "effective_date": "2026-03-01",
        })
        self.assertEqual(letter.status_code, 201, letter.data)
        self.api(self.admin).post(f"/api/v1/hr-letters/{letter.data['id']}/send/")
        signed = self.api(self.guide_user).post(
            f"/api/v1/hr-letters/{letter.data['id']}/sign/",
            {"full_name": "Moussa Keita", "signature": self.signature_url,
             "consent": True}, format="json")
        self.assertEqual(signed.status_code, 200, signed.data)
        contract_obj = Contract.objects.get(pk=contract["id"])
        self.employee.refresh_from_db()
        self.assertEqual(contract_obj.job_title, "Chef guide")
        self.assertEqual(self.employee.role, "Chef guide")

    def test_visibility_and_write_permissions(self):
        own = self.create_contract()
        other = self.create_contract(employee=self.other_employee)
        visible = self.api(self.responsable).get("/api/v1/contracts/")
        self.assertEqual(visible.status_code, 200)
        ids = [item["id"] for item in visible.data]
        self.assertIn(own["id"], ids)
        self.assertNotIn(other["id"], ids)
        # Brouillon invisible pour le salarié tant qu'il n'est pas envoyé.
        self.assertEqual(self.api(self.guide_user).get(
            "/api/v1/contracts/").data, [])
        self.assertEqual(self.send(own["id"]).status_code, 200)
        guide_view = self.api(self.guide_user).get("/api/v1/contracts/")
        self.assertEqual([item["id"] for item in guide_view.data], [own["id"]])
        compta_view = self.api(self.comptable).get("/api/v1/contracts/")
        self.assertEqual(len(compta_view.data), 2)
        self.assertEqual(self.api(self.comptable).post("/api/v1/contracts/", {
            "employee": self.employee.id, "start": "2026-01-01",
            "base_salary": 100000}).status_code, 403)
        self.assertEqual(self.api(self.client_user).get(
            "/api/v1/contracts/").data, [])
        denied = self.api(self.responsable).post("/api/v1/contracts/", {
            "employee": self.other_employee.id, "start": "2026-01-01",
            "base_salary": 100000})
        self.assertEqual(denied.status_code, 403)

    def test_my_documents_and_notifications(self):
        contract = self.create_contract()
        self.send(contract["id"])
        docs = self.api(self.guide_user).get("/api/v1/hr/my-documents/")
        self.assertEqual(docs.status_code, 200)
        self.assertTrue(docs.data["employee"]["has_account"])
        self.assertEqual(docs.data["contracts"][0]["status"], "pending_signature")
        activity = self.api(self.guide_user).get("/api/v1/hr/activity/")
        self.assertEqual(len(activity.data["to_sign"]), 1)
        self.assertEqual(activity.data["signed"], [])
        self.sign(contract["id"])
        self.assertEqual(len(self.api(self.guide_user).get(
            "/api/v1/hr/activity/").data["to_sign"]), 0)
        admin_activity = self.api(self.admin).get("/api/v1/hr/activity/")
        self.assertEqual(len(admin_activity.data["signed"]), 1)
        self.assertEqual(admin_activity.data["signed"][0]["type"], "contract")

    def test_employee_account_is_unique(self):
        response = self.api(self.admin).patch(
            f"/api/v1/employees/{self.other_employee.id}/",
            {"user": self.guide_user.id}, format="json")
        self.assertEqual(response.status_code, 400)
        created = self.api(self.admin).post("/api/v1/employees/", {
            "name": "Doublon", "role": "guide", "site": self.site.id,
            "user": self.guide_user.id})
        self.assertEqual(created.status_code, 400)

    def test_letter_contract_must_match_employee(self):
        other_contract = self.create_contract(employee=self.other_employee)
        response = self.api(self.admin).post("/api/v1/hr-letters/", {
            "employee": self.employee.id, "contract": other_contract["id"],
            "kind": "prime", "amount": 25000})
        self.assertEqual(response.status_code, 400)
