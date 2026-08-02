/**
 * Live Field-Force Tracking page (manager view).
 *
 * Server component: gates access to ADMIN/MANAGER and renders the live map
 * client. STAFF users are shown a restricted-access notice (they share their
 * own location from the Staff Portal instead).
 */

import { MapPinned, ShieldAlert } from 'lucide-react';
import { getSession } from '@/lib/auth-helpers';
import LiveTrackingClient from './LiveTrackingClient';

// Authorization is resolved from the current database-backed session on every
// request. Never let a previously rendered STAFF restriction be reused after
// an administrator signs in or their role changes.
export const dynamic = 'force-dynamic';

export default async function LiveTrackingPage() {
    const session = await getSession();
    const role = session?.user?.role;
    const allowed = role === 'ADMIN' || role === 'MANAGER';

    return (
        <div className="space-y-6 animate-[fade-in_0.5s_ease-out]">
            <div className="flex items-center gap-2">
                <MapPinned className="w-6 h-6 text-accent" />
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-foreground">Live Field-Force Tracking</h1>
                    <p className="text-xs md:text-sm text-muted mt-0.5">
                        Real-time positions of agents who are sharing their location.
                    </p>
                </div>
            </div>

            {allowed ? (
                <LiveTrackingClient />
            ) : (
                <div className="glass-card py-16 text-center text-muted">
                    <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium text-foreground">Live tracking is restricted</p>
                    <p className="text-sm mt-1">
                        Only managers and administrators can view the field-force map. You can share your own
                        location from the Staff Portal.
                    </p>
                </div>
            )}
        </div>
    );
}
