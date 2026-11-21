/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Dashboard' },
  { path: '/suppliers', label: 'Suppliers' },
  { path: '/purchase-requests', label: 'Purchase Requests' },
  { path: '/comparisons', label: 'Comparisons' },
  { path: '/analyst', label: 'AI Analyst' },
  { path: '/quotation-import', label: 'Import Quotations' },
  { path: '/settings', label: 'Settings', roles: ['admin'] },
  { path: '/api-status', label: 'API Status', devOnly: true },
  // ── Features add nav items below this line ──
]
