/**
 * ProcureLens — Auth & Onboarding Layout
 */

import type { ReactNode } from 'react'

export interface AuthLayoutProps {
  children?: ReactNode
  title?: string
  subtitle?: string
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-3">
          <div className="size-12 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl shadow-lg shadow-primary/20">
            PL
          </div>
        </div>
        {title && <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>}
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="card-layer p-8 spatial-shadow">
          {children}
        </div>
      </div>
    </div>
  )
}

export default AuthLayout
