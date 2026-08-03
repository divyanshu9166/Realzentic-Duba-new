import SidebarClient from '@/components/SidebarClient';
import TopBar from '@/components/TopBar';
import { SidebarProvider } from '@/components/SidebarContext';

export default function DashboardLayout({ children }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-background">
        <SidebarClient />
        <div className="flex-1 md:ml-[260px] ml-0 min-w-0 transition-all duration-300">
          <TopBar />
          <main className="p-3.5 md:p-6 overflow-x-hidden pt-3 md:pt-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
