'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getStaff } from '@/app/actions/staff';
import { getStoreSettings } from '@/app/actions/settings';
import Image from 'next/image';
import MagicCard from '@/components/MagicCard';
import { Shield, Users, Eye, EyeOff, Loader2, ArrowLeft, LogIn, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const [mode, setMode] = useState(null); // null = chooser, 'admin', 'staff'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [storeProfile, setStoreProfile] = useState({ name: 'Realzentic Dubai', logo: '' });
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  // Staff login state
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  useEffect(() => {
    if (mode === 'staff' && staffList.length === 0) {
      setStaffLoading(true);
      getStaff().then(res => {
        if (res.success) setStaffList(res.data);
        setStaffLoading(false);
      });
    }
  }, [mode, staffList.length]);

  useEffect(() => {
    let active = true;
    getStoreSettings().then(res => {
      if (!active || !res.success) return;
      setStoreProfile({
        name: res.data.storeName || 'Realzentic Dubai',
        logo: res.data.logo || '',
      });
    });
    return () => { active = false; };
  }, []);

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, type: 'credentials' }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Invalid email or password');
      } else {
        window.location.href = '/';
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!selectedStaffId) { setError('Please select a staff member'); return; }
    if (!staffPassword) { setError('Please enter your login password'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: selectedStaffId, password: staffPassword, type: 'staff-credentials' }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Invalid staff credentials.');
      } else {
        window.location.href = '/staff-portal';
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const Logo = ({ size = 56 }) => (
    <div className="rounded-2xl flex items-center justify-center overflow-hidden bg-accent/10 ring-1 ring-accent/20" style={{ width: size, height: size }}>
      {storeProfile.logo ? (
        <Image src={storeProfile.logo} alt="Store Logo" width={size} height={size} unoptimized className="w-full h-full object-contain bg-white" />
      ) : (
        <span className="text-2xl">🪑</span>
      )}
    </div>
  );

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Ambient background */}
      <div className="ambient-grid absolute inset-0" aria-hidden="true" />
      <div className="ambient-glow absolute left-1/2 top-1/4 h-[460px] w-[460px] -translate-x-1/2 rounded-full animate-float-slow" aria-hidden="true" />

      <MagicCard className="glass-card relative z-10 w-full max-w-md p-8 md:p-9 rounded-3xl" gradientSize={300}>
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-7">
          <Logo />
          <h1 className="mt-4 text-xl md:text-2xl font-bold text-foreground tracking-tight">
            {mode === null ? storeProfile.name : mode === 'admin' ? 'Admin sign in' : 'Staff sign in'}
          </h1>
          <p className="text-sm text-muted mt-1">
            {mode === null ? 'Choose how you want to sign in'
              : mode === 'admin' ? 'Enter your admin credentials to continue'
                : 'Select your name and enter your login password'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-danger-light border border-danger/20 rounded-xl text-danger text-sm text-center animate-[fade-in_0.2s_ease]">
            {error}
          </div>
        )}

        {/* Role chooser */}
        {mode === null && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setMode('admin'); setError(''); }}
              className="tap-press group flex flex-col items-center gap-3 p-5 rounded-2xl border border-border hover:border-accent/50 hover:bg-accent-light transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center group-hover:scale-105 transition-transform">
                <Shield className="w-6 h-6" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground text-sm">Admin</p>
                <p className="text-[11px] text-muted mt-0.5">Full dashboard access</p>
              </div>
            </button>

            <button
              onClick={() => { setMode('staff'); setError(''); }}
              className="tap-press group flex flex-col items-center gap-3 p-5 rounded-2xl border border-border hover:border-teal/50 hover:bg-teal-light transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-teal/10 text-teal flex items-center justify-center group-hover:scale-105 transition-transform">
                <Users className="w-6 h-6" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground text-sm">Staff</p>
                <p className="text-[11px] text-muted mt-0.5">Staff portal &amp; tasks</p>
              </div>
            </button>
          </div>
        )}

        {/* Admin form */}
        {mode === 'admin' && (
          <form onSubmit={handleAdminSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Username or Email</label>
              <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username"
                placeholder="Enter username or email"
                className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-foreground placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required
                  placeholder="Enter your password"
                  className="w-full px-4 py-2.5 pr-11 rounded-xl bg-surface border border-border text-foreground placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all" />
                <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="tap-press-sm w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : <><LogIn className="w-4 h-4" /> Sign In</>}
            </button>
          </form>
        )}

        {/* Staff form */}
        {mode === 'staff' && (
          <form onSubmit={handleStaffSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Select Staff Member</label>
              {staffLoading ? (
                <div className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-muted text-sm animate-pulse">Loading staff...</div>
              ) : (
                <select value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} required
                  className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-foreground focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all">
                  <option value="">Choose your name</option>
                  {staffList.filter(s => s.status === 'Active' && s.hasLogin && s.loginActive).map(s => (
                    <option key={s.id} value={s.id}>{s.name} — {s.role}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={staffPassword} onChange={(e) => setStaffPassword(e.target.value)} required
                  placeholder="Enter your login password"
                  className="w-full px-4 py-2.5 pr-11 rounded-xl bg-surface border border-border text-foreground placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all" />
                <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="tap-press-sm w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : <>Enter Staff Portal <ArrowRight className="w-4 h-4" /></>}
            </button>
            <p className="text-[11px] text-muted text-center bg-surface-light border border-border rounded-xl p-2.5">
              Use the login password assigned by admin in Settings / Team.
            </p>
          </form>
        )}

        {/* Back button */}
        {mode !== null && (
          <button onClick={() => { setMode(null); setError(''); }}
            className="w-full mt-5 py-2 text-sm text-muted hover:text-foreground transition-colors flex items-center justify-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to role selection
          </button>
        )}
      </MagicCard>
    </div>
  );
}
