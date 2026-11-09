"use client";

import { Plus } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { useMembers } from "@/features/profile/api";

import { useTasks, type Task } from "./api";
import { MembersPanel } from "./members-panel";
import { TaskDialog } from "./task-dialog";
import { TaskBoard, TaskTimeline, TeamCalendar } from "./task-views";

const TABS = ["board", "timeline", "calendar", "members"] as const;

export function TeamScreen() {
  const { data: me } = useMe();
  const members = useMembers();
  const tasks = useTasks();
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("board"));
  const [dialog, setDialog] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const canEdit = me?.role !== "viewer";
  const meId = me?.id ?? "";

  const open = (task: Task | null) => setDialog({ open: true, task });
  const viewProps = { tasks: tasks.data ?? [], members: members.data ?? [], canEdit, meId, onOpen: (t: Task) => open(t) };
  const mine = (tasks.data ?? []).filter((t) => t.assignee_id === meId && t.status !== "done").length;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[38px] font-semibold tracking-[-0.03em]">Team</h1>
          <p className="text-[15px] text-muted">
            Data tasks for the people in {me?.workspace.name}. {mine > 0 ? `${mine} open task${mine > 1 ? "s" : ""} assigned to you.` : ""}
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => open(null)}>
            <Plus /> New task
          </Button>
        )}
      </div>

      {tasks.isError && <p className="text-sm text-accent">{tasks.error.message}</p>}

      <Tabs value={tab} onValueChange={(v) => void setTab(v as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="pt-4">
          {tasks.isPending ? <div className="h-64 animate-pulse rounded-[16px] bg-surface" /> : <TaskBoard {...viewProps} />}
        </TabsContent>
        <TabsContent value="timeline" className="pt-4">
          {tasks.data && <TaskTimeline {...viewProps} />}
        </TabsContent>
        <TabsContent value="calendar" className="pt-4">
          {tasks.data && <TeamCalendar {...viewProps} />}
        </TabsContent>
        <TabsContent value="members" className="pt-4">
          {members.data && <MembersPanel members={members.data} meId={meId} isOwner={me?.role === "owner"} />}
        </TabsContent>
      </Tabs>

      <TaskDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        task={dialog.task}
        canEdit={canEdit}
      />
    </div>
  );
}
