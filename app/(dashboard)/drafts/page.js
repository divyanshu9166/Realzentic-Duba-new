/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect } from 'react';
import {
  Trash2, RotateCcw, Clock, Package, Search,
  AlertTriangle, Calendar, Phone, MapPin, Ruler,
  DollarSign, X, ChevronDown, FileText, Camera,
  MapPinned, User,
} from 'lucide-react';
import Modal from '@/components/Modal';
import { useAlertToast } from '@/components/AlertToastProvider';
import { getDrafts, restoreFromDraft, permanentlyDeleteDraft } from '@/app/actions/drafts';

export default function DraftsPage() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const sourceTypeLabels = {
    CustomOrder: 'Property Bookings',
    FieldVisit: 'Self Visits',
    Lead: 'Leads',
    Walkin: 'Walk-ins',
    Appointment: 'Appointments',
    Order: 'Property Deals',
    Quotation: 'Cost Sheets',
    Invoice: 'Payment Records',
    PurchaseOrder: 'Developer Payment Plans',
    Expense: 'Expenses',
  };

  const sourceTypeActionLabels = {
    CustomOrder: 'Property Booking',
    FieldVisit: 'Self Visit',
    Lead: 'Lead',
    Walkin: 'Walk-in',
    Appointment: 'Appointment',
    Order: 'Property Deal',
    Quotation: 'Cost Sheet',
    Invoice: 'Payment Record',
    PurchaseOrder: 'Developer Payment Plan',
    Expense: 'Expense',
  };

  const getDraftLabel = sourceType => sourceTypeLabels[sourceType] || sourceType;
  const getDraftActionLabel = sourceType => sourceTypeActionLabels[sourceType] || sourceType;

  const reload = async () => {
    const res = await getDrafts();
    if (res.success) setDrafts(res.data);
  };

  useEffect(() => {
    // Initial draft load is intentionally kicked off on mount.
    reload().finally(() => setLoading(false));
  }, []);

  const alertToast = useAlertToast?.() || { notify: (m) => alert(m) };

  const [confirmAction, setConfirmAction] = useState({ open: false, type: null, draftId: null, message: '' });

  const openConfirm = (type, draftId, message) => setConfirmAction({ open: true, type, draftId, message });
  const closeConfirm = () => setConfirmAction({ open: false, type: null, draftId: null, message: '' });

  const handleRestore = (draftId) => {
    const draft = drafts.find(d => d.id === draftId);
    const label = draft ? (draft.sourceType === 'FieldVisit' ? 'visit' : getDraftActionLabel(draft.sourceType).toLowerCase()) : 'item';
    openConfirm('restore', draftId, `Restore this ${label}? It will be re-created.`);
  };

  const handlePermanentDelete = (draftId) => {
    openConfirm('delete', draftId, 'Permanently delete this draft? This cannot be undone.');
  };

  const runConfirmed = async () => {
    if (!confirmAction.open || !confirmAction.type) return;
    setSaving(true);
    try {
      if (confirmAction.type === 'restore') {
        const res = await restoreFromDraft(confirmAction.draftId);
        if (res.success) {
          setSelectedDraft(null);
          await reload();
          alertToast.notify?.('Restored successfully', 'success');
        } else {
          alertToast.notify?.(res.error || 'Failed to restore', 'error');
        }
      } else if (confirmAction.type === 'delete') {
        const res = await permanentlyDeleteDraft(confirmAction.draftId);
        if (res.success) {
          setSelectedDraft(null);
          await reload();
          alertToast.notify?.('Draft deleted permanently', 'success');
        } else {
          alertToast.notify?.(res.error || 'Failed to delete', 'error');
        }
      }
    } catch (err) {
      alertToast.notify?.(err?.message || 'Action failed', 'error');
    } finally {
      setSaving(false);
      closeConfirm();
    }
  };

  const filtered = drafts.filter(d => {
    if (filter !== 'All' && d.sourceType !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      const data = d.data;
      return (
        (data.displayId || '').toLowerCase().includes(s) ||
        (data.customer || '').toLowerCase().includes(s) ||
        (data.phone || '').toLowerCase().includes(s) ||
        (data.type || '').toLowerCase().includes(s) ||
        (data.address || '').toLowerCase().includes(s) ||
        (data.staffName || '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-surface rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-surface rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Drafts</h2>
          <p className="text-xs text-muted mt-0.5">Deleted items are auto-removed after 30 days</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted bg-surface px-3 py-1.5 rounded-lg border border-border">
            {drafts.length} item{drafts.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search drafts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-border text-sm focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-1.5">
          {['All', 'CustomOrder', 'FieldVisit', 'Lead', 'Walkin', 'Appointment', 'Order', 'Quotation', 'Invoice', 'PurchaseOrder', 'Expense'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${filter === f ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-foreground border border-border'}`}
            >
              {f === 'All' ? 'All' : getDraftLabel(f)}
            </button>
          ))}
        </div>
      </div>

      {/* Drafts List */}
      {filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Trash2 className="w-10 h-10 text-muted/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted">No drafts</p>
          <p className="text-xs text-muted mt-1">Deleted items will appear here for 30 days</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(draft => {
            const data = draft.data;
            const deletedDate = new Date(draft.deletedAt);

            return (
              <div
                key={draft.id}
                onClick={() => setSelectedDraft(draft)}
                className="glass-card p-5 cursor-pointer hover:border-accent/30 transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-accent">{data.displayId}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-700 border border-red-500/20">
                        Deleted
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-hover text-muted">
                        {getDraftActionLabel(draft.sourceType)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{data.customer}</p>
                    <p className="text-xs text-muted">{data.type}</p>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs font-medium ${draft.daysLeft <= 7 ? 'text-red-600' : draft.daysLeft <= 14 ? 'text-amber-600' : 'text-muted'}`}>
                      {draft.daysLeft} day{draft.daysLeft !== 1 ? 's' : ''} left
                    </div>
                    <p className="text-[10px] text-muted mt-0.5">
                      Deleted {deletedDate.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted mb-3">
                  {data.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {data.phone}</span>}
                  {draft.sourceType === 'FieldVisit' && data.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {data.address}</span>}
                  {draft.sourceType === 'FieldVisit' && data.staffName && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {data.staffName}</span>}
                  {data.quotedPrice != null && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> AED {data.quotedPrice.toLocaleString()}</span>}
                  {data.materials && <span>{data.materials}</span>}
                </div>

                {/* Progress bar showing days left */}
                <div className="w-full bg-surface rounded-full h-1.5 mb-3">
                  <div
                    className={`h-1.5 rounded-full transition-all ${draft.daysLeft <= 7 ? 'bg-red-500' : draft.daysLeft <= 14 ? 'bg-amber-500' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, (draft.daysLeft / 30) * 100)}%` }}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRestore(draft.id); }}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg text-xs font-medium text-emerald-700 border border-emerald-500/20 transition-all disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePermanentDelete(draft.id); }}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-xs font-medium text-red-700 border border-red-500/20 transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" /> Delete Forever
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <Modal isOpen={!!selectedDraft} onClose={() => setSelectedDraft(null)} title="Draft Details" size="lg">
        {selectedDraft && (() => {
          const data = selectedDraft.data;
          const deletedDate = new Date(selectedDraft.deletedAt);
          const expiresDate = new Date(selectedDraft.expiresAt);

          return (
            <div className="space-y-4">
              {/* Warning Banner */}
              <div className={`flex items-center gap-2 p-3 rounded-xl text-xs font-medium ${selectedDraft.daysLeft <= 7 ? 'bg-red-500/10 text-red-700 border border-red-500/20' : 'bg-amber-500/10 text-amber-700 border border-amber-500/20'}`}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>This draft will be permanently deleted on {expiresDate.toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric' })} ({selectedDraft.daysLeft} days remaining)</span>
              </div>

              {/* Info Section — adapts based on sourceType */}
              {selectedDraft.sourceType === 'FieldVisit' ? (
                <>
                  {/* Visit Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Visit</p>
                      <p className="text-sm font-semibold text-foreground">{data.displayId}</p>
                      <p className="text-xs text-muted">{data.type}</p>
                    </div>
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Customer</p>
                      <p className="text-sm font-semibold text-foreground">{data.customer}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {data.address && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Address</p>
                        <p className="text-xs text-foreground flex items-center gap-1"><MapPin className="w-3 h-3 text-muted" /> {data.address}</p>
                      </div>
                    )}
                    {data.staffName && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Staff</p>
                        <p className="text-xs text-foreground flex items-center gap-1"><User className="w-3 h-3 text-muted" /> {data.staffName}</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {data.date && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Date</p>
                        <p className="text-xs text-foreground">{new Date(data.date).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      </div>
                    )}
                    {data.time && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Time</p>
                        <p className="text-xs text-foreground">{data.time}</p>
                      </div>
                    )}
                    {data.status && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Status</p>
                        <p className="text-xs text-foreground">{data.status}</p>
                      </div>
                    )}
                  </div>

                  {data.notes && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Notes</p>
                      <p className="text-xs text-foreground">{data.notes}</p>
                    </div>
                  )}

                  {data.staffNotes && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Staff Notes</p>
                      <p className="text-xs text-foreground">{data.staffNotes}</p>
                    </div>
                  )}

                  {data.measurements && Object.values(data.measurements).some(v => v) && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-2 flex items-center gap-1"><Ruler className="w-3 h-3" /> Measurements</p>
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(data.measurements).filter(([, v]) => v).map(([k, v]) => (
                          <span key={k} className="text-xs text-foreground capitalize"><span className="text-muted">{k}:</span> {v}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.photoUrls && data.photoUrls.length > 0 && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-2 flex items-center gap-1"><Camera className="w-3 h-3" /> Photos ({data.photoUrls.length})</p>
                      <div className="flex gap-2 flex-wrap">
                        {data.photoUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="w-16 h-16 rounded-lg overflow-hidden border border-border hover:border-accent/50 transition-colors">
                            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Custom Order Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Order</p>
                      <p className="text-sm font-semibold text-foreground">{data.displayId}</p>
                      <p className="text-xs text-muted">{data.type}</p>
                    </div>
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Customer</p>
                      <p className="text-sm font-semibold text-foreground">{data.customer}</p>
                      <p className="text-xs text-muted">{data.phone}</p>
                    </div>
                  </div>

                  {data.address && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Address</p>
                      <p className="text-xs text-foreground flex items-center gap-1"><MapPin className="w-3 h-3 text-muted" /> {data.address}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    {data.materials && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Materials</p>
                        <p className="text-xs text-foreground">{data.materials}</p>
                      </div>
                    )}
                    {data.color && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Color</p>
                        <p className="text-xs text-foreground">{data.color}</p>
                      </div>
                    )}
                    {data.quotedPrice != null && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Quoted Price</p>
                        <p className="text-xs text-foreground font-medium">AED {data.quotedPrice.toLocaleString()}</p>
                      </div>
                    )}
                    {data.advancePaid > 0 && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Advance Paid</p>
                        <p className="text-xs text-foreground font-medium">AED {data.advancePaid.toLocaleString()}</p>
                      </div>
                    )}
                    {data.assignedStaff && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Assigned Staff</p>
                        <p className="text-xs text-foreground">{data.assignedStaff}</p>
                      </div>
                    )}
                    {data.status && (
                      <div className="bg-surface rounded-xl p-3">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Last Status</p>
                        <p className="text-xs text-foreground">{data.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                      </div>
                    )}
                  </div>

                  {data.measurements && Object.values(data.measurements).some(v => v) && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-2 flex items-center gap-1"><Ruler className="w-3 h-3" /> Measurements</p>
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(data.measurements).filter(([k, v]) => v && k !== 'notes').map(([k, v]) => (
                          <span key={k} className="text-xs text-foreground capitalize"><span className="text-muted">{k}:</span> {v}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.referenceImages && data.referenceImages.length > 0 && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-2">Reference Images</p>
                      <div className="flex gap-2 flex-wrap">
                        {data.referenceImages.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="w-16 h-16 rounded-lg overflow-hidden border border-border hover:border-accent/50 transition-colors">
                            <img src={url} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.timeline && data.timeline.length > 0 && (
                    <div className="bg-surface rounded-xl p-3">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-2">Timeline</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {data.timeline.map((t, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className={`w-2 h-2 rounded-full mt-1 ${t.status === 'done' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            <div>
                              <p className="text-xs text-foreground">{t.event}</p>
                              <p className="text-[10px] text-muted">
                                {new Date(t.date).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}
                                {t.updatedBy && ` · ${t.updatedBy}`}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Deletion Info */}
              <div className="bg-surface rounded-xl p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Deleted by <span className="text-foreground font-medium">{selectedDraft.deletedBy}</span> on {deletedDate.toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setSelectedDraft(null)} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">
                  Close
                </button>
                <button
                  onClick={() => handlePermanentDelete(selectedDraft.id)}
                  disabled={saving}
                  className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-700 rounded-xl text-sm font-medium border border-red-500/20 transition-all disabled:opacity-50"
                >
                  Delete Forever
                </button>
                <button
                  onClick={() => handleRestore(selectedDraft.id)}
                  disabled={saving}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {saving ? 'Restoring...' : `Restore ${getDraftActionLabel(selectedDraft.sourceType)}`}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>
      {/* Confirmation Modal for restore / delete */}
      <Modal isOpen={confirmAction.open} onClose={closeConfirm} title={confirmAction.type === 'delete' ? 'Confirm Deletion' : 'Confirm Action'} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted">{confirmAction.message}</p>
          <div className="flex justify-end gap-3">
            <button onClick={closeConfirm} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
            <button onClick={runConfirmed} disabled={saving} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50">{saving ? 'Processing...' : (confirmAction.type === 'delete' ? 'Delete Forever' : 'Confirm')}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
