import { TaskPanelConnected } from "@/components/workspace/task-panel-connected";

export default function TasksPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tasks</h1>
        <p className="text-muted-foreground mt-1">AI generation tasks</p>
      </div>

      <TaskPanelConnected />
    </div>
  );
}
