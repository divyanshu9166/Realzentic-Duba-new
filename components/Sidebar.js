'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Megaphone,
  MessageSquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  Headphones,
  UserPlus,
  UsersRound,
  KeyRound,
  X,
  Trash2,
  MailPlus,
  Wallet,
  BarChart3,
  Calculator,
  Building2,
  Banknote,
  Trophy,
  Handshake,
  FileText,
  MapPinned,
  Building,
  Briefcase,
  Sparkles,
  Gift,
  Contact,
  CheckSquare,
  CalendarDays,
  Landmark,
  Scale,
  Navigation,
  CalendarClock,
  MessageSquareDot,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSession } from '@/components/AuthProvider';
import { useSidebarContext } from './SidebarContext';
import { getStoreSettings } from '@/app/actions/settings';

// role: which roles can see this item. undefined = all authenticated users
const navItems = [
  { href: '/staff-portal', label: 'Staff Portal', icon: KeyRound, roles: ['STAFF'] },
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/walkins', label: 'Walk-ins', icon: UserPlus },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { href: '/contacts', label: 'Contacts', icon: Contact },
  { href: '/properties', label: 'Properties', icon: Building },
  { href: '/deals', label: 'Deals', icon: Briefcase },
  { href: '/loans', label: 'Loan Desk', icon: Landmark, roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { href: '/recommend', label: 'AI Match', icon: Sparkles },
  { href: '/tools/cma', label: 'CMA Pricing', icon: Scale, roles: ['ADMIN', 'MANAGER'] },
  { href: '/tools/calculators', label: 'Calculators', icon: Calculator },
  { href: '/channel-partners', label: 'Channel Partners', icon: Handshake, roles: ['ADMIN', 'MANAGER'] },
  { href: '/staff', label: 'Staff', icon: UsersRound, roles: ['ADMIN', 'MANAGER'] },
  { href: '/appointments', label: 'Appointments', icon: Calendar },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  // One canonical Site Visits workspace serves both roles: managers get
  // scheduling/oversight and staff get only their assigned check-in workflow.
  { href: '/field-visits', label: 'Site Visits', icon: MapPinned, roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { href: '/live-tracking', label: 'Live Tracking', icon: Navigation, roles: ['ADMIN', 'MANAGER'] },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/documents', label: 'Documents & KYC', icon: FileText, roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/drafts', label: 'Drafts', icon: Trash2, roles: ['ADMIN', 'MANAGER'] },
  { href: '/email-marketing', label: 'Email Marketing', icon: MailPlus, roles: ['ADMIN', 'MANAGER'] },
  { href: '/whatsapp-marketing', label: 'WhatsApp Marketing', icon: Megaphone, roles: ['ADMIN', 'MANAGER'] },
  { href: '/whatsapp-reminders', label: 'WhatsApp Reminders', icon: MessageSquareDot, roles: ['ADMIN', 'MANAGER'] },
  { href: '/social-inbox', label: 'Instagram & FB Inbox', icon: MessageSquare, roles: ['ADMIN', 'MANAGER'] },
  { href: '/calls', label: 'Call Center', icon: Headphones },
  { href: '/expenses', label: 'Expenses', icon: Calculator, roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { href: '/payments', label: 'Daily Payments', icon: Banknote, roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { href: '/payroll', label: 'Payroll', icon: Wallet, roles: ['ADMIN'] },
  { href: '/financials', label: 'Financials', icon: BarChart3, roles: ['ADMIN'] },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['ADMIN'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { sidebarOpen, setSidebarOpen } = useSidebarContext();
  const { data: session } = useSession();

  const [logoUrl, setLogoUrl] = useState('/logo.png');

  useEffect(() => {
    getStoreSettings().then(res => {
      if (res.success && res.data.logo) setLogoUrl(res.data.logo);
    });
    const handleLogoUpdate = (e) => setLogoUrl(e.detail);
    window.addEventListener('logo-updated', handleLogoUpdate);
    return () => window.removeEventListener('logo-updated', handleLogoUpdate);
  }, []);

  const userRole = session?.user?.role || 'STAFF';
  const userName = session?.user?.name || 'User';
  const userInitials = userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const roleLabel = userRole === 'ADMIN' ? 'Administrator' : userRole === 'MANAGER' ? 'Manager' : 'Staff';

  // Filter nav items by role
  const visibleNav = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(userRole);
  });

  return (
    <>
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[55] md:hidden animate-[fade-in_0.2s_ease]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-screen bg-sidebar flex flex-col z-[60] transition-all duration-300
          ${/* Top safe-area clearance so the header clears the mobile status bar/notch */ ''}
          max-md:pt-[max(env(safe-area-inset-top),12px)]
          ${/* Desktop */ ''}
          max-md:w-[280px]
          ${sidebarOpen ? 'max-md:translate-x-0' : 'max-md:translate-x-[-100%]'}
          ${collapsed ? 'md:w-[68px]' : 'md:w-[260px]'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 h-[64px] border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
              <Image src={logoUrl} alt="Real Estate CRM Logo" width={32} height={32} className="object-contain" priority />
            </div>
            {(!collapsed || sidebarOpen) && (
              <div>
                <h1 className="text-sm font-semibold text-white tracking-wide">Realzentic</h1>
                <p className="text-[10px] text-white/40 tracking-widest uppercase">{roleLabel}</p>
              </div>
            )}
          </div>
          {/* Mobile close button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden min-h-11 min-w-11 p-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 md:min-h-0 md:py-2 ${isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                  }`}
                title={collapsed && !sidebarOpen ? item.label : undefined}
              >
                <Icon className={`w-[17px] h-[17px] flex-shrink-0 ${isActive ? 'text-white' : ''}`} />
                {(!collapsed || sidebarOpen) && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section (mobile only) */}
        <div className="md:hidden px-4 py-3 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-white text-xs font-semibold">
              {userInitials}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{userName}</p>
              <p className="text-[10px] text-white/40">{roleLabel}</p>
            </div>
          </div>
        </div>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex mx-2.5 mb-3 p-2 rounded-lg border border-white/10 text-white/40 hover:text-white/70 hover:bg-white/5 transition-all duration-150 items-center justify-center"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>
    </>
  );
}

export function useSidebarWidth() {
  return 260;
}
