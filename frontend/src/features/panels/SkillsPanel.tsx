import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2Icon, PlusIcon, SearchIcon, SquarePenIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteSkill,
  getSkillContent,
  getSkills,
  saveSkill,
  type SkillContentSuccess,
  type SkillSummary,
} from '@/api/panels'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/features/chat/Markdown'

/**
 * Skills tab of the Control Center.
 *
 * Mirrors the legacy Skills panel (static/panels.js): a searchable list
 * grouped by category, a SKILL.md preview rendered with the same Markdown
 * component as the chat transcript, inline edit (POST /api/skills/save),
 * delete with confirmation, and a create-skill form. The detail view is a
 * quiet two-pane layout — list on the left, preview/editor on the right.
 */

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // detail view state
  const [selected, setSelected] = useState<SkillContentSuccess | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // create form + delete confirmation
  const [createOpen, setCreateOpen] = useState(false)
  const [createFields, setCreateFields] = useState({ name: '', category: '', content: '' })
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await getSkills()
      setSkills(data.skills)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load skills.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openSkill = async (skill: SkillSummary) => {
    setEditMode(false)
    setDetailError(null)
    try {
      const data = await getSkillContent(skill.name)
      if (data.success) {
        setSelected(data)
        setDraft(data.content)
      } else {
        setDetailError(data.error || 'Failed to load skill content.')
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load skill content.')
    }
  }

  // search filter + category grouping (client-side, like the legacy panel)
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = (skills ?? []).filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q),
    )
    const byCategory = new Map<string, SkillSummary[]>()
    for (const skill of visible) {
      const category = skill.category || 'ungrouped'
      const bucket = byCategory.get(category)
      if (bucket) bucket.push(skill)
      else byCategory.set(category, [skill])
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [skills, query])

  const saveDraft = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await saveSkill({ name: selected.name, content: draft })
      toast.success(`Saved "${selected.name}".`)
      setEditMode(false)
      await refresh()
      // refresh the preview with the saved content
      setSelected({ ...selected, content: draft })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save skill.')
    } finally {
      setSaving(false)
    }
  }

  const createSkill = async () => {
    const name = createFields.name.trim()
    const content = createFields.content.trim()
    if (!name || !content) return
    setSaving(true)
    try {
      await saveSkill({
        name,
        category: createFields.category.trim() || undefined,
        content,
      })
      toast.success(`Created "${name}".`)
      setCreateOpen(false)
      setCreateFields({ name: '', category: '', content: '' })
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create skill.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setSaving(true)
    try {
      await deleteSkill(target.name)
      toast.success(`Deleted "${target.name}".`)
      if (selected?.name === target.name) {
        setSelected(null)
        setEditMode(false)
      }
      setDeleteTarget(null)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete skill.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !skills) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  return (
    <div className="flex h-full gap-3">
      {/* ── left: searchable, category-grouped list ── */}
      <div className="flex w-60 shrink-0 flex-col">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search skills"
            placeholder="Search skills"
            className="h-8 pl-7 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New skill
        </Button>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {skills === null && (
            <p className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" /> Loading skills…
            </p>
          )}
          {grouped.map(([category, items]) => (
            <div key={category} className="mb-3">
              <h3 className="px-1 pb-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                {category}
              </h3>
              <ul className="space-y-0.5">
                {items.map((skill) => (
                  <li key={skill.name}>
                    <button
                      type="button"
                      onClick={() => void openSkill(skill)}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40 data-[active=true]:bg-muted/60"
                      data-active={selected?.name === skill.name}
                    >
                      <span className="block truncate">{skill.name}</span>
                      {skill.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {skill.description}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ── right: preview / editor ── */}
      <div className="min-w-0 flex-1 border-l border-border/60 pl-3">
        {!selected && !detailError && (
          <p className="pt-1 text-xs text-muted-foreground">Select a skill to preview its SKILL.md.</p>
        )}
        {detailError && <p className="text-sm text-destructive">{detailError}</p>}
        {selected && (
          <div className="flex h-full flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-mono text-sm">{selected.name}</h3>
                {selected.path && (
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {selected.path}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {editMode ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveDraft()} disabled={saving}>
                      {saving && <Loader2Icon className="animate-spin" />}
                      Save skill
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditMode(true)}
                    >
                      <SquarePenIcon />
                      Edit skill
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Delete skill"
                      onClick={() =>
                        setDeleteTarget(
                          skills?.find((s) => s.name === selected.name) ?? {
                            name: selected.name,
                          } as SkillSummary,
                        )
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {editMode ? (
                <Textarea
                  aria-label="Skill content"
                  className="min-h-full font-mono text-xs"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              ) : (
                <article className="prose-xs max-w-none text-sm">
                  <Markdown content={selected.content} />
                </article>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create skill form */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) setCreateOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>Create a SKILL.md in your skills directory.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              aria-label="Skill name"
              placeholder="skill-name"
              value={createFields.name}
              onChange={(e) => setCreateFields({ ...createFields, name: e.target.value })}
            />
            <Input
              aria-label="Category"
              placeholder="Category (optional)"
              value={createFields.category}
              onChange={(e) => setCreateFields({ ...createFields, category: e.target.value })}
            />
            <Textarea
              aria-label="Skill content"
              placeholder="# skill-name\n\nDescribe when to use this skill."
              className="min-h-40 font-mono text-xs"
              value={createFields.content}
              onChange={(e) => setCreateFields({ ...createFields, content: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createSkill()}
              disabled={saving || !createFields.name.trim() || !createFields.content.trim()}
            >
              {saving && <Loader2Icon className="animate-spin" />}
              Create skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete skill</DialogTitle>
            <DialogDescription>
              Delete “{deleteTarget?.name}”? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={saving}>
              {saving && <Loader2Icon className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
