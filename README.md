# 🔍 ProcureLens

**Enterprise AI-Powered Procurement Intelligence Platform**

> A real-time collaborative SaaS application that transforms raw supplier quotations into deterministic vendor comparisons and AI-driven procurement insights — built on the [DeepSpace](https://docs.deep.space) platform, deployed to Cloudflare Workers.

🌐 **Live Application:** [https://procurelens.app.space](https://procurelens.app.space)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [Development](#development)
- [Deployment](#deployment)
- [Core Modules Deep Dive](#core-modules-deep-dive)
  - [1. Quotation Parser](#1-quotation-parser--csv-import-engine)
  - [2. Vendor Comparison Engine](#2-vendor-comparison-engine)
  - [3. AI Procurement Analyst](#3-ai-procurement-analyst)
  - [4. Multi-Tenant Data Isolation](#4-multi-tenant-data-isolation)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Security](#security)
- [Known Limitations](#known-limitations)
- [Future Improvements](#future-improvements)
- [License](#license)

---

## Overview

ProcureLens is a **full-stack procurement management platform** designed for enterprise teams to:

1. **Manage suppliers** — Full CRUD with status tracking, ratings, and category classification
2. **Create purchase requests** — Track requirements with priority, budget, and deadlines
3. **Import quotations** — Upload CSV files with RFC 4180 parsing, auto-column mapping, and formula injection defense
4. **Compare vendors** — Deterministic 5-factor scoring engine with configurable weights and explainable rankings
5. **Get AI insights** — AI procurement analyst that explains rankings, identifies risks, and suggests negotiation strategies
6. **Make award decisions** — Record and track vendor awards with full audit trail

All data is **organization-scoped** with zero-trust multi-tenant isolation.

---

## Features

### 📊 Dashboard
- Real-time metrics: active suppliers, open PRs, pending comparisons, total spend
- Quick-action cards for common workflows
- Recent activity feed across all modules

### 🏢 Supplier Management
- Create, edit, delete suppliers with full profile data
- Filter by status (Active / Inactive / Blacklisted) and category
- Contact information, tax ID, website tracking
- 1–5 star rating system

### 📝 Purchase Requests
- Full lifecycle: Draft → Pending → Approved → In Progress → Completed → Cancelled
- Priority levels: Low / Medium / High / Urgent
- Budget estimation, quantity tracking, deadline management
- One-click link to quotation import and comparison

### 📤 Quotation CSV Import
- **RFC 4180 compliant** parser with multiline cell support and escaped quotes
- Auto-detect delimiters: comma, semicolon, tab, pipe
- Intelligent column mapping with 60+ header aliases
- Formula injection defense (strips `=`, `+`, `-`, `@` prefixes)
- Currency normalization ($, ₹, €, £, ¥)
- Real-time calculation: Subtotal + Tax + Delivery = Total
- Duplicate detection (intra-file and against existing records)
- Per-row validation with detailed error/warning reporting

### ⚖️ Smart Vendor Comparison
- **Zero-AI, 100% deterministic** scoring engine
- Five-factor evaluation with configurable weights:
  | Factor | Default Weight | Scoring Logic |
  |--------|---------------|---------------|
  | Cost | 40% | Lower total cost → higher score |
  | Delivery | 25% | Fewer delivery days → higher score |
  | Quality | 20% | Higher quality rating → higher score |
  | Payment Terms | 10% | Net-day parsing, longer terms → higher score |
  | Reliability | 5% | Higher supplier rating → higher score |
- Score normalization to 0–100 range
- Explicit tie-breaker hierarchy (cost → delivery → quality → terms → reliability)
- Comparability audit: currency, unit, and quantity mismatch detection
- Individual scoring explanations with exact point breakdowns
- Save, reload, and re-run comparisons with full snapshot history
- Interactive weight sliders with real-time recalculation
- Award vendor with auto-updated quotation statuses

### 🤖 AI Procurement Analyst
- **Seven analytical capabilities:**
  1. Analyse saved vendor comparisons
  2. Explain supplier rankings with factor-by-factor breakdown
  3. Identify procurement risks (sole-supplier, price volatility, etc.)
  4. Highlight missing quotation information
  5. Suggest negotiation strategies with counter-offer points
  6. Answer free-text questions grounded in comparison data
  7. Generate executive purchasing summaries
- **Epistemic guardrails:**
  - `[FACT]` — Data-grounded statements from actual comparison results
  - `[SUGGESTION]` — Advisory recommendations clearly marked
  - `[RISK]` — Audit flags requiring human review
- **Tri-mode fallback architecture:**
  - Mode 1: DeepSpace native AI proxy (primary)
  - Mode 2: External LLM via server-side API keys (Gemini / OpenAI / Anthropic)
  - Mode 3: Rule-based deterministic fallback (zero-AI, always succeeds)
- Markdown rendering with syntax highlighting and copy-to-clipboard
- Conversation threading with localStorage persistence

### 🎨 Spatial UI
- Collapsible sidebar navigation with icon-only collapsed state
- Three-panel layout: sidebar + main content + AI chat dock
- Dark/light theme toggle with system preference detection
- Fully responsive: mobile drawer navigation, stacked panels on small screens
- Smooth transitions and micro-animations

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (React 19)                        │
│                                                                 │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌───────────────┐  │
│  │Dashboard │ │ Suppliers │ │ Purchase   │ │  Quotation    │  │
│  │  Page    │ │   Page    │ │ Requests   │ │  Import Page  │  │
│  └──────────┘ └───────────┘ └────────────┘ └───────────────┘  │
│  ┌──────────────────────┐ ┌──────────────────────────────┐    │
│  │  Comparisons Page    │ │   AI Analyst Page             │    │
│  │  (Scoring Engine)    │ │   (Chat Interface)            │    │
│  └──────────────────────┘ └──────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Shared Hooks: useOrgQuery<T>, useOrgMutations<T>       │   │
│  │  (Multi-tenant isolation layer)                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WebSocket (real-time sync)
                               │ HTTPS (REST API)
┌──────────────────────────────┴──────────────────────────────────┐
│                   SERVER (Cloudflare Worker)                     │
│                                                                 │
│  ┌────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │  Hono HTTP     │ │  AI Analyst      │ │  Realtime        │  │
│  │  Routes        │ │  Handler         │ │  Routes (WS)     │  │
│  └────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DeepSpace SDK: AppRecordRoom (Durable Object + SQLite)  │   │
│  │  Collections: suppliers, purchase_requests, quotations,  │   │
│  │  quotation_items, comparisons, decisions, organizations  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                     Cloudflare Edge Network
                     (Global CDN + Workers)
```

### Data Flow

```
CSV Upload → RFC 4180 Parser → Column Mapper → Validator → DeepSpace DB
                                                                ↓
Purchase Request ← links → Quotations ← links → Quotation Items
                                                                ↓
                              Comparison Engine (deterministic)
                              ├── Comparability Audit
                              ├── Cost Calculation
                              ├── 5-Factor Scoring (0-100)
                              ├── Weighted Aggregation
                              ├── Tie-Breaking & Ranking
                              └── Explanation Generation
                                                                ↓
                              Saved Comparison Record (DB)
                                                                ↓
                              AI Analyst (Mode 1 → 2 → 3)
                              ├── Risk Analysis
                              ├── Negotiation Strategies
                              ├── Executive Summaries
                              └── Grounded Q&A
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Platform** | [DeepSpace SDK](https://docs.deep.space) `0.44.2` | Real-time data, auth, collections, deployment |
| **Runtime** | Cloudflare Workers + Durable Objects | Edge compute with transactional SQLite |
| **Frontend** | React 19 + TypeScript 5.7 | UI framework with strict type safety |
| **Routing** | React Router 7 + Generouted | File-based routing with type-safe paths |
| **Styling** | Tailwind CSS 4 | Utility-first responsive design |
| **UI Components** | Custom + Base UI + Lucide icons | Accessible component library |
| **Build** | Vite 8 | Fast HMR and optimized production builds |
| **Server** | Hono | Lightweight HTTP framework for Worker routes |
| **AI** | Vercel AI SDK (`ai` 7.0) | LLM integration with streaming support |
| **Validation** | Zod 4 | Runtime schema validation |
| **Markdown** | react-markdown + remark-gfm + rehype-highlight | Rich text rendering for AI responses |
| **Testing** | Vitest 4 + Playwright | Unit tests + E2E browser tests |
| **Linting** | ESLint 9 + typescript-eslint | Code quality enforcement |

---

## Project Structure

```
procurelens/
├── src/
│   ├── ai/                              # AI integration layer
│   │   ├── agent.ts                     # DeepSpace AI agent configuration
│   │   ├── chat-routes.ts               # Chat panel streaming routes
│   │   ├── procurement-analyst-prompts.ts  # System prompts & fallback templates
│   │   └── tools.ts                     # AI tool definitions
│   │
│   ├── components/
│   │   ├── ai-analyst/                  # AI Analyst UI components
│   │   │   ├── AnalystEpistemicBadge.tsx   # [FACT]/[SUGGESTION]/[RISK] badges
│   │   │   ├── AnalystPromptSuggestions.tsx # Quick prompt action buttons
│   │   │   └── index.ts
│   │   │
│   │   ├── comparisons/                 # Comparison module components
│   │   │   ├── ComparisonMatrixTable.tsx   # Side-by-side vendor matrix
│   │   │   ├── ComparisonWeightSliders.tsx # Interactive weight adjustment
│   │   │   ├── ComparisonWinnerHero.tsx    # Winner announcement card
│   │   │   └── index.ts
│   │   │
│   │   ├── dashboard/                   # Dashboard widgets
│   │   │   ├── DashboardMetricsCard.tsx   # KPI summary cards
│   │   │   ├── DashboardQuickActions.tsx  # Quick navigation cards
│   │   │   ├── DashboardRecentActivity.tsx # Activity feed
│   │   │   └── index.ts
│   │   │
│   │   ├── purchase-requests/           # PR module components
│   │   │   ├── PurchaseRequestModal.tsx   # Create/edit PR modal
│   │   │   ├── PurchaseRequestTable.tsx   # PR listing table
│   │   │   └── index.ts
│   │   │
│   │   ├── quotations/                  # Quotation module components
│   │   │   ├── QuotationPreviewTable.tsx  # Parsed CSV preview
│   │   │   ├── QuotationUploadDropzone.tsx # Drag & drop CSV upload
│   │   │   └── index.ts
│   │   │
│   │   ├── suppliers/                   # Supplier module components
│   │   │   ├── SupplierFilterBar.tsx     # Status/category filters
│   │   │   ├── SupplierModal.tsx         # Create/edit supplier modal
│   │   │   ├── SupplierTable.tsx         # Supplier listing table
│   │   │   └── index.ts
│   │   │
│   │   ├── chat/                        # DeepSpace chat panel
│   │   ├── shell/                       # App shell (theme toggle, chat dock)
│   │   ├── sidebar/                     # Collapsible sidebar navigation
│   │   ├── ui/                          # Reusable UI primitives (Button, Badge, etc.)
│   │   ├── ErrorScreen.tsx
│   │   ├── OrganizationProvider.tsx      # Org context provider
│   │   ├── PageHeader.tsx
│   │   ├── Seo.tsx
│   │   └── StatusBadge.tsx
│   │
│   ├── hooks/
│   │   └── useOrgQuery.ts               # Multi-tenant query & mutation hooks
│   │
│   ├── lib/
│   │   ├── quotation-parser.ts          # RFC 4180 CSV parser (1,371 lines)
│   │   ├── quotation-parser.test.ts     # Parser test suite (8 test cases)
│   │   ├── vendor-comparison-engine.ts  # Deterministic scoring engine (2,709 lines)
│   │   └── utils.ts                     # Utility helpers (cn, etc.)
│   │
│   ├── pages/
│   │   ├── (app)/
│   │   │   ├── (protected)/
│   │   │   │   ├── analyst.tsx          # AI Procurement Analyst page
│   │   │   │   ├── comparisons.tsx      # Vendor Comparison page
│   │   │   │   ├── home.tsx             # Dashboard page
│   │   │   │   ├── onboarding.tsx       # Organization setup
│   │   │   │   ├── purchase-requests.tsx # Purchase Requests page
│   │   │   │   ├── quotation-import.tsx # CSV Import page
│   │   │   │   ├── settings.tsx         # App settings
│   │   │   │   └── suppliers.tsx        # Supplier Management page
│   │   │   └── _layout.tsx              # Protected layout wrapper
│   │   ├── index.tsx                    # Landing / login page
│   │   └── _app.tsx                     # Root app layout
│   │
│   ├── schemas/                         # DeepSpace collection schemas
│   │   ├── suppliers-schema.ts
│   │   ├── purchase-requests-schema.ts
│   │   ├── quotations-schema.ts
│   │   ├── quotation-items-schema.ts
│   │   ├── comparisons-schema.ts
│   │   ├── decisions-schema.ts
│   │   ├── organizations-schema.ts
│   │   ├── users-schema.ts
│   │   ├── admin-schema.ts
│   │   └── ai-chat-schema.ts
│   │
│   ├── server/                          # Cloudflare Worker server routes
│   │   ├── ai-analyst-handler.ts        # POST /api/ai/analyst endpoint
│   │   ├── http-routes.ts               # HTTP route registration
│   │   ├── action-routes.ts             # DeepSpace action handlers
│   │   └── realtime-routes.ts           # WebSocket handlers
│   │
│   ├── services/
│   │   ├── procurement-analyst.service.ts      # AI analyst business logic
│   │   ├── procurement-analyst.service.test.ts # Analyst service tests
│   │   ├── quotation-import.service.ts         # CSV-to-DB import service
│   │   └── index.ts
│   │
│   ├── types/
│   │   ├── analyst.types.ts             # AI analyst type definitions
│   │   ├── comparison.types.ts          # Comparison engine types
│   │   ├── procurement.types.ts         # Core procurement types
│   │   └── index.ts
│   │
│   ├── utils/
│   │   ├── csv.utils.ts                 # CSV helper utilities
│   │   ├── currency.utils.ts            # Currency formatting
│   │   ├── date.utils.ts                # Date formatting
│   │   ├── validation.utils.ts          # Input validation helpers
│   │   └── index.ts
│   │
│   ├── schemas.ts                       # Schema registry (all collections)
│   ├── router.ts                        # Generated route types
│   ├── themes.ts                        # Theme configuration
│   └── subscriptions.ts                # Real-time subscriptions
│
├── scripts/
│   └── test_quotation_parser.ts         # Standalone parser test script
│
├── public/                              # Static assets
├── worker.ts                            # Cloudflare Worker entry point
├── wrangler.toml                        # Cloudflare/DeepSpace configuration
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── .env.example
└── README.md
```

---

## Database Schema

ProcureLens uses **10 DeepSpace collections** backed by Durable Object + transactional SQLite:

### Core Collections

#### `organizations`
| Column | Type | Description |
|--------|------|-------------|
| name | text | Organization display name |
| slug | text | URL-safe identifier |
| description | text | Organization description |
| industry | text | Industry category |
| size | select | 1-10 / 11-50 / 51-200 / 201-500 / 500+ |
| ownerId | text | Creator user ID |

#### `suppliers`
| Column | Type | Description |
|--------|------|-------------|
| organizationId | text | Tenant isolation key |
| name | text | Supplier company name |
| email | text | Primary contact email |
| phone | text | Contact phone number |
| address | text | Business address |
| category | text | Product/service category |
| rating | number | 1–5 star rating |
| status | select | active / inactive / blacklisted |
| contactPerson | text | Primary contact name |
| website | text | Company website |
| taxId | text | Tax identification number |

#### `purchase_requests`
| Column | Type | Description |
|--------|------|-------------|
| organizationId | text | Tenant isolation key |
| title | text | Request title |
| description | text | Detailed requirements |
| category | text | Product/service category |
| priority | select | low / medium / high / urgent |
| status | select | draft / pending / approved / in_progress / completed / cancelled |
| quantity | number | Required quantity |
| unit | text | Unit of measure |
| estimatedBudget | number | Budget estimate |
| requiredByDate | text | Delivery deadline |
| requestedBy | text | Requester name |
| approvedBy | text | Approver name |

#### `quotations`
| Column | Type | Description |
|--------|------|-------------|
| organizationId | text | Tenant isolation key |
| purchaseRequestId | text | Linked purchase request |
| supplierId | text | Linked supplier record |
| supplierName | text | Supplier name (denormalized) |
| totalAmount | number | Total quotation value |
| currency | text | Currency code (USD, INR, etc.) |
| validUntil | text | Quotation validity date |
| deliveryDays | number | Promised delivery days |
| paymentTerms | text | Payment terms (Net 30, etc.) |
| status | select | draft / submitted / under_review / accepted / rejected |

#### `quotation_items`
| Column | Type | Description |
|--------|------|-------------|
| organizationId | text | Tenant isolation key |
| quotationId | text | Parent quotation |
| description | text | Line item description |
| quantity | number | Item quantity |
| unitPrice | number | Price per unit |
| totalPrice | number | Line item total |
| unit | text | Unit of measure |
| specifications | text | Technical specs |

#### `comparisons`
| Column | Type | Description |
|--------|------|-------------|
| organizationId | text | Tenant isolation key |
| purchaseRequestId | text | Compared purchase request |
| title | text | Comparison title |
| quotationIds | text | JSON array of quotation IDs |
| criteria | text | JSON snapshot of scoring criteria & rankings |
| status | select | in_progress / completed |
| recommendation | text | Winner summary |
| notes | text | User notes |

#### `decisions`
| Column | Type | Description |
|--------|------|-------------|
| organizationId | text | Tenant isolation key |
| comparisonId | text | Source comparison |
| purchaseRequestId | text | Decided purchase request |
| selectedQuotationId | text | Winning quotation |
| selectedSupplierId | text | Winning supplier |
| selectedSupplierName | text | Winner name |
| totalAmount | number | Award amount |
| justification | text | Decision rationale |
| approvedBy | text | Decision maker |
| status | select | pending / approved / rejected |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 22.15.0 (recommended: 26.x)
- **npm** ≥ 11.6.0
- A [DeepSpace](https://app.space) account

### Installation

```bash
# Clone the repository
git clone https://github.com/kunj-kakadiya/ProcureLens.git
cd ProcureLens

# Install dependencies
npm install

# Authenticate with DeepSpace
npx deepspace auth login
```

### Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure:

```env
# Required — set by DeepSpace automatically
DEEPSPACE_APP_ID="app_01M7S1PN81E1J4CFYT5CXF9BG1"

# Optional — AI Analyst external LLM fallback (server-side only)
GEMINI_API_KEY=""
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
```

> **⚠️ Important:** API keys are ONLY used server-side in the Cloudflare Worker. They are never exposed to frontend code.

---

## Development

### Start Dev Server

```bash
npx deepspace dev start
```

This starts a local Vite + Miniflare dev server at `http://localhost:8780` with:
- Hot Module Replacement (HMR)
- Local Durable Object SQLite storage
- Full DeepSpace SDK functionality
- Real-time WebSocket sync

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server |
| `npm run build` | Production Vite build |
| `npm run validate` | TypeScript check + Vitest unit tests |
| `npm run test:unit` | Run Vitest unit tests only |
| `npm run test:watch` | Vitest in watch mode |
| `npm run type-check` | TypeScript type checking only |
| `npm run lint` | ESLint code quality check |
| `npm run test` | DeepSpace platform tests |
| `npm run test:smoke` | Smoke tests |
| `npm run test:e2e` | Playwright E2E tests |

### Version Control

ProcureLens uses the **DeepSpace cloud repository** as its default version control:

```bash
# Push code to DeepSpace cloud repo
npx deepspace push

# Create a workspace branch for in-progress work
npx deepspace workspace new -t "feature description"

# Sync and land workspace branches
npx deepspace workspace sync
npx deepspace workspace land
```

---

## Deployment

### Deploy to Production

```bash
# Ensure all changes are committed
git add -A && git commit -m "your commit message"

# Deploy to Cloudflare Workers via DeepSpace
npx deepspace deploy
```

The deploy process:
1. Runs `vite build` for the production bundle
2. Collects and uploads static assets to Cloudflare CDN
3. Pushes the commit to the DeepSpace cloud repo
4. Deploys the Worker to Cloudflare's edge network
5. Confirms edge + data plane availability

**Production URL:** [https://procurelens.app.space](https://procurelens.app.space)

### Deploy without Version Control Sync

```bash
npx deepspace deploy --no-push
```

> This ships the current working tree without recording source lineage.

---

## Core Modules Deep Dive

### 1. Quotation Parser & CSV Import Engine

**File:** `src/lib/quotation-parser.ts` (1,371 lines)

The parser implements a **zero-dependency RFC 4180 compliant CSV processor** with security hardening:

#### Parsing Pipeline

```
Raw CSV Text
  ↓
Delimiter Auto-Detection (,  ;  \t  |)
  ↓
RFC 4180 Cell Parser
  ├── Quoted cell handling ("cell")
  ├── Escaped quote resolution ("")
  ├── Multiline cell preservation
  └── CRLF / LF normalization
  ↓
Header Row Detection
  ↓
Column Mapping (60+ aliases)
  ├── "Supplier Name" / "vendor" / "company" → supplierName
  ├── "Unit Price" / "rate" / "price_per_unit" → unitPrice
  ├── "GST %" / "tax_rate" / "vat" → gstPercentage
  └── ... (9 field definitions × ~7 aliases each)
  ↓
Formula Injection Defense
  ├── Strips leading = + - @ from cells
  └── Prevents spreadsheet macro execution
  ↓
Data Normalization
  ├── Currency symbol removal ($, ₹, €, £, ¥)
  ├── Thousands separator handling (1,000 → 1000)
  ├── Percentage symbol stripping
  └── Quality rating normalization (1-5 scale)
  ↓
Per-Row Validation
  ├── Quantity > 0
  ├── Unit Price ≥ 0
  ├── GST % between 0–100
  ├── Delivery charges ≥ 0
  ├── Delivery days ≥ 0
  └── Quality rating 1–5 (or empty)
  ↓
Financial Calculation
  ├── Subtotal = Quantity × Unit Price
  ├── Tax Amount = Subtotal × (GST% / 100)
  ├── Delivery Charges (direct)
  └── Total = Subtotal + Tax + Delivery
  ↓
Duplicate Detection
  ├── Intra-file duplicates (same supplier + product)
  └── Existing DB record matches
  ↓
Supplier Grouping & Aggregation
  ↓
DeepSpace DB Persistence (quotations + quotation_items)
```

#### Key Functions

| Function | Description |
|----------|-------------|
| `detectDelimiter(csv)` | Auto-detects `,` `;` `\t` `\|` from first 5 lines |
| `parseCsvToRawRows(csv, delimiter)` | RFC 4180 parser returning `string[][]` |
| `detectColumnMapping(headers)` | Maps headers to field definitions via alias matching |
| `cleanNumericString(str)` | Strips currency symbols, commas, whitespace |
| `parseNumeric(str)` | Safe number parsing with NaN → null handling |
| `parseQualityRating(str)` | Normalizes quality to 1–5 scale |
| `calculateQuotationItem(row)` | Computes subtotal, tax, delivery, total |
| `validateAndParseRow(row, mapping)` | Full row validation with error collection |
| `checkDuplicates(items, existing)` | Intra-file and DB-level duplicate detection |
| `groupItemsBySupplier(items)` | Groups parsed items by supplier name |
| `parseQuotationCsv(csvText, options)` | Complete pipeline: parse → map → validate → calculate |
| `generateSampleQuotationCsv()` | Generates downloadable sample CSV template |

---

### 2. Vendor Comparison Engine

**File:** `src/lib/vendor-comparison-engine.ts` (2,709 lines)

A **zero-AI, 100% deterministic** multi-criteria vendor evaluation engine implementing all 10 comparison requirements:

#### Scoring Formula

```
Final Score = (CostScore × 0.40) + (DeliveryScore × 0.25) + (QualityScore × 0.20)
            + (PaymentTermsScore × 0.10) + (ReliabilityScore × 0.05)
```

Each factor is normalized to 0–100:

| Factor | Normalization | Missing Data Handling |
|--------|--------------|----------------------|
| **Cost** | `100 × (1 - (cost - min) / (max - min))` | Penalized to score 0 |
| **Delivery** | `100 × (1 - (days - min) / (max - min))` | Penalized to score 0 |
| **Quality** | `(rating / 5) × 100` | Receives median score |
| **Payment Terms** | Net-day parsing → linear scale | Receives 50 (neutral) |
| **Reliability** | `(supplierRating / 5) × 100` | Receives median score |

#### Tie-Breaking Hierarchy

When two suppliers have identical final scores, ties are broken by:
1. Lower total purchase cost
2. Fewer delivery days
3. Higher quality rating
4. Better payment terms
5. Higher supplier reliability rating

#### Comparability Audit

Before scoring, the engine audits whether quotations are truly comparable:
- **Currency mismatch** — Different currencies flagged as warning
- **Unit mismatch** — Different units of measure detected
- **Quantity mismatch** — Significantly different quantities
- **Missing required fields** — Explicit "Data not provided" markers

#### Key Exports

| Export | Description |
|--------|-------------|
| `compareVendorQuotations(pr, quotations, options)` | Main engine entry point |
| `buildComparisonInputsFromRecords(params)` | Converts DeepSpace records to engine inputs |
| `saveComparisonToDeepSpace(params)` | Persists results to `comparisons` collection |
| `parseSavedComparison(record)` | Deserializes saved comparison for reload |
| `buildComparisonRecordPayload(result, options)` | Serializes results for storage |
| `normalizeWeights(weights)` | Ensures weights sum to 1.0 |
| `formatCurrencyValue(amount, currency)` | Locale-aware currency formatting |
| `DEFAULT_COMPARISON_WEIGHTS` | Standard 40/25/20/10/5 weights |

---

### 3. AI Procurement Analyst

**Files:**
- `src/server/ai-analyst-handler.ts` (575 lines) — Server endpoint
- `src/services/procurement-analyst.service.ts` (862 lines) — Business logic
- `src/ai/procurement-analyst-prompts.ts` — System prompts & templates
- `src/pages/(app)/(protected)/analyst.tsx` (1,196 lines) — Chat UI

#### Tri-Mode Architecture

```
Client Request (POST /api/ai/analyst)
  ↓
JWT Authentication + Org Verification
  ↓
Mode 1: DeepSpace Native AI Proxy
  ├── Uses platform's built-in LLM infrastructure
  └── On failure → Mode 2
  ↓
Mode 2: External LLM (Server-Side Keys)
  ├── Gemini API (GEMINI_API_KEY)
  ├── OpenAI API (OPENAI_API_KEY)
  └── Anthropic API (ANTHROPIC_API_KEY)
  ├── Keys from Worker secrets — never from client
  └── On failure → Mode 3
  ↓
Mode 3: Deterministic Fallback (Zero-AI)
  ├── Rule-based analysis from comparison data
  ├── Template-driven output with [FACT] markers
  └── Always succeeds given valid comparison input
```

#### Seven Analyst Actions

| Action | Endpoint Field | Description |
|--------|---------------|-------------|
| `analyse_comparison` | Full analysis | Complete vendor comparison audit |
| `explain_rankings` | Rankings breakdown | Factor-by-factor score explanation |
| `identify_risks` | Risk assessment | Procurement risk identification |
| `missing_info` | Data gaps | Missing quotation information audit |
| `negotiation_strategies` | Strategies | Counter-offer and leverage suggestions |
| `grounded_qa` | Free Q&A | Answer questions from comparison data |
| `executive_summary` | Summary | 1-page purchasing recommendation |

#### Safety Rules

- ✅ AI uses actual database-backed comparison data
- ❌ AI never invents supplier details or prices
- ❌ AI never changes calculated scores
- ✅ AI distinguishes `[FACT]` from `[SUGGESTION]` from `[RISK]`
- ❌ AI never approves purchases automatically
- ✅ All data scoped to authenticated organization

---

### 4. Multi-Tenant Data Isolation

**File:** `src/hooks/useOrgQuery.ts` (91 lines)

Every data query in ProcureLens passes through the multi-tenant isolation layer:

```typescript
// Generic hook — enforces organization boundary at query level
function useOrgQuery<T extends { organizationId: string }>(collection: string) {
  const { records } = useQuery<T>(collection)
  // Filter: only records where organizationId === active org
  return records.filter(r => r.data.organizationId === orgId)
}

// Mutation guard — prevents cross-tenant writes
function useOrgMutations<T extends { organizationId: string }>(collection: string) {
  return {
    createWithOrg(data)      // Auto-injects organizationId
    updateWithOrgCheck(id, record, updates)  // Verifies ownership
    removeWithOrgCheck(id, record)           // Verifies ownership
  }
}
```

**Server-side enforcement:** The AI analyst handler verifies that the `organizationId` in the request body matches the authenticated user's JWT claims. Cross-tenant requests are rejected with HTTP 403.

---

## API Reference

### `POST /api/ai/analyst`

AI procurement analyst endpoint.

**Headers:**
```
Authorization: Bearer <deepspace-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "action": "analyse_comparison",
  "comparisonResult": { ... },
  "organizationId": "org_...",
  "organizationName": "Acme Corp",
  "question": "Why is Supplier A ranked first?"
}
```

**Response:**
```json
{
  "text": "[FACT] Based on the deterministic comparison...",
  "provider": "gemini",
  "isFallback": false,
  "generatedAt": "2026-11-20T12:00:00.000Z"
}
```

**Error Responses:**
| Status | Meaning |
|--------|---------|
| 400 | Missing or invalid request fields |
| 401 | Unauthenticated — no valid JWT |
| 403 | Organization mismatch — cross-tenant access denied |
| 429 | Rate limited by upstream AI provider |
| 500 | Internal server error |

---

## Testing

### Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run with coverage
npx vitest run --coverage

# Watch mode
npm run test:watch

# Run specific test file
npx vitest run src/lib/quotation-parser.test.ts
```

### Test Suites

| Test File | Coverage |
|-----------|----------|
| `src/lib/quotation-parser.test.ts` | Delimiter detection, RFC 4180 parsing, column mapping, currency normalization, financial calculations, row validation, duplicate detection, DB persistence |
| `src/services/procurement-analyst.service.test.ts` | Analyst service actions, fallback generation, org validation |
| `src/components/responsive-layout.test.ts` | Responsive layout breakpoints |
| `prerender.test.ts` | SSR prerendering validation |

### Full Validation

```bash
# TypeScript compilation + all unit tests
npm run validate
```

### Platform Tests

```bash
# Smoke tests (quick health check)
npm run test:smoke

# API tests
npm run test:api

# End-to-end browser tests
npm run test:e2e
```

---

## Security

### Data Isolation
- Every record contains an `organizationId` field
- All queries filtered by active organization at the hook level
- Server-side JWT verification for API endpoints
- Cross-tenant mutations throw explicit errors

### CSV Security
- Formula injection defense (strips `=`, `+`, `-`, `@` prefixes from cell values)
- Input sanitization before database persistence
- File size and row count limits

### API Key Management
- AI provider keys stored as Cloudflare Worker secrets
- Never included in client-side bundles
- Never transmitted in API request bodies
- `.env.example` documents required variables without values

### Authentication
- DeepSpace native authentication (OAuth / email)
- JWT-based session management
- Protected routes require active session
- Org-level access control (viewer / member / admin roles)

---

## Known Limitations

1. **Single currency comparison** — The engine compares nominal values without exchange rate conversion. Cross-currency comparisons are flagged but not auto-converted.

2. **Quality & reliability ratings** — Must be manually assigned. The system does not auto-compute ratings from historical data.

3. **CSV format only** — Quotation import supports CSV files. Excel (.xlsx), PDF, and image-based quotation parsing are not yet implemented.

4. **AI context window** — Very large comparisons (50+ suppliers) may exceed the AI analyst's context window. The deterministic fallback (Mode 3) always works regardless.

5. **Offline support** — The app requires an internet connection for DeepSpace real-time sync and AI features.

6. **Localization** — UI text is English-only. Currency formatting uses browser locale but labels are not translated.

---

## Future Improvements

- [ ] **Excel/PDF import** — Parse `.xlsx` and PDF quotation documents
- [ ] **Historical analytics** — Track spending trends, supplier performance over time
- [ ] **Automated supplier rating** — Compute reliability scores from delivery and quality history
- [ ] **Multi-currency conversion** — Real-time exchange rate integration for cross-currency comparisons
- [ ] **Approval workflows** — Multi-step approval chains with email notifications
- [ ] **Audit log** — Complete immutable trail of all actions and decisions
- [ ] **Bulk operations** — Mass import of suppliers, batch PR creation
- [ ] **Custom scoring factors** — User-defined evaluation criteria beyond the standard five
- [ ] **Report export** — PDF/Excel export of comparisons, decisions, and AI analyses
- [ ] **API integrations** — ERP/SAP connectors, email-based quotation ingestion
- [ ] **Mobile app** — React Native companion app for on-the-go approvals

---

## Contributing

1. Fork the repository
2. Create a workspace branch: `npx deepspace workspace new -t "your feature"`
3. Make your changes
4. Run validation: `npm run validate`
5. Commit and push
6. Submit a pull request

---

## License

This project is private and proprietary. All rights reserved.

---

<div align="center">
  <strong>Built with ❤️ using DeepSpace + React + TypeScript + Cloudflare Workers</strong>
  <br/>
  <sub>ProcureLens v0.0.1 — Enterprise AI-Powered Procurement Intelligence</sub>
</div>
