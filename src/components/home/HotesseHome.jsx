import React from 'react';
import HotesseWorkspace from '@/components/outlets/HotesseWorkspace';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import MobileHotesseHome from './MobileHotesseHome';
export default function HotesseHome(props) {
  const phone=usePhoneLayout();
  return <HotesseWorkspace {...props} renderHome={phone?state=><MobileHotesseHome {...state}/>:undefined}/>;
}
