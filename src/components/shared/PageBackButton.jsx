import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ui } from '@/lib/i18n';

// One touch-sized return control, kept on the same line as the page title.
export default function PageBackButton({ onClick, label = ui('Back'), disabled = false }) {
  return <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-xl" onClick={onClick} disabled={disabled} aria-label={label} title={label} data-page-back>
    <ArrowLeft size={20} aria-hidden="true" />
  </Button>;
}
