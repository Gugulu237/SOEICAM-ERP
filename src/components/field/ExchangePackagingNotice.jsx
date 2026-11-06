import React from 'react';
import {ui, uiMessage} from '@/lib/i18n';

export function exchangePackagingWarningText(record) {
  const warnings = record?.exchange_packaging_warnings;
  if (!Array.isArray(warnings) || !warnings.length) return '';
  return ui('Packaging recovery needs review.') + ' ' + [...new Set(warnings.map(row =>
    [row.product_name, uiMessage(row.message || '')].filter(Boolean).join(': ')
  ))].filter(Boolean).join(' ');
}

export default function ExchangePackagingNotice({record}) {
  const text = exchangePackagingWarningText(record);
  return text ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{text}</p> : null;
}
