import { InstagramConfig } from '@/components/social/instagram-config'

export const metadata = {
  title: 'Instagram Settings | Realzentic Dubai',
  description: 'Configure Instagram DM messaging and AI chatbot',
}

export default function InstagramSettingsPage() {
  return (
    <div className="max-w-4xl space-y-2">
      <div>
        <h1 className="text-xl font-bold text-foreground">Instagram Messaging</h1>
        <p className="text-sm text-muted mt-0.5">
          Connect your Instagram Business Account to enable AI-powered DM replies.
        </p>
      </div>
      <InstagramConfig />
    </div>
  )
}
