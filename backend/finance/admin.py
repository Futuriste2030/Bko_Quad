from django.contrib import admin

from finance.models import BankTransaction, CashbookEntry, CashAdvance, MonthlyClosing


@admin.register(CashbookEntry)
class CashbookEntryAdmin(admin.ModelAdmin):
    list_display = ("voucher", "date", "direction", "category", "amount", "locked")
    list_filter = ("direction", "category", "locked")


@admin.register(BankTransaction)
class BankTransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "type", "amount", "reason",
                    "receipt_number", "check_number", "locked")
    list_filter = ("type", "locked")


admin.site.register(CashAdvance)
admin.site.register(MonthlyClosing)
