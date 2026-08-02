'use client';

import { useState, useEffect } from 'react';
import { Search, Plus, MessageSquare, Instagram, Facebook, Globe, Phone, Mail, ChevronRight, Bot, Clock, Trash2, Store, Building2, AlertCircle, Users } from 'lucide-react';
import { getLeads, getLeadReferenceData, createLead, updateLeadStatus, addFollowUp, findDuplicates, mergeContacts, dedupReport } from '@/app/actions/leads';
import { convertLeadToFollowUp } from '@/app/actions/follow-ups';
import { moveLeadToDraft } from '@/app/actions/drafts';
import Modal from '@/components/Modal';
import AiMatchPanel from '@/components/AiMatchPanel';
import DuplicateWarningModal from '@/components/leads/DuplicateWarningModal';
import { useAlertToast } from '@/components/AlertToastProvider';
import { LEAD_SOURCE_OPTIONS } from '@/lib/lead-sources';
import {
  PROPERTY_CONFIG_OPTIONS,
  RE_BUDGET_RANGES,
  PURPOSE_OPTIONS,
  POSSESSION_OPTIONS,
  DUBAI_LOCATION_OPTIONS,
  composePreferenceNotes,
} from '@/lib/real-estate-options';

const pipelineStages = ['New', 'Contacted', 'Site Visit', 'Quotation', 'Won', 'Lost'];

const stageToEnum = {
  'New': 'NEW', 'Contacted': 'CONTACTED', 'Site Visit': 'SHOWROOM_VISIT',
  'Quotation': 'QUOTATION', 'Won': 'WON', 'Lost': 'LOST',
};

const sourceIconMap = { WhatsApp: MessageSquare, 'WhatsApp Inquiry': MessageSquare, Instagram, Facebook, Website: Globe, 'Property Viewing': Store, 'Site Visit': Store, 'Walk-in': Store, Referral: Users, 'Channel Partner': Building2, Bayut: Building2, 'Property Finder': Building2, Dubizzle: Building2 };

const sourceColorMap = {
  WhatsApp: 'text-success bg-success-light',
  'WhatsApp Inquiry': 'text-emerald-700 bg-emerald-500/10',
  Instagram: 'text-pink bg-pink-light',
  Facebook: 'text-info bg-info-light',
  Website: 'text-teal bg-teal-light',
  'Property Viewing': 'text-amber-700 bg-amber-500/10',
  'Site Visit': 'text-amber-700 bg-amber-500/10',
  'Walk-in': 'text-amber-700 bg-amber-500/10',
  Referral: 'text-purple bg-purple-light',
  'Channel Partner': 'text-blue-700 bg-blue-500/10',
  Bayut: 'text-blue-700 bg-blue-500/10',
  'Property Finder': 'text-indigo-700 bg-indigo-500/10',
  Dubizzle: 'text-amber-700 bg-amber-500/10',
};

const defaultSourceColor = 'text-muted bg-surface-hover';

const statusColorMap = {
  New: 'bg-info-light text-info border-info/20',
  Contacted: 'bg-accent-light text-accent border-accent/20',
  'Site Visit': 'bg-purple-light text-purple border-purple/20',
  Quotation: 'bg-teal-light text-teal border-teal/20',
  Won: 'bg-success-light text-success border-success/20',
  Lost: 'bg-danger-light text-danger border-danger/20',
};

const normalizePhoneNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00971')) return digits.slice(2);
  if (digits.startsWith('971')) return digits;
  if (digits.length === 10 && digits.startsWith('05')) return `971${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `971${digits}`;
  return digits;
};

const buildWhatsAppUrl = (phone, message) => {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
};

const buildLeadWhatsAppMessage = (lead) => {
  const interest = lead?.interest ? ` about ${lead.interest}` : '';
  return `Hello ${lead?.name || ''}, this is regarding your enquiry${interest}.`.trim();
};

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [view, setView] = useState('pipeline');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({ day: 1, message: '', date: '' });
  const { notify } = useAlertToast();
  const [leadToDraft, setLeadToDraft] = useState(null);
  const [deletingLead, setDeletingLead] = useState(false);

  // Convert-to-follow-up state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [leadToConvert, setLeadToConvert] = useState(null);
  const [convertForm, setConvertForm] = useState({ followUpDate: '', reason: '', priority: 'Medium' });
  const [converting, setConverting] = useState(false);

  // Duplicate-detection state (Req 11.2, 11.5)
  const [duplicateMatches, setDuplicateMatches] = useState([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [pendingLeadData, setPendingLeadData] = useState(null);
  const [mergingContact, setMergingContact] = useState(false);
  // Set of contactIds that are flagged as potential duplicates (for badge rendering)
  const [duplicateContactIds, setDuplicateContactIds] = useState(new Set());

  const refresh = async () => {
    const [leadsRes, dupRes, refsRes] = await Promise.all([getLeads(), dedupReport(), getLeadReferenceData()]);
    if (leadsRes.success) setLeads(leadsRes.data);
    if (refsRes.success) setProjects(refsRes.data.projects);
    if (dupRes.success && dupRes.data.length > 0) {
      const ids = new Set(dupRes.data.flatMap(group => group.map(m => m.id)));
      setDuplicateContactIds(ids);
    } else {
      setDuplicateContactIds(new Set());
    }
  };

  useEffect(() => {
    getLeads().then(res => {
      if (res.success) setLeads(res.data);
      setLoading(false);
    });
    // Req 11.5: load duplicate groups so we can show badges on existing leads.
    dedupReport().then(res => {
      if (res.success && res.data.length > 0) {
        const ids = new Set(res.data.flatMap(group => group.map(m => m.id)));
        setDuplicateContactIds(ids);
      }
    });
    getLeadReferenceData().then(res => { if (res.success) setProjects(res.data.projects); });
  }, []);

  const filteredLeads = leads.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.interest.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateLead = async (e) => {
    e.preventDefault();
    const f = e.target;
    const leadData = {
      name: f.fullName.value, phone: f.phone.value, email: f.email.value,
      source: f.source.value, budget: f.budget.value,
      projectId: f.projectId?.value ? Number(f.projectId.value) : null,
      interest: f.interest.value,
      notes: composePreferenceNotes({
        notes: f.notes.value,
        purpose: f.purpose?.value || undefined,
        possession: f.possession?.value || undefined,
        location: f.location?.value || undefined,
      }),
    };

    // Req 11.1 / 11.2: check for duplicates before saving.
    const dupRes = await findDuplicates({
      name: leadData.name,
      phone: leadData.phone,
      email: leadData.email || null,
    });

    if (dupRes.success && dupRes.data.length > 0) {
      // Stash the form data and show the duplicate-warning modal.
      setPendingLeadData(leadData);
      setDuplicateMatches(dupRes.data);
      setShowAddModal(false);
      setShowDuplicateModal(true);
      return;
    }

    // No duplicates — proceed directly.
    const res = await createLead(leadData);
    if (res.success) { setShowAddModal(false); await refresh(); }
    else notify(res.error || 'Failed to create lead', { variant: 'danger' });
  };

  /**
   * The user chose to proceed and create a new lead despite duplicates.
   * Req 11.2: "Create New" action.
   */
  const handleCreateNewDespiteDuplicates = async () => {
    if (!pendingLeadData) return;
    const res = await createLead(pendingLeadData);
    setShowDuplicateModal(false);
    setPendingLeadData(null);
    setDuplicateMatches([]);
    if (res.success) {
      await refresh();
    } else {
      notify(res.error || 'Failed to create lead', { variant: 'danger' });
    }
  };

  /**
   * The user chose to merge the incoming lead with an existing contact.
   * Req 11.2: "Merge" action.
   * targetId is the existing Contact to keep; we first create the incoming
   * lead so its data exists, then merge its contact into targetId.
   */
  const handleMergeDuplicate = async (targetId, fieldChoices) => {
    if (!pendingLeadData || mergingContact) return;
    setMergingContact(true);
    try {
      // 1. Create the lead/contact for the incoming data.
      const createRes = await createLead(pendingLeadData);
      if (!createRes.success) {
        notify(createRes.error || 'Failed to create lead before merge', { variant: 'danger' });
        return;
      }
      const newContactId = createRes.data?.contactId ?? createRes.data?.id;

      // 2. Merge: source = newly created contact, target = existing chosen contact.
      if (newContactId && newContactId !== targetId) {
        const mergeRes = await mergeContacts(targetId, newContactId, fieldChoices);
        if (!mergeRes.success) {
          notify(mergeRes.error || 'Merge did not complete', { variant: 'danger' });
          return;
        }
      }

      setShowDuplicateModal(false);
      setPendingLeadData(null);
      setDuplicateMatches([]);
      await refresh();
      notify('Lead merged successfully', { variant: 'success' });
    } finally {
      setMergingContact(false);
    }
  };

  /**
   * Dismiss the duplicate modal without any action (user closed it).
   * Re-open the add modal so they can edit their input.
   */
  const handleCloseDuplicateModal = () => {
    setShowDuplicateModal(false);
    setDuplicateMatches([]);
    // Re-open the add modal so the user can continue editing.
    setShowAddModal(true);
  };

  const handleUpdateStatus = async (leadId, newStage) => {
    const enumStatus = stageToEnum[newStage];
    if (!enumStatus) return;
    setUpdatingStatus(true);
    const res = await updateLeadStatus({ id: leadId, status: enumStatus });
    if (res.success) {
      await refresh();
      setSelectedLead(prev => prev ? { ...prev, status: newStage } : null);
    }
    setUpdatingStatus(false);
  };

  const handleDelete = (leadId) => {
    const lead = leads.find(l => l.id === leadId);
    // Close detail modal so confirmation modal appears on top.
    // Delay setting the draft modal until after the detail modal closes to avoid z-index/overlay issues.
    setSelectedLead(null);
    setTimeout(() => setLeadToDraft(lead || { id: leadId }), 160);
  };

  const confirmDelete = async () => {
    if (!leadToDraft) return;
    setDeletingLead(true);
    try {
      const res = await moveLeadToDraft(leadToDraft.id);
      if (res?.success) {
        setSelectedLead(null);
        await refresh();
        notify('Lead moved to drafts', { variant: 'success' });
      } else {
        notify(res?.error || 'Failed to move lead to drafts', { variant: 'danger' });
      }
    } catch (err) {
      notify(err?.message || 'Failed to move lead to drafts', { variant: 'danger' });
    } finally {
      setDeletingLead(false);
      setLeadToDraft(null);
    }
  };

  const cancelDelete = () => setLeadToDraft(null);

  const handleAddFollowUp = async () => {
    if (!followUpForm.message || !followUpForm.date) return;
    const res = await addFollowUp({ leadId: selectedLead.id, day: followUpForm.day, message: followUpForm.message, date: followUpForm.date });
    if (res.success) {
      setFollowUpForm({ day: 1, message: '', date: '' });
      setShowFollowUpForm(false);
      const updated = await getLeads();
      if (updated.success) {
        setLeads(updated.data);
        const fresh = updated.data.find(l => l.id === selectedLead.id);
        if (fresh) setSelectedLead(fresh);
      }
    }
  };

  const handleConvertToFollowUp = async () => {
    if (!leadToConvert || !convertForm.followUpDate) {
      notify('Please pick a follow-up date', { variant: 'danger' });
      return;
    }
    setConverting(true);
    const res = await convertLeadToFollowUp({
      leadId: leadToConvert.id,
      followUpDate: convertForm.followUpDate,
      reason: convertForm.reason || undefined,
      priority: convertForm.priority || undefined,
    });
    setConverting(false);
    if (res.success) {
      setShowConvertModal(false);
      setLeadToConvert(null);
      setConvertForm({ followUpDate: '', reason: '', priority: 'Medium' });
      setSelectedLead(null);
      await refresh();
      notify('Lead converted to a follow-up', { variant: 'success' });
    } else {
      notify(res.error || 'Failed to convert lead', { variant: 'danger' });
    }
  };

  const handleLeadWhatsApp = (lead) => {
    const message = buildLeadWhatsAppMessage(lead);
    const url = buildWhatsAppUrl(lead?.phone, message);
    if (!url) {
      notify('Lead phone number is missing', { variant: 'danger' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-surface rounded-lg" />
        <div className="flex gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="min-w-[280px] h-64 bg-surface rounded-2xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-[fade-in_0.5s_ease-out] min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Leads</h1>
          <p className="text-xs md:text-sm text-muted mt-1">{leads.length} total · {leads.filter(l => l.status === 'New').length} new · {leads.filter(l => l.status === 'Won').length} won</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-surface rounded-xl border border-border p-0.5">
            <button onClick={() => setView('pipeline')} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'pipeline' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>Pipeline</button>
            <button onClick={() => setView('list')} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'list' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>List</button>
          </div>
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all">
            <Plus className="w-4 h-4" /> Add Lead
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input type="text" placeholder="Search leads by name or property interest..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full md:max-w-md pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-border text-sm" />
      </div>

      {view === 'pipeline' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {pipelineStages.map((stage) => {
            const stageLeads = filteredLeads.filter(l => l.status === stage);
            return (
              <div key={stage} className="min-w-[280px] flex-shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={`badge ${statusColorMap[stage]}`}>{stage}</span>
                  <span className="text-xs text-muted">({stageLeads.length})</span>
                </div>
                <div className="space-y-3">
                  {stageLeads.map((lead) => {
                    const SourceIcon = sourceIconMap[lead.source] || Globe;
                    const sourceColor = sourceColorMap[lead.source] || defaultSourceColor;
                    const isDuplicate = duplicateContactIds.has(lead.contactId);
                    return (
                      <div key={lead.id} onClick={() => setSelectedLead(lead)}
                        className="glass-card p-4 cursor-pointer group hover:scale-[1.02] transition-transform">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="relative w-8 h-8">
                              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-semibold text-accent">
                                {lead.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              {/* Duplicate badge — Req 11.5 */}
                              {isDuplicate && (
                                <span
                                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center"
                                  title="Potential duplicate contact"
                                  aria-label="Potential duplicate"
                                >
                                  <AlertCircle className="w-2.5 h-2.5 text-white" />
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-foreground">{lead.name}</p>
                                {isDuplicate && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-700 border border-amber-500/20">
                                    Duplicate
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted">{lead.date}</p>
                            </div>
                          </div>
                          {SourceIcon && (
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${sourceColor}`}>
                              <SourceIcon className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted mb-2">🏠 {lead.interest}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-accent">{lead.budget}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    );
                  })}
                  {stageLeads.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted border-2 border-dashed border-border rounded-xl">No leads</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* Mobile: app-style card list */}
          <div className="md:hidden space-y-2.5">
            {filteredLeads.length === 0 && (
              <div className="glass-card py-12 text-center text-sm text-muted">No leads found</div>
            )}
            {filteredLeads.map((lead, i) => {
              const SourceIcon = sourceIconMap[lead.source] || Globe;
              const sourceColor = sourceColorMap[lead.source] || defaultSourceColor;
              const isDupLead = duplicateContactIds.has(lead.contactId);
              return (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className="m-card tap-press animate-list-in flex items-center gap-3"
                  style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                >
                  <div className="relative w-11 h-11 flex-shrink-0">
                    <div className="w-11 h-11 rounded-full bg-accent/10 flex items-center justify-center text-sm font-semibold text-accent">
                      {lead.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    {/* Duplicate badge — Req 11.5 */}
                    {isDupLead && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center"
                        title="Potential duplicate contact"
                      >
                        <AlertCircle className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{lead.name}</p>
                        {isDupLead && (
                          <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-700 border border-amber-500/20">
                            Dup
                          </span>
                        )}
                      </div>
                      <span className={`badge flex-shrink-0 ${statusColorMap[lead.status]}`}>{lead.status}</span>
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">🏠 {lead.interest}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md ${sourceColor}`}>
                        {SourceIcon && <SourceIcon className="w-3 h-3" />}
                        {lead.source}
                      </span>
                      <span className="text-xs font-medium text-accent ml-auto">{lead.budget}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="crm-table">
                <thead><tr><th>Name</th><th>Interest</th><th>Source</th><th>Budget</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {filteredLeads.map((lead) => {
                    const SourceIcon = sourceIconMap[lead.source] || Globe;
                    const sourceColor = sourceColorMap[lead.source] || defaultSourceColor;
                    const sourceTextColor = sourceColor.split(' ')[0];
                    const isDupLead = duplicateContactIds.has(lead.contactId);
                    return (
                      <tr key={lead.id} className="cursor-pointer" onClick={() => setSelectedLead(lead)}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="relative w-8 h-8">
                              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-semibold text-accent">
                                {lead.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              {/* Duplicate badge — Req 11.5 */}
                              {isDupLead && (
                                <span
                                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center"
                                  title="Potential duplicate contact"
                                >
                                  <AlertCircle className="w-2.5 h-2.5 text-white" />
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-foreground">{lead.name}</p>
                                {isDupLead && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-700 border border-amber-500/20">
                                    Duplicate
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted">{lead.phone}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-foreground">{lead.interest}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            {SourceIcon && <SourceIcon className={`w-4 h-4 ${sourceTextColor}`} />}
                            <span>{lead.source}</span>
                          </div>
                        </td>
                        <td className="text-accent font-medium">{lead.budget}</td>
                        <td><span className={`badge ${statusColorMap[lead.status]}`}>{lead.status}</span></td>
                        <td className="text-muted">{lead.date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal isOpen={!!leadToDraft} onClose={cancelDelete} title="Move Lead to Draft" size="sm">
        {leadToDraft && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Move <strong className="text-foreground">{leadToDraft.name || leadToDraft.id}</strong> to drafts? It will be permanently deleted after 30 days.</p>
            <div className="flex justify-end gap-3">
              <button onClick={cancelDelete} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
              <button onClick={confirmDelete} disabled={deletingLead} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50">{deletingLead ? 'Moving...' : 'Move to Draft'}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Convert to Follow-up Modal */}
      <Modal isOpen={showConvertModal} onClose={() => { setShowConvertModal(false); setLeadToConvert(null); }} title="Convert to Follow-up" size="md">
        {leadToConvert && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Schedule a future date to reconnect with <strong className="text-foreground">{leadToConvert.name}</strong>.
              The lead is kept and linked, so nothing is lost.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Follow-up Date *</label>
                <input
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  value={convertForm.followUpDate}
                  onChange={(e) => setConvertForm((p) => ({ ...p, followUpDate: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Priority</label>
                <select
                  value={convertForm.priority}
                  onChange={(e) => setConvertForm((p) => ({ ...p, priority: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Reason / When are they buying?</label>
              <input
                value={convertForm.reason}
                onChange={(e) => setConvertForm((p) => ({ ...p, reason: e.target.value }))}
                placeholder="e.g. Will decide after 2 months / after selling current home"
                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setShowConvertModal(false); setLeadToConvert(null); }} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
              <button onClick={handleConvertToFollowUp} disabled={converting} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50">
                {converting ? 'Converting...' : 'Create Follow-up'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Lead Detail Modal */}
      <Modal isOpen={!!selectedLead} onClose={() => { setSelectedLead(null); setShowFollowUpForm(false); }} title="Lead Details" size="lg">
        {selectedLead && (
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-xl font-bold text-accent">
                {selectedLead.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">{selectedLead.name}</h3>
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-sm text-muted"><Phone className="w-3.5 h-3.5" /> {selectedLead.phone}</span>
                  {selectedLead.email && <span className="flex items-center gap-1 text-sm text-muted"><Mail className="w-3.5 h-3.5" /> {selectedLead.email}</span>}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <a
                    href={`tel:${selectedLead.phone}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 hover:bg-emerald-500/20"
                  >
                    <Phone className="w-3.5 h-3.5" /> Call
                  </a>
                  <button
                    type="button"
                    onClick={() => handleLeadWhatsApp(selectedLead)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-border text-muted hover:text-foreground hover:border-emerald-500/30"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLeadToConvert(selectedLead); setConvertForm({ followUpDate: '', reason: '', priority: 'Medium' }); setSelectedLead(null); setShowConvertModal(true); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-light text-purple border border-purple/20 hover:bg-purple/20"
                  >
                    <Clock className="w-3.5 h-3.5" /> Convert to Follow-up
                  </button>
                </div>
              </div>
            </div>

            {/* Pipeline Stage Selector */}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Move Stage</p>
              <div className="flex flex-wrap gap-1.5">
                {pipelineStages.map(stage => (
                  <button key={stage} disabled={updatingStatus} onClick={() => handleUpdateStatus(selectedLead.id, stage)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${selectedLead.status === stage
                      ? `${statusColorMap[stage]} font-bold`
                      : 'bg-surface border-border text-muted hover:text-foreground'
                      }`}>
                    {stage}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-surface">
                <p className="text-xs text-muted mb-1">Interest</p>
                <p className="text-sm font-medium text-foreground">🏠 {selectedLead.interest}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface">
                <p className="text-xs text-muted mb-1">Budget</p>
                <p className="text-sm font-medium text-accent">{selectedLead.budget}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface">
                <p className="text-xs text-muted mb-1">Source</p>
                <p className="text-sm font-medium text-foreground">{selectedLead.source}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface">
                <p className="text-xs text-muted mb-1">Date Added</p>
                <p className="text-sm font-medium text-foreground">{selectedLead.date}</p>
              </div>
            </div>

            {selectedLead.notes && (
              <div className="p-3 rounded-xl bg-surface">
                <p className="text-xs text-muted mb-1">Notes</p>
                <p className="text-sm text-foreground">{selectedLead.notes}</p>
              </div>
            )}

            {/* AI Match Panel — Req 16.4 */}
            <AiMatchPanel
              preferences={{ location: selectedLead.location || undefined }}
              initialBudgetText={selectedLead.budget || ''}
              buyerName={selectedLead.name}
              buyerPhone={selectedLead.phone}
            />

            {/* Follow-up Timeline */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-accent" />
                  <p className="text-sm font-semibold text-foreground">Follow-up Timeline</p>
                  {selectedLead.followUps?.length > 0 && (
                    <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">{selectedLead.followUps.length}</span>
                  )}
                </div>
                <button onClick={() => setShowFollowUpForm(f => !f)}
                  className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Follow-up
                </button>
              </div>

              {showFollowUpForm && (
                <div className="mb-4 p-4 rounded-xl bg-surface border border-border space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted mb-1 block">Day #</label>
                      <input type="number" min="1" value={followUpForm.day} onChange={e => setFollowUpForm(f => ({ ...f, day: Number(e.target.value) }))}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50" />
                    </div>
                    <div>
                      <label className="text-xs text-muted mb-1 block">Date</label>
                      <input type="date" value={followUpForm.date} onChange={e => setFollowUpForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Message</label>
                    <textarea rows={2} value={followUpForm.message} onChange={e => setFollowUpForm(f => ({ ...f, message: e.target.value }))}
                      placeholder="Follow-up message..." className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-border rounded-lg text-sm resize-none focus:outline-none focus:border-accent/50" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowFollowUpForm(false)} className="px-3 py-1.5 text-xs text-muted hover:text-foreground rounded-lg hover:bg-surface-hover transition-colors">Cancel</button>
                    <button onClick={handleAddFollowUp} disabled={!followUpForm.message || !followUpForm.date}
                      className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">Save</button>
                  </div>
                </div>
              )}

              {selectedLead.followUps?.length > 0 ? (
                <div className="space-y-3 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border">
                  {selectedLead.followUps.map((fu, i) => (
                    <div key={i} className="flex gap-3 relative">
                      <div className="w-[32px] h-[32px] rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 z-10 border-2 border-background">
                        <Clock className="w-3.5 h-3.5 text-accent" />
                      </div>
                      <div className="flex-1 p-3 rounded-xl bg-surface">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-accent">Day {fu.day}</span>
                          <span className="text-[10px] text-muted">{fu.date}</span>
                        </div>
                        <p className="text-sm text-foreground">{fu.message}</p>
                        <span className={`badge text-[10px] mt-2 ${fu.sent ? 'bg-success-light text-success' : 'bg-surface-hover text-muted'}`}>{fu.sent ? '✓ Sent' : '⏳ Pending'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted text-center py-4">No follow-ups yet</p>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <button onClick={() => handleDelete(selectedLead.id)}
                className="flex items-center gap-1.5 text-xs text-danger hover:text-danger/80 font-medium transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Move to Draft
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Lead Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add New Lead">
        <form className="space-y-4" onSubmit={handleCreateLead}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Full Name</label>
              <input type="text" name="fullName" required placeholder="Customer name" className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Phone</label>
              <input type="tel" name="phone" required placeholder="+971..." className="w-full" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Email</label>
            <input type="email" name="email" placeholder="customer@email.com" className="w-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Source</label>
              <select name="source" className="w-full">
                {LEAD_SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Budget</label>
              <select name="budget" className="w-full">
                <option value="">Select budget range</option>
                {RE_BUDGET_RANGES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Property Configuration</label>
              <select name="interest" required className="w-full" defaultValue="">
                <option value="" disabled>Select configuration</option>
                {PROPERTY_CONFIG_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Preferred Location / Project</label>
              <input type="text" name="location" list="lead-dubai-location-options" placeholder="e.g., Dubai Marina or a project name" className="w-full" />
              <datalist id="lead-dubai-location-options">
                {DUBAI_LOCATION_OPTIONS.map(location => <option key={location} value={location} />)}
              </datalist>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Exact Project (for demand reporting)</label>
            <select name="projectId" className="w-full" defaultValue="">
              <option value="">Not specified / location only</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.city}, {project.emirate}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Purpose</label>
              <select name="purpose" className="w-full" defaultValue="">
                <option value="">Not specified</option>
                {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Possession Timeline</label>
              <select name="possession" className="w-full" defaultValue="">
                <option value="">Not specified</option>
                {POSSESSION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Notes</label>
            <textarea rows={3} name="notes" placeholder="Additional notes..." className="w-full" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">Cancel</button>
            <button type="submit" className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all">Save Lead</button>
          </div>
        </form>
      </Modal>

      {/* Duplicate Warning Modal — Req 11.2, 11.5 */}
      <DuplicateWarningModal
        isOpen={showDuplicateModal}
        matches={duplicateMatches}
        pendingLead={pendingLeadData || {}}
        onMerge={handleMergeDuplicate}
        onCreateNew={handleCreateNewDespiteDuplicates}
        onClose={handleCloseDuplicateModal}
      />
    </div>
  );
}
