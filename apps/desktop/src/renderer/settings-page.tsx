import { Link, Navigate } from '@tanstack/react-router';
import { AudioLines, Bot, FileText, RadioTower, SlidersHorizontal, UserRound } from 'lucide-react';
import { useEffect } from 'react';

import { AgentCapabilitySettings, SystemPromptSettings } from './agent-settings.tsx';
import { AssistantSettingsPanel } from './assistant-settings.tsx';
import { ModelSettings } from './model-settings.tsx';
import { PlatformSettings, WorkspaceRoomSettings } from './platform-settings.tsx';

const groups = [
  {
    label: '当前工作区',
    items: [
      { id: 'rooms', label: '直播间', icon: RadioTower, content: WorkspaceRoomSettings },
      { id: 'assistant', label: '直播助手', icon: AudioLines, content: AssistantSettingsPanel },
    ],
  },
  {
    label: '全局',
    items: [
      { id: 'accounts', label: '平台账号', icon: UserRound, content: PlatformSettings },
      { id: 'models', label: '模型', icon: SlidersHorizontal, content: ModelSettings },
      { id: 'prompt', label: '系统提示词', icon: FileText, content: SystemPromptSettings },
      { id: 'agent', label: 'Agent 能力', icon: Bot, content: AgentCapabilitySettings },
    ],
  },
] as const;

const sections = groups.flatMap(({ items }) => [...items]);
type Section = (typeof sections)[number]['id'];
const lastSectionKey = 'herald-settings-section';

export function settingsSearch(search: Record<string, unknown>): { section?: Section } {
  return { section: sections.find(item => item.id === search.section)?.id };
}

export function SettingsPage({
  section,
  openLogin,
}: {
  section?: Section;
  openLogin: React.ComponentProps<typeof PlatformSettings>['openLogin'];
}) {
  const active =
    sections.find(item => item.id === (section ?? sessionStorage.getItem(lastSectionKey))) ??
    groups[0].items[0];

  const Content = active.content;

  useEffect(() => {
    sessionStorage.setItem(lastSectionKey, active.id);
  }, [active.id]);

  if (!section) {
    return <Navigate to="/settings" search={{ section: active.id }} replace />;
  }

  return (
    <>
      <nav id="workspace-list" className="secondary-pane settings-menu" aria-label="设置菜单">
        <div className="secondary-heading">
          <h2>设置</h2>
        </div>
        {groups.map(group => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="settings-group-label">{group.label}</h3>
            <div className="grid gap-0.5">
              {group.items.map(({ id, label, icon: Icon }) => (
                <Link
                  key={id}
                  to="/settings"
                  search={{ section: id }}
                  className="nav-item"
                  data-current={active.id === id}
                  aria-current={active.id === id ? 'page' : undefined}
                  activeOptions={{ exact: true, includeSearch: true }}
                  activeProps={{ 'aria-current': active.id === id ? 'page' : undefined }}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>
      <main
        key={active.id}
        className="route-content page settings-content"
        aria-label={active.label}
      >
        <div className="settings-stack mx-auto grid max-w-3xl gap-4">
          <Content openLogin={openLogin} />
        </div>
      </main>
    </>
  );
}
