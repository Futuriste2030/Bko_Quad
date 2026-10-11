"""Routeur API unique tranche 7."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from common.views import (
    ActivityViewSet,
    AnomalyViewSet,
    BookingEventViewSet,
    BookingViewSet,
    CallLogViewSet,
    CashView,
    ClosingView,
    CustomerViewSet,
    InvoiceView,
    MessageViewSet,
    MeView,
    PaymentView,
    SiteViewSet,
    SlotViewSet,
    WebhookView,
)

router = DefaultRouter()
router.register("customers", CustomerViewSet)
router.register("sites", SiteViewSet)
router.register("activities", ActivityViewSet)
router.register("slots", SlotViewSet)
router.register("bookings", BookingViewSet)
router.register("booking-events", BookingEventViewSet)
router.register("messages", MessageViewSet)
router.register("calls", CallLogViewSet)
router.register("anomalies", AnomalyViewSet)

urlpatterns = [
    path("auth/token/", TokenObtainPairView.as_view(), name="token"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("payments/link/", PaymentView.as_view(), name="pay-link"),
    path("payments/webhook/", WebhookView.as_view(), name="pay-webhook"),
    path("payments/cash/", CashView.as_view(), name="pay-cash"),
    path("payments/invoice/", InvoiceView.as_view(), name="pay-invoice"),
    path("closings/validate/", ClosingView.as_view(), name="closing"),
    path("", include(router.urls)),
]
