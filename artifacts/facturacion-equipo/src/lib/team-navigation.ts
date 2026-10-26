import {
  ArrowDownToLine, BookOpen, FileText, LayoutDashboard, Settings2, Users, WalletCards,
} from 'lucide-react';

export type TeamRole = 'owner' | 'specialist';

export const ownerOnlyRoutes = {
  catalogs: '/catalogs',
  export: '/export',
  settings: '/settings',
  team: '/team/members',
} as const;

const navigationItems = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
  { href: '/invoices', label: 'Facturas', icon: FileText },
  { href: '/customers', label: 'Clientes', icon: Users },
  { href: ownerOnlyRoutes.catalogs, label: 'Catálogos', icon: BookOpen, ownerOnly: true },
  { href: '/settlements', label: 'Liquidación', icon: WalletCards },
  { href: ownerOnlyRoutes.export, label: 'Exportar', icon: ArrowDownToLine, ownerOnly: true },
  { href: ownerOnlyRoutes.settings, label: 'Ajustes', icon: Settings2, ownerOnly: true },
];

const teamNavigationItem = { href: ownerOnlyRoutes.team, label: 'Equipo', icon: Users, ownerOnly: true };

export function getNavigationItems(role: TeamRole, includeTeam = false) {
  const items = navigationItems.filter(({ ownerOnly }) => role === 'owner' || !ownerOnly);
  return includeTeam && role === 'owner' ? [...items, teamNavigationItem] : items;
}

export function getOwnerRouteRedirect(role: string): string | null {
  return role === 'owner' ? null : '/dashboard';
}
