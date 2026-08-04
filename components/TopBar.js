'use client';

import { Bell, Search, Menu, ChevronDown, LogOut, User, UserPlus, Shield, MessageSquare, CalendarClock, AlertTriangle, Package, MapPin, FileText } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { useSidebarContext } from './SidebarContext';
import ThemeToggle from './ThemeToggle';
import {
  getTopNotifications,
  markConversationNotificationRead,
  markAllConversationNotificationsRead,
  markNotificationRead,
  markAllAlertNotificationsRead,
} from '@/app/actions/notifications';

export default function TopBar() {
  const [searchFocused, setSearchFocused] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [notifications, setNotifications] = useState({
    unreadCount: 0,
    unreadConversationsCount: 0,
    pendingFollowUps: 0,
    overdueInvoices: 0,
    items: [],
  });
  const { setSidebarOpen } = useSidebarContext();
  const { data: session } = useSession();
  const router = useRouter();
  const menuRef = useRef(null);
  const notificationsRef = useRef(null);

  const userName = session?.user?.name || 'User';
  const userRole = session?.user?.role || 'STAFF';
  const userInitials = userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = userRole === 'ADMIN' ? 'Administrator' : userRole === 'MANAGER' ? 'Manager' : 'Staff';

  const refreshNotifications = async () => {
    setLoadingNotifications(true);
    const res = await getTopNotifications();
    if (res?.success) setNotifications(res.data);
    setLoadingNotifications(false);
  };

  useEffect(() => {
    const tick = () => {
      refreshNotifications().catch(() => { });
    };

    queueMicrotask(tick);
    const interval = setInterval(tick, 15000);
    const onFocus = () => tick();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const handleBellClick = async () => {
    const opening = !showNotifications;
    setShowNotifications(opening);
    if (opening) {
      await refreshNotifications();
    }
  };

  const formatDateTime = (dateStr) => {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-AE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getNotificationIcon = (type) => {
    if (type === 'conversation') return MessageSquare;
    if (type === 'followup') return CalendarClock;
    if (type === 'stock_alert') return Package;
    if (type === 'field_visit') return MapPin;
    if (type === 'purchase_order') return FileText;
    if (type === 'financial_alert') return AlertTriangle;
    if (type === 'lead_captured' || type === 'portal_lead') return UserPlus;
    return AlertTriangle;
  };

  const getNotificationIconColor = (type) => {
    if (type === 'conversation') return 'text-info bg-info/10';
    if (type === 'followup') return 'text-accent bg-accent/10';
    if (type === 'stock_alert') return 'text-warning bg-warning/10';
    if (type === 'field_visit') return 'text-success bg-success/10';
    if (type === 'purchase_order') return 'text-blue-600 bg-blue-500/10';
    if (type === 'financial_alert') return 'text-red-600 bg-red-500/10';
    if (type === 'lead_captured' || type === 'portal_lead') return 'text-emerald-600 bg-emerald-500/10';
    return 'text-danger bg-danger/10';
  };

  const handleNotificationClick = async (item) => {
    if (item.type === 'conversation') {
      const convoId = Number(item.id.split('-')[1]);
      if (!Number.isNaN(convoId)) {
        await markConversationNotificationRead(convoId);
      }
    } else if (item.type === 'stock_alert' || item.type === 'field_visit' || item.type === 'purchase_order' || item.type === 'financial_alert' || item.type === 'lead_captured' || item.type === 'portal_lead') {
      const notifId = Number(item.id.split('-')[1]);
      if (!Number.isNaN(notifId)) {
        await markNotificationRead(notifId);
      }
    }

    setShowNotifications(false);
    await refreshNotifications();
    router.push(item.href);
  };

  const handleMarkAllConversationsRead = async () => {
    if (notifications.unreadConversationsCount <= 0) return;
    setMarkingAllRead(true);
    await markAllConversationNotificationsRead();
    await markAllAlertNotificationsRead();
    await refreshNotifications();
    setMarkingAllRead(false);
  };

  // Close menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    if (showUserMenu || showNotifications) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu, showNotifications]);

  return (
    <header className="mobile-top-safe border-b border-border bg-surface/95 backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
      {/* Left section */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="md:hidden touch-target p-2 -ml-1 rounded-xl hover:bg-surface-hover transition-colors flex-shrink-0"
          aria-label="Open sidebar menu"
        >
          <Menu className="w-5 h-5 text-foreground" />
        </button>

        {/* Mobile: App title / Desktop: Search */}
        <div className="md:hidden flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-foreground tracking-tight truncate">Realzentic Dubai</span>
        </div>
        <div className={`hidden md:flex relative items-center transition-all duration-200 ${searchFocused ? 'w-[400px]' : 'w-[300px]'}`}>
          <Search className="absolute left-3 w-4 h-4 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search leads, products, orders..."
            style={{ paddingLeft: '40px' }}
            className="w-full pr-4 py-2 bg-surface-hover rounded-lg border border-border text-sm placeholder:text-muted/60 focus:bg-surface transition-all"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0 ml-2">
        {/* Theme toggle */}
        <ThemeToggle className="touch-target" />

        {/* Notifications */}
        <div className="relative" ref={notificationsRef}>
          <button
            onClick={handleBellClick}
            className="relative touch-target p-2 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Open notifications"
          >
            <Bell className="w-[18px] h-[18px] text-muted" />
            {notifications.unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-semibold leading-4 text-center">
                {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-1.5 w-[360px] max-w-[calc(100vw-24px)] bg-surface rounded-2xl border border-border shadow-xl z-50 overflow-hidden animate-[fade-in_0.15s_ease-out]">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Notifications</p>
                  <p className="text-[11px] text-muted">
                    {notifications.unreadCount} active · {notifications.unreadConversationsCount} unread chats
                  </p>
                </div>
                <button
                  onClick={handleMarkAllConversationsRead}
                  disabled={markingAllRead || notifications.unreadConversationsCount === 0}
                  className="text-[11px] font-medium text-accent disabled:text-muted disabled:cursor-not-allowed"
                >
                  {markingAllRead ? 'Marking...' : 'Mark chats read'}
                </button>
              </div>

              <div className="max-h-[380px] overflow-y-auto">
                {loadingNotifications ? (
                  <div className="p-4 text-sm text-muted">Loading notifications...</div>
                ) : notifications.items.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm font-medium text-foreground">No notifications</p>
                    <p className="text-xs text-muted mt-1">You are all caught up.</p>
                  </div>
                ) : (
                  notifications.items.map(item => {
                    const Icon = getNotificationIcon(item.type);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNotificationClick(item)}
                        className="w-full text-left p-3.5 border-b border-border last:border-0 hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${getNotificationIconColor(item.type)}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-foreground truncate">{item.title}</p>
                              <span className="text-[10px] text-muted whitespace-nowrap">{formatDateTime(item.date)}</span>
                            </div>
                            <p className="text-[11px] text-muted truncate mt-0.5">{item.subtitle}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="px-4 py-2.5 border-t border-border bg-surface/50 flex items-center justify-between gap-2">
                <a href="/calls" className="text-[11px] font-medium text-accent hover:text-accent-hover">Call Center</a>
                <a href="/leads" className="text-[11px] font-medium text-accent hover:text-accent-hover">Leads</a>
                <a href="/payments" className="text-[11px] font-medium text-accent hover:text-accent-hover">Payments</a>
              </div>
            </div>
          )}
        </div>

        {/* Divider — desktop only */}
        <div className="w-px h-7 bg-border hidden md:block" />

        {/* User dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 hover:bg-surface-hover rounded-xl px-2 py-1.5 min-h-[44px] md:min-h-0 transition-colors"
            aria-label="User menu"
          >
            <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-white text-xs font-semibold ring-2 ring-transparent hover:ring-accent/20 transition-all">
              {userInitials}
            </div>
            <div className="text-left hidden md:block">
              <p className="text-sm font-medium text-foreground leading-tight">{userName}</p>
              <p className="text-[10px] text-muted">{roleLabel}</p>
            </div>
            <ChevronDown className={`w-3 h-3 text-muted hidden md:block transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown menu */}
          {showUserMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-surface rounded-xl border border-border shadow-lg py-1.5 z-50 animate-[fade-in_0.15s_ease-out]">
              {/* User info */}
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-semibold text-foreground">{userName}</p>
                <p className="text-xs text-muted">{session?.user?.email}</p>
                <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${userRole === 'ADMIN' ? 'bg-blue-500/10 text-blue-700' :
                  userRole === 'MANAGER' ? 'bg-purple-500/10 text-purple-700' :
                    'bg-amber-500/10 text-amber-700'
                  }`}>
                  <Shield className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />
                  {roleLabel}
                </span>
              </div>

              {/* Menu items */}
              <div className="py-1">
                <button
                  onClick={() => { setShowUserMenu(false); window.location.href = '/settings'; }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-surface-hover transition-colors"
                >
                  <User className="w-4 h-4 text-muted" />
                  Profile & Settings
                </button>
              </div>

              <div className="border-t border-border pt-1">
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-danger hover:bg-danger-light transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
