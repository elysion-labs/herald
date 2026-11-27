import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { dialogOrigin } from './dialog-origin.ts';
import { rpc } from './rpc.ts';
import { workspaceKey, workspaceListQuery } from './workspace-context.ts';
import type { Workspace } from './workspace-context.ts';

type Action = 'create' | 'rename' | 'remove';

interface WorkspaceSwitcherProps {
  workspace: Workspace;
  workspaces: Workspace[];
  onSelect: (id: string) => void;
}

export function WorkspaceSwitcher({ workspace, workspaces, onSelect }: WorkspaceSwitcherProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<Action>();
  const [origin, setOrigin] = useState<CSSProperties>();

  function open(next: Action, event: Event) {
    event.preventDefault();
    setOrigin(dialogOrigin(trigger.current));
    setMenuOpen(false);
    setAction(next);
  }

  return (
    <>
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="outline"
            size="sm"
            className="w-full justify-start"
            aria-label={`工作区：${workspace.name}`}
          >
            <FolderOpen data-icon="inline-start" />
            <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
            <ChevronsUpDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          onCloseAutoFocus={event => {
            if (action) {
              event.preventDefault();
            }
          }}
        >
          <DropdownMenuLabel>工作区</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={workspace.id} onValueChange={onSelect}>
            {workspaces.map(item => (
              <DropdownMenuRadioItem key={item.id} value={item.id}>
                <span className="truncate">{item.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={event => open('create', event)}>
              <Plus />
              新建工作区
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={event => open('rename', event)}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={event => open('remove', event)}>
              <Trash2 />
              删除工作区
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {action && (
        <WorkspaceDialog
          action={action}
          workspace={workspace}
          origin={origin}
          onSelect={onSelect}
          onClose={() => setAction(undefined)}
          restoreFocus={() => trigger.current?.focus()}
        />
      )}
    </>
  );
}

const actions = {
  create: {
    title: '新建工作区',
    submit: '新建',
    description: '创建后可在设置里绑定 B 站或抖音直播间。',
  },
  rename: {
    title: '重命名工作区',
    submit: '保存',
    description: '名称会显示在侧栏的工作区切换菜单里。',
  },
};

function WorkspaceDialog({
  action,
  workspace,
  origin,
  onSelect,
  onClose,
  restoreFocus,
}: {
  action: Action;
  workspace: Workspace;
  origin?: CSSProperties;
  onSelect: (id: string) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(action === 'rename' ? workspace.name : '');

  const save = useMutation({
    mutationFn: async () => {
      if (action === 'remove') {
        const rows = await rpc.workspaces.remove({ workspaceId: workspace.id });
        client.removeQueries({ queryKey: workspaceKey(workspace.id) });
        sessionStorage.removeItem(`herald-active-chat:${workspace.id}`);

        return { rows, next: rows[0]?.id };
      }

      const row =
        action === 'create'
          ? await rpc.workspaces.create({ name: name.trim() })
          : await rpc.workspaces.rename({ workspaceId: workspace.id, name: name.trim() });

      const current = client.getQueryData<Workspace[]>(workspaceListQuery.queryKey) ?? [];

      const rows =
        action === 'create'
          ? [...current, row]
          : current.map(item => (item.id === row.id ? row : item));

      return { rows, next: action === 'create' ? row.id : undefined };
    },
    onSuccess({ rows, next }) {
      client.setQueryData(workspaceListQuery.queryKey, rows);
      onClose();

      if (next) {
        onSelect(next);
      }
    },
  });

  const destructive = action === 'remove';

  const copy = destructive
    ? {
        title: '删除工作区',
        submit: '删除工作区',
        description: `删除「${workspace.name}」会永久删除其中的记忆、会话和弹幕，并解除直播间绑定。`,
      }
    : actions[action];

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !save.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="login-dialog"
        style={origin}
        showCloseButton={false}
        onCloseAutoFocus={event => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="break-words">{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={event => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {!destructive && (
            <Field data-invalid={save.isError}>
              <FieldLabel htmlFor="workspace-name">工作区名称</FieldLabel>
              <Input
                id="workspace-name"
                value={name}
                maxLength={60}
                required
                aria-invalid={save.isError}
                onChange={event => setName(event.target.value)}
              />
            </Field>
          )}
          {save.error && <FieldError>{save.error.message}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'default'}
              disabled={save.isPending || (!destructive && !name.trim())}
            >
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
