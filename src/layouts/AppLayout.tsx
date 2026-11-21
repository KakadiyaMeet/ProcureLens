/**
 * ProcureLens — Main Application Layout
 *
 * Implements the Spatial three-panel architecture:
 * 1. Collapsible enterprise sidebar
 * 2. Elevated central analytical canvas
 * 3. AI copilot dock
 */

import { useState, useCallback, type ReactNode } from 'react'
import { AppSidebar, SidebarMobileHeader } from '@/components/sidebar/AppSidebar'
import { ChatDock } from '@/components/shell/ChatDock'

export interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  return (
    <div className="flex h-screen overflow-hidden bg-shell">
      <AppSidebar mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <SidebarMobileHeader onOpenMenu={() => setMobileNavOpen(true)} />
        <div className="flex min-h-0 flex-1">
          {/* Main Elevated Canvas */}
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-shell-panel md:my-2 md:mr-2 md:rounded-xl md:border md:border-border md:shadow-[var(--shadow-card)]">
            {children}
          </main>
          {/* AI Chat Dock */}
          <ChatDock />
        </div>
      </div>
    </div>
  )
}

export default AppLayout
