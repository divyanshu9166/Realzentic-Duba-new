/**
 * Properties & Inventory listing page (Req 1.6, 1.7, 1.8, 2.8).
 *
 * Server component: loads all project cards via `listProjects` (Req 1.6) and
 * passes them to the client `PropertiesClient` which owns the interactive
 * surfaces (unit filter panel, analytics view, project card grid).
 *
 * Requirements: 1.6, 2.8
 */

import { Building2 } from 'lucide-react';
import { listProjects } from '@/app/actions/properties';
import PropertiesClient, { type ProjectCardRow } from './PropertiesClient';

export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
    const res = await listProjects();
    const projects: ProjectCardRow[] = res.success
        ? res.data.map((p) => ({
            id: p.id,
            name: p.name,
            location: p.location,
            city: p.city,
            emirate: p.emirate,
            dldProjectRegNo: p.dldProjectRegNo,
            dldProjectRegExpiry: p.dldProjectRegExpiry,
            escrowAccountNo: p.escrowAccountNo,
            trakheesiPermitNo: p.trakheesiPermitNo,
            saleType: p.saleType,
            type: p.type,
            status: p.status,
            builderName: p.builderName,
            locationConfirmed: p.locationConfirmed,
            photoUrl: p.photoUrl,
            unitCount: p.unitCount,
            percentSold: p.percentSold,
            availableUnitCount: p.availableUnitCount,
            blockedUnitCount: p.blockedUnitCount,
            bookedUnitCount: p.bookedUnitCount,
            soldUnitCount: p.soldUnitCount,
            mortgagedUnitCount: p.mortgagedUnitCount,
            inventoryMismatch: p.inventoryMismatch,
            goldenVisaEligibleUnitCount: p.goldenVisaEligibleUnitCount,
        }))
        : [];

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-accent" />
                        <h1 className="text-xl md:text-2xl font-bold text-foreground">
                            Properties & Inventory
                        </h1>
                    </div>
                    <p className="mt-1 text-xs md:text-sm text-muted">
                        Browse projects, view floor grids, filter units, and track inventory analytics.
                    </p>
                </div>
            </div>

            {!res.success ? (
                <div className="glass-card py-16 text-center text-muted">
                    <p className="font-medium">Could not load projects</p>
                    <p className="mt-1 text-sm">
                        {res.error ?? 'Please refresh the page to try again.'}
                    </p>
                </div>
            ) : (
                <PropertiesClient projects={projects} />
            )}
        </div>
    );
}
