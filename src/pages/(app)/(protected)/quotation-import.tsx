import { useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  RefreshCw,
  FileDown,
  PackageCheck,
  Building2,
  Layers,
  Sparkles,
} from 'lucide-react'
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label,
  useToast,
} from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useOrgQuery } from '@/hooks/useOrgQuery'
import {
  downloadRejectedRowsCsv,
  sanitizeRow,
  type RejectedRow,
  type CsvFieldError,
  CSV_ERROR_CODES,
} from '@/lib/csv-security'
import {
  SUPPORTED_FIELDS,
  type QuotationFieldKey,
  type ColumnMapping,
  type ParsedRowResult,
  parseQuotationCsv,
  generateSampleQuotationCsv,
  detectDelimiter,
  parseCsvToRawRows,
} from '@/lib/quotation-parser'
import { useQuotationImportService } from '@/services/quotation-import.service'
import type { PRData } from './purchase-requests'

// ─── Step Definition ──────────────────────────────────────────────────────────

const STEPS = ['Upload', 'Column Mapping', 'Preview & Validate', 'Review & Commit'] as const
type Step = 0 | 1 | 2 | 3

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {STEPS.map((label, idx) => (
        <div key={label} className="flex items-center">
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              idx === current
                ? 'bg-primary text-primary-foreground shadow-sm'
                : idx < current
                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <span
              className={`flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                idx < current
                  ? 'bg-green-600 text-white'
                  : idx === current
                  ? 'bg-white/30 text-inherit'
                  : 'bg-border text-muted-foreground'
              }`}
            >
              {idx < current ? '✓' : idx + 1}
            </span>
            {label}
          </div>
          {idx < STEPS.length - 1 && (
            <ChevronRight className="size-4 mx-1 text-muted-foreground/50 shrink-0" />
          )}
        </div>
      ))}
    </div>
  )
}

function formatCurrency(n: number | undefined | null) {
  if (n === undefined || n === null || isNaN(n)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n)
}

function StatusPill({ status }: { status: 'valid' | 'warning' | 'rejected' }) {
  if (status === 'valid')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
        <CheckCircle2 className="size-3" /> Valid
      </span>
    )
  if (status === 'warning')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
        <AlertTriangle className="size-3" /> Warning
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
      <XCircle className="size-3" /> Rejected
    </span>
  )
}

export default function QuotationImportPage() {
  const [searchParams] = useSearchParams()
  const initialPrId = searchParams.get('prId') || ''
  const navigate = useNavigate()
  const { success, warning, error: toastError } = useToast()

  // Purchase Requests & Org
  const { records: prRecords, orgId } = useOrgQuery<PRData>('purchase_requests')
  const [selectedPrId, setSelectedPrId] = useState<string>(initialPrId)

  // Step state
  const [step, setStep] = useState<Step>(0)

  // Step 1 — Upload
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [csvContent, setCsvContent] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // Step 2 — Mapping
  const [headers, setHeaders] = useState<string[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<QuotationFieldKey, number | null>>({
    supplierName: null,
    productName: null,
    quantity: null,
    unitPrice: null,
    gstPercentage: null,
    deliveryCharges: null,
    deliveryDays: null,
    paymentTerms: null,
    qualityRating: null,
  })

  // Step 3 — Preview & Validation Result
  const [previewTab, setPreviewTab] = useState<'all' | 'valid' | 'rejected'>('all')
  const [parsedRows, setParsedRows] = useState<ParsedRowResult[]>([])
  const [rejectedRows, setRejectedRows] = useState<RejectedRow[]>([])
  const [securityCleanedCount, setSecurityCleanedCount] = useState(0)

  // Step 4 — Database Import Hook
  const { importQuotations, isImporting, progress, lastResult, reset: resetService } =
    useQuotationImportService()

  // ── CSV Template Download ──────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const content = generateSampleQuotationCsv()
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'quotation-import-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── File Selection & Parsing ───────────────────────────────────────────────
  const processUploadedContent = useCallback((rawText: string) => {
    setCsvContent(rawText)
    const delimiter = detectDelimiter(rawText)
    const rawRows = parseCsvToRawRows(rawText, delimiter)
    if (rawRows.length === 0) {
      setFileError('The selected CSV file appears to be completely empty.')
      return
    }

    const firstRowHeaders = rawRows[0].map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`))
    setHeaders(firstRowHeaders)

    // Initial parse to auto-detect mappings
    const parseRes = parseQuotationCsv(rawText)
    setColumnMapping(parseRes.columnMapping)
  }, [])

  const handleFile = useCallback(
    (f: File) => {
      setFileError('')
      if (!f.name.toLowerCase().endsWith('.csv')) {
        setFileError('Only .csv files are supported.')
        return
      }
      if (f.size > 5 * 1024 * 1024) {
        setFileError('File exceeds 5 MB limit.')
        return
      }

      setFile(f)
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = (e.target?.result as string) ?? ''
        processUploadedContent(text)
      }
      reader.onerror = () => {
        setFileError('Failed to read the file from disk.')
      }
      reader.readAsText(f)
    },
    [processUploadedContent]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const f = e.dataTransfer.files[0]
      if (f) handleFile(f)
    },
    [handleFile]
  )

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  // ── Execute Validation with Security Sanitization ──────────────────────────
  const handleRunValidation = () => {
    if (!csvContent) return

    // 1. Parse via RFC 4180 parser using the custom mapping from Step 2
    const parseRes = parseQuotationCsv(csvContent, {
      customMapping: columnMapping,
      allowDuplicates: false,
    })

    // 2. Pass rows through csv-security: CSV injection defense, XSS, tenant fence
    let injectionCount = 0
    const localRejectedRows: RejectedRow[] = []

    const validatedRows = parseRes.rows.map((row) => {
      // Security sanitize the row
      const secResult = sanitizeRow(row.rawValues, row.rowNumber)
      if (secResult.injectionFields.length > 0) {
        injectionCount++
        row.warnings.push({
          field: secResult.injectionFields.join(', '),
          value: '',
          message: `Sanitized potential formula injection in columns: ${secResult.injectionFields.join(', ')}`,
          severity: 'warning',
        })
      }
      if (secResult.xssFields.length > 0) {
        row.warnings.push({
          field: secResult.xssFields.join(', '),
          value: '',
          message: `HTML or script tags were stripped from: ${secResult.xssFields.join(', ')}`,
          severity: 'warning',
        })
      }

      // Multi-tenant check: if organizationId was uploaded, must match active organization
      const uploadedOrgId = row.rawValues['organizationId'] || row.rawValues['OrganizationId']
      if (uploadedOrgId && orgId && uploadedOrgId.trim() !== orgId) {
        row.isValid = false
        row.errors.push({
          field: 'organizationId',
          value: uploadedOrgId,
          message: `Organization ID "${uploadedOrgId}" does not match active org "${orgId}". Cross-tenant import rejected.`,
          severity: 'error',
        })
      }

      if (!row.isValid) {
        const fieldErrors: CsvFieldError[] = row.errors.map((e) => ({
          code:
            e.field === 'organizationId'
              ? CSV_ERROR_CODES.CROSS_ORG_VIOLATION
              : CSV_ERROR_CODES.SCHEMA_MISMATCH,
          field: String(e.field),
          message: e.message,
          rawValue: e.value,
        }))

        localRejectedRows.push({
          rowIndex: row.rowNumber,
          raw: row.rawValues,
          errors: fieldErrors,
        })
      }

      return row
    })

    setSecurityCleanedCount(injectionCount)
    setParsedRows(validatedRows)
    setRejectedRows(localRejectedRows)
    setStep(2)
    setPreviewTab('all')
  }

  // ── Commit Database Import ────────────────────────────────────────────────
  const handleCommit = async () => {
    if (!orgId) {
      toastError('No Organization', 'Please select or create an organization before importing.')
      return
    }

    const prIdToUse = selectedPrId || prRecords[0]?.recordId || 'default_pr'
    const validToImport = parsedRows.filter((r) => r.isValid && r.parsedData)

    if (validToImport.length === 0) {
      toastError('No valid records', 'There are no valid records available to commit.')
      return
    }

    try {
      const result = await importQuotations(prIdToUse, validToImport, {
        defaultCurrency: 'USD',
        validUntilDays: 30,
        defaultStatus: 'submitted',
        autoCreateSuppliers: true,
      })

      if (result.success) {
        success(
          'Import successful!',
          `Created ${result.totalQuotationsCreated} quotation(s) and ${result.totalItemsCreated} line item(s).`
        )
      } else {
        warning(
          'Import completed with warnings',
          `Created ${result.totalQuotationsCreated} quotation(s), with ${result.errors.length} error(s).`
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Database import failed.'
      toastError('Import failed', msg)
    }
  }

  // ── Reset Workflow ────────────────────────────────────────────────────────
  const handleReset = () => {
    resetService()
    setStep(0)
    setFile(null)
    setFileError('')
    setCsvContent('')
    setHeaders([])
    setParsedRows([])
    setRejectedRows([])
    setSecurityCleanedCount(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Stats computation
  const stats = useMemo(() => {
    const total = parsedRows.length
    const valid = parsedRows.filter((r) => r.isValid && r.warnings.length === 0).length
    const warning = parsedRows.filter((r) => r.isValid && r.warnings.length > 0).length
    const rejected = parsedRows.filter((r) => !r.isValid).length
    return { total, valid, warning, rejected }
  }, [parsedRows])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Quotations"
        description="Zero-trust quotation ingestion with RFC 4180 parsing, automated validation, and DeepSpace database persistence."
        actions={
          <Button variant="ghost" onClick={() => navigate('/purchase-requests')} className="gap-2">
            <ChevronLeft className="size-4" />
            Back to Requests
          </Button>
        }
      />

      {/* Step Bar */}
      <StepBar current={step} />

      {/* ─── STEP 1: UPLOAD ───────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-5">
          {/* PR Selection Bar */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                <Label htmlFor="target-pr" className="text-xs font-semibold text-foreground">
                  Target Purchase Request
                </Label>
              </div>
              <div className="w-full sm:w-80">
                <Select value={selectedPrId} onValueChange={setSelectedPrId}>
                  <SelectTrigger id="target-pr" className="h-9 text-xs">
                    <SelectValue placeholder="Select target purchase request (or auto-link)" />
                  </SelectTrigger>
                  <SelectContent>
                    {prRecords.map((r) => (
                      <SelectItem key={r.recordId} value={r.recordId}>
                        {r.data?.title || r.recordId}
                      </SelectItem>
                    ))}
                    {prRecords.length === 0 && (
                      <SelectItem value="default_pr">General Quotations (No active PR)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Template Download Banner */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card/70 p-4 text-sm">
            <FileText className="size-5 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="font-medium text-foreground">Need a standardized CSV format?</p>
              <p className="text-xs text-muted-foreground">
                Download our template CSV pre-configured with all 9 quotation fields and sample data.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadTemplate}
              className="gap-2 shrink-0"
            >
              <Download className="size-3.5" />
              CSV Template
            </Button>
          </div>

          {/* Drag & Drop Zone */}
          <div
            className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
              isDragOver
                ? 'border-primary bg-primary/5'
                : file
                ? 'border-green-500 bg-green-50/50 dark:bg-green-950/30'
                : 'border-border bg-card/50 hover:border-primary/40 hover:bg-card/70'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            {file ? (
              <>
                <CheckCircle2 className="size-12 text-green-500" />
                <div>
                  <p className="font-semibold text-foreground">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB — ready for column mapping
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 text-muted-foreground">
                  <RefreshCw className="size-3.5" />
                  Replace file
                </Button>
              </>
            ) : (
              <>
                <Upload className="size-12 text-muted-foreground/50" />
                <div>
                  <p className="font-semibold text-foreground">Drag & drop your CSV file here</p>
                  <p className="text-sm text-muted-foreground">
                    Supports RFC 4180 format, automatic delimiter detection (comma, semicolon, tab), up to 5 MB.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  <Upload className="size-4" />
                  Browse Files
                </Button>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          {fileError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <XCircle className="size-4 shrink-0" />
              {fileError}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setStep(1)}
              disabled={!file || !!fileError}
              className="gap-2"
            >
              Next: Map Columns
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: COLUMN MAPPING ───────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-foreground">
                Map CSV Columns to Quotation Schema
              </h2>
              <span className="text-xs text-muted-foreground">
                {headers.length} headers detected in file
              </span>
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
              Columns are auto-detected by header alias. Review or adjust mapping before running validation.
              Required fields are indicated with an asterisk (*).
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SUPPORTED_FIELDS.map((field) => {
                const currentIdx = columnMapping[field.key]
                const mappedVal = currentIdx !== null ? String(currentIdx) : '__none__'

                return (
                  <div
                    key={field.key}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="w-40 shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-foreground">{field.label}</span>
                        {field.required && <span className="text-destructive">*</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">{field.description}</p>
                    </div>

                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />

                    <div className="flex-1">
                      <Select
                        value={mappedVal}
                        onValueChange={(val) => {
                          const newMapping = { ...columnMapping }
                          newMapping[field.key] = val === '__none__' ? null : Number(val)
                          setColumnMapping(newMapping)
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="— Skip field —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Skip field —</SelectItem>
                          {headers.map((h, idx) => (
                            <SelectItem key={idx} value={String(idx)}>
                              Col {idx + 1}: {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)} className="gap-2">
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <Button onClick={handleRunValidation} className="gap-2">
              Run Validation & Preview
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: PREVIEW & VALIDATION ─────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Security Banner if injections cleaned */}
          {securityCleanedCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
              <Sparkles className="size-4 shrink-0 text-yellow-600" />
              <span>
                Zero-trust defense active: sanitized {securityCleanedCount} cell(s) starting with formula
                injection characters (=, +, -, @).
              </span>
            </div>
          )}

          {/* Stats Bar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Rows</p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50/60 p-4 text-center dark:border-green-800 dark:bg-green-950/30">
              <p className="text-2xl font-bold text-green-700 dark:text-green-300">{stats.valid}</p>
              <p className="text-xs text-green-600 dark:text-green-400">Valid</p>
            </div>
            <div className="rounded-xl border border-yellow-200 bg-yellow-50/60 p-4 text-center dark:border-yellow-800 dark:bg-yellow-950/30">
              <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{stats.warning}</p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400">Warnings</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 text-center dark:border-red-800 dark:bg-red-950/30">
              <p className="text-2xl font-bold text-red-700 dark:text-red-300">{stats.rejected}</p>
              <p className="text-xs text-red-600 dark:text-red-400">Rejected</p>
            </div>
          </div>

          {/* Row Table Tabs */}
          <div className="rounded-xl border border-border bg-card">
            <Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as typeof previewTab)}>
              <div className="border-b border-border px-4 pt-3 flex items-center justify-between">
                <TabsList className="mb-0">
                  <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
                  <TabsTrigger value="valid">Valid ({stats.valid + stats.warning})</TabsTrigger>
                  <TabsTrigger value="rejected">Rejected ({stats.rejected})</TabsTrigger>
                </TabsList>

                {stats.rejected > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadRejectedRowsCsv(rejectedRows, 'rejected-quotations.csv')}
                    className="gap-1 text-xs text-red-600 hover:text-red-700"
                  >
                    <FileDown className="size-3.5" />
                    Download Rejected CSV
                  </Button>
                )}
              </div>

              {(['all', 'valid', 'rejected'] as const).map((tab) => {
                const filtered =
                  tab === 'all'
                    ? parsedRows
                    : tab === 'valid'
                    ? parsedRows.filter((r) => r.isValid)
                    : parsedRows.filter((r) => !r.isValid)

                return (
                  <TabsContent key={tab} value={tab} className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[950px] text-left text-xs">
                        <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2.5">Row</th>
                            <th className="px-4 py-2.5">Supplier</th>
                            <th className="px-4 py-2.5">Product</th>
                            <th className="px-4 py-2.5 text-right">Qty</th>
                            <th className="px-4 py-2.5 text-right">Unit Price</th>
                            <th className="px-4 py-2.5 text-right">Subtotal</th>
                            <th className="px-4 py-2.5 text-right">GST / Tax</th>
                            <th className="px-4 py-2.5 text-right">Delivery</th>
                            <th className="px-4 py-2.5 text-right">Total Cost</th>
                            <th className="px-4 py-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {filtered.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                                No rows in this category.
                              </td>
                            </tr>
                          ) : (
                            filtered.map((row) => {
                              const p = row.parsedData
                              const c = row.calculated
                              const rowStatus = !row.isValid
                                ? 'rejected'
                                : row.warnings.length > 0
                                ? 'warning'
                                : 'valid'

                              return (
                                <tr
                                  key={row.rowNumber}
                                  className={`transition-colors ${
                                    rowStatus === 'rejected'
                                      ? 'bg-red-50/40 dark:bg-red-950/20'
                                      : rowStatus === 'warning'
                                      ? 'bg-yellow-50/40 dark:bg-yellow-950/20'
                                      : 'hover:bg-muted/30'
                                  }`}
                                >
                                  <td className="px-4 py-2.5 font-mono text-muted-foreground">
                                    {row.rowNumber}
                                  </td>
                                  <td className="px-4 py-2.5 font-medium text-foreground max-w-[140px] truncate">
                                    {p?.supplierName || row.rawValues[headers[0]] || '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-muted-foreground max-w-[160px] truncate">
                                    {p?.productName || row.rawValues[headers[1]] || '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">
                                    {p?.quantity ?? '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">
                                    {p ? formatCurrency(p.unitPrice) : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">
                                    {c ? formatCurrency(c.subtotal) : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">
                                    {c ? `${formatCurrency(c.taxAmount)} (${c.gstPercentage}%)` : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">
                                    {c ? formatCurrency(c.deliveryCharges) : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                                    {c ? formatCurrency(c.totalCost) : '—'}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="flex flex-col gap-1">
                                      <StatusPill status={rowStatus} />
                                      {row.errors.map((e, idx) => (
                                        <span key={idx} className="text-[10px] text-destructive">
                                          {e.message}
                                        </span>
                                      ))}
                                      {row.warnings.map((w, idx) => (
                                        <span key={idx} className="text-[10px] text-yellow-600 dark:text-yellow-400">
                                          {w.message}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </TabsContent>
                )
              })}
            </Tabs>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)} className="gap-2">
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={stats.valid + stats.warning === 0}
              className="gap-2"
            >
              Review & Commit
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: REVIEW & COMMIT ───────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          {!lastResult ? (
            <>
              <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                <h2 className="text-base font-semibold text-foreground">Commit Quotations to Database</h2>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-lg bg-green-50 p-4 dark:bg-green-950/30">
                    <CheckCircle2 className="size-5 shrink-0 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-800 dark:text-green-200">
                        {stats.valid + stats.warning} record{(stats.valid + stats.warning) !== 1 ? 's' : ''} will be imported
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Items will be grouped by supplier and persisted to `quotations` and `quotation_items` with active organization tenant fencing.
                      </p>
                    </div>
                  </div>

                  {stats.rejected > 0 && (
                    <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
                      <XCircle className="size-5 shrink-0 text-red-600 dark:text-red-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">
                          {stats.rejected} record{stats.rejected !== 1 ? 's' : ''} will NOT be imported
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400">
                          Preserved rejected rows can be downloaded as an annotated CSV to inspect and fix validation issues.
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => downloadRejectedRowsCsv(rejectedRows, 'rejected-quotations.csv')}
                        className="shrink-0 gap-2"
                      >
                        <FileDown className="size-3.5" />
                        Download Rejected CSV
                      </Button>
                    </div>
                  )}
                </div>

                {!orgId && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    No active organization found. Please set up or select an organization before importing.
                  </div>
                )}
              </div>

              {/* Progress Bar (Visible while importing) */}
              {isImporting && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{progress.statusMessage || 'Processing batch import...'}</span>
                    <span>{progress.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${Math.max(5, progress.percent)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)} disabled={isImporting} className="gap-2">
                  <ChevronLeft className="size-4" />
                  Back to Preview
                </Button>
                <Button
                  onClick={handleCommit}
                  loading={isImporting}
                  disabled={!orgId || stats.valid + stats.warning === 0}
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                >
                  <PackageCheck className="size-4" />
                  Confirm & Commit Import ({stats.valid + stats.warning} records)
                </Button>
              </div>
            </>
          ) : (
            /* Success Summary View */
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                <CheckCircle2 className="size-10 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Import Complete!</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Successfully imported {lastResult.totalQuotationsCreated} quotation(s) and{' '}
                  {lastResult.totalItemsCreated} line item(s) under organization context.
                </p>
                {stats.rejected > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stats.rejected} rejected row(s) were excluded from database persistence.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                {stats.rejected > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => downloadRejectedRowsCsv(rejectedRows, 'rejected-quotations.csv')}
                    className="gap-2"
                  >
                    <FileDown className="size-4" />
                    Download Rejected Rows CSV
                  </Button>
                )}
                <Button onClick={handleReset} className="gap-2">
                  <Upload className="size-4" />
                  Import Another File
                </Button>
                <Button variant="secondary" onClick={() => navigate('/comparisons')} className="gap-2">
                  <Building2 className="size-4" />
                  View Comparisons
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
