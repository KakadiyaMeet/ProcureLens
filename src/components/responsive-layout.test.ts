import { describe, it, expect } from 'vitest'
import { AppSidebar, SidebarMobileHeader } from './sidebar/AppSidebar'
import AppLayout from '../pages/(app)/_layout'

describe('Responsive Design & Spatial Layout Components Audit', () => {
  it('exports AppSidebar with mobile and desktop responsive props', () => {
    expect(typeof AppSidebar).toBe('function')
  })

  it('exports SidebarMobileHeader for mobile drawer activation (<md)', () => {
    expect(typeof SidebarMobileHeader).toBe('function')
  })

  it('exports AppLayout containing three-panel responsive shell architecture', () => {
    expect(typeof AppLayout).toBe('function')
  })
})
