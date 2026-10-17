import { base44 } from "@/api/base44Client";

export const invokeFieldOps = (payload) => base44.functions.invoke("fieldOps", payload);

export const SALE_STATUS = {
  draft: { label: "Draft", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  submitted: { label: "Submitted", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  under_review: { label: "Under review", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  approved_posted: { label: "Approved & posted", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  returned: { label: "Returned for correction", tone: "bg-orange-50 text-orange-700 border-orange-200" },
  rejected: { label: "Rejected", tone: "bg-red-50 text-red-700 border-red-200" },
  posting_failed: { label: "Posting failed", tone: "bg-red-50 text-red-700 border-red-200" },
};

export const COLLECTION_STATUS = {
  held_by_commercial: { label: "Held by Commercial", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  handover_submitted: { label: "Handover submitted", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  partially_received: { label: "Partly received", tone: "bg-orange-50 text-orange-700 border-orange-200" },
  received: { label: "Received", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  disputed: { label: "Disputed", tone: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-700 border-slate-200" },
};

export const HANDOVER_STATUS = {
  draft: { label: "Draft", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  submitted: { label: "Awaiting receipt", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  partially_received: { label: "Partly received", tone: "bg-orange-50 text-orange-700 border-orange-200" },
  received: { label: "Received", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  disputed: { label: "Disputed", tone: "bg-red-50 text-red-700 border-red-200" },
};

export const PAYMENT_LABEL = { cash: "Cash", credit: "Credit" };

export async function uploadReceipt(file) {
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  return file_uri;
}

export async function receiptUrl(fileUri) {
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 900 });
  return signed_url;
}

export function errorMessage(e) {
  return e?.response?.data?.error || e?.message || "Something went wrong — please try again";
}

export function newIdempotencyKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}