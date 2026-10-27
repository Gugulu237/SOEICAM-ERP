import React from 'react';
import {ui} from '@/lib/i18n';
import {invalidateERPReads} from '@/api/erpClient';
export default class AccountingPanelBoundary extends React.Component{
 constructor(props){super(props);this.state={failed:false,revision:0};}
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(this.state.failed)return <section role="alert" className="space-y-3 rounded-xl border bg-white p-4"><h2 className="font-semibold">{ui('The journal view could not be displayed.')}</h2><p className="text-sm">{ui('Retry this view. Other accounting sections remain available.')}</p><button type="button" className="min-h-11 rounded-lg bg-primary px-4 py-2 text-white" onClick={()=>{invalidateERPReads();this.setState(s=>({failed:false,revision:s.revision+1}));}}>{ui('Retry journal view')}</button></section>;
  return <React.Fragment key={this.state.revision}>{this.props.children}</React.Fragment>;
 }
}
