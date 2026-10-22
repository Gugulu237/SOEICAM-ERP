
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Link } from '@/lib/router';
import PageHeader from '@/components/shared/PageHeader';
import CashFlowStatement from '@/components/accounting/CashFlowStatement';
import { Button } from '@/components/ui/button';
export default function CashFlow() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <div><PageHeader title={ui("Cash Flow & History")} subtitle={ui("Track cash collected, spent and transferred across SOEICAM.")} actions={<Button variant="outline" asChild><Link to="/accounting">{ui("Accounting")}</Link></Button>} /><CashFlowStatement /></div>;
}
