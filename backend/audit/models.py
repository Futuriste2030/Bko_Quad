"""Audit append-only + rapport hebdomadaire."""

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                              on_delete=models.SET_NULL, related_name="audit_logs")
    action = models.CharField(max_length=80)
    entity = models.CharField(max_length=120)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    ip = models.CharField(max_length=45, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.action} {self.entity}"

    def save(self, *args, **kwargs):
        if self.pk:
            raise RuntimeError("Audit append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Audit append-only.")


class WeeklyReport(models.Model):
    year = models.PositiveIntegerField()
    week = models.PositiveIntegerField()
    content = models.JSONField(default=dict)
    recipients = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["year", "week"], name="uniq_report_per_week"),
        ]

    def __str__(self):
        return f"Rapport S{self.week:02d}/{self.year}"
