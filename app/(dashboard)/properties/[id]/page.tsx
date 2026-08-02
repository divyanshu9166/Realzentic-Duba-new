/**
 * Project detail page (Req 1.7, 1.8, 2.8).
 *
 * Server component: loads the full project (towers, floors, units) via
 * `getProjectDetail` and passes it to the client `ProjectDetailClient` which
 * renders tower tabs, a color-coded floor grid, and a unit filter panel.
 *
 * Requirements: 1.7, 1.8, 2.8
 */

import { notFound } from 'next/navigation';
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { getProjectDetail } from '@/app/actions/properties';
import { getSession } from '@/lib/auth-helpers';
import ProjectDetailClient, { type ProjectDetail } from './ProjectDetailClient';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
    const { id } = await params;
    const projectId = parseInt(id, 10);
    if (isNaN(projectId)) notFound();

    const res = await getProjectDetail(projectId);
    if (!res.success) {
        return (
            <div className="space-y-4">
                <Link
                    href="/properties"
                    className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                    ← Back to Properties
                </Link>
                <div className="glass-card py-16 text-center text-muted">
                    <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Could not load project</p>
                    <p className="mt-1 text-sm">{res.error}</p>
                </div>
            </div>
        );
    }

    const project = res.data as ProjectDetail;
    const session = await getSession();
    const canManage = session?.user.role === 'ADMIN' || session?.user.role === 'MANAGER';

    return (
        <div className="space-y-5">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
                <Link href="/properties" className="hover:text-foreground transition-colors">
                    Properties
                </Link>
                <span>/</span>
                <span className="text-foreground font-medium truncate">{project.name}</span>
            </div>

            <ProjectDetailClient project={project} canManage={canManage} />
        </div>
    );
}
