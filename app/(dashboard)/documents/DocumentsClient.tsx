'use client';

/**
 * Documents & KYC interactive surface (Req 8.7, 8.8).
 *
 * - Tabs for All / Contact / Deal / Project documents (Req 8.8).
 * - Drag-and-drop upload subject to the same size (1 B – 25 MB) and MIME
 *   allow-list validation as the server action, surfaced via `validateUpload`
 *   before the file is ever sent (Req 8.8, mirrors Req 8.2/8.3).
 * - Expiry alerts driven by `listExpiringDocuments` with a configurable window
 *   in [1, 365] days (Req 8.7).
 * - KYC center (`createKycRecord`) and template manager
 *   (`upsertDocumentTemplate`, `generateFromTemplate`).
 */

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import {
    FileText,
    UploadCloud,
    AlertTriangle,
    ShieldCheck,
    LayoutTemplate,
    ExternalLink,
    Calendar,
    Loader2,
    Plus,
    CheckCircle2,
    X,
    Download,
    PenLine,
} from 'lucide-react';
import ESignatureModal from './ESignatureModal';
import { toast } from 'sonner';
import {
    uploadDocument,
    createKycRecord,
    upsertDocumentTemplate,
    generateFromTemplate,
    listExpiringDocuments,
} from '@/app/actions/documents';
import {
    validateUpload,
    extractMergeFields,
    MAX_UPLOAD_BYTES,
    MIN_EXPIRY_WINDOW_DAYS,
    MAX_EXPIRY_WINDOW_DAYS,
    type UploadRejectionReason,
} from '@/lib/documents';

// ─── Shared row types (serialized for the client) ─────────

export interface DocumentRow {
    id: number;
    entityType: string;
    entityId: number;
    type: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    status: string;
    notes: string | null;
    expiryDate: string | null;
    createdAt: string;
}

export interface TemplateRow {
    id: number;
    name: string;
    type: string;
    category: string;
    htmlBody: string;
    header: string | null;
    footer: string | null;
    isDefault: boolean;
}

export interface KycRow {
    id: number;
    contactId: number;
    contactName: string;
    documentType: string;
    documentNumber: string;
    verified: boolean;
    autoVerified: boolean;
    verifiedAt: string | null;
}

export interface ContactOption {
    id: number;
    name: string;
    phone: string | null;
}

// ─── Constants & helpers ──────────────────────────────────

const ENTITY_TABS = ['All', 'Contact', 'Deal', 'Project'] as const;
type EntityTab = (typeof ENTITY_TABS)[number];
const UPLOAD_ENTITY_TYPES = ['Contact', 'Deal', 'Project', 'Booking'] as const;

const UPLOAD_REJECTION_MESSAGES: Record<UploadRejectionReason, string> = {
    EMPTY_FILE: 'File is empty (minimum size is 1 byte).',
    TOO_LARGE: 'File exceeds the maximum size of 25 MB.',
    INVALID_SIZE: 'File size is invalid.',
    DISALLOWED_TYPE: 'File type is not accepted.',
};

const STATUS_STYLES: Record<string, string> = {
    Pending: 'bg-amber-500/10 text-amber-600',
    Verified: 'bg-emerald-500/10 text-emerald-600',
    Rejected: 'bg-red-500/10 text-red-600',
    Expired: 'bg-zinc-500/10 text-zinc-500',
};

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-AE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const target = Math.floor(new Date(iso).getTime() / MS_PER_DAY);
    const today = Math.floor(Date.now() / MS_PER_DAY);
    return target - today;
}

// ─── Root component ───────────────────────────────────────

export default function DocumentsClient({
    initialDocuments,
    templates: initialTemplates,
    kycRecords: initialKyc,
    contacts,
    initialExpiringIds,
    initialWindowDays,
}: {
    initialDocuments: DocumentRow[];
    templates: TemplateRow[];
    kycRecords: KycRow[];
    contacts: ContactOption[];
    initialExpiringIds: number[];
    initialWindowDays: number;
}) {
    const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
    const [templates, setTemplates] = useState<TemplateRow[]>(initialTemplates);
    const [kycRecords, setKycRecords] = useState<KycRow[]>(initialKyc);
    const [activeTab, setActiveTab] = useState<EntityTab>('All');

    // E-signature modal state.
    const [eSignOpen, setESignOpen] = useState(false);
    const [eSignDoc, setESignDoc] = useState<{ contactId?: number; documentId?: number } | null>(null);

    function openESign(doc: DocumentRow) {
        setESignDoc({ contactId: doc.entityType === 'Contact' ? doc.entityId : undefined, documentId: doc.id });
        setESignOpen(true);
    }

    // Expiry alert state (Req 8.7).
    const [windowDays, setWindowDays] = useState<number>(initialWindowDays);
    const [expiringIds, setExpiringIds] = useState<Set<number>>(new Set(initialExpiringIds));
    const [expiryLoading, startExpiryTransition] = useTransition();

    const filteredDocuments = useMemo(() => {
        if (activeTab === 'All') return documents;
        return documents.filter((d) => d.entityType === activeTab);
    }, [documents, activeTab]);

    const expiringDocuments = useMemo(
        () => documents.filter((d) => expiringIds.has(d.id)),
        [documents, expiringIds],
    );

    function refreshExpiry(nextWindow: number) {
        startExpiryTransition(async () => {
            const res = await listExpiringDocuments(nextWindow);
            if (res.success) {
                setExpiringIds(new Set(res.data.map((d) => d.id)));
            } else {
                toast.error(res.error ?? 'Could not refresh expiry alerts.');
            }
        });
    }

    function handleWindowChange(value: number) {
        const clamped = Math.min(
            MAX_EXPIRY_WINDOW_DAYS,
            Math.max(MIN_EXPIRY_WINDOW_DAYS, Math.round(value || MIN_EXPIRY_WINDOW_DAYS)),
        );
        setWindowDays(clamped);
        refreshExpiry(clamped);
    }

    function handleUploaded(doc: DocumentRow) {
        setDocuments((prev) => [doc, ...prev]);
        refreshExpiry(windowDays);
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-accent" />
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-foreground">Documents &amp; KYC</h1>
                    <p className="mt-0.5 text-xs md:text-sm text-muted">
                        Central repository, KYC verification, and template-based generation.
                    </p>
                </div>
            </div>

            {/* Expiry alerts (Req 8.7) */}
            <ExpiryAlerts
                documents={expiringDocuments}
                windowDays={windowDays}
                loading={expiryLoading}
                onWindowChange={handleWindowChange}
            />

            {/* Upload (Req 8.8) */}
            <UploadPanel
                defaultEntityType={activeTab === 'All' ? 'Contact' : activeTab}
                onUploaded={handleUploaded}
            />

            {/* Tabs (Req 8.8) */}
            <div>
                <div className="flex flex-wrap gap-1 border-b border-border">
                    {ENTITY_TABS.map((tab) => {
                        const count =
                            tab === 'All'
                                ? documents.length
                                : documents.filter((d) => d.entityType === tab).length;
                        const isActive = tab === activeTab;
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${isActive
                                    ? 'border-accent text-accent'
                                    : 'border-transparent text-muted hover:text-foreground'
                                    }`}
                            >
                                {tab}
                                <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <DocumentTable documents={filteredDocuments} expiringIds={expiringIds} onRequestESign={openESign} />
            </div>

            {/* KYC + Templates */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <KycCenter
                    contacts={contacts}
                    records={kycRecords}
                    onCreated={(rec) => setKycRecords((prev) => [rec, ...prev])}
                />
                <TemplateManager
                    templates={templates}
                    onUpserted={(tpl) =>
                        setTemplates((prev) => {
                            const idx = prev.findIndex((t) => t.id === tpl.id);
                            if (idx === -1) return [...prev, tpl].sort((a, b) => a.name.localeCompare(b.name));
                            const next = [...prev];
                            next[idx] = tpl;
                            return next;
                        })
                    }
                />
            </div>

            {/* E-signature modal */}
            <ESignatureModal
                isOpen={eSignOpen}
                onClose={() => setESignOpen(false)}
                contactId={eSignDoc?.contactId}
                documentId={eSignDoc?.documentId}
                onSigned={(url) => {
                    toast.success(`Signature captured: ${url.split('/').pop()}`);
                    setESignOpen(false);
                }}
            />
        </div>
    );
}

// ─── Expiry alerts ────────────────────────────────────────

function ExpiryAlerts({
    documents,
    windowDays,
    loading,
    onWindowChange,
}: {
    documents: DocumentRow[];
    windowDays: number;
    loading: boolean;
    onWindowChange: (value: number) => void;
}) {
    return (
        <div className="glass-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <h2 className="text-sm font-semibold text-foreground">
                        Expiry alerts
                        <span className="ml-1.5 font-normal text-muted">
                            ({documents.length} within {windowDays} day{windowDays === 1 ? '' : 's'})
                        </span>
                    </h2>
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                    Alert window (days)
                    <input
                        type="number"
                        min={MIN_EXPIRY_WINDOW_DAYS}
                        max={MAX_EXPIRY_WINDOW_DAYS}
                        defaultValue={windowDays}
                        onBlur={(e) => onWindowChange(Number(e.target.value))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onWindowChange(Number((e.target as HTMLInputElement).value));
                        }}
                        className="w-20"
                    />
                </label>
            </div>

            {documents.length === 0 ? (
                <p className="mt-3 text-xs text-muted">No documents are expiring within the alert window.</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {documents.map((d) => {
                        const remaining = daysUntil(d.expiryDate);
                        return (
                            <li
                                key={d.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                            >
                                <span className="flex items-center gap-2 text-sm text-foreground">
                                    <Calendar className="h-3.5 w-3.5 text-amber-500" />
                                    <span className="font-medium">{d.fileName}</span>
                                    <span className="text-xs text-muted">
                                        {d.entityType} #{d.entityId} · {d.type}
                                    </span>
                                </span>
                                <span className="text-xs font-medium text-amber-600">
                                    {remaining != null && remaining >= 0
                                        ? `Expires in ${remaining} day${remaining === 1 ? '' : 's'} (${formatDate(d.expiryDate)})`
                                        : `Expired (${formatDate(d.expiryDate)})`}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// ─── Upload panel (drag-and-drop, Req 8.8) ────────────────

function UploadPanel({
    defaultEntityType,
    onUploaded,
}: {
    defaultEntityType: string;
    onUploaded: (doc: DocumentRow) => void;
}) {
    const [dragging, setDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [entityType, setEntityType] = useState(defaultEntityType);
    const [entityId, setEntityId] = useState('');
    const [docType, setDocType] = useState('');
    const [notes, setNotes] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [uploading, setUploading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function pickFile(f: File) {
        // Client-side validation mirrors the server (Req 8.2, 8.3).
        const result = validateUpload(f.size, f.type);
        if (!result.ok) {
            const reason = result.reason ?? 'INVALID_SIZE';
            toast.error(UPLOAD_REJECTION_MESSAGES[reason]);
            return;
        }
        setFile(f);
    }

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) pickFile(dropped);
        },
        [],
    );

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!file || !docType.trim() || !entityId.trim()) {
            toast.error('File, document type, and entity ID are required.');
            return;
        }
        setUploading(true);
        const res = await uploadDocument(
            entityType,
            Number(entityId),
            docType.trim(),
            file,
            { notes: notes.trim() || undefined, expiryDate: expiryDate || undefined },
        );
        setUploading(false);
        if (res.success) {
            toast.success('Document uploaded.');
            const d = res.data;
            onUploaded({
                id: d.id,
                entityType: d.entityType,
                entityId: d.entityId,
                type: d.type,
                fileUrl: d.fileUrl,
                fileName: d.fileName,
                fileSize: d.fileSize,
                status: d.status,
                notes: d.notes,
                expiryDate: d.expiryDate ? new Date(d.expiryDate).toISOString() : null,
                createdAt: new Date(d.createdAt).toISOString(),
            });
            setFile(null);
            setEntityId('');
            setDocType('');
            setNotes('');
            setExpiryDate('');
        } else {
            toast.error(res.error ?? 'Upload failed.');
        }
    }

    return (
        <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-4">
                <UploadCloud className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-foreground">Upload document</h2>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Drop zone */}
                <div
                    onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'}`}
                >
                    <UploadCloud className={`h-8 w-8 ${dragging ? 'text-accent' : 'text-muted'}`} />
                    {file ? (
                        <div className="flex items-center gap-2 text-sm text-foreground font-medium">
                            <FileText className="h-4 w-4 text-accent" />
                            {file.name}
                            <span className="text-muted font-normal">({formatBytes(file.size)})</span>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                className="ml-1 text-muted hover:text-foreground"
                                aria-label="Remove file"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ) : (
                        <>
                            <p className="text-sm text-muted">Drag &amp; drop a file here, or click to browse</p>
                            <p className="text-xs text-muted">PDF, images, Word, Excel · max {formatBytes(MAX_UPLOAD_BYTES)}</p>
                        </>
                    )}
                    <input
                        ref={inputRef}
                        type="file"
                        className="sr-only"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.doc,.docx,.xls,.xlsx,.txt,.csv"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
                        aria-label="File upload"
                    />
                </div>

                {/* Metadata fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Entity type</label>
                        <select
                            value={entityType}
                            onChange={(e) => setEntityType(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                        >
                            {UPLOAD_ENTITY_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Entity ID</label>
                        <input
                            type="number"
                            min={1}
                            placeholder="e.g. 42"
                            value={entityId}
                            onChange={(e) => setEntityId(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Document type</label>
                        <input
                            type="text"
                            placeholder="e.g. Aadhaar, Agreement"
                            value={docType}
                            onChange={(e) => setDocType(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Expiry date (optional)</label>
                        <input
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                        />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                        <label className="block text-xs font-medium text-muted mb-1">Notes (optional)</label>
                        <input
                            type="text"
                            placeholder="Any notes about this document"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={uploading || !file}
                    className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    {uploading ? 'Uploading…' : 'Upload'}
                </button>
            </form>
        </div>
    );
}

// ─── Document table ───────────────────────────────────────

function DocumentTable({
    documents,
    expiringIds,
    onRequestESign,
}: {
    documents: DocumentRow[];
    expiringIds: Set<number>;
    onRequestESign: (doc: DocumentRow) => void;
}) {
    if (documents.length === 0) {
        return (
            <div className="glass-card mt-4 py-14 text-center text-muted">
                <FileText className="mx-auto h-9 w-9 opacity-30" />
                <p className="mt-2 text-sm font-medium">No documents here yet</p>
                <p className="mt-0.5 text-xs">Upload a file above to get started.</p>
            </div>
        );
    }

    return (
        <div className="glass-card mt-4 overflow-x-auto">
            <table className="crm-table">
                <thead>
                    <tr>
                        <th>File</th>
                        <th>Linked to</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Status</th>
                        <th>Expiry</th>
                        <th>Uploaded</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {documents.map((d) => {
                        const expiring = expiringIds.has(d.id);
                        return (
                            <tr key={d.id}>
                                <td className="font-medium text-foreground">{d.fileName}</td>
                                <td className="text-muted">
                                    {d.entityType} #{d.entityId}
                                </td>
                                <td>{d.type}</td>
                                <td className="text-muted">{formatBytes(d.fileSize)}</td>
                                <td>
                                    <span className={`badge text-[10px] ${STATUS_STYLES[d.status] ?? 'bg-surface text-muted'}`}>
                                        {d.status}
                                    </span>
                                </td>
                                <td>
                                    {d.expiryDate ? (
                                        <span className={expiring ? 'inline-flex items-center gap-1 text-xs font-medium text-amber-600' : 'text-xs text-muted'}>
                                            {expiring && <AlertTriangle className="h-3 w-3" />}
                                            {formatDate(d.expiryDate)}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-muted">—</span>
                                    )}
                                </td>
                                <td className="text-xs text-muted">{formatDate(d.createdAt)}</td>
                                <td>
                                    <div className="flex items-center gap-3">
                                        <a
                                            href={d.fileUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                                        >
                                            Open <ExternalLink className="h-3 w-3" />
                                        </a>
                                        <button
                                            onClick={() => onRequestESign(d)}
                                            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-accent transition-colors"
                                            title="Request e-signature"
                                        >
                                            <PenLine className="h-3.5 w-3.5" />
                                            Request e-sign
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── KYC Center ───────────────────────────────────────────

const KYC_DOC_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Voter ID', 'Driving License', 'Other'];

function KycCenter({
    contacts,
    records,
    onCreated,
}: {
    contacts: ContactOption[];
    records: KycRow[];
    onCreated: (rec: KycRow) => void;
}) {
    const [showForm, setShowForm] = useState(false);
    const [contactId, setContactId] = useState('');
    const [docType, setDocType] = useState(KYC_DOC_TYPES[0]);
    const [docNumber, setDocNumber] = useState('');
    const [frontImage, setFrontImage] = useState('');
    const [backImage, setBackImage] = useState('');
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!contactId || !docNumber.trim()) {
            toast.error('Contact and document number are required.');
            return;
        }
        setBusy(true);
        const res = await createKycRecord(Number(contactId), {
            documentType: docType,
            documentNumber: docNumber.trim(),
            frontImage: frontImage.trim() || null,
            backImage: backImage.trim() || null,
            verified,
        });
        setBusy(false);
        if (res.success) {
            toast.success('KYC record saved.');
            const k = res.data;
            const contact = contacts.find((c) => c.id === k.contactId);
            onCreated({
                id: k.id,
                contactId: k.contactId,
                contactName: contact?.name ?? `Contact ${k.contactId}`,
                documentType: k.documentType,
                documentNumber: k.documentNumber,
                verified: k.verified,
                autoVerified: k.autoVerified,
                verifiedAt: k.verifiedAt ? new Date(k.verifiedAt).toISOString() : null,
            });
            setShowForm(false);
            setContactId('');
            setDocNumber('');
            setFrontImage('');
            setBackImage('');
            setVerified(false);
        } else {
            toast.error(res.error ?? 'Failed to save KYC record.');
        }
    }

    return (
        <div className="glass-card p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                    <h2 className="text-sm font-semibold text-foreground">KYC center</h2>
                </div>
                <button
                    onClick={() => setShowForm((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                    {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {showForm ? 'Cancel' : 'Add KYC'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Contact</label>
                            <select
                                value={contactId}
                                onChange={(e) => setContactId(e.target.value)}
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                                required
                            >
                                <option value="">Select contact…</option>
                                {contacts.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Document type</label>
                            <select
                                value={docType}
                                onChange={(e) => setDocType(e.target.value)}
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                            >
                                {KYC_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Document number</label>
                            <input
                                type="text"
                                placeholder="e.g. XXXX-XXXX-XXXX"
                                value={docNumber}
                                onChange={(e) => setDocNumber(e.target.value)}
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                                required
                            />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={verified}
                                    onChange={(e) => setVerified(e.target.checked)}
                                    className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                                />
                                Mark as verified
                            </label>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Front image URL (optional)</label>
                            <input
                                type="url"
                                placeholder="https://…"
                                value={frontImage}
                                onChange={(e) => setFrontImage(e.target.value)}
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Back image URL (optional)</label>
                            <input
                                type="url"
                                placeholder="https://…"
                                value={backImage}
                                onChange={(e) => setBackImage(e.target.value)}
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={busy}
                        className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {busy ? 'Saving…' : 'Save KYC record'}
                    </button>
                </form>
            )}

            {records.length === 0 ? (
                <p className="text-xs text-muted">No KYC records yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="crm-table">
                        <thead>
                            <tr>
                                <th>Contact</th>
                                <th>Type</th>
                                <th>Number</th>
                                <th>Status</th>
                                <th>Verified at</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((r) => (
                                <tr key={r.id}>
                                    <td className="font-medium text-foreground">{r.contactName}</td>
                                    <td>{r.documentType}</td>
                                    <td className="font-mono text-xs text-muted">{r.documentNumber}</td>
                                    <td>
                                        <span className={`badge text-[10px] ${r.verified ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                                            {r.autoVerified ? 'Auto-verified' : r.verified ? 'Verified' : 'Pending'}
                                        </span>
                                    </td>
                                    <td className="text-xs text-muted">{r.verifiedAt ? formatDate(r.verifiedAt) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Template Manager ─────────────────────────────────────

function TemplateManager({
    templates,
    onUpserted,
}: {
    templates: TemplateRow[];
    onUpserted: (tpl: TemplateRow) => void;
}) {
    const [mode, setMode] = useState<'list' | 'form' | 'generate'>('list');
    const [editing, setEditing] = useState<TemplateRow | null>(null);
    const [generating, setGenerating] = useState<TemplateRow | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [type, setType] = useState('');
    const [category, setCategory] = useState('');
    const [htmlBody, setHtmlBody] = useState('');
    const [header, setHeader] = useState('');
    const [footer, setFooter] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [busy, setBusy] = useState(false);

    // Generate state
    const [mergeValues, setMergeValues] = useState<Record<string, string>>({});
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [generating2, setGenerating2] = useState(false);

    function openNew() {
        setEditing(null);
        setName(''); setType(''); setCategory(''); setHtmlBody('');
        setHeader(''); setFooter(''); setIsDefault(false);
        setMode('form');
    }

    function openEdit(tpl: TemplateRow) {
        setEditing(tpl);
        setName(tpl.name); setType(tpl.type); setCategory(tpl.category);
        setHtmlBody(tpl.htmlBody); setHeader(tpl.header ?? '');
        setFooter(tpl.footer ?? ''); setIsDefault(tpl.isDefault);
        setMode('form');
    }

    function openGenerate(tpl: TemplateRow) {
        setGenerating(tpl);
        const fields = extractMergeFields([tpl.header ?? '', tpl.htmlBody, tpl.footer ?? ''].join('\n'));
        const init: Record<string, string> = {};
        fields.forEach((f) => { init[f] = ''; });
        setMergeValues(init);
        setPdfUrl(null);
        setMode('generate');
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim() || !type.trim() || !category.trim() || !htmlBody.trim()) {
            toast.error('Name, type, category, and body are required.');
            return;
        }
        setBusy(true);
        const res = await upsertDocumentTemplate({
            id: editing?.id,
            name: name.trim(),
            type: type.trim(),
            category: category.trim(),
            htmlBody: htmlBody.trim(),
            header: header.trim() || null,
            footer: footer.trim() || null,
            isDefault,
        });
        setBusy(false);
        if (res.success) {
            toast.success(editing ? 'Template updated.' : 'Template created.');
            const t = res.data;
            onUpserted({
                id: t.id, name: t.name, type: t.type,
                category: t.category, htmlBody: t.htmlBody,
                header: t.header, footer: t.footer, isDefault: t.isDefault,
            });
            setMode('list');
        } else {
            toast.error(res.error ?? 'Failed to save template.');
        }
    }

    async function handleGenerate(e: React.FormEvent) {
        e.preventDefault();
        if (!generating) return;
        setGenerating2(true);
        const values: Record<string, unknown> = {};
        Object.entries(mergeValues).forEach(([k, v]) => { values[k] = v; });
        const res = await generateFromTemplate(generating.id, values);
        setGenerating2(false);
        if (res.success) {
            toast.success('PDF generated.');
            setPdfUrl(res.data.pdfUrl);
        } else {
            toast.error(res.error ?? 'Failed to generate PDF.');
        }
    }

    return (
        <div className="glass-card p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LayoutTemplate className="h-4 w-4 text-accent" />
                    <h2 className="text-sm font-semibold text-foreground">Template manager</h2>
                </div>
                {mode === 'list' ? (
                    <button
                        onClick={openNew}
                        className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                        <Plus className="h-3.5 w-3.5" /> New template
                    </button>
                ) : (
                    <button
                        onClick={() => setMode('list')}
                        className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" /> Back
                    </button>
                )}
            </div>

            {mode === 'list' && (
                <>
                    {templates.length === 0 ? (
                        <p className="text-xs text-muted">No templates yet. Create one to generate branded documents.</p>
                    ) : (
                        <ul className="space-y-2">
                            {templates.map((t) => (
                                <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            {t.name}
                                            {t.isDefault && (
                                                <span className="ml-2 badge text-[10px] bg-accent/10 text-accent">Default</span>
                                            )}
                                        </p>
                                        <p className="text-xs text-muted">{t.type} · {t.category}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => openGenerate(t)}
                                            className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                                            title="Generate PDF from this template"
                                        >
                                            <Download className="h-3.5 w-3.5" /> Generate
                                        </button>
                                        <button
                                            onClick={() => openEdit(t)}
                                            className="text-xs text-muted hover:text-foreground"
                                            title="Edit template"
                                        >
                                            Edit
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            {mode === 'form' && (
                <form onSubmit={handleSave} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Template name</label>
                            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Sale Agreement" required
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Type</label>
                            <input type="text" value={type} onChange={(e) => setType(e.target.value)}
                                placeholder="e.g. Agreement" required
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1">Category</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                                placeholder="e.g. Legal" required
                                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground" />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
                                    className="h-4 w-4 rounded border-border text-accent focus:ring-accent" />
                                Default template
                            </label>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Header (optional)</label>
                        <textarea value={header} onChange={(e) => setHeader(e.target.value)} rows={2}
                            placeholder="Header HTML or text. Use {{fieldName}} for merge fields."
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground font-mono resize-y" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Body</label>
                        <textarea value={htmlBody} onChange={(e) => setHtmlBody(e.target.value)} rows={6} required
                            placeholder="Template HTML body. Use {{fieldName}} for merge fields."
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground font-mono resize-y" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1">Footer (optional)</label>
                        <textarea value={footer} onChange={(e) => setFooter(e.target.value)} rows={2}
                            placeholder="Footer HTML or text."
                            className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground font-mono resize-y" />
                    </div>
                    <button type="submit" disabled={busy}
                        className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {busy ? 'Saving…' : editing ? 'Update template' : 'Create template'}
                    </button>
                </form>
            )}

            {mode === 'generate' && generating && (
                <form onSubmit={handleGenerate} className="space-y-3">
                    <p className="text-sm text-muted">
                        Generating from <span className="font-medium text-foreground">{generating.name}</span>.
                        Fill in the merge fields below.
                    </p>
                    {Object.keys(mergeValues).length === 0 ? (
                        <p className="text-xs text-muted">This template has no merge fields.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {Object.keys(mergeValues).map((field) => (
                                <div key={field}>
                                    <label className="block text-xs font-medium text-muted mb-1">{field}</label>
                                    <input
                                        type="text"
                                        value={mergeValues[field]}
                                        onChange={(e) =>
                                            setMergeValues((prev) => ({ ...prev, [field]: e.target.value }))
                                        }
                                        placeholder={`Value for {{${field}}}`}
                                        className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                                        required
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-3">
                        <button type="submit" disabled={generating2}
                            className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all">
                            {generating2 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {generating2 ? 'Generating…' : 'Generate PDF'}
                        </button>
                        {pdfUrl && (
                            <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:underline">
                                <CheckCircle2 className="h-4 w-4" /> Open PDF
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                    </div>
                </form>
            )}
        </div>
    );
}
