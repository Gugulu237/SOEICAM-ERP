'use client';
import React from 'react';
import { LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { hasCustomerLocation } from '@/lib/customer-location';

export function canCaptureCustomerGps({ role, employee, loading }) {
  return !loading && (role === 'admin' || ['employee', 'commercial'].includes(role) && employee?.status === 'active');
}

export default function CustomerGpsButton({ point, onClick, disabled = false }) {
  useLocaleRender();
  const label = hasCustomerLocation(point) ? ui('Update GPS') : ui('Add GPS');
  return <Button type="button" variant="outline" size="sm" className="min-h-11 gap-2 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50" aria-label={ui('{0}: {1}', label, point.business_name || point.name)} disabled={disabled} onClick={onClick}>
    <LocateFixed size={16} aria-hidden="true"/>{label}
  </Button>;
}
