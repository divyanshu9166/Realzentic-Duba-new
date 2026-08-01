import { FacebookConfig } from '@/components/social/facebook-config'

export const metadata = {
  title: 'Facebook Settings | Realzentic Dubai',
  description: 'Configure Facebook Page messaging and AI chatbot',
}

export default function FacebookSettingsPage() {
  return (
    <div className="max-w-4xl space-y-2">
      <div>
        <h1 className="text-xl font-bold text-foreground">Facebook Messaging</h1>
        <p className="text-sm text-muted mt-0.5">
          Connect your Facebook Page to enable AI-powered customer messaging.
        </p>
      </div>
      <FacebookConfig />
    </div>
  )
}
