import { useState } from 'react'
import { Settings2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MemoryPanel } from './MemoryPanel'
import { ProfilesPanel } from './ProfilesPanel'
import { SettingsPanel } from './SettingsPanel'
import { SkillsPanel } from './SkillsPanel'
import { TasksPanel } from './TasksPanel'
import { TodoPanel } from './TodoPanel'

/**
 * Control Center: the tabbed modal that replaces the legacy main-view
 * panels (static/panels.js). Launched from a sidebar-footer trigger
 * button; hosts six tabs:
 *
 *   Tasks    — cron job management + output viewer
 *   Skills   — searchable skill list + SKILL.md preview/edit
 *   Memory   — MEMORY.md / USER.md / SOUL.md editor
 *   Profiles — profile list + per-client active-profile switcher
 *   Todo     — read-only checklist derived from the session transcript
 *   Settings — safe subset of settings.json (model/workspace/send key/language)
 *
 * Panels mount lazily on first tab activation (Base UI Tabs default), so
 * each tab fetches its data only when opened. The modal stays in the calm
 * console language of the rest of the app: flat surface, hairline borders,
 * no decorative cards or shadows in the content.
 */
export function ControlCenter() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Settings2Icon />
        <span>Control Center</span>
      </DialogTrigger>
      <DialogContent className="flex h-[min(85vh,680px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/60 px-4 py-3 pr-10">
          <DialogTitle className="font-mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Control Center
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="tasks" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList
            variant="line"
            className="h-9 w-full shrink-0 justify-start gap-1 rounded-none border-b border-border/60 px-3"
          >
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="profiles">Profiles</TabsTrigger>
            <TabsTrigger value="todo">Todo</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <TabsContent value="tasks" className="h-full">
              <TasksPanel />
            </TabsContent>
            <TabsContent value="skills" className="h-full">
              <SkillsPanel />
            </TabsContent>
            <TabsContent value="memory" className="h-full">
              <MemoryPanel />
            </TabsContent>
            <TabsContent value="profiles" className="h-full">
              <ProfilesPanel />
            </TabsContent>
            <TabsContent value="todo" className="h-full">
              <TodoPanel />
            </TabsContent>
            <TabsContent value="settings" className="h-full">
              <SettingsPanel />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
