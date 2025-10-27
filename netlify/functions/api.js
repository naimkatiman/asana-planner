const asana = require('asana');

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-asana-token, x-workspace-gid, x-project-gid, x-user-gid',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function getCreds(headers) {
  const h = headers || {};
  return {
    token: h['x-asana-token'] || h['X-Asana-Token'] || h['x-asana-token'.toLowerCase()],
    workspaceGid: h['x-workspace-gid'] || h['X-Workspace-Gid'] || h['x-workspace-gid'.toLowerCase()],
    projectGid: h['x-project-gid'] || h['X-Project-Gid'] || h['x-project-gid'.toLowerCase()],
    userGid: h['x-user-gid'] || h['X-User-Gid'] || h['x-user-gid'.toLowerCase()],
  };
}

async function getTasks(client, creds) {
  let tasks = [];
  if (creds.projectGid) {
    const projectTasks = await client.tasks.getTasksForProject(creds.projectGid, {
      opt_fields:
        'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at',
    });
    tasks = await projectTasks.collect();
  } else if (creds.userGid && creds.workspaceGid) {
    const userTasks = await client.tasks.getTasksForUser(creds.userGid, {
      workspace: creds.workspaceGid,
      opt_fields:
        'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at',
    });
    tasks = await userTasks.collect();
  } else if (creds.workspaceGid) {
    const workspaceTasks = await client.tasks.searchTasksForWorkspace(creds.workspaceGid, {
      opt_fields:
        'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at',
    });
    tasks = await workspaceTasks.collect();
  }
  return tasks;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  const route = (event.path || '').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  const creds = getCreds(event.headers);

  try {
    if (route === '/workspaces' && event.httpMethod === 'GET') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure token first' });
      const client = asana.Client.create().useAccessToken(creds.token);
      const workspaces = await client.workspaces.getWorkspaces();
      const workspacesList = await workspaces.collect();
      return jsonResponse(200, { success: true, workspaces: workspacesList });
    }

    if (route === '/projects' && event.httpMethod === 'GET') {
      if (!creds.token || !creds.workspaceGid)
        return jsonResponse(400, { error: 'Please configure token and workspace first' });
      const client = asana.Client.create().useAccessToken(creds.token);
      const projects = await client.projects.getProjectsForWorkspace(creds.workspaceGid);
      const projectsList = await projects.collect();
      return jsonResponse(200, { success: true, projects: projectsList });
    }

    if (route === '/tasks' && event.httpMethod === 'GET') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure credentials first' });
      const client = asana.Client.create().useAccessToken(creds.token);
      const tasks = await getTasks(client, creds);
      return jsonResponse(200, { success: true, tasks, count: tasks.length });
    }

    if (route === '/plan/weekly' && event.httpMethod === 'POST') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure credentials first' });
      const client = asana.Client.create().useAccessToken(creds.token);
      let tasks = [];
      if (creds.projectGid) {
        const projectTasks = await client.tasks.getTasksForProject(creds.projectGid, {
          opt_fields: 'name,completed,due_on,due_at,assignee.name,tags.name,priority',
        });
        tasks = await projectTasks.collect();
      }

      const today = new Date();
      const weeklyPlan = { thisWeek: [], nextWeek: [], overdue: [], noDueDate: [] };

      tasks.forEach((task) => {
        if (task.completed) return;
        if (!task.due_on) {
          weeklyPlan.noDueDate.push(task);
          return;
        }
        const dueDate = new Date(task.due_on);
        const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        if (daysDiff < 0) weeklyPlan.overdue.push(task);
        else if (daysDiff <= 7) weeklyPlan.thisWeek.push(task);
        else if (daysDiff <= 14) weeklyPlan.nextWeek.push(task);
      });

      ['thisWeek', 'nextWeek', 'overdue'].forEach((key) => {
        weeklyPlan[key].sort((a, b) => new Date(a.due_on) - new Date(b.due_on));
      });

      return jsonResponse(200, { success: true, plan: weeklyPlan });
    }

    if (route === '/brainstorm' && event.httpMethod === 'POST') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure credentials first' });
      const client = asana.Client.create().useAccessToken(creds.token);
      let tasks = [];
      if (creds.projectGid) {
        const projectTasks = await client.tasks.getTasksForProject(creds.projectGid, {
          opt_fields: 'name,completed,due_on,assignee.name,tags.name,notes',
        });
        tasks = await projectTasks.collect();
      }

      const analysis = {
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.completed).length,
        pendingTasks: tasks.filter((t) => !t.completed).length,
        tasksWithoutDueDate: tasks.filter((t) => !t.due_on && !t.completed).length,
        unassignedTasks: tasks.filter((t) => !t.assignee && !t.completed).length,
        overdueTasks: tasks.filter((t) => {
          if (!t.due_on || t.completed) return false;
          return new Date(t.due_on) < new Date();
        }).length,
      };

      const suggestions = [];
      if (analysis.tasksWithoutDueDate > 0) {
        suggestions.push({
          type: 'deadline',
          priority: 'high',
          message: `${analysis.tasksWithoutDueDate} tasks don't have due dates. Consider setting deadlines to improve planning.`,
          action: 'Set due dates for pending tasks',
        });
      }
      if (analysis.unassignedTasks > 0) {
        suggestions.push({
          type: 'assignment',
          priority: 'medium',
          message: `${analysis.unassignedTasks} tasks are unassigned. Assign them to team members to clarify ownership.`,
          action: 'Assign tasks to team members',
        });
      }
      if (analysis.overdueTasks > 0) {
        suggestions.push({
          type: 'overdue',
          priority: 'critical',
          message: `${analysis.overdueTasks} tasks are overdue. Review and reschedule or complete them.`,
          action: 'Address overdue tasks immediately',
        });
      }

      const completionRate = analysis.totalTasks > 0 ? ((analysis.completedTasks / analysis.totalTasks) * 100).toFixed(1) : 0;
      if (completionRate < 50) {
        suggestions.push({
          type: 'productivity',
          priority: 'medium',
          message: `Current completion rate is ${completionRate}%. Consider breaking down large tasks into smaller, manageable subtasks.`,
          action: 'Create subtasks for better progress tracking',
        });
      }

      const taskIdeas = [];
      if (analysis.pendingTasks > 0) {
        taskIdeas.push('Schedule a sprint planning meeting to prioritize pending tasks');
        taskIdeas.push('Create a task review checkpoint to assess progress');
        taskIdeas.push('Set up automated reminders for upcoming deadlines');
      }

      return jsonResponse(200, {
        success: true,
        analysis,
        suggestions,
        taskIdeas,
        completionRate: parseFloat(completionRate),
      });
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    console.error('Function error:', error);
    return jsonResponse(500, { error: 'Internal Error', details: error.message });
  }
};
