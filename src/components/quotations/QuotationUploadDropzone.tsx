import { useState, useRef } from 'react'
import { UploadCloud, FileText, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui'

export interface QuotationUploadDropzoneProps {
  onFileSelect: (file: File) => void
  disabled?: boolean
}

export function QuotationUploadDropzone({ onFileSelect, disabled = false }: QuotationUploadDropzoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      setSelectedFileName(file.name)
      onFileSelect(file)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFileName(file.name)
      onFileSelect(file)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`card-layer p-8 text-center border-dashed cursor-pointer transition-all ${
        dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/30'
      } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      <div className="flex flex-col items-center justify-center space-y-3">
        <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <UploadCloud className="size-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {selectedFileName ? selectedFileName : 'Choose a quotation CSV file or drag & drop'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Supports RFC 4180 standard CSV files with automatic formula sanitization.
          </p>
        </div>
        <Button variant="outline" size="sm" type="button" className="gap-2 pointer-events-none">
          <FileText className="size-3.5" />
          Browse CSV File
        </Button>
      </div>
    </div>
  )
}
