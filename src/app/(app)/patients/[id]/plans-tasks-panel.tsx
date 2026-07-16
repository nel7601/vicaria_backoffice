"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import {
  completeTaskAction,
  createPlanAction,
  createTaskAction,
} from "./clinical-actions";

export interface PlanRow {
  id: string;
  title: string;
  status: string;
}
export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

export function PlansTasksPanel({
  patientId,
  plans,
  tasks,
  canManagePlans,
  canManageTasks,
}: {
  patientId: string;
  plans: PlanRow[];
  tasks: TaskRow[];
  canManagePlans: boolean;
  canManageTasks: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planTitle, setPlanTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");

  function addPlan() {
    if (!planTitle.trim()) return;
    startTransition(async () => {
      const res = await createPlanAction({ patientId, title: planTitle });
      if (res.ok) {
        setPlanTitle("");
        router.refresh();
      }
    });
  }

  function addTask() {
    if (!taskTitle.trim()) return;
    startTransition(async () => {
      const res = await createTaskAction({
        patientId,
        title: taskTitle,
        dueDate: taskDue || undefined,
        priority: taskPriority as "low" | "normal" | "high" | "urgent",
      });
      if (res.ok) {
        setTaskTitle("");
        setTaskDue("");
        router.refresh();
      }
    });
  }

  function complete(taskId: string) {
    startTransition(async () => {
      const res = await completeTaskAction(taskId, patientId);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Treatment plans</h3>
        <ul className="mt-2 divide-y divide-border text-sm">
          {plans.length === 0 && <li className="py-2 text-muted">No plans.</li>}
          {plans.map((p) => (
            <li key={p.id} className="flex justify-between py-2">
              <span>{p.title}</span>
              <span className="text-muted">{p.status}</span>
            </li>
          ))}
        </ul>
        {canManagePlans && (
          <div className="mt-3 flex gap-2">
            <input
              className={inputClass}
              placeholder="New plan title"
              value={planTitle}
              onChange={(e) => setPlanTitle(e.target.value)}
            />
            <Button variant="secondary" onClick={addPlan} disabled={pending}>
              Add
            </Button>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Follow-up tasks</h3>
        <ul className="mt-2 divide-y divide-border text-sm">
          {tasks.length === 0 && <li className="py-2 text-muted">No tasks.</li>}
          {tasks.map((t) => {
            const overdue =
              t.dueDate &&
              t.status !== "completed" &&
              new Date(t.dueDate) < new Date();
            return (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span className={overdue ? "text-danger" : ""}>
                  {t.title}
                  {t.dueDate ? ` · due ${t.dueDate.slice(0, 10)}` : ""}
                </span>
                <span className="flex items-center gap-2 text-muted">
                  <span className="text-xs">{t.priority}</span>
                  {canManageTasks && t.status !== "completed" ? (
                    <button
                      onClick={() => complete(t.id)}
                      disabled={pending}
                      className="text-xs text-primary hover:underline"
                    >
                      Complete
                    </button>
                  ) : (
                    <span className="text-xs">{t.status}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {canManageTasks && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              className={`${inputClass} max-w-48`}
              placeholder="New task"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
            <input
              type="date"
              className={`${inputClass} max-w-40`}
              value={taskDue}
              onChange={(e) => setTaskDue(e.target.value)}
            />
            <select
              className={`${inputClass} max-w-28`}
              value={taskPriority}
              onChange={(e) => setTaskPriority(e.target.value)}
            >
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
            <Button variant="secondary" onClick={addTask} disabled={pending}>
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
