"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { ChartRecord, ChartView } from "./api";
import type { ChartActions } from "./chart-menu";
import { InsightCard } from "./insight-card";

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type Props = {
  charts: ChartRecord[];
  views: Map<string, ChartView>;
  canEdit: boolean;
  onReorder?: (ids: string[]) => void;
  actionsFor: (chart: ChartRecord) => ChartActions;
};

/** The dashboard's story: insight cards editors can reorder by mouse, touch or keyboard (saved for everyone). */
export function StoryFeed({ charts, views, canEdit, onReorder, actionsFor }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = charts.map((c) => c.id);
    onReorder?.(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={onDragEnd}>
      <SortableContext items={charts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">
          {charts.map((c) => (
            <InsightCard key={c.id} chart={c} view={views.get(c.id)} canEdit={canEdit} draggable={canEdit && !!onReorder} actions={actionsFor(c)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
