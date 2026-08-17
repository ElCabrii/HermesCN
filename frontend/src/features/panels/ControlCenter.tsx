import { useState, type ComponentType } from 'react'
import {
  BlocksIcon,
  BrainIcon,
  ClockIcon,
  FolderTreeIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  ListChecksIcon,
  ScrollTextIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExtensionsPanel } from './ExtensionsPanel'
import { InsightsPanel } from './InsightsPanel'
import { KanbanPanel } from './KanbanPanel'
import { LogsPanel } from './LogsPanel'
import { MemoryPanel } from './MemoryPanel'
import { ProfilesPanel } from './ProfilesPanel'
import { ProvidersPanel } from './ProvidersPanel'
import { SettingsPanel } from './SettingsPanel'
import { SkillsPanel } from './SkillsPanel'
import { TasksPanel } from './TasksPanel'
import { TodoPanel } from './TodoPanel'
import { WorkspacesPanel } from './WorkspacesPanel'

/**
 * Control Center: the tabbed modal that replaces the legacy main-view
 * panels (static/panels.js). Launched from a sidebar-footer trigger
 * button; hosts these tabs (lazy-mounted on first activation):
 *
 *   Tasks    — cron job management + output viewer
 *   Skills   — searchable skill list + SKILL.md preview/edit
 *   Memory   — MEMORY.md / USER.md / SOUL.md editor
 *   Profiles — profile list + per-client active-profile switcher
 *   Providers — API keys, OAuth status, self-hosted setup, quota/cost
 *   Todo     — read-only checklist derived from the session transcript
 *   Settings — safe subset of settings.json (model/workspace/send key/language)
 *
 * Panels mount lazily on first tab activation (Base UI Tabs default), so
 * each tab fetches its data only when opened. The modal stays in the calm
 * console language of the rest of the app: flat surface, hairline borders,
 * no decorative cards or shadows in the content.
 */
interface Section {
  group: string
  items: { value: string; label: string; icon: ComponentType<{ className?: string }> }[]
}

/**
 * Rail contents, grouped by what the user came to do: run and track work,
 * shape what the agent knows and can do, or configure the installation.
 */
const SECTIONS: Section[] = [
  {
    group: 'Work',
    items: [
      { value: 'tasks', label: 'Tasks', icon: ClockIcon },
      { value: 'todo', label: 'Todo', icon: ListChecksIcon },
      { value: 'kanban', label: 'Kanban', icon: LayoutGridIcon },
      { value: 'insights', label: 'Insights', icon: TrendingUpIcon },
    ],
  },
  {
    group: 'Agent',
    items: [
      { value: 'skills', label: 'Skills', icon: SparklesIcon },
      { value: 'memory', label: 'Memory', icon: BrainIcon },
      { value: 'profiles', label: 'Profiles', icon: UsersIcon },
      { value: 'extensions', label: 'Extensions', icon: BlocksIcon },
    ],
  },
  {
    group: 'System',
    items: [
      { value: 'workspaces', label: 'Workspaces', icon: FolderTreeIcon },
      { value: 'providers', label: 'Providers', icon: KeyRoundIcon },
      { value: 'logs', label: 'Logs', icon: ScrollTextIcon },
      { value: 'settings', label: 'Settings', icon: SlidersHorizontalIcon },
    ],
  },
]

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
      <DialogContent className="flex h-[min(88vh,720px)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/60 px-4 py-3 pr-10">
          <DialogTitle className="font-mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Control Center
          </DialogTitle>
        </DialogHeader>
        {/* Twelve destinations is a navigation list, not a tab strip: as a
            horizontal row the last tabs fell off the edge of the dialog with no
            visible way to reach them. A left rail shows all of them at once,
            labels them with icons, and groups them by what they are for. On
            narrow screens the rail collapses to a scrollable icon column. */}
        <Tabs
          defaultValue="tasks"
          orientation="vertical"
          className="flex min-h-0 flex-1 flex-row gap-0"
        >
          <TabsList
            variant="line"
            // `group-data-vertical/tabs:h-full` overrides the primitive's own
            // vertical `h-fit`, which left the rail's surface ending partway
            // down the dialog with a bare gap beneath it.
            className="w-14 shrink-0 items-stretch gap-0.5 overflow-x-hidden overflow-y-auto rounded-none border-r border-border/60 bg-sidebar p-2 group-data-vertical/tabs:h-full sm:w-48"
          >
            {SECTIONS.map((section, i) => (
              <div key={section.group} className="contents">
                <p
                  aria-hidden="true"
                  className={cn(
                    'hidden px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase sm:block',
                    i > 0 && 'pt-3',
                  )}
                >
                  {section.group}
                </p>
                {section.items.map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    title={item.label}
                    className="justify-center gap-2 rounded-md px-0 py-1.5 text-sm sm:justify-start sm:px-2"
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </TabsTrigger>
                ))}
              </div>
            ))}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
            <TabsContent value="workspaces" className="h-full">
              <WorkspacesPanel />
            </TabsContent>
            <TabsContent value="extensions" className="h-full">
              <ExtensionsPanel />
            </TabsContent>
            <TabsContent value="providers" className="h-full">
              <ProvidersPanel />
            </TabsContent>
            <TabsContent value="todo" className="h-full">
              <TodoPanel />
            </TabsContent>
            <TabsContent value="insights" className="h-full">
              <InsightsPanel />
            </TabsContent>
            <TabsContent value="kanban" className="h-full">
              <KanbanPanel />
            </TabsContent>
            <TabsContent value="logs" className="h-full">
              <LogsPanel />
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
