import {useEffect,useState} from 'react';
import {inventoryStockIndex} from '@/lib/inventory-workspace';

// Reuse the role-checked stock overview; never infer quantities from risk lots.
export function useMobileHomeInventory(enabled,date) {
  const [state,setState]=useState({data:null,error:'',loading:!!enabled});
  useEffect(()=>{
    if(!enabled)return;let active=true;const controller=new AbortController();
    setState({data:null,error:'',loading:true});
    fetch('/api/inventory/overview?compact=1',{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Inventory could not load');return {...data,stock:inventoryStockIndex(data.balances||[],data.warehouses||[],date,data.products||[])};}).then(data=>{if(active)setState({data,error:'',loading:false});}).catch(error=>{if(active&&!controller.signal.aborted)setState({data:null,error:error.message,loading:false});});
    return()=>{active=false;controller.abort();};
  },[enabled,date]);
  return enabled?state:{data:null,error:'',loading:false};
}
