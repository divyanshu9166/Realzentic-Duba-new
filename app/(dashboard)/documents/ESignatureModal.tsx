'use client';

/**
 * ESignatureModal — capture a drawn or typed signature and persist it via
 * `createSignature`. Two tabs:
 *   • Draw  — HTML canvas with mouse + touch support.
 *   • Type  — renders the signer's name in Dancing Script (cursive).
 *
 * On "Sign & Save" the canvas PNG is uploaded via /api/upload, then
 * `createSignature` is called. A green checkmark is shown on success and
 * `onSigned(signatureUrl)` is called.
 *
 * Props
 * -----
 * isOpen      — controls visibility
 * onClose     — called when the dialog should close
 * contactId   — optional pre-fill
 * documentId  — optional pre-fill
 * contractId  — optional billing contract to mark as signed
 * signerName  — optional pre-fill
 * onSigned    — called with the stored signature URL after success
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { PenLine, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createSignature } from '@/app/actions/e-sign';

// ─── Types ────────────────────────────────────────────────

export interface ESignatureModalProps {
    isOpen: boolean;
    onClose: () => void;
    contactId?: number;
    documentId?: number;
    contractId?: number;
    signerName?: string;
    onSigned: (signatureUrl: string) => void;
}

type SignatureTab = 'draw' | 'type';

// ─── Component ───────────────────────────────────────────

export default function ESignatureModal({
    isOpen,
    onClose,
    contactId,
    documentId,
    contractId,
    signerName: signerNameProp,
    onSigned,
}: ESignatureModalProps) {
    const [tab, setTab] = useState<SignatureTab>('draw');
    const [signerName, setSignerName] = useState(signerNameProp ?? '');
    const [signerEmail, setSignerEmail] = useState('');
    const [signerPhone, setSignerPhone] = useState('');
    const [typedName, setTypedName] = useState(signerNameProp ?? '');
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);
    const [hasDrawing, setHasDrawing] = useState(false);

    // Canvas drawing state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const lastPosRef = useRef<{ x: number; y: number } | null>(null);

    // Sync name field when prop changes (e.g. modal re-opened with new contact)
    // Props-driven form reset is intentional for this modal.
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (signerNameProp) {
            setSignerName(signerNameProp);
            setTypedName(signerNameProp);
        }
    }, [signerNameProp]);

    // Reset when modal is opened/closed
    // Reset transient drawing state whenever the modal closes.
    useEffect(() => {
        if (!isOpen) {
            setTab('draw');
            setDone(false);
            setSaving(false);
            setHasDrawing(false);
            lastPosRef.current = null;
        }
    }, [isOpen]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // ─── Canvas helpers ──────────────────────────────────

    function getPos(
        canvas: HTMLCanvasElement,
        e: MouseEvent | Touch
    ): { x: number; y: number } {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: ('clientX' in e ? e.clientX : (e as Touch).clientX - rect.left) * scaleX,
            y: ('clientY' in e ? e.clientY : (e as Touch).clientY - rect.top) * scaleY,
        };
    }

    function getCtx() {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        return { canvas, ctx };
    }

    // Mouse events
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const pair = getCtx();
        if (!pair) return;
        isDrawingRef.current = true;
        const pos = getPos(pair.canvas, e.nativeEvent);
        lastPosRef.current = pos;
        pair.ctx.beginPath();
        pair.ctx.moveTo(pos.x, pos.y);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current) return;
        const pair = getCtx();
        if (!pair || !lastPosRef.current) return;
        const pos = getPos(pair.canvas, e.nativeEvent);
        pair.ctx.lineTo(pos.x, pos.y);
        pair.ctx.stroke();
        lastPosRef.current = pos;
        setHasDrawing(true);
    }, []);

    const handleMouseUp = useCallback(() => {
        isDrawingRef.current = false;
        lastPosRef.current = null;
    }, []);

    // Touch events
    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const pair = getCtx();
        if (!pair) return;
        isDrawingRef.current = true;
        const touch = e.touches[0];
        const rect = pair.canvas.getBoundingClientRect();
        const scaleX = pair.canvas.width / rect.width;
        const scaleY = pair.canvas.height / rect.height;
        const pos = {
            x: (touch.clientX - rect.left) * scaleX,
            y: (touch.clientY - rect.top) * scaleY,
        };
        lastPosRef.current = pos;
        pair.ctx.beginPath();
        pair.ctx.moveTo(pos.x, pos.y);
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        if (!isDrawingRef.current) return;
        const pair = getCtx();
        if (!pair || !lastPosRef.current) return;
        const touch = e.touches[0];
        const rect = pair.canvas.getBoundingClientRect();
        const scaleX = pair.canvas.width / rect.width;
        const scaleY = pair.canvas.height / rect.height;
        const pos = {
            x: (touch.clientX - rect.left) * scaleX,
            y: (touch.clientY - rect.top) * scaleY,
        };
        pair.ctx.lineTo(pos.x, pos.y);
        pair.ctx.stroke();
        lastPosRef.current = pos;
        setHasDrawing(true);
    }, []);

    const handleTouchEnd = useCallback(() => {
        isDrawingRef.current = false;
        lastPosRef.current = null;
    }, []);

    function clearCanvas() {
        const pair = getCtx();
        if (!pair) return;
        pair.ctx.clearRect(0, 0, pair.canvas.width, pair.canvas.height);
        setHasDrawing(false);
    }

    // ─── Build typed-signature canvas ───────────────────

    function renderTypedCanvas(): HTMLCanvasElement {
        const offscreen = document.createElement('canvas');
        offscreen.width = 600;
        offscreen.height = 160;
        const ctx = offscreen.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, offscreen.width, offscreen.height);
            ctx.fillStyle = '#1e293b';
            ctx.font = "64px 'Dancing Script', cursive";
            ctx.textBaseline = 'middle';
            ctx.fillText(typedName || signerName, 24, offscreen.height / 2);
        }
        return offscreen;
    }

    // ─── Submit ──────────────────────────────────────────

    async function handleSave() {
        if (!signerName.trim()) {
            toast.error('Signer name is required.');
            return;
        }

        let blob: Blob;

        if (tab === 'draw') {
            const canvas = canvasRef.current;
            if (!canvas || !hasDrawing) {
                toast.error('Please draw your signature first.');
                return;
            }
            blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error('Canvas is empty'))),
                    'image/png'
                );
            });
        } else {
            if (!typedName.trim()) {
                toast.error('Please type your name to generate a signature.');
                return;
            }
            const offscreen = renderTypedCanvas();
            blob = await new Promise<Blob>((resolve, reject) => {
                offscreen.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error('Canvas render failed'))),
                    'image/png'
                );
            });
        }

        setSaving(true);
        try {
            // Upload the PNG to get a URL.
            const formData = new FormData();
            formData.append('file', blob, 'signature.png');
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });
            if (!uploadRes.ok) {
                const err = await uploadRes.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error ?? 'Upload failed');
            }
            const uploadData = (await uploadRes.json()) as { urls?: string[]; error?: string };
            const signatureUrl = uploadData.urls?.[0];
            if (!signatureUrl) {
                throw new Error('No URL returned from upload');
            }

            // Persist the signature record.
            const res = await createSignature({
                signerName: signerName.trim(),
                signerEmail: signerEmail.trim() || null,
                signerPhone: signerPhone.trim() || null,
                signatureUrl,
                contactId: contactId ?? null,
                documentId: documentId ?? null,
                contractId: contractId ?? null,
            });

            if (!res.success) {
                throw new Error(res.error);
            }

            setDone(true);
            toast.success('Signature saved successfully.');
            onSigned(signatureUrl);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save signature';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    }

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Dialog */}
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="esign-title"
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
                <div className="glass-card w-full max-w-lg shadow-2xl flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
                        <div className="flex items-center gap-2">
                            <PenLine className="h-4 w-4 text-accent" />
                            <h2 id="esign-title" className="text-sm font-semibold text-foreground">
                                E-Signature
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="rounded-lg p-1 text-muted hover:text-foreground hover:bg-surface transition-colors"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        {done ? (
                            /* Success state */
                            <div className="flex flex-col items-center gap-3 py-8">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                                    <Check className="h-7 w-7 text-emerald-500" />
                                </div>
                                <p className="text-sm font-medium text-foreground">Signature saved!</p>
                                <p className="text-xs text-muted text-center">
                                    The signature has been captured and linked to this document.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Signer info */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-muted mb-1">
                                            Full name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={signerName}
                                            onChange={(e) => {
                                                setSignerName(e.target.value);
                                                if (tab === 'type') setTypedName(e.target.value);
                                            }}
                                            placeholder="Signer's name"
                                            className="w-full px-3 py-2 bg-surface rounded-xl border border-border text-sm text-foreground"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-muted mb-1">Email</label>
                                        <input
                                            type="email"
                                            value={signerEmail}
                                            onChange={(e) => setSignerEmail(e.target.value)}
                                            placeholder="optional"
                                            className="w-full px-3 py-2 bg-surface rounded-xl border border-border text-sm text-foreground"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-muted mb-1">Phone</label>
                                        <input
                                            type="tel"
                                            value={signerPhone}
                                            onChange={(e) => setSignerPhone(e.target.value)}
                                            placeholder="optional"
                                            className="w-full px-3 py-2 bg-surface rounded-xl border border-border text-sm text-foreground"
                                        />
                                    </div>
                                </div>

                                {/* Tabs */}
                                <div className="flex gap-1 border-b border-border">
                                    {(['draw', 'type'] as const).map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setTab(t)}
                                            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${tab === t
                                                    ? 'border-accent text-accent'
                                                    : 'border-transparent text-muted hover:text-foreground'
                                                }`}
                                        >
                                            {t === 'draw' ? 'Draw' : 'Type instead'}
                                        </button>
                                    ))}
                                </div>

                                {/* Draw tab */}
                                {tab === 'draw' && (
                                    <div className="space-y-2">
                                        <p className="text-xs text-muted">
                                            Draw your signature inside the box below.
                                        </p>
                                        <div className="relative rounded-xl border-2 border-dashed border-border bg-white overflow-hidden">
                                            <canvas
                                                ref={canvasRef}
                                                width={600}
                                                height={160}
                                                className="w-full touch-none cursor-crosshair"
                                                onMouseDown={handleMouseDown}
                                                onMouseMove={handleMouseMove}
                                                onMouseUp={handleMouseUp}
                                                onMouseLeave={handleMouseUp}
                                                onTouchStart={handleTouchStart}
                                                onTouchMove={handleTouchMove}
                                                onTouchEnd={handleTouchEnd}
                                                aria-label="Signature drawing area"
                                            />
                                            {!hasDrawing && (
                                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                                    <span className="text-xs text-gray-300 select-none">
                                                        Sign here
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        {hasDrawing && (
                                            <button
                                                type="button"
                                                onClick={clearCanvas}
                                                className="text-xs text-muted hover:text-foreground underline underline-offset-2"
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Type tab */}
                                {tab === 'type' && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-muted mb-1">
                                                Name to render as signature
                                            </label>
                                            <input
                                                type="text"
                                                value={typedName}
                                                onChange={(e) => setTypedName(e.target.value)}
                                                placeholder="Type your name"
                                                className="w-full px-3 py-2 bg-surface rounded-xl border border-border text-sm text-foreground"
                                            />
                                        </div>
                                        {/* Preview */}
                                        <div className="flex min-h-[80px] items-center justify-center rounded-xl border-2 border-dashed border-border bg-white px-4 py-3">
                                            {typedName ? (
                                                <span
                                                    style={{
                                                        fontFamily: 'Dancing Script, cursive',
                                                        fontSize: '2.5rem',
                                                        color: '#1e293b',
                                                        lineHeight: 1.2,
                                                    }}
                                                >
                                                    {typedName}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-300 select-none">
                                                    Preview appears here
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
                        {done ? (
                            <button
                                onClick={onClose}
                                className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all"
                            >
                                Done
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted hover:text-foreground transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                                >
                                    {saving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <PenLine className="h-4 w-4" />
                                    )}
                                    {saving ? 'Saving…' : 'Sign & Save'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
