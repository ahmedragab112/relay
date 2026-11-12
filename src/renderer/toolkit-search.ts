import type { SessionSummary, Workspace } from '../shared/contracts';

export interface ToolkitLimits {
  tasks: number;
  projects: number;
}

export interface ToolkitMatches {
  tasks: SessionSummary[];
  projects: Workspace[];
}

export function searchTasksAndProjects(
  tasks: SessionSummary[],
  projects: Workspace[],
  query: string,
  limits: ToolkitLimits = { tasks: 5, projects: 4 },
): ToolkitMatches {
  const needle = query.trim().toLowerCase();
  if (!needle) return { tasks: [], projects: [] };
  return {
    tasks: tasks.filter((task) => `${task.title} ${task.directory ?? ''}`.toLowerCase().includes(needle)).slice(0, limits.tasks),
    projects: projects.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(needle)).slice(0, limits.projects),
  };
}
