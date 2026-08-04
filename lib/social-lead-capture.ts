import { prisma } from '@/lib/db'
import { notifyLeadCaptured, type LeadCaptureChannel } from '@/lib/notify'

type CaptureSocialLeadInput = {
  channel: Extract<LeadCaptureChannel, 'Facebook' | 'Instagram'>
  userId: string
  platformId: string
  contactName?: string | null
  messageText?: string | null
}

/**
 * Convert an inbound Facebook/Instagram conversation into one CRM lead and
 * one in-app notification. Social DMs do not expose a phone number, so the
 * platform-scoped identifier is stored in Contact.phone as an internal
 * identity key; it is never presented as a real phone number to the client.
 */
export async function captureSocialLead(input: CaptureSocialLeadInput) {
  const name = input.contactName?.trim() || `${input.channel} contact`
  const message = input.messageText?.trim() || ''
  const interest = message.slice(0, 120) || `${input.channel} enquiry`
  const identityKey = `social:${input.channel.toLowerCase()}:${input.userId}:${input.platformId}`

  try {
    const result = await prisma.$transaction(async tx => {
      const contact = await tx.contact.upsert({
        where: { phone: identityKey },
        create: {
          name,
          phone: identityKey,
          source: input.channel,
          notes: `Auto-captured from inbound ${input.channel} message. Internal platform ID: ${input.platformId}`,
        },
        // The social contact profile is refreshed before this helper runs. Do
        // not overwrite a name that a staff member may have edited in CRM.
        update: { updatedAt: new Date() },
        select: { id: true, name: true },
      })

      const existingLead = await tx.lead.findFirst({
        where: {
          contactId: contact.id,
          source: input.channel,
          status: { notIn: ['WON', 'LOST'] },
        },
        select: { id: true },
      })

      if (existingLead) {
        return { created: false as const, leadId: existingLead.id, contactName: contact.name }
      }

      const lead = await tx.lead.create({
        data: {
          contactId: contact.id,
          source: input.channel,
          interest,
          status: 'NEW',
          preferredLanguage: 'English',
          notes: message
            ? `Auto-created from inbound ${input.channel} message: ${message.slice(0, 500)}`
            : `Auto-created from inbound ${input.channel} message.`,
        },
      })

      return { created: true as const, leadId: lead.id, contactName: contact.name }
    })

    if (result.created) {
      await notifyLeadCaptured({
        channel: input.channel,
        leadId: result.leadId,
        contactName: result.contactName,
        interest,
      })
    }

    return result
  } catch (error) {
    // A CRM sync or notification issue must not cause Meta to retry a message
    // that was already saved in the social inbox.
    console.error(`[social-lead-capture] ${input.channel} lead sync failed:`, error)
    return { created: false as const, leadId: null, contactName: name }
  }
}
