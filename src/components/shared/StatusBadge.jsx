import React from "react";
import { statusColor, statusLabel } from "@/lib/formatters";

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(status)}`}>
      {statusLabel(status)}
    </span>
  );
}