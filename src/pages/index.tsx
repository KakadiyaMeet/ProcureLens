/**
 * Landing page — a STATIC page.
 *
 * Professional ProcureLens landing: hero section, feature highlights,
 * and call to action. No auth session fetch, no records WebSocket.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import {
  BarChart3,
  Building2,
  FileText,
  Lightbulb,
  ArrowRight,
  CheckCircle2,
  Zap,
  Shield,
  TrendingUp,
} from 'lucide-react'

const FEATURES = [
  {
    icon: Building2,
    title: 'Supplier Management',
    description:
      'Centralize your supplier database. Track performance, certifications, and contact details in one place.',
  },
  {
    icon: FileText,
    title: 'Purchase Request Tracking',
    description:
      'Streamline procurement workflows from request to fulfillment with full audit trails.',
  },
  {
    icon: BarChart3,
    title: 'Quotation Comparison',
    description:
      'Compare vendor quotes side by side. Visualize pricing, terms, and delivery timelines instantly.',
  },
  {
    icon: Lightbulb,
    title: 'Smart Decisions',
    description:
      'AI-powered insights help you choose the best supplier based on price, quality, and reliability.',
  },
]

const STATS = [
  { value: '40%', label: 'Cost Reduction' },
  { value: '3×', label: 'Faster Procurement' },
  { value: '99.9%', label: 'Uptime' },
  { value: '500+', label: 'Organizations' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div className="min-h-screen bg-white text-gray-900">
        {/* Navigation */}
        <nav className="fixed top-0 right-0 left-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                P
              </span>
              <span className="text-lg font-semibold tracking-tight text-gray-900">
                ProcureLens
              </span>
            </div>
            <Link
              to="/home"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md"
            >
              Get Started
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="relative overflow-hidden pt-32 pb-20">
          {/* Subtle background gradient */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-50/60 via-white to-white" />
          <div className="pointer-events-none absolute top-0 left-1/2 size-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-100/40 blur-3xl" />

          <div className="relative mx-auto max-w-6xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
              <Zap className="size-3.5" />
              Procurement Intelligence Platform
            </div>

            <h1 className="mx-auto max-w-3xl text-5xl leading-[1.1] font-bold tracking-tight text-gray-900 sm:text-6xl">
              Smarter procurement,{' '}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                better decisions
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-600">
              Centralize suppliers, track purchase requests, compare quotations,
              and make data-driven procurement decisions — all in one real-time
              collaborative workspace.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to="/home"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30"
              >
                Get Started Free
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50"
              >
                See Features
              </a>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-gray-100 bg-gray-50/50 py-12">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-6 sm:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-indigo-600">{stat.value}</div>
                <div className="mt-1 text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Everything you need for modern procurement
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                From supplier onboarding to purchase decision — ProcureLens covers
                the full procurement lifecycle.
              </p>
            </div>

            <div className="mt-16 grid gap-8 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-gray-100 bg-white p-8 spatial-shadow transition-all hover:border-indigo-200 hover:spatial-shadow-hover hover:-translate-y-0.5"
                >
                  <div className="flex size-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-100">
                    <feature.icon className="size-6" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-gray-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trust section */}
        <section className="border-t border-gray-100 bg-gray-50/50 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Built for enterprise teams
              </h2>
              <p className="mt-4 text-lg text-gray-600">
                Real-time collaboration, role-based access, and audit trails — designed
                for procurement teams that demand reliability.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {[
                {
                  icon: Shield,
                  title: 'Role-Based Access',
                  description: 'Control who sees what with granular permissions per organization.',
                },
                {
                  icon: TrendingUp,
                  title: 'Real-Time Collaboration',
                  description: 'Updates propagate instantly. No refresh needed, no stale data.',
                },
                {
                  icon: CheckCircle2,
                  title: 'Audit Trail',
                  description: 'Every action is tracked. Full transparency for compliance.',
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-4 rounded-xl bg-white p-6 shadow-sm">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <item.icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                    <p className="mt-1 text-sm text-gray-500">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24">
          <div className="mx-auto max-w-6xl px-6 text-center">
            <div className="mx-auto max-w-2xl rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 px-8 py-16 shadow-2xl shadow-indigo-600/20">
              <h2 className="text-3xl font-bold text-white">
                Ready to transform your procurement?
              </h2>
              <p className="mx-auto mt-4 max-w-md text-indigo-100">
                Join organizations already making smarter procurement decisions with ProcureLens.
              </p>
              <Link
                to="/home"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-indigo-600 shadow-sm transition-all hover:bg-indigo-50"
              >
                Get Started Free
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-gray-100 py-8">
          <div className="mx-auto max-w-6xl px-6 text-center text-sm text-gray-400">
            &copy; {new Date().getFullYear()} ProcureLens. All rights reserved.
          </div>
        </footer>
      </div>
    </>
  )
}
