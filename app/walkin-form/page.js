/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect } from 'react';
import { PROPERTY_CONFIG_OPTIONS, RE_BUDGET_RANGES } from '@/lib/real-estate-options';

const REQUIREMENT_OPTIONS = PROPERTY_CONFIG_OPTIONS;

const BUDGET_RANGES = RE_BUDGET_RANGES;

export default function WalkinFormPage() {
  const [storeName, setStoreName] = useState('');
  const [logo, setLogo] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', requirement: '', budget: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/walkin')
      .then(r => r.json())
      .then(data => {
        setStoreName(data.storeName || 'Realzentic');
        setLogo(data.logo);
      })
      .catch(() => { });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) { setError('Please enter your name'); return; }
    if (!/^5\d{8}$/.test(form.phone.replace(/\D/g, ''))) { setError('Please enter a valid UAE mobile number'); return; }
    if (!form.requirement) { setError('Please select what you are looking for'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/walkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: `971${form.phone.replace(/\D/g, '')}`,
          requirement: form.requirement,
          budget: form.budget || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Success Screen ─────────────────────────────
  if (submitted) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={S.successIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1 style={S.successTitle}>Welcome, {form.name}!</h1>
          <p style={S.successSub}>Thank you for registering. Our team will assist you shortly.</p>
          <div style={S.infoBox}>
            <p style={S.infoLabel}>Looking for</p>
            <p style={S.infoValue}>{form.requirement}</p>
            {form.budget && <>
              <p style={{ ...S.infoLabel, marginTop: 10 }}>Budget</p>
              <p style={S.infoValue}>{form.budget}</p>
            </>}
          </div>
          <p style={S.successHint}>Feel free to explore our projects while we connect you with the right person.</p>
          <button onClick={() => { setSubmitted(false); setForm({ name: '', phone: '', requirement: '', budget: '' }); }} style={S.againBtn}>
            Register another visitor
          </button>
        </div>
      </div>
    );
  }

  // ─── Form Screen ────────────────────────────────
  return (
    <div style={S.page}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {logo ? (
            <div style={S.logoWrap}><img src={logo} alt={storeName} style={S.logoImg} /></div>
          ) : (
            <div style={S.logoDef}><span style={{ fontSize: 28 }}>🏠</span></div>
          )}
          <h1 style={S.storeName}>{storeName}</h1>
          <p style={S.tagline}>Welcome! Please register your visit</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={S.card}>
          {/* Name */}
          <div style={S.field}>
            <label style={S.label}>Your Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="text" placeholder="Enter your full name" autoFocus
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={S.input}
            />
          </div>

          {/* Phone */}
          <div style={S.field}>
            <label style={S.label}>Phone Number <span style={{ color: '#ef4444' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={S.prefix}>+971</span>
              <input
                type="tel" placeholder="5X XXX XXXX" inputMode="numeric" maxLength={9}
                value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
                style={{ ...S.input, flex: 1 }}
              />
            </div>
          </div>

          {/* Requirement */}
          <div style={S.field}>
            <label style={S.label}>What are you looking for? <span style={{ color: '#ef4444' }}>*</span></label>
            <select
              value={form.requirement} onChange={e => setForm(f => ({ ...f, requirement: e.target.value }))}
              style={{ ...S.input, appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3e%3cpath stroke=%27%236b7280%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27M6 8l4 4 4-4%27/%3e%3c/svg%3e")', backgroundPosition: 'right 12px center', backgroundRepeat: 'no-repeat', backgroundSize: '20px', paddingRight: 40 }}
            >
              <option value="">Select your requirement</option>
              {REQUIREMENT_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Budget */}
          <div style={S.field}>
            <label style={S.label}>Budget Range <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <select
              value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
              style={{ ...S.input, appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3e%3cpath stroke=%27%236b7280%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27M6 8l4 4 4-4%27/%3e%3c/svg%3e")', backgroundPosition: 'right 12px center', backgroundRepeat: 'no-repeat', backgroundSize: '20px', paddingRight: 40 }}
            >
              <option value="">Select budget range</option>
              {BUDGET_RANGES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div style={S.errorBox}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              {error}
            </div>
          )}

          {/* Submit */}
          <button type="submit" disabled={submitting} style={{ ...S.submitBtn, opacity: submitting ? 0.65 : 1 }}>
            {submitting ? 'Registering...' : 'Register My Visit'}
          </button>

          <p style={S.privacy}>Your information is safe and will only be used for in-store assistance.</p>
        </form>
      </div>
    </div>
  );
}

// ─── Inline Styles ────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 40%, #fff7ed 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    background: '#fff', borderRadius: 24, padding: '28px 24px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.06)', border: '1px solid #f3f4f6',
  },
  logoWrap: {
    width: 64, height: 64, margin: '0 auto 12px', borderRadius: 16,
    overflow: 'hidden', background: '#fff', border: '1px solid #f3f4f6',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  logoImg: { width: '100%', height: '100%', objectFit: 'contain' },
  logoDef: {
    width: 64, height: 64, margin: '0 auto 12px', borderRadius: 16,
    background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(245,158,11,0.25)',
  },
  storeName: { fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 2px' },
  tagline: { fontSize: 14, color: '#6b7280', margin: 0 },
  field: { marginBottom: 18 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 },
  input: {
    width: '100%', padding: '12px 14px', background: '#f9fafb',
    border: '1.5px solid #e5e7eb', borderRadius: 12, fontSize: 15,
    color: '#111827', outline: 'none', boxSizing: 'border-box',
  },
  prefix: {
    padding: '12px 12px', background: '#f3f4f6', border: '1.5px solid #e5e7eb',
    borderRadius: 12, fontSize: 14, color: '#6b7280', fontWeight: 500,
  },
  errorBox: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
    borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca',
    color: '#dc2626', fontSize: 13, marginBottom: 16,
  },
  submitBtn: {
    width: '100%', padding: '14px', borderRadius: 14, border: 'none',
    background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
    color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(245,158,11,0.25)',
    marginBottom: 12,
  },
  privacy: { fontSize: 11, color: '#9ca3af', textAlign: 'center', margin: 0 },

  // Success
  successIcon: {
    width: 72, height: 72, margin: '0 auto 16px', borderRadius: '50%',
    background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 6px', textAlign: 'center' },
  successSub: { fontSize: 14, color: '#6b7280', margin: '0 0 20px', textAlign: 'center' },
  infoBox: {
    padding: 16, borderRadius: 14, background: '#f9fafb', border: '1px solid #f3f4f6',
    marginBottom: 16,
  },
  infoLabel: { fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 2px' },
  infoValue: { fontSize: 15, color: '#111827', fontWeight: 500, margin: 0 },
  successHint: { fontSize: 13, color: '#6b7280', textAlign: 'center', margin: '0 0 16px' },
  againBtn: {
    display: 'block', margin: '0 auto', padding: '8px 20px', borderRadius: 10,
    border: 'none', background: 'none', color: '#f59e0b', fontSize: 14,
    fontWeight: 600, cursor: 'pointer',
  },
};
