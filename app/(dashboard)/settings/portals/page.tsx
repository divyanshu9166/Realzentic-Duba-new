import PortalIntegrationsClient from './PortalIntegrationsClient'
import { listPortalConfigs } from '@/app/actions/portal-integration'
import { getStaff } from '@/app/actions/staff'

export const metadata = {
    title: 'Portal Integrations | Realzentic Dubai',
    description: 'Auto-capture leads from Bayut, Property Finder, and Dubizzle.',
}

export default async function PortalIntegrationsPage() {
    const [portalResult, staffResult] = await Promise.all([
        listPortalConfigs().catch(() => ({
            success: false as const,
            error: 'Portal integrations could not be loaded.',
            data: [],
        })),
        getStaff().catch(() => ({
            success: false as const,
            error: 'Staff list could not be loaded.',
            data: [],
        })),
    ])

    const initialStaff = staffResult.success
        ? staffResult.data.map((member: { id: number; name: string }) => ({ id: member.id, name: member.name }))
        : []

    return (
        <div className="max-w-4xl">
            <PortalIntegrationsClient
                initialConfigs={portalResult.success ? portalResult.data : []}
                initialStaff={initialStaff}
                initialLoadError={
                    !portalResult.success
                        ? portalResult.error
                        : !staffResult.success
                            ? staffResult.error
                            : null
                }
            />
        </div>
    )
}
