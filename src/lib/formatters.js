// Currency and number formatting utilities for SOEICAM (XAF)
import { getLocale,ui } from './i18n.js';
export function formatXAF(amount) {
  if (amount == null || isNaN(amount)) return "0 XAF";
  const num = Math.round(Number(amount));
  return num.toLocaleString(getLocale()) + " XAF";
}

export function formatNumber(num, decimals = 0) {
  if (num == null || isNaN(num)) return "0";
  return Number(num).toLocaleString(getLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatQuantity(num) {
  if (num == null || !Number.isFinite(Number(num))) return '-';
  return Number(num).toLocaleString(getLocale(), { maximumFractionDigits: 3 });
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(getLocale(), { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(getLocale(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function statusColor(status) {
  const colors = {
    draft: "bg-gray-100 text-gray-700",
    pending: "bg-slate-100 text-slate-800",
    pending_approval: "bg-slate-100 text-slate-800",
    awaiting_approval: "bg-slate-100 text-slate-800",
    approved: "bg-blue-100 text-blue-800",
    confirmed: "bg-blue-100 text-blue-800",
    posted: "bg-green-100 text-green-800",
    reversed: "bg-purple-100 text-purple-800",
    completed: "bg-green-100 text-green-800",
    released: "bg-green-100 text-green-800",
    paid: "bg-green-100 text-green-800",
    received: "bg-green-100 text-green-800",
    closed: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
    rejected: "bg-red-100 text-red-700",
    overdue: "bg-red-100 text-red-700",
    hold: "bg-slate-100 text-slate-800",
    credit_hold: "bg-slate-100 text-slate-800",
    blocked: "bg-red-100 text-red-800",
    good: "bg-green-100 text-green-700",
    warning: "bg-slate-100 text-slate-800",
    in_production: "bg-purple-100 text-purple-800",
    materials_issued: "bg-indigo-100 text-indigo-800",
    partially_received: "bg-blue-100 text-blue-700",
    partially_paid: "bg-blue-100 text-blue-700",
    active: "bg-green-100 text-green-700",
    quarantined: "bg-slate-100 text-slate-800",
    quarantine: "bg-slate-100 text-slate-800",
    awaiting_qc: "bg-slate-100 text-slate-800",
    expired: "bg-red-100 text-red-700",
    processed: "bg-green-100 text-green-800",
  };
  return colors[status] || "bg-gray-100 text-gray-700";
}

export function statusLabel(status) {
  if (!status) return "";
  if (status==='in_production') return ui('Under fermentation');
  return ui(status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
}
