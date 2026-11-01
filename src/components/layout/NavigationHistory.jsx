
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { ArrowLeft, ArrowRight, History, Check } from 'lucide-react';
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
  return <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={ui("Page history")} title={ui("Page history")} className="h-11 w-11 shrink-0 rounded-xl"><History size={19} aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(24rem,calc(100dvh_-_5rem))] w-80 max-w-[calc(100vw_-_2rem)] overflow-y-auto">
        <DropdownMenuItem className="min-h-11 gap-2" disabled={!history.canBack} onSelect={() => navigate(-1)} aria-label={ui("Previous page")}><ArrowLeft size={17} aria-hidden="true" />{ui('Back')}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 gap-2" disabled={!history.canForward} onSelect={() => navigate(1)} aria-label={ui("Next page")}><ArrowRight size={17} aria-hidden="true" />{ui('Forward')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{ui("Pages visited in this tab")}</DropdownMenuLabel><DropdownMenuSeparator />
        {recent.map(href => <DropdownMenuItem key={href} asChild><Link to={href} aria-current={href === current ? 'page' : undefined} className="flex min-h-11 items-center gap-2"><span className="min-w-0 flex-1 truncate">{navigationLabel(href)}</span>{href === current && <Check size={14} aria-label={ui("Current page")} />}</Link></DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>;
}
