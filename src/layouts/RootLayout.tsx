/**
 * ProcureLens — Root System Layout
 *
 * Wraps children with OrganizationProvider, ToastProvider, and theme configurations.
 */

import type { ReactNode } from 'react'
import { OrganizationProvider } from '@/components/OrganizationProvider'

export interface RootLayoutProps {
  children?: ReactNode
}

export function RootLayout({ children }: RootLayoutProps) {
  return (
    <OrganizationProvider>
      {children}
    </OrganizationProvider>
  )
}

export default RootLayout
