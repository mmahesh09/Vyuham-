"use client";

import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { format, parseISO } from "date-fns";
import { useEffect } from "react";

import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { LEAVE_LABEL, PresenceAvatar } from "@/features/presence/status";
import type { Role } from "@/lib/api/client";

import type { Member } from "./api";

type Node = { name: string; caption?: string; initials?: string; status?: Member["status"]; children?: string[] };

const ROLE_GROUPS: { role: Role; label: string }[] = [
  { role: "owner", label: "Owners" },
  { role: "editor", label: "Editors" },
  { role: "viewer", label: "Viewers" },
];

const INDENT = 24;

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Workspace → role → person, with each person's role description (ReUI c-tree-6). */
function buildNodes(workspaceName: string, members: Member[]): Record<string, Node> {
  const nodes: Record<string, Node> = {};
  const groups = ROLE_GROUPS.filter((g) => members.some((m) => m.role === g.role));
  nodes.root = { name: "root", children: ["workspace"] };
  nodes.workspace = { name: workspaceName, caption: `${members.length} ${members.length === 1 ? "person" : "people"}`, children: groups.map((g) => `role:${g.role}`) };
  for (const g of groups) {
    const people = members.filter((m) => m.role === g.role);
    nodes[`role:${g.role}`] = { name: g.label, caption: `${people.length}`, children: people.map((m) => `user:${m.id}`) };
    for (const m of people) {
      const caption =
        m.status === "on_leave" && m.leave_type
          ? `${LEAVE_LABEL[m.leave_type]} until ${m.leave_until ? format(parseISO(m.leave_until), "MMM d") : "—"} · backup: ${m.backup_name ?? "—"}`
          : m.status_message || m.job_role || "No role set yet";
      nodes[`user:${m.id}`] = { name: m.name, caption, initials: initials(m.name), status: m.status };
    }
  }
  return nodes;
}

export function TeamTree({ workspaceName, members }: { workspaceName: string; members: Member[] }) {
  const nodes = buildNodes(workspaceName, members);
  const tree = useTree<Node>({
    initialState: { expandedItems: ["workspace", ...ROLE_GROUPS.map((g) => `role:${g.role}`)] },
    indent: INDENT,
    rootItemId: "root",
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (id) => nodes[id] ?? { name: "" },
      getChildren: (id) => nodes[id]?.children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  // The tree caches loaded items; rebuild when people, roles or statuses change.
  const key = members.map((m) => `${m.id}:${m.role}:${m.job_role}:${m.status}:${m.leave_type}:${m.status_message}`).join("|");
  useEffect(() => {
    tree.rebuildTree();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `tree` is stable; `key` captures the data

  return (
    <Tree indent={INDENT} tree={tree} aria-label="People in this workspace">
      {tree.getItems().map((item) => {
        const data = item.getItemData();
        return (
          <TreeItem key={item.getId()} item={item}>
            <TreeItemLabel className="gap-2 py-1.5">
              {data.initials && data.status && (
                <PresenceAvatar initials={data.initials} status={data.status} size="sm" className="shrink-0" fallbackClassName="text-[10px]" />
              )}
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate text-sm leading-tight">{data.name}</span>
                {data.caption && <span className="line-clamp-1 text-[11px] leading-tight text-muted">{data.caption}</span>}
              </span>
            </TreeItemLabel>
          </TreeItem>
        );
      })}
    </Tree>
  );
}
