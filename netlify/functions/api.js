const asana = require('asana');
const axios = require('axios');

function jsonResponse(statusCode, body, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-asana-token, x-workspace-gid, x-project-gid, x-user-gid, x-openrouter-key, x-admin-key, x-user-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extraHeaders,
  };
  const ct = headers['Content-Type'] || headers['content-type'] || 'application/json';
  return {
    statusCode,
    headers,
    body: ct === 'text/csv' || ct === 'text/plain' ? String(body ?? '') : JSON.stringify(body),
  };
}

function getCreds(headers) {
  const h = headers || {};
  return {
    token: h['x-asana-token'] || h['X-Asana-Token'] || h['x-asana-token'.toLowerCase()],
    workspaceGid: h['x-workspace-gid'] || h['X-Workspace-Gid'] || h['x-workspace-gid'.toLowerCase()],
    projectGid: h['x-project-gid'] || h['X-Project-Gid'] || h['x-project-gid'.toLowerCase()],
    userGid: h['x-user-gid'] || h['X-User-Gid'] || h['x-user-gid'.toLowerCase()],
    openrouterKey: h['x-openrouter-key'] || h['X-OpenRouter-Key'] || h['x-openrouter-key'.toLowerCase()],
  };
}

async function createAsanaClient(token) {
  const http = axios.create({
    baseURL: 'https://app.asana.com/api/1.0',
    headers: { Authorization: `Bearer ${token}` },
  });

  const paginate = async (url, params = {}) => {
    const results = [];
    let offset;
    do {
      const resp = await http.get(url, { params: { limit: 100, ...params, offset } });
      const body = resp.data || {};
      const data = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
      results.push(...data);
      offset = body.next_page && body.next_page.offset ? body.next_page.offset : undefined;
    } while (offset);
    return results;
  };

  const collection = (executor) => ({ collect: () => executor() });

  return {
    workspaces: {
      getWorkspaces: () => collection(() => paginate('/workspaces')),
    },
    projects: {
      getProjectsForWorkspace: (workspaceGid) =>
        collection(() => paginate(`/workspaces/${workspaceGid}/projects`)),
    },
    tasks: {
      getTasksForProject: (projectGid, { opt_fields } = {}) =>
        collection(() => paginate(`/projects/${projectGid}/tasks`, { opt_fields })),
      getTasksForUser: (userGid, { workspace, opt_fields } = {}) =>
        collection(() => paginate(`/tasks`, { assignee: userGid, workspace, opt_fields })),
      // Safe fallback: return empty list to avoid 400s from search without filters
      searchTasksForWorkspace: (workspaceGid, { opt_fields } = {}) =>
        collection(async () => []),
    },
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

function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {}
  const fence = text.match(/```(?:json)?\n([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const brace = text.indexOf('{');
  if (brace >= 0) {
    const last = text.lastIndexOf('}');
    if (last > brace) {
      const slice = text.slice(brace, last + 1);
      try {
        return JSON.parse(slice);
      } catch {}
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  const originalPath = event.path || '';
  let route = originalPath.replace(/^\/\.netlify\/functions\/api/, '');
  route = route.replace(/^\/api/, '');
  if (!route) route = '/';
  const creds = getCreds(event.headers);
  console.log('api handler', {
    path: originalPath,
    method: event.httpMethod,
    route,
    hasToken: !!creds.token,
    hasWorkspace: !!creds.workspaceGid,
    hasProject: !!creds.projectGid,
    hasUser: !!creds.userGid,
  });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const ADMIN_API_KEY = process.env.ADMIN_API_KEY || process.env.ADMIN_KEY;
    const hasSB = !!(SUPABASE_URL && SUPABASE_KEY);
    const axiosSB = hasSB
      ? axios.create({
          baseURL: `${SUPABASE_URL}/rest/v1`,
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          timeout: 20000,
        })
      : null;

    const historyLog = async (entry) => {
      const sql = await getNeon();
      if (sql) {
        const actTypes = Array.isArray(entry.actions) ? Array.from(new Set(entry.actions.map((x) => x && x.type).filter(Boolean))) : [];
        const arrLit = `{${actTypes.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(',')}}`;
        const rows = await sql`
          insert into ai_history (created_at, user_id, workspace_gid, project_gid, prompt, mode, output, actions, action_types, model, source)
          values (now(), ${entry.user_id || 'default'}, ${entry.workspace_gid || null}, ${entry.project_gid || null}, ${entry.prompt || ''}, ${entry.mode || 'get'}, ${entry.output || ''}, ${JSON.stringify(entry.actions || [])}::jsonb, ${arrLit}::text[], ${entry.model || null}, ${entry.source || 'netlify'})
          returning id
        `;
        return { ok: true, id: rows && rows[0] && rows[0].id };
      }
      if (!hasSB) return { ok: false, reason: 'disabled' };
      const action_types = Array.isArray(entry.actions) ? Array.from(new Set(entry.actions.map((x) => x && x.type).filter(Boolean))) : [];
      const payload = {
        created_at: new Date().toISOString(),
        user_id: entry.user_id || 'default',
        workspace_gid: entry.workspace_gid || null,
        project_gid: entry.project_gid || null,
        prompt: entry.prompt || '',
        mode: entry.mode || 'get',
        output: entry.output || '',
        actions: Array.isArray(entry.actions) ? entry.actions : [],
        action_types,
        model: entry.model || null,
        source: entry.source || 'netlify',
      };
      const resp = await axiosSB.post('/ai_history', payload, { headers: { Prefer: 'return=representation' } });
      return { ok: true, id: resp.data && resp.data[0] && resp.data[0].id };
    };

    const historyList = async (q) => {
      const sql = await getNeon();
      const startIso = q.start ? new Date(q.start).toISOString() : null;
      const endIso = q.end ? new Date(q.end).toISOString() : null;
      const limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
      const offset = Math.max(0, Number(q.offset) || 0);
      if (sql) {
        const rows = await sql`
          select id, created_at, user_id, workspace_gid, project_gid, mode, action_types, prompt, output, actions, model, source,
                 count(*) over() as total_count
          from ai_history
          where (${q.user_id || null}::text is null or user_id = ${q.user_id || null})
            and (${q.mode || null}::text is null or mode = ${q.mode || null})
            and (${q.project_gid || null}::text is null or project_gid = ${q.project_gid || null})
            and (${q.workspace_gid || null}::text is null or workspace_gid = ${q.workspace_gid || null})
            and (${q.action_type || null}::text is null or ${q.action_type || null} = any(action_types))
            and (${startIso}::timestamptz is null or created_at >= ${startIso})
            and (${endIso}::timestamptz is null or created_at <= ${endIso})
          order by created_at desc
          limit ${limit} offset ${offset}
        `;
        const total = rows && rows[0] && rows[0].total_count ? Number(rows[0].total_count) : (rows ? rows.length : 0);
        return { ok: true, items: rows, count: total };
      }
      if (!hasSB) return { ok: false, reason: 'disabled' };
      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('order', 'created_at.desc');
      if (q.user_id) params.set('user_id', `eq.${q.user_id}`);
      if (q.mode) params.set('mode', `eq.${q.mode}`);
      if (q.project_gid) params.set('project_gid', `eq.${q.project_gid}`);
      if (q.workspace_gid) params.set('workspace_gid', `eq.${q.workspace_gid}`);
      if (q.action_type) params.set('action_types', `cs.{"${q.action_type}"}`);
      if (q.start) params.set('created_at', `gte.${new Date(q.start).toISOString()}`);
      if (q.end) params.append('created_at', `lte.${new Date(q.end).toISOString()}`);
      const start = Math.max(0, Number(q.offset) || 0);
      const lim = Math.min(500, Math.max(1, Number(q.limit) || 50));
      const end = start + lim - 1;
      const resp = await axiosSB.get(`/ai_history?${params.toString()}`, {
        headers: { 'Range-Unit': 'items', Range: `${start}-${end}`, Prefer: 'count=exact' },
      });
      return { ok: true, items: Array.isArray(resp.data) ? resp.data : [], count: Number(resp.headers['content-range']?.split('/')?.[1] || 0) };
    };

    const historyPurge = async (p, adminHeader) => {
      const sql = await getNeon();
      if (!ADMIN_API_KEY || adminHeader !== ADMIN_API_KEY) return { ok: false, reason: 'forbidden' };
      let beforeTs = p.before ? new Date(p.before).toISOString() : null;
      if (!beforeTs && p.retention_days) {
        const d = new Date();
        d.setDate(d.getDate() - Number(p.retention_days));
        beforeTs = d.toISOString();
      }
      if (!beforeTs) return { ok: false, reason: 'missing_threshold' };
      if (sql) {
        await sql`
          delete from ai_history
          where created_at < ${beforeTs}
            and (${p.user_id || null}::text is null or user_id = ${p.user_id || null})
        `;
        return { ok: true };
      }
      if (!hasSB) return { ok: false, reason: 'disabled' };
      const params = new URLSearchParams();
      params.set('created_at', `lt.${beforeTs}`);
      if (p.user_id) params.set('user_id', `eq.${p.user_id}`);
      await axiosSB.delete(`/ai_history?${params.toString()}`, { headers: { Prefer: 'return=minimal' } });
      return { ok: true };
    };

    const historyExport = async (q, format) => {
      const list = await historyList(q);
      if (!list.ok) return list;
      if (format === 'csv') {
        const cols = ['id', 'created_at', 'user_id', 'workspace_gid', 'project_gid', 'mode', 'action_types', 'prompt', 'output', 'actions'];
        const esc = (v) => {
          const s = typeof v === 'string' ? v : JSON.stringify(v || '');
          if (s == null) return '';
          const t = s.replace(/"/g, '""');
          return `"${t.replace(/\n/g, ' ').slice(0, 10000)}"`;
        };
        const rows = [cols.join(',')];
        list.items.forEach((it) => {
          rows.push([
            it.id || '',
            it.created_at || '',
            it.user_id || '',
            it.workspace_gid || '',
            it.project_gid || '',
            it.mode || '',
            Array.isArray(it.action_types) ? it.action_types.join('|') : '',
            it.prompt || '',
            it.output || '',
            JSON.stringify(it.actions || []),
          ].map(esc).join(','));
        });
        return { ok: true, csv: rows.join('\n') };
      }
      return { ok: true, json: list.items };
    };

    if (route === '/workspaces' && event.httpMethod === 'GET') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure token first' });
      const client = await createAsanaClient(creds.token);
      const workspaces = await client.workspaces.getWorkspaces();
      const workspacesList = await workspaces.collect();
      return jsonResponse(200, { success: true, workspaces: workspacesList });
    }

    if (route === '/projects' && event.httpMethod === 'GET') {
      if (!creds.token || !creds.workspaceGid)
        return jsonResponse(400, { error: 'Please configure token and workspace first' });
      const client = await createAsanaClient(creds.token);
      const projects = await client.projects.getProjectsForWorkspace(creds.workspaceGid);
      const projectsList = await projects.collect();
      return jsonResponse(200, { success: true, projects: projectsList });
    }

    if (route === '/tasks' && event.httpMethod === 'GET') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure credentials first' });
      const client = await createAsanaClient(creds.token);
      const tasks = await getTasks(client, creds);
      return jsonResponse(200, { success: true, tasks, count: tasks.length });
    }

    if (route === '/plan/weekly' && event.httpMethod === 'POST') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure credentials first' });
      const client = await createAsanaClient(creds.token);
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
      const client = await createAsanaClient(creds.token);
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

    if (route === '/ai/query' && event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const prompt = (body && body.prompt) || '';
      if (!prompt) return jsonResponse(400, { error: 'Prompt is required' });
      if (!creds.openrouterKey) return jsonResponse(400, { error: 'Please provide OpenRouter API key in x-openrouter-key header' });

      let tasks = [];
      if (creds.token) {
        try {
          const client = await createAsanaClient(creds.token);
          tasks = await getTasks(client, creds);
        } catch {}
      }

      const tasksBrief = (tasks || []).slice(0, 200).map((t) => ({
        gid: t.gid,
        name: t.name,
        completed: !!t.completed,
        due_on: t.due_on || null,
        assignee: t.assignee && t.assignee.name ? t.assignee.name : null,
        tags: Array.isArray(t.tags) ? t.tags.map((x) => x && x.name).filter(Boolean) : [],
        priority: t.priority || null,
      }));

      const messages = [
        {
          role: 'system',
          content:
            'You are an assistant for Asana task planning. Always respond with a single JSON object. Keys: mode ("get" or "post"), output (string), actions (optional array). Use mode="get" for informational queries. Use mode="post" only when the user asks to create, update, or edit. When using mode="post", propose actions only and do not assume execution. Allowed actions: {type:"update_task", task_gid, fields:{...}} | {type:"create_subtask", parent_task_gid, fields:{name, due_on?, assignee?, notes?}} | {type:"comment_task", task_gid, text} | {type:"create_task", fields:{name, notes?, due_on?, assignee_email?, projects?, workspace? , tags?}} | {type:"assign_task", task_gid, assignee_email?, assignee_gid?} | {type:"set_tags", task_gid, tags?:string[], remove_tags?:string[]} | {type:"set_section", task_gid, project_gid?, section_gid?, section_name?} | {type:"complete_task", task_gid, completed?}. Prefer names for tags/sections; the app will resolve them. If project_gid/workspace are omitted, the app will use configured defaults. Keep output concise and actionable.',
        },
        {
          role: 'user',
          content: `${prompt}\n\nContext JSON:\n${JSON.stringify({ tasks: tasksBrief, workspace_gid: creds.workspaceGid || null, project_gid: creds.projectGid || null })}`,
        },
      ];

      try {
        const resp = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: 'google/gemini-2.5-flash',
            messages,
            temperature: 0.2,
            max_tokens: 1200,
          },
          {
            headers: {
              Authorization: `Bearer ${creds.openrouterKey}`,
              'HTTP-Referer': 'http://localhost',
              'X-Title': 'Asana Planner Agent',
            },
            timeout: 60000,
          }
        );
        const content =
          resp && resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content
            ? resp.data.choices[0].message.content
            : '';
        const parsed = tryParseJson(content);
        if (parsed && (parsed.mode === 'get' || parsed.mode === 'post')) {
          return jsonResponse(200, {
            success: true,
            mode: parsed.mode,
            output: typeof parsed.output === 'string' ? parsed.output : String(parsed.output || ''),
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
            raw: content,
          });
        }
        return jsonResponse(200, { success: true, mode: 'get', output: content || '', actions: [] });
      } catch (e) {
        return jsonResponse(500, { error: 'AI request failed', details: e.message });
      }
    }

    if (route === '/ai/execute' && event.httpMethod === 'POST') {
      if (!creds.token) return jsonResponse(400, { error: 'Please configure credentials first' });
      const body = event.body ? JSON.parse(event.body) : {};
      const actions = Array.isArray(body && body.actions) ? body.actions : [];
      if (!actions.length) return jsonResponse(400, { error: 'No actions to execute' });

      const http = axios.create({
        baseURL: 'https://app.asana.com/api/1.0',
        headers: { Authorization: `Bearer ${creds.token}` },
      });

      const results = [];
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i] || {};
        try {
          if (a.type === 'update_task' && a.task_gid) {
            const r = await http.put(`/tasks/${a.task_gid}`, { data: a.fields || {} });
            results.push({ index: i, type: a.type, ok: true, gid: a.task_gid, data: r.data && r.data.data });
            continue;
          }
          if (a.type === 'create_subtask' && a.parent_task_gid) {
            const r = await http.post(`/tasks/${a.parent_task_gid}/subtasks`, { data: a.fields || {} });
            results.push({ index: i, type: a.type, ok: true, parent: a.parent_task_gid, data: r.data && r.data.data });
            continue;
          }
          if (a.type === 'comment_task' && a.task_gid && a.text) {
            const r = await http.post(`/tasks/${a.task_gid}/stories`, { data: { text: a.text } });
            results.push({ index: i, type: a.type, ok: true, gid: a.task_gid, data: r.data && r.data.data });
            continue;
          }
          if (a.type === 'create_task' && a.fields && a.fields.name) {
            const f = a.fields || {};
            const payload = { name: f.name };
            if (f.notes) payload.notes = f.notes;
            if (f.due_on) payload.due_on = f.due_on;
            if (f.workspace) payload.workspace = f.workspace;
            if (!payload.workspace && creds.workspaceGid) payload.workspace = creds.workspaceGid;
            if (Array.isArray(f.projects) && f.projects.length) payload.projects = f.projects;
            else if (creds.projectGid) payload.projects = [creds.projectGid];
            if (f.assignee) payload.assignee = f.assignee;
            if (f.assignee_email && payload.workspace) {
              try {
                const u = await http.get(`/users`, { params: { workspace: payload.workspace, email: f.assignee_email } });
                const udata = u.data && u.data.data;
                if (udata && ((Array.isArray(udata) && udata[0]) || udata.gid)) {
                  const user = Array.isArray(udata) ? udata[0] : udata;
                  payload.assignee = user.gid;
                }
              } catch {}
            }
            const cr = await http.post(`/tasks`, { data: payload });
            const created = cr.data && cr.data.data;
            if (created && Array.isArray(f.tags) && f.tags.length) {
              let wgid = payload.workspace;
              if (!wgid) {
                try {
                  const t = await http.get(`/tasks/${created.gid}`, { params: { opt_fields: 'workspace' } });
                  wgid = t.data && t.data.data && t.data.data.workspace && t.data.data.workspace.gid;
                } catch {}
              }
              if (wgid) {
                let offset;
                const tagMap = {};
                try {
                  do {
                    const tr = await http.get(`/tags`, { params: { workspace: wgid, limit: 100, offset, opt_fields: 'name' } });
                    const body = tr.data || {};
                    const arr = Array.isArray(body.data) ? body.data : [];
                    arr.forEach(tg => { if (tg && tg.name) tagMap[tg.name.toLowerCase()] = tg.gid; });
                    offset = body.next_page && body.next_page.offset ? body.next_page.offset : undefined;
                  } while (offset);
                } catch {}
                for (const tn of f.tags) {
                  if (!tn) continue;
                  const key = String(tn).toLowerCase();
                  let tgId = tagMap[key];
                  if (!tgId) {
                    try {
                      const crt = await http.post(`/tags`, { data: { name: tn, workspace: wgid } });
                      tgId = crt.data && crt.data.data && crt.data.data.gid;
                      if (tgId) tagMap[key] = tgId;
                    } catch {}
                  }
                  if (tgId) {
                    try { await http.post(`/tasks/${created.gid}/addTag`, { data: { tag: tgId } }); } catch {}
                  }
                }
              }
            }
            results.push({ index: i, type: a.type, ok: true, gid: created && created.gid, data: created });
            continue;
          }
          if (a.type === 'assign_task' && a.task_gid && (a.assignee_email || a.assignee_gid)) {
            let assignee = a.assignee_gid;
            let wgid = creds.workspaceGid;
            if (!wgid) {
              try {
                const t = await http.get(`/tasks/${a.task_gid}`, { params: { opt_fields: 'workspace' } });
                wgid = t.data && t.data.data && t.data.data.workspace && t.data.data.workspace.gid;
              } catch {}
            }
            if (!assignee && a.assignee_email && wgid) {
              try {
                const u = await http.get(`/users`, { params: { workspace: wgid, email: a.assignee_email } });
                const udata = u.data && u.data.data;
                if (udata && ((Array.isArray(udata) && udata[0]) || udata.gid)) {
                  const user = Array.isArray(udata) ? udata[0] : udata;
                  assignee = user.gid;
                }
              } catch {}
            }
            if (!assignee) throw new Error('Assignee not found');
            const r = await http.put(`/tasks/${a.task_gid}`, { data: { assignee } });
            results.push({ index: i, type: a.type, ok: true, gid: a.task_gid, data: r.data && r.data.data });
            continue;
          }
          if (a.type === 'set_tags' && a.task_gid && (Array.isArray(a.tags) || Array.isArray(a.remove_tags))) {
            let wgid = creds.workspaceGid;
            if (!wgid) {
              try {
                const t = await http.get(`/tasks/${a.task_gid}`, { params: { opt_fields: 'workspace' } });
                wgid = t.data && t.data.data && t.data.data.workspace && t.data.data.workspace.gid;
              } catch {}
            }
            if (!wgid) throw new Error('Workspace not found');
            const want = Array.isArray(a.tags) ? a.tags.filter(Boolean) : [];
            const rem = Array.isArray(a.remove_tags) ? a.remove_tags.filter(Boolean) : [];
            let offset;
            const tagMap = {};
            try {
              do {
                const tr = await http.get(`/tags`, { params: { workspace: wgid, limit: 100, offset, opt_fields: 'name' } });
                const body = tr.data || {};
                const arr = Array.isArray(body.data) ? body.data : [];
                arr.forEach(tg => { if (tg && tg.name) tagMap[tg.name.toLowerCase()] = tg.gid; });
                offset = body.next_page && body.next_page.offset ? body.next_page.offset : undefined;
              } while (offset);
            } catch {}
            for (const tn of want) {
              const key = String(tn).toLowerCase();
              let tgId = tagMap[key];
              if (!tgId) {
                try {
                  const crt = await http.post(`/tags`, { data: { name: tn, workspace: wgid } });
                  tgId = crt.data && crt.data.data && crt.data.data.gid;
                  if (tgId) tagMap[key] = tgId;
                } catch {}
              }
              if (tgId) {
                try { await http.post(`/tasks/${a.task_gid}/addTag`, { data: { tag: tgId } }); } catch {}
              }
            }
            for (const tn of rem) {
              const key = String(tn).toLowerCase();
              const tgId = tagMap[key];
              if (tgId) {
                try { await http.post(`/tasks/${a.task_gid}/removeTag`, { data: { tag: tgId } }); } catch {}
              }
            }
            results.push({ index: i, type: a.type, ok: true, gid: a.task_gid });
            continue;
          }
          if (a.type === 'set_section' && a.task_gid && (a.project_gid || creds.projectGid) && (a.section_gid || a.section_name)) {
            const project = a.project_gid || creds.projectGid;
            let section = a.section_gid;
            if (!section && a.section_name) {
              try {
                let offset;
                let found;
                do {
                  const sr = await http.get(`/projects/${project}/sections`, { params: { limit: 100, offset } });
                  const body = sr.data || {};
                  const arr = Array.isArray(body.data) ? body.data : [];
                  found = arr.find(s => s && s.name && s.name.toLowerCase() === String(a.section_name).toLowerCase());
                  offset = body.next_page && body.next_page.offset ? body.next_page.offset : undefined;
                } while (!section && offset);
                if (found && found.gid) section = found.gid;
                if (!section) {
                  const crs = await http.post(`/projects/${project}/sections`, { data: { name: a.section_name } });
                  section = crs.data && crs.data.data && crs.data.data.gid;
                }
              } catch {}
            }
            if (!section) throw new Error('Section not found');
            let ok = false;
            try {
              await http.post(`/tasks/${a.task_gid}/addProject`, { data: { project, section } });
              ok = true;
            } catch {
              try {
                await http.post(`/sections/${section}/addTask`, { data: { task: a.task_gid } });
                ok = true;
              } catch {}
            }
            if (!ok) throw new Error('Failed to set section');
            results.push({ index: i, type: a.type, ok: true, gid: a.task_gid, project, section });
            continue;
          }
          if (a.type === 'complete_task' && a.task_gid) {
            const r = await http.put(`/tasks/${a.task_gid}`, { data: { completed: a.completed === false ? false : true } });
            results.push({ index: i, type: a.type, ok: true, gid: a.task_gid, data: r.data && r.data.data });
            continue;
          }
          results.push({ index: i, type: a.type, ok: false, error: 'Unsupported or invalid action' });
        } catch (e) {
          results.push({ index: i, type: a.type, ok: false, error: e.message });
        }
      }
      return jsonResponse(200, { success: true, results });
    }

    if (route === '/ai/history/log' && event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const userId = body.user_id || event.headers['x-user-id'] || 'default';
      const entry = {
        user_id: userId,
        workspace_gid: body.workspace_gid || creds.workspaceGid || null,
        project_gid: body.project_gid || creds.projectGid || null,
        prompt: body.prompt || '',
        mode: body.mode || 'get',
        output: body.output || '',
        actions: Array.isArray(body.actions) ? body.actions : [],
        model: body.model || 'google/gemini-2.5-flash',
        source: 'netlify',
      };
      const r = await historyLog(entry);
      if (!r.ok) return jsonResponse(400, { error: 'History disabled or failed', details: r.reason });
      return jsonResponse(200, { success: true, id: r.id });
    }

    if (route === '/ai/history/list' && event.httpMethod === 'GET') {
      const q = {
        user_id: event.queryStringParameters && event.queryStringParameters.user_id,
        mode: event.queryStringParameters && event.queryStringParameters.mode,
        project_gid: event.queryStringParameters && event.queryStringParameters.project_gid,
        workspace_gid: event.queryStringParameters && event.queryStringParameters.workspace_gid,
        action_type: event.queryStringParameters && event.queryStringParameters.action_type,
        start: event.queryStringParameters && event.queryStringParameters.start,
        end: event.queryStringParameters && event.queryStringParameters.end,
        limit: event.queryStringParameters && event.queryStringParameters.limit,
        offset: event.queryStringParameters && event.queryStringParameters.offset,
      };
      const r = await historyList(q);
      if (!r.ok) return jsonResponse(400, { error: 'History disabled or failed', details: r.reason });
      return jsonResponse(200, { success: true, items: r.items, count: r.count });
    }

    if (route === '/ai/history/export' && event.httpMethod === 'GET') {
      const format = (event.queryStringParameters && event.queryStringParameters.format) || 'json';
      const q = {
        user_id: event.queryStringParameters && event.queryStringParameters.user_id,
        mode: event.queryStringParameters && event.queryStringParameters.mode,
        project_gid: event.queryStringParameters && event.queryStringParameters.project_gid,
        workspace_gid: event.queryStringParameters && event.queryStringParameters.workspace_gid,
        action_type: event.queryStringParameters && event.queryStringParameters.action_type,
        start: event.queryStringParameters && event.queryStringParameters.start,
        end: event.queryStringParameters && event.queryStringParameters.end,
        limit: event.queryStringParameters && event.queryStringParameters.limit,
        offset: event.queryStringParameters && event.queryStringParameters.offset,
      };
      const r = await historyExport(q, format);
      if (!r.ok) return jsonResponse(400, { error: 'History disabled or failed', details: r.reason });
      if (format === 'csv') return jsonResponse(200, r.csv, { 'Content-Type': 'text/csv' });
      return jsonResponse(200, r.json);
    }

    if (route === '/ai/history/purge' && event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const adminHeader = event.headers['x-admin-key'] || event.headers['X-Admin-Key'] || event.headers['x-admin-key'];
      const r = await historyPurge(body || {}, adminHeader);
      if (!r.ok) return jsonResponse(403, { error: 'Forbidden or disabled', details: r.reason });
      return jsonResponse(200, { success: true });
    }

    console.warn('Route not found', { route, method: event.httpMethod, path: event.path });
    return jsonResponse(404, {
      error: 'Not found',
      details: `No handler for ${event.httpMethod} ${route}`,
      hint: 'Valid routes: GET /workspaces, GET /projects, GET /tasks, POST /plan/weekly, POST /brainstorm',
    });
  } catch (error) {
    console.error('Function error:', error);
    return jsonResponse(500, { error: 'Internal Error', details: error.message });
  }
};
