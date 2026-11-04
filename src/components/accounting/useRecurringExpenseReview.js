import {useEffect,useState} from 'react';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
export function useRecurringExpenseReview(from,to){
  const [state,setState]=useState({loading:true,total:0,count:0,error:''});
  useEffect(()=>{
    let alive=true,generation=0;
    const load=()=>{const current=++generation;setState({loading:true,total:0,count:0,error:''});recurringExpenseRequest(null,{from,to,summary:'1'}).then(data=>{if(alive&&current===generation)setState({loading:false,total:data.pending_total,count:data.pending_count,canReview:data.can_review,error:''});}).catch(e=>{if(alive&&current===generation)setState({loading:false,total:0,count:0,error:e.message});});};
    load();window.addEventListener('soeicam:recurring-expenses',load);
    return()=>{alive=false;window.removeEventListener('soeicam:recurring-expenses',load);};
  },[from,to]);
  return state;
}
