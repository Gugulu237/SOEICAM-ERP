
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { ArrowLeft, ArrowRight, History, ChevronDown, Check } from 'lucide-react';
import { useNavigate, Link } from '@/lib/router';
import { useNavigationHistory } from '@/lib/navigation-context';
import { navigationLabel } from '@/lib/navigation-session';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { canOpenFieldPath } from '@/lib/permissions';
import { moduleForPath } from '@/server/domain/role-catalogue';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function NavigationHistory() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const history = useNavigationHistory(), navigate = useNavigate();
  const { role, allowedModules } = useCurrentUser();
  const current = history.entries[history.cursor]?.href;
  const recent = history.recent.filter(href => {
    const pathname = href.split('?')[0], module = moduleForPath(pathname);
    return canOpenFieldPath(role, href, allowedModules) && (role === 'admin' || !module || !allowedModules || allowedModules.includes(module));
  });
  return <nav aria-label={ui("Page history")} className="flex min-w-0 items-center gap-2 border-t border-green-50 px-3 py-1 sm:px-5 xl:px-8">
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" disabled={!history.canBack} onClick={() => navigate(-1)} aria-label={ui("Previous page")} title={ui("Back to previous page")}><ArrowLeft size={17} /></Button>
      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" disabled={!history.canForward} onClick={() => navigate(1)} aria-label={ui("Next page")} title={ui("Forward to next page")}><ArrowRight size={17} /></Button>
    </div>
    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600">{current ? navigationLabel(current) : ui("Workspace")}</span>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label={ui("Recent pages")} className="h-10 shrink-0 gap-2 text-xs sm:h-8" disabled={!recent.length}><History size={15} /><span className="hidden sm:inline">{ui("Recent pages")}</span><ChevronDown size={13} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 max-w-[calc(100vw_-_2rem)] overflow-y-auto">
        <DropdownMenuLabel>{ui("Pages visited in this tab")}</DropdownMenuLabel><DropdownMenuSeparator />
        {recent.map(href => <DropdownMenuItem key={href} asChild><Link to={href} className="flex min-h-10 items-center gap-2"><span className="min-w-0 flex-1 truncate">{navigationLabel(href)}</span>{href === current && <Check size={14} aria-label={ui("Current page")} />}</Link></DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </nav>;
}
