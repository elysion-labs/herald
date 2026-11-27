import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { rpc } from './rpc.ts';

export type Workspace = Awaited<ReturnType<typeof rpc.workspaces.list>>[number];

export const workspaceListQuery = {
  queryKey: ['workspaces'],
  queryFn: ({ signal }: { signal: AbortSignal }) => rpc.workspaces.list(undefined, { signal }),
};

export const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);

  if (!workspace) {
    throw new Error('当前没有工作区');
  }

  return workspace;
}

export const workspaceKey = (id: string) => ['workspace', id];

export const conversationsKey = (id: string) => [...workspaceKey(id), 'conversations'];

export function useConversations() {
  const { id: workspaceId } = useWorkspace();

  return useQuery({
    queryKey: conversationsKey(workspaceId),
    queryFn: ({ signal }) => rpc.conversations.list({ workspaceId }, { signal }),
  });
}
