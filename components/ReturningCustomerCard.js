'use client';

import { useState } from 'react';
import { Star, Clock, Tag, ChevronDown, ChevronUp, FileText, ShoppingBag, Hammer } from 'lucide-react';

export default function ReturningCustomerCard({ profile, onApplyDiscount, loading = false }) {
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState('flat');
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (!profile && !loading) return null;

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="h-4 w-40 bg-muted rounded" />
          <div className="h-4 w-16 bg-muted rounded" />
        </div>
        <div className="flex border-t border-border divide-x divide-border">
          <div className="flex-1 px-3 py-2"><div className="h-3 w-full bg-muted rounded" /></div>
          <div className="flex-1 px-3 py-2"><div className="h-3 w-full bg-muted rounded" /></div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const totalPurchases = profile.invoiceCount + profile.orderCount + profile.customOrderCount;
  const isFirstVisit = totalPurchases === 0;

  const lastVisitLabel = profile.lastPurchaseDate
    ? `Last: ${new Date(profile.lastPurchaseDate).toLocaleDateString('en-AE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })}`
    : null;

  // Loyalty tier
  const tier = isFirstVisit
    ? { label: 'New Customer', color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20' }
    : profile.lifetimeValue >= 500000
    ? { label: 'Platinum', color: 'text-cyan-600', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' }
    : profile.lifetimeValue >= 200000
    ? { label: 'Gold', color: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/20' }
    : profile.lifetimeValue >= 50000
    ? { label: 'Silver', color: 'text-zinc-500', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' }
    : { label: 'Regular', color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };

  return (
    <div className={`rounded-xl border ${tier.border} ${tier.bg} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Star className={`w-3.5 h-3.5 ${tier.color} fill-current flex-shrink-0`} />
          <span className={`text-xs font-semibold ${tier.color}`}>
            {isFirstVisit ? 'Customer Found' : 'Returning Customer'}
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${tier.bg} ${tier.color} border ${tier.border}`}>
            {tier.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastVisitLabel && (
            <span className={`text-[10px] ${tier.color} flex items-center gap-1`}>
              <Clock className="w-3 h-3" /> {lastVisitLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowBreakdown(p => !p)}
            className={`${tier.color} opacity-60 hover:opacity-100 transition-opacity`}
          >
            {showBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-0 border-t border-current/10 divide-x divide-current/10">
        {isFirstVisit ? (
          <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
            <span className="text-[11px] text-muted">Contact is in the system — no purchases yet</span>
          </div>
        ) : (
          <>
            {profile.invoiceCount > 0 && (
              <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
                <FileText className={`w-3 h-3 ${tier.color} opacity-70`} />
                <span className="text-xs text-foreground font-semibold">{profile.invoiceCount}</span>
                <span className="text-[10px] text-muted">invoice{profile.invoiceCount !== 1 ? 's' : ''}</span>
              </div>
            )}
            {profile.orderCount > 0 && (
              <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
                <ShoppingBag className={`w-3 h-3 ${tier.color} opacity-70`} />
                <span className="text-xs text-foreground font-semibold">{profile.orderCount}</span>
                <span className="text-[10px] text-muted">order{profile.orderCount !== 1 ? 's' : ''}</span>
              </div>
            )}
            {profile.customOrderCount > 0 && (
              <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
                <Hammer className={`w-3 h-3 ${tier.color} opacity-70`} />
                <span className="text-xs text-foreground font-semibold">{profile.customOrderCount}</span>
                <span className="text-[10px] text-muted">custom</span>
              </div>
            )}
            <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
              <span className="text-[10px] text-muted">Lifetime</span>
              <span className={`text-xs font-bold ${tier.color}`}>
                AED {profile.lifetimeValue >= 100000
                  ? (profile.lifetimeValue / 100000).toFixed(1) + 'L'
                  : profile.lifetimeValue.toLocaleString()}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Breakdown (expandable) */}
      {showBreakdown && (
        <div className="border-t border-current/10 px-3 py-2.5 space-y-1.5">
          {isFirstVisit ? (
            <div className="text-xs text-muted">No purchase history on record for this contact.</div>
          ) : (
            <>
              {profile.invoiceCount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Invoices total</span>
                  <span className="text-foreground font-medium">AED {profile.totalInvoiceValue.toLocaleString()}</span>
                </div>
              )}
              {profile.orderCount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Orders total</span>
                  <span className="text-foreground font-medium">AED {profile.totalOrderValue.toLocaleString()}</span>
                </div>
              )}
              {profile.customOrderCount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Custom orders total</span>
                  <span className="text-foreground font-medium">AED {profile.totalCustomValue.toLocaleString()}</span>
                </div>
              )}
            </>
          )}
          {profile.email && (
            <div className="flex justify-between text-xs pt-1 border-t border-current/10">
              <span className="text-muted">Email on file</span>
              <span className="text-foreground">{profile.email}</span>
            </div>
          )}
        </div>
      )}

      {/* Loyalty discount — only shown in billing/invoice context, and only for returning customers */}
      {onApplyDiscount && !isFirstVisit && (
        <div className="border-t border-current/10 px-3 py-2.5 flex items-center gap-2">
          <Tag className={`w-3.5 h-3.5 ${tier.color} flex-shrink-0`} />
          <span className="text-[10px] text-muted flex-shrink-0">Loyalty discount</span>
          <input
            type="number"
            min="0"
            placeholder="Amount"
            value={discountValue}
            onChange={e => setDiscountValue(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 rounded-lg text-xs bg-background border border-border focus:outline-none focus:border-accent/50 text-foreground"
          />
          <select
            value={discountType}
            onChange={e => setDiscountType(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs bg-background border border-border focus:outline-none text-foreground flex-shrink-0"
          >
            <option value="flat">AED  Flat</option>
            <option value="percent">% Off</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const v = parseFloat(discountValue);
              if (v > 0) onApplyDiscount(v, discountType);
            }}
            disabled={!discountValue || parseFloat(discountValue) <= 0}
            className={`px-3 py-1 rounded-lg text-[11px] font-semibold text-white transition-colors flex-shrink-0 disabled:opacity-40 ${
              tier.label === 'Platinum' ? 'bg-cyan-600 hover:bg-cyan-700'
              : tier.label === 'Gold' ? 'bg-amber-600 hover:bg-amber-700'
              : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
