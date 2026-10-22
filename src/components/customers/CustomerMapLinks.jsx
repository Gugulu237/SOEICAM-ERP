
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { customerMapUrl, hasCustomerLocation } from '@/lib/customer-location';

export default function CustomerMapLinks({ customer }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (!hasCustomerLocation(customer)) return <span className="text-xs text-slate-400">{ui("No delivery pin recorded")}</span>;
  return <div className="flex flex-wrap gap-3 text-sm font-medium text-blue-700">
    <a className="inline-flex min-h-10 items-center gap-1.5 hover:underline" href={customerMapUrl(customer)} target="_blank" rel="noopener noreferrer"><MapPin size={15} />{ui("View on Maps")}</a>
    <a className="inline-flex min-h-10 items-center gap-1.5 hover:underline" href={customerMapUrl(customer, true)} target="_blank" rel="noopener noreferrer"><Navigation size={15} />{ui("Directions")}</a>
  </div>;
}
