import Link from 'next/link';
import { Home, Search, ArrowLeft } from 'lucide-react';
import MagicCard from '@/components/MagicCard';

export const metadata = {
    title: 'Page not found — Realzentic Dubai',
};

export default function NotFound() {
    return (
        <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background px-4">
            {/* Ambient background */}
            <div className="ambient-grid absolute inset-0" aria-hidden="true" />
            <div className="ambient-glow absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full" aria-hidden="true" />

            <MagicCard className="glass-card relative z-10 w-full max-w-md p-8 md:p-10 text-center rounded-3xl">
                {/* Big 404 */}
                <div className="relative mx-auto mb-6 w-fit">
                    <span className="select-none text-[88px] md:text-[104px] font-bold leading-none tracking-tight bg-gradient-to-b from-foreground to-muted/40 bg-clip-text text-transparent">
                        404
                    </span>
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-24 h-[3px] rounded-full bg-accent/60" />
                </div>

                <h1 className="text-xl md:text-2xl font-bold text-foreground">Page not found</h1>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                    The page you&apos;re looking for doesn&apos;t exist or may have been moved.
                    Let&apos;s get you back on track.
                </p>

                <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
                    <Link
                        href="/"
                        className="tap-press-sm inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors"
                    >
                        <Home className="w-4 h-4" /> Back to Dashboard
                    </Link>
                    <Link
                        href="/leads"
                        className="tap-press-sm inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border text-foreground hover:bg-surface-hover text-sm font-medium transition-colors"
                    >
                        <Search className="w-4 h-4" /> Browse Leads
                    </Link>
                </div>

                <Link
                    href="/"
                    className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="w-3.5 h-3.5" /> Go to home
                </Link>
            </MagicCard>
        </div>
    );
}
