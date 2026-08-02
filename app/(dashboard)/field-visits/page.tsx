/**
 * Site Visit 2.0 page (Req 12.2–12.6).
 *
 * Server component: loads the reference data the agent workflow needs
 * (active field visits, staff, leads, deal stages, contacts) and hands it to
 * the client `SiteVisitClient`. Managers get scheduling/status management and
 * analytics; assigned staff get the geo check-in and feedback workflow.
 */

import { MapPinned, ShieldAlert } from 'lucide-react';
import { getFieldVisits, getSiteVisitReferenceData } from '@/app/actions/field-visits';
import { getSession } from '@/lib/auth-helpers';
import SiteVisitClient, {
    type VisitItem,
    type StaffItem,
    type LeadItem,
    type StageItem,
    type ContactItem,
    type ProjectItem,
} from './SiteVisitClient';

export const dynamic = 'force-dynamic';

export default async function FieldVisitsPage({
    searchParams,
}: {
    searchParams: Promise<{ visit?: string }>;
}) {
    const requestedVisitId = Number((await searchParams).visit);
    const initialVisitId = Number.isInteger(requestedVisitId) && requestedVisitId > 0 ? requestedVisitId : undefined;
    const session = await getSession();
    const role = session?.user.role;
    if (!session || (role === 'STAFF' && session.user.staffId == null)) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-2">
                    <MapPinned className="h-5 w-5 text-accent" />
                    <h1 className="text-xl md:text-2xl font-bold text-foreground">Site Visits</h1>
                </div>
                <div className="glass-card py-16 text-center text-muted">
                    <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium text-foreground">Site visits are unavailable</p>
                    <p className="text-sm mt-1">Your account must be linked to an active staff profile.</p>
                </div>
            </div>
        );
    }

    const [visitsRes, referencesRes] = await Promise.all([
        getFieldVisits(),
        getSiteVisitReferenceData(),
    ]);
    const references = referencesRes.success ? referencesRes.data : null;
    // Keep the UI mode tied to the authenticated role, not to optional
    // reference-data loading. An admin must never fall back to the staff
    // check-in workflow just because a reference query failed.
    const canManage = role === 'ADMIN' || role === 'MANAGER';

    const visits: VisitItem[] = (visitsRes.success ? visitsRes.data ?? [] : []).map((v) => ({
        id: v.id,
        displayId: v.displayId,
        customer: v.customer,
        address: v.address,
        status: v.status,
        checkedIn: v.geoCheckinTime != null,
        buyerRating: v.buyerRating ?? null,
        followUpAction: v.followUpAction ?? null,
        liveLinked: Boolean(v.liveLinked),
        liveLocationAvailable: Boolean(v.liveLocationAvailable),
        liveDistanceM: typeof v.liveDistanceM === 'number' ? v.liveDistanceM : null,
        liveLocationAccuracyM: typeof v.liveLocationAccuracyM === 'number' ? v.liveLocationAccuracyM : null,
        projectId: v.projectId ?? null,
        staffId: v.staffId,
        staffName: v.staff?.name ?? null,
        scheduledDate: v.scheduledDate ?? null,
        scheduledTime: v.scheduledTime ?? null,
        buyerPhone: v.buyerPhone ?? null,
        unitIds: v.unitIds ?? [],
        type: v.type,
        notes: v.notes ?? null,
    }));

    const staff: StaffItem[] = (references?.staff ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
    }));

    const leads: LeadItem[] = (references?.leads ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone ?? null,
    }));

    const stages: StageItem[] = (references?.stages ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        isWon: Boolean(s.isWon),
        isLost: Boolean(s.isLost),
    }));

    const contacts: ContactItem[] = (references?.contacts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? null,
    }));

    const projects: ProjectItem[] = (references?.projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        location: project.location,
        emirate: project.emirate,
        hasCoordinates: project.hasCoordinates,
        units: project.units,
    }));

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <MapPinned className="h-5 w-5 text-accent" />
                        <h1 className="text-xl md:text-2xl font-bold text-foreground">Site Visits</h1>
                    </div>
                    <p className="mt-1 text-xs md:text-sm text-muted">
                        {canManage
                            ? 'Manage schedules, assignment, live-linked status, and visit outcomes.'
                            : 'GPS-verified site visits with structured buyer feedback.'}
                    </p>
                </div>
            </div>

            <SiteVisitClient
                visits={visits}
                staff={staff}
                leads={leads}
                stages={stages}
                contacts={contacts}
                projects={projects}
                canManage={canManage}
                currentStaffId={canManage ? null : session.user.staffId}
                initialVisitId={canManage ? undefined : initialVisitId}
            />
        </div>
    );
}
