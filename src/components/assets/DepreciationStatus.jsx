import {ui,uiMessage} from '@/lib/i18n';
import {formatXAF} from '@/lib/formatters';
import {Link} from '@/lib/router';
export default function DepreciationStatus({status,canManage=false}) {
  if(!status)return null;
  const needsReview=status.pending_count>0||status.issues?.length>0||status.disabled;
  return <div role="status" className={'mb-4 rounded-lg p-3 text-sm '+(needsReview?'bg-amber-50 text-amber-900':'bg-green-50 text-green-900')}>
    <p>{ui('Monthly depreciation checked through {0}.',status.through)}</p>
    {status.disabled&&<p>{ui('Automatic posting is disabled in this environment.')}</p>}
    {status.pending_count>0&&<p>{ui('Unposted depreciation: {0} across {1} asset-months. This amount is not yet deducted from profit.',formatXAF(status.pending_total),status.pending_count)}</p>}
    {status.manual_count>0&&<p>{ui('Some assets still require manual posting. Enable automatic posting in their depreciation settings.')}</p>}
    {status.issues?.map((issue,i)=><p key={issue.asset_id+':'+i}>{issue.asset_name}: {uiMessage(issue.message)}</p>)}
    {needsReview&&canManage&&<Link to="/accounting/assets" className="mt-2 inline-block underline">{ui('Review asset depreciation')}</Link>}
  </div>;
}
