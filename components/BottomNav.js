'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, CheckSquare, Menu, KeyRound } from 'lucide-react';
import { useSession } from '@/components/AuthProvider';
import { useSidebarContext } from './SidebarContext';

const MANAGEMENT_NAV = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
];

const STAFF_NAV = [
  { href: '/staff-portal', label: 'Portal', icon: KeyRound },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
];

function isActivePath(pathname, href) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Thumb-friendly primary navigation for phones. The complete role-aware
 * navigation remains in the drawer opened by More, so no CRM capability is
 * hidden on mobile while the most frequent actions stay one tap away.
 */
export default function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { sidebarOpen, setSidebarOpen } = useSidebarContext();
  const navItems = session?.user?.role === 'STAFF' ? STAFF_NAV : MANAGEMENT_NAV;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[80] border-t border-border/80 bg-surface/95 backdrop-blur-xl md:hidden"
      role="navigation"
      aria-label="Primary mobile navigation"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition-colors ${
                active ? 'text-accent' : 'text-muted hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              <span className={`flex h-7 w-11 items-center justify-center rounded-xl transition-colors ${active ? 'bg-accent/10' : ''}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="truncate">{label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-expanded={sidebarOpen}
          aria-label="Open all navigation"
          className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition-colors ${
            sidebarOpen ? 'text-accent' : 'text-muted hover:bg-surface-hover hover:text-foreground'
          }`}
        >
          <span className={`flex h-7 w-11 items-center justify-center rounded-xl transition-colors ${sidebarOpen ? 'bg-accent/10' : ''}`}>
            <Menu className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
