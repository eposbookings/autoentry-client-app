import {
  Banknote,
  BookOpen,
  Building2,
  CalendarCheck,
  FileBarChart,
  Landmark,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { formatMoney } from "./shared";

export const MODULES = [
  { key: "ai_workspace", label: "AI Workspace", icon: Sparkles },
  { key: "payables", label: "Payables", icon: ReceiptText },
  { key: "receivables", label: "Receivables", icon: WalletCards },
  { key: "banking", label: "Banking", icon: Banknote },
  { key: "vat", label: "VAT", icon: ShieldCheck },
  { key: "fixed_assets", label: "Fixed Assets", icon: Building2 },
  { key: "year_end", label: "Year End", icon: CalendarCheck },
  { key: "gl", label: "General ledger", icon: Landmark },
  { key: "coa", label: "Chart of accounts", icon: BookOpen },
  { key: "audit", label: "Audit trail", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: FileBarChart },
  { key: "settings", label: "Settings", icon: Settings },
];

export const ACCOUNT_TYPES = [
  "Bank",
  "Receivable",
  "Payable",
  "VAT",
  "Tax",
  "Payroll",
  "Equity",
  "Sales",
  "Purchases",
  "Cost of Sales",
  "Overheads",
  "Suspense",
];

export const ACCOUNT_CATEGORIES = ["Asset", "Liability", "Equity", "Income", "Expense"];

export const ACCOUNT_PURPOSES = [
  "Sales Ledger",
  "Purchase Ledger",
  "Bank Account",
  "VAT Control",
  "Suspense",
  "Retained Earnings",
  "Corporation Tax",
  "Payroll Control",
  "Standard Nominal",
];

export const MODULE_DETAILS = {
  ai_workspace: {
    title: "AI Accounting Workspace",
    manage: ["My Work Queue", "Insights", "Exceptions", "Approvals", "Health Check"],
    statLabel: "Health score",
    stat: (workspace) => `${workspace?.ai_workspace?.health_check?.score ?? 0}/100`,
    tabs: ["Overview", "Tasks", "Insights", "Exceptions", "Approvals", "Deadlines", "Health Check", "AI Assistant", "Settings"],
  },
  payables: {
    title: "Accounts Payable",
    manage: ["Supplier cards", "Supplier records", "Supplier ledger"],
    statLabel: "Supplier balances",
    stat: (workspace) => formatMoney(workspace?.accounts_payable?.dashboard?.outstanding_total || workspace?.summary?.ap_outstanding || 0),
    tabs: ["Suppliers", "Create supplier"],
  },
  receivables: {
    title: "Accounts Receivable",
    manage: ["Customer cards", "Customer records", "Customer ledger"],
    statLabel: "Outstanding invoices",
    stat: (workspace) => formatMoney(workspace?.accounts_receivable?.dashboard?.outstanding_total || workspace?.summary?.ar_outstanding || workspace?.summary?.receivables || 0),
    tabs: ["Customers", "Create customer"],
  },
  banking: {
    title: "Banking",
    manage: ["Bank Accounts", "Transactions", "Reconciliation", "Rules", "Transfers", "Cashbook"],
    statLabel: "Awaiting match",
    stat: (workspace) => workspace?.banking?.dashboard?.awaiting_match || workspace?.summary?.unreconciled_bank_transactions || 0,
    tabs: ["Dashboard", "Bank Accounts", "Transactions", "Reconciliation", "Bank Rules", "Transfers", "Cashbook", "Imported Statements", "Reports", "Settings"],
  },
  vat: {
    title: "VAT",
    manage: ["VAT Returns", "VAT Transactions", "VAT Codes", "VAT Periods", "Adjustments"],
    statLabel: "Net VAT due",
    stat: (workspace) => formatMoney(workspace?.vat_engine?.dashboard?.net_vat_due || 0),
    tabs: ["Dashboard", "VAT Returns", "VAT Transactions", "VAT Codes", "VAT Periods", "Adjustments", "Reports", "Settings"],
  },
  fixed_assets: {
    title: "Fixed Assets",
    manage: ["Asset Register", "Categories", "Depreciation", "Disposals", "Transfers", "Revaluations"],
    statLabel: "Net book value",
    stat: (workspace) => formatMoney(workspace?.fixed_assets?.dashboard?.net_book_value || 0),
    tabs: ["Dashboard", "Asset Register", "Asset Categories", "Depreciation", "Disposals", "Transfers", "Revaluations", "Reports", "Settings"],
  },
  year_end: {
    title: "Year End",
    manage: ["Period Close", "Financial Year Close", "Opening Balances", "Closing Journals", "Retained Earnings"],
    statLabel: "Open tasks",
    stat: (workspace) => workspace?.year_end?.dashboard?.outstanding_tasks || 0,
    tabs: ["Dashboard", "Period Close", "Financial Year Close", "Opening Balances", "Closing Journals", "Retained Earnings", "Lock History", "Reports", "Settings"],
  },
  gl: {
    title: "General Ledger",
    manage: ["Transactions", "Journals", "Account Activity", "Trial Balance"],
    statLabel: "Posted journals",
    stat: (workspace) => workspace?.summary?.journals || 0,
    tabs: ["Transactions", "Journals", "Account Activity", "Trial Balance"],
  },
  coa: {
    title: "Chart of Accounts",
    manage: ["One account list", "Purpose filters", "Control account flags"],
    statLabel: "Accounts",
    stat: (workspace) => workspace?.reports?.account_count || workspace?.accounts?.length || 0,
    tabs: ["Chart of Accounts"],
  },
  audit: {
    title: "Audit Trail",
    manage: ["User actions", "Record changes", "Posting history"],
    statLabel: "Audit events",
    stat: (workspace) => workspace?.audit_log?.length || 0,
    tabs: ["Audit Trail"],
  },
  reports: {
    title: "Reports",
    manage: ["Financial Statements", "Management Reports", "VAT Reports", "Sales Reports", "Purchase Reports", "Bank Reports"],
    statLabel: "Net profit",
    stat: (workspace) => formatMoney(workspace?.reports?.dashboard?.net_profit || workspace?.reports?.profit_and_loss?.profit),
    tabs: ["Dashboard", "Financial Statements", "Management Reports", "VAT Reports", "Sales Reports", "Purchase Reports", "Bank Reports", "Custom Reports", "Report Scheduler", "Exports", "Settings"],
  },
  settings: {
    title: "Settings",
    manage: ["Accounting Defaults", "Financial Years", "Period Locks"],
    statLabel: "Accounting periods",
    stat: (workspace) => workspace?.periods?.length || 0,
    tabs: ["Accounting Settings", "Financial Years", "Periods"],
  },
};
