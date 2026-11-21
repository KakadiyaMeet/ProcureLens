import { useState, useMemo, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutations, useAuth } from 'deepspace'
import { Button, Input, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui'
import { Building2, ArrowRight, CheckCircle2, Sparkles, Loader2 } from 'lucide-react'

type OrgData = {
  name: string
  slug: string
  description?: string
  industry: string
  size: string
  ownerId: string
}

export default function OnboardingPage() {
  const auth = useAuth() as any
  const user = auth.user ?? (auth.userId ? { id: auth.userId } : null)
  const navigate = useNavigate()
  const { records: orgs, status } = useQuery<OrgData>('organizations')
  const { create, ready } = useMutations<OrgData>('organizations')

  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [size, setSize] = useState('11-50')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const userOrgs = useMemo(
    () => orgs.filter((r) => r.data?.ownerId === user?.id || r.createdBy === user?.id),
    [orgs, user?.id]
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrorMsg('Organization name is required.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')

    try {
      const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
      const newOrgId = await create({
        name: name.trim(),
        industry: industry.trim() || 'General',
        size: size || '11-50',
        ownerId: user?.id || '',
        slug,
        description: '',
      })

      if (newOrgId) {
        localStorage.setItem('procurelens-org-id', newOrgId)
      }
      navigate('/home')
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create organization. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6 md:p-12">
      <div className="w-full max-w-xl">
        <div className="rounded-2xl border border-border bg-card p-8 md:p-10 shadow-lg spatial-shadow">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Set up your Organization</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure your procurement workspace to get started.
              </p>
            </div>
          </div>

          {userOrgs.length > 0 && (
            <div className="mb-6 rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium text-foreground">Existing Organization: </span>
                  <span className="text-muted-foreground">{userOrgs[0].data?.name}</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate('/home')}>
                  Go to Dashboard
                </Button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mb-6 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                placeholder="e.g. Acme Global Logistics"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                This is displayed across your procurement requests and vendor interactions.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-industry">Industry</Label>
              <Input
                id="org-industry"
                placeholder="e.g. Manufacturing, Healthcare, Technology"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-size">Company Size</Label>
              <Select value={size} onValueChange={(val) => setSize(val)}>
                <SelectTrigger id="org-size" className="w-full">
                  <SelectValue placeholder="Select company size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1-10">1-10 employees</SelectItem>
                  <SelectItem value="11-50">11-50 employees</SelectItem>
                  <SelectItem value="51-200">51-200 employees</SelectItem>
                  <SelectItem value="201-500">201-500 employees</SelectItem>
                  <SelectItem value="500+">500+ employees</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-4">
              <Button type="submit" className="w-full h-11" disabled={submitting || !ready}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating workspace...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
