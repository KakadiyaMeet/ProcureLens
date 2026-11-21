import { formatCurrency } from '@/utils'
import type { ParsedRowResult } from '@/lib/quotation-parser'

export interface QuotationPreviewTableProps {
  rows: ParsedRowResult[]
}

export function QuotationPreviewTable({ rows }: QuotationPreviewTableProps) {
  if (rows.length === 0) return null

  return (
    <div className="card-layer overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2.5 px-3">Row</th>
              <th className="py-2.5 px-3">Supplier</th>
              <th className="py-2.5 px-3">Product</th>
              <th className="py-2.5 px-3">Qty</th>
              <th className="py-2.5 px-3">Unit Price</th>
              <th className="py-2.5 px-3">GST%</th>
              <th className="py-2.5 px-3">Delivery</th>
              <th className="py-2.5 px-3">Lead Time</th>
              <th className="py-2.5 px-3">Terms</th>
              <th className="py-2.5 px-3 text-right">Calculated Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.rowNumber} className="hover:bg-muted/30 transition-colors">
                <td className="py-2 px-3 text-muted-foreground font-mono">#{r.rowNumber}</td>
                <td className="py-2 px-3 font-semibold text-foreground">
                  {r.parsedData?.supplierName || '—'}
                </td>
                <td className="py-2 px-3 text-muted-foreground">
                  {r.parsedData?.productName || '—'}
                </td>
                <td className="py-2 px-3 font-mono">{r.parsedData?.quantity ?? '—'}</td>
                <td className="py-2 px-3 font-mono">{formatCurrency(r.parsedData?.unitPrice)}</td>
                <td className="py-2 px-3 font-mono">
                  {r.parsedData?.gstPercentage !== undefined ? `${r.parsedData.gstPercentage}%` : '—'}
                </td>
                <td className="py-2 px-3 font-mono">
                  {formatCurrency(r.parsedData?.deliveryCharges)}
                </td>
                <td className="py-2 px-3">
                  {r.parsedData?.deliveryDays !== undefined ? `${r.parsedData.deliveryDays}d` : '—'}
                </td>
                <td className="py-2 px-3 text-muted-foreground">
                  {r.parsedData?.paymentTerms || '—'}
                </td>
                <td className="py-2 px-3 text-right font-mono font-bold text-primary">
                  {formatCurrency(r.calculated?.totalCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
