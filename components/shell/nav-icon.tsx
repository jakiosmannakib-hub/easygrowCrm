// components/shell/nav-icon.tsx — PUL-110.2
//
// Resolves the icon NAME stored in lib/nav.ts to a lucide component. The lookup lives here,
// on the client, so lib/nav.ts stays free of client-only imports and remains importable by
// the server route guard.

'use client';

import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarOff,
  ClipboardCheck,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Clock,
  Building2,
  FolderKanban,
  LayoutTemplate,
  ListChecks,
  CalendarCheck,
  FileText,
  CalendarOff,
  ClipboardCheck,
  BarChart3,
  ScrollText,
  Settings,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  // An unknown name renders nothing rather than throwing — a missing icon must never take
  // the whole sidebar down.
  const Icon = ICONS[name];
  return Icon ? <Icon className={className} aria-hidden /> : null;
}
