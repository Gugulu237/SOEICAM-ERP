import React from "react";
import { formatXAF, formatDate, statusLabel } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, Check, X, Banknote } from "lucide-react";

// One expense request in the kanban board, with the actions allowed at its stage.
export default function ExpenseCard({ request, canApprove, canPay, isOwner, onSubmit, onApprove, onReject, onPay }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm text-slate-900 leading-tight">{request.title}</p>
        <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(request.request_date)}</span>
      </div>
      <p className="text-lg font-bold text-slate-900 mt-1">{formatXAF(request.amount)}</p>
      <p className="text-xs text-slate-500">
        {statusLabel(request.category)} · {request.department_name || "No department"}
      </p>
      {request.requester_name && <p className="text-xs text-slate-400 mt-0.5">By {request.requester_name}</p>}
      {request.receipt_url && (
        <a href={request.receipt_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 inline-flex items-center gap-1 mt-1">
          <Paperclip size={11} /> Receipt
        </a>
      )}
      {request.rejection_reason && <p className="text-xs text-red-600 mt-1">{request.rejection_reason}</p>}

      <div className="flex flex-wrap gap-1 mt-3">
        {request.status === "draft" && isOwner && (
          <Button size="sm" variant="outline" onClick={() => onSubmit(request)}><Send size={12} className="mr-1" /> Submit</Button>
        )}
        {request.status === "pending_approval" && canApprove && (
          <>
            <Button size="sm" onClick={() => onApprove(request)}><Check size={12} className="mr-1" /> Approve</Button>
            <Button size="sm" variant="outline" onClick={() => onReject(request)}><X size={12} className="mr-1" /> Reject</Button>
          </>
        )}
        {request.status === "approved" && canPay && (
          <Button size="sm" onClick={() => onPay(request)}><Banknote size={12} className="mr-1" /> Pay</Button>
        )}
      </div>
    </div>
  );
}