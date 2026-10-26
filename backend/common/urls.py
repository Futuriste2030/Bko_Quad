"""Routeur API unique tranche 7."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from common.export_views import ExportView
from common.views import (
    ActivityViewSet,
    AnomalyViewSet,
    BankDepositView,
    BankSummaryView,
    BankTransactionViewSet,
    BankTransferView,
    BankReportPdfView,
    RecettePdfView,    BankWithdrawalView,
    BookingEventViewSet,
    BookingViewSet,
    CallLogViewSet,
    CashbookEntryViewSet,
    CashView,
    ClosingView,
    CompanyView,
    CustomerViewSet,
    DocumentPdfView,
    ExpenseView,
    InvoiceView,
    InvoiceViewSet,
    LoginView,
    MaintenanceViewSet,
    MessageViewSet,
    MeView,
    MonthSummaryView,
    VersionView,
    NoticeViewSet,
    PasswordView,
    PaymentView,
    PaymentViewSet,
    EmployeeViewSet,
    ContractViewSet,
    HRActivityView,
    HRLetterViewSet,
    HRUserDirectoryView,
    MyHRDocumentsView,
    PayrollSheetViewSet,
    PayslipViewSet,
    SiteViewSet,
    SlotViewSet,
    SparePartViewSet,
    TotpEnrollView,
    TotpVerifyView,
    TrackedLineViewSet,
    UserViewSet,
    VehicleViewSet,
    WebhookView,
)

router = DefaultRouter()
router.register("customers", CustomerViewSet)
router.register("sites", SiteViewSet)
router.register("activities", ActivityViewSet)
router.register("slots", SlotViewSet)
router.register("vehicles", VehicleViewSet)
router.register("maintenances", MaintenanceViewSet)
router.register("parts", SparePartViewSet, basename="parts")
router.register("bookings", BookingViewSet)
router.register("booking-events", BookingEventViewSet)
router.register("messages", MessageViewSet)
router.register("notices", NoticeViewSet, basename="notices")
router.register("calls", CallLogViewSet)
router.register("lines", TrackedLineViewSet, basename="lines")
router.register("anomalies", AnomalyViewSet)
router.register("payments", PaymentViewSet, basename="payments")
router.register("invoices", InvoiceViewSet, basename="invoices")
router.register("entries", CashbookEntryViewSet, basename="entries")
router.register("bank-transactions", BankTransactionViewSet, basename="bank-transactions")
router.register("users", UserViewSet, basename="users")
router.register("employees", EmployeeViewSet)
router.register("contracts", ContractViewSet)
router.register("hr-letters", HRLetterViewSet, basename="hr-letters")
router.register("sheets", PayrollSheetViewSet, basename="sheets")
router.register("payslips", PayslipViewSet, basename="payslips")

urlpatterns = [
    path("auth/token/", LoginView.as_view(), name="token"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("version/", VersionView.as_view(), name="version"),
    path("auth/password/", PasswordView.as_view(), name="password"),
    path("auth/totp/enroll/", TotpEnrollView.as_view(), name="totp-enroll"),
    path("auth/totp/verify/", TotpVerifyView.as_view(), name="totp-verify"),
    path("company/", CompanyView.as_view(), name="company"),
    path("payments/link/", PaymentView.as_view(), name="pay-link"),
    path("payments/webhook/", WebhookView.as_view(), name="pay-webhook"),
    path("payments/cash/", CashView.as_view(), name="pay-cash"),
    path("payments/invoice/", InvoiceView.as_view(), name="pay-invoice"),
    path("finance/expense/", ExpenseView.as_view(), name="finance-expense"),
    path("finance/month/", MonthSummaryView.as_view(), name="finance-month"),
    path("bank/deposit/", BankDepositView.as_view(), name="bank-deposit"),
    path("bank/withdrawal/", BankWithdrawalView.as_view(), name="bank-withdrawal"),
    path("bank/transfer/", BankTransferView.as_view(), name="bank-transfer"),
    path("bank/summary/", BankSummaryView.as_view(), name="bank-summary"),
    path("bank/report/", BankReportPdfView.as_view(), name="bank-report"),
    path("finance/recette/pdf/", RecettePdfView.as_view(), name="recette-pdf"),
    path("finance/month/pdf/", RecettePdfView.as_view(), name="finance-month-pdf"),
    path("finance/report/", RecettePdfView.as_view(), name="finance-report"),
    path("recette/pdf/", RecettePdfView.as_view(), name="recette-pdf-short"),
    path("cash/pdf/", RecettePdfView.as_view(), name="cash-pdf"),    path("documents/<int:booking_id>/<str:kind>/pdf/", DocumentPdfView.as_view(), name="document-pdf"),
    path("hr/my-documents/", MyHRDocumentsView.as_view(), name="hr-my-documents"),
    path("hr/activity/", HRActivityView.as_view(), name="hr-activity"),
    path("hr/accounts/", HRUserDirectoryView.as_view(), name="hr-accounts"),
    path("closings/", ClosingView.as_view(), name="closing"),
    path("exports/", ExportView.as_view(), name="exports"),
    path("", include(router.urls)),
]
