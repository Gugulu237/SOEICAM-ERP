import React from 'react';
import CashierWorkspace from '@/components/cashier/CashierWorkspace';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import MobileCashierHome from './MobileCashierHome';
export default function CashierHome(props) {
  const phone=usePhoneLayout();
  return <CashierWorkspace {...props} renderHome={phone?state=><MobileCashierHome {...state}/>:undefined}/>;
}
