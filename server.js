const express = require('express');
const asana = require('asana');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Store credentials in memory (for demo purposes)
let credentials = {
    token: null,
    workspaceGid: null,
    projectGid: null,
    userGid: null
};

// API Endpoints

function tryParseJson(text) {
    if (!text || typeof text !== 'string') return null;
    try { return JSON.parse(text); } catch {}
    const fence = text.match(/```(?:json)?\n([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1]); } catch {} }
    const brace = text.indexOf('{');
    if (brace >= 0) {
        const last = text.lastIndexOf('}');
        if (last > brace) {
            const slice = text.slice(brace, last + 1);
            try { return JSON.parse(slice); } catch {}
        }
    }
    return null;
}

// Save credentials
app.post('/api/credentials', (req, res) => {
    credentials = {
        token: req.body.token,
        workspaceGid: req.body.workspaceGid,
        projectGid: req.body.projectGid,
        userGid: req.body.userGid
    };
    res.json({ success: true, message: 'Credentials saved successfully' });
});

// Get current credentials status
app.get('/api/credentials/status', (req, res) => {
    res.json({
        configured: !!credentials.token,
        hasWorkspace: !!credentials.workspaceGid,
        hasProject: !!credentials.projectGid,
        hasUser: !!credentials.userGid
    });
});

// Fetch tasks
app.get('/api/tasks', async (req, res) => {
    try {
        if (!credentials.token) {
            return res.status(400).json({ error: 'Please configure credentials first' });
        }

        const client = asana.Client.create().useAccessToken(credentials.token);
        
        let tasks = [];
        
        // Fetch tasks based on available filters
        if (credentials.projectGid) {
            const projectTasks = await client.tasks.getTasksForProject(credentials.projectGid, {
                opt_fields: 'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at'
            });
            tasks = await projectTasks.collect();
        } else if (credentials.userGid && credentials.workspaceGid) {
            const userTasks = await client.tasks.getTasksForUser(credentials.userGid, {
                workspace: credentials.workspaceGid,
                opt_fields: 'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at'
            });
            tasks = await userTasks.collect();
        } else if (credentials.workspaceGid) {
            const workspaceTasks = await client.tasks.searchTasksForWorkspace(credentials.workspaceGid, {
                opt_fields: 'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at'
            });
            tasks = await workspaceTasks.collect();
        }

        res.json({ success: true, tasks, count: tasks.length });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ 
            error: 'Failed to fetch tasks', 
            details: error.message,
            hint: 'Check if your credentials are correct and have proper permissions'
        });
    }
});

app.post('/api/ai/query', async (req, res) => {
    try {
        const prompt = (req.body && req.body.prompt) || '';
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
        const openrouterKey = req.headers['x-openrouter-key'] || req.headers['X-OpenRouter-Key'] || req.headers['x-openrouter-key'];
        if (!openrouterKey) return res.status(400).json({ error: 'Please provide OpenRouter API key in x-openrouter-key header' });

        let tasks = [];
        if (credentials.token) {
            try {
                const client = asana.Client.create().useAccessToken(credentials.token);
                if (credentials.projectGid) {
                    const projectTasks = await client.tasks.getTasksForProject(credentials.projectGid, {
                        opt_fields: 'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at'
                    });
                    tasks = await projectTasks.collect();
                } else if (credentials.userGid && credentials.workspaceGid) {
                    const userTasks = await client.tasks.getTasksForUser(credentials.userGid, {
                        workspace: credentials.workspaceGid,
                        opt_fields: 'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at'
                    });
                    tasks = await userTasks.collect();
                } else if (credentials.workspaceGid) {
                    const workspaceTasks = await client.tasks.searchTasksForWorkspace(credentials.workspaceGid, {
                        opt_fields: 'name,completed,due_on,due_at,assignee,assignee.name,tags,tags.name,notes,created_at,modified_at,priority,completed_at'
                    });
                    tasks = await workspaceTasks.collect();
                }
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
                content: 'You are an assistant for Asana task planning. Always respond with a single JSON object. Keys: mode ("get" or "post"), output (string), actions (optional array). Use mode="get" for informational queries. Use mode="post" only when the user asks to create, update, or edit. When using mode="post", propose actions only and do not assume execution. Allowed actions: {type:"update_task", task_gid, fields:{...}} | {type:"create_subtask", parent_task_gid, fields:{name, due_on?, assignee?, notes?}} | {type:"comment_task", task_gid, text} | {type:"create_task", fields:{name, notes?, due_on?, assignee_email?, projects?, workspace? , tags?}} | {type:"assign_task", task_gid, assignee_email?, assignee_gid?} | {type:"set_tags", task_gid, tags?:string[], remove_tags?:string[]} | {type:"set_section", task_gid, project_gid?, section_gid?, section_name?} | {type:"complete_task", task_gid, completed?}. Prefer names for tags/sections; the app will resolve them. If project_gid/workspace are omitted, the app will use configured defaults. Keep output concise and actionable.'
            },
            {
                role: 'user',
                content: `${prompt}\n\nContext JSON:\n${JSON.stringify({ tasks: tasksBrief, workspace_gid: credentials.workspaceGid || null, project_gid: credentials.projectGid || null })}`
            }
        ];

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
                    Authorization: `Bearer ${openrouterKey}`,
                    'HTTP-Referer': 'http://localhost',
                    'X-Title': 'Asana Planner Agent',
                },
                timeout: 60000,
            }
        );

        const content = resp && resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content
            ? resp.data.choices[0].message.content
            : '';
        const parsed = tryParseJson(content);
        if (parsed && (parsed.mode === 'get' || parsed.mode === 'post')) {
            return res.json({
                success: true,
                mode: parsed.mode,
                output: typeof parsed.output === 'string' ? parsed.output : String(parsed.output || ''),
                actions: Array.isArray(parsed.actions) ? parsed.actions : [],
                raw: content,
            });
        }
        return res.json({ success: true, mode: 'get', output: content || '', actions: [] });
    } catch (error) {
        console.error('AI query error:', error);
        res.status(500).json({ error: 'AI request failed', details: error.message });
    }
});

app.post('/api/ai/execute', async (req, res) => {
    try {
        if (!credentials.token) return res.status(400).json({ error: 'Please configure credentials first' });
        const actions = Array.isArray(req.body && req.body.actions) ? req.body.actions : [];
        if (!actions.length) return res.status(400).json({ error: 'No actions to execute' });

        const http = axios.create({
            baseURL: 'https://app.asana.com/api/1.0',
            headers: { Authorization: `Bearer ${credentials.token}` },
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
                    if (!payload.workspace && credentials.workspaceGid) payload.workspace = credentials.workspaceGid;
                    if (Array.isArray(f.projects) && f.projects.length) payload.projects = f.projects;
                    else if (credentials.projectGid) payload.projects = [credentials.projectGid];
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
                    let wgid = credentials.workspaceGid;
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
                    let wgid = credentials.workspaceGid;
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
                if (a.type === 'set_section' && a.task_gid && (a.project_gid || credentials.projectGid) && (a.section_gid || a.section_name)) {
                    const project = a.project_gid || credentials.projectGid;
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
        res.json({ success: true, results });
    } catch (error) {
        console.error('Execute actions error:', error);
        res.status(500).json({ error: 'Failed to execute actions', details: error.message });
    }
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || process.env.ADMIN_KEY;
const hasSB = !!(SUPABASE_URL && SUPABASE_KEY);
const axiosSB = hasSB ? axios.create({ baseURL: `${SUPABASE_URL}/rest/v1`, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, timeout: 20000 }) : null;

async function historyLog(entry) {
    if (!hasSB) return { ok: false, reason: 'disabled' };
    const action_types = Array.isArray(entry.actions) ? Array.from(new Set(entry.actions.map(x => x && x.type).filter(Boolean))) : [];
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
        source: entry.source || 'express',
    };
    const resp = await axiosSB.post('/ai_history', payload, { headers: { Prefer: 'return=representation' } });
    return { ok: true, id: resp.data && resp.data[0] && resp.data[0].id };
}

async function historyList(q) {
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
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const end = start + limit - 1;
    const resp = await axiosSB.get(`/ai_history?${params.toString()}`, { headers: { 'Range-Unit': 'items', Range: `${start}-${end}`, Prefer: 'count=exact' } });
    return { ok: true, items: Array.isArray(resp.data) ? resp.data : [], count: Number(resp.headers['content-range']?.split('/')?.[1] || 0) };
}

async function historyPurge(p, adminHeader) {
    if (!hasSB) return { ok: false, reason: 'disabled' };
    if (!ADMIN_API_KEY || adminHeader !== ADMIN_API_KEY) return { ok: false, reason: 'forbidden' };
    const params = new URLSearchParams();
    let beforeTs = p.before ? new Date(p.before).toISOString() : null;
    if (!beforeTs && p.retention_days) {
        const d = new Date();
        d.setDate(d.getDate() - Number(p.retention_days));
        beforeTs = d.toISOString();
    }
    if (!beforeTs) return { ok: false, reason: 'missing_threshold' };
    params.set('created_at', `lt.${beforeTs}`);
    if (p.user_id) params.set('user_id', `eq.${p.user_id}`);
    await axiosSB.delete(`/ai_history?${params.toString()}`, { headers: { Prefer: 'return=minimal' } });
    return { ok: true };
}

async function historyExport(q, format) {
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
        list.items.forEach(it => {
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
}

app.post('/api/ai/history/log', async (req, res) => {
    try {
        const userId = req.body.user_id || req.headers['x-user-id'] || 'default';
        const entry = {
            user_id: userId,
            workspace_gid: req.body.workspace_gid || credentials.workspaceGid || null,
            project_gid: req.body.project_gid || credentials.projectGid || null,
            prompt: req.body.prompt || '',
            mode: req.body.mode || 'get',
            output: req.body.output || '',
            actions: Array.isArray(req.body.actions) ? req.body.actions : [],
            model: req.body.model || 'google/gemini-2.5-flash',
            source: 'express',
        };
        const r = await historyLog(entry);
        if (!r.ok) return res.status(400).json({ error: 'History disabled or failed', details: r.reason });
        res.json({ success: true, id: r.id });
    } catch (e) {
        res.status(500).json({ error: 'Failed to log history', details: e.message });
    }
});

app.get('/api/ai/history/list', async (req, res) => {
    try {
        const q = {
            user_id: req.query.user_id,
            mode: req.query.mode,
            project_gid: req.query.project_gid,
            workspace_gid: req.query.workspace_gid,
            action_type: req.query.action_type,
            start: req.query.start,
            end: req.query.end,
            limit: req.query.limit,
            offset: req.query.offset,
        };
        const r = await historyList(q);
        if (!r.ok) return res.status(400).json({ error: 'History disabled or failed', details: r.reason });
        res.json({ success: true, items: r.items, count: r.count });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list history', details: e.message });
    }
});

app.get('/api/ai/history/export', async (req, res) => {
    try {
        const format = req.query.format || 'json';
        const q = {
            user_id: req.query.user_id,
            mode: req.query.mode,
            project_gid: req.query.project_gid,
            workspace_gid: req.query.workspace_gid,
            action_type: req.query.action_type,
            start: req.query.start,
            end: req.query.end,
            limit: req.query.limit,
            offset: req.query.offset,
        };
        const r = await historyExport(q, format);
        if (!r.ok) return res.status(400).json({ error: 'History disabled or failed', details: r.reason });
        if (format === 'csv') return res.set('Content-Type', 'text/csv').send(r.csv);
        res.json(r.json);
    } catch (e) {
        res.status(500).json({ error: 'Failed to export history', details: e.message });
    }
});

app.post('/api/ai/history/purge', async (req, res) => {
    try {
        const adminHeader = req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || req.headers['x-admin-key'];
        const r = await historyPurge(req.body || {}, adminHeader);
        if (!r.ok) return res.status(403).json({ error: 'Forbidden or disabled', details: r.reason });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to purge history', details: e.message });
    }
});

// Get workspaces
app.get('/api/workspaces', async (req, res) => {
    try {
        if (!credentials.token) {
            return res.status(400).json({ error: 'Please configure token first' });
        }

        const client = asana.Client.create().useAccessToken(credentials.token);
        const workspaces = await client.workspaces.getWorkspaces();
        const workspacesList = await workspaces.collect();
        
        res.json({ success: true, workspaces: workspacesList });
    } catch (error) {
        console.error('Error fetching workspaces:', error);
        res.status(500).json({ error: 'Failed to fetch workspaces', details: error.message });
    }
});

// Get projects
app.get('/api/projects', async (req, res) => {
    try {
        if (!credentials.token || !credentials.workspaceGid) {
            return res.status(400).json({ error: 'Please configure token and workspace first' });
        }

        const client = asana.Client.create().useAccessToken(credentials.token);
        const projects = await client.projects.getProjectsForWorkspace(credentials.workspaceGid);
        const projectsList = await projects.collect();
        
        res.json({ success: true, projects: projectsList });
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
});

// Generate weekly plan
app.post('/api/plan/weekly', async (req, res) => {
    try {
        if (!credentials.token) {
            return res.status(400).json({ error: 'Please configure credentials first' });
        }

        const client = asana.Client.create().useAccessToken(credentials.token);
        let tasks = [];
        
        if (credentials.projectGid) {
            const projectTasks = await client.tasks.getTasksForProject(credentials.projectGid, {
                opt_fields: 'name,completed,due_on,due_at,assignee.name,tags.name,priority'
            });
            tasks = await projectTasks.collect();
        }

        // Group tasks by week
        const today = new Date();
        const weeklyPlan = {
            thisWeek: [],
            nextWeek: [],
            overdue: [],
            noDueDate: []
        };

        tasks.forEach(task => {
            if (task.completed) return; // Skip completed tasks

            if (!task.due_on) {
                weeklyPlan.noDueDate.push(task);
                return;
            }

            const dueDate = new Date(task.due_on);
            const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

            if (daysDiff < 0) {
                weeklyPlan.overdue.push(task);
            } else if (daysDiff <= 7) {
                weeklyPlan.thisWeek.push(task);
            } else if (daysDiff <= 14) {
                weeklyPlan.nextWeek.push(task);
            }
        });

        // Sort by due date
        ['thisWeek', 'nextWeek', 'overdue'].forEach(key => {
            weeklyPlan[key].sort((a, b) => new Date(a.due_on) - new Date(b.due_on));
        });

        res.json({ success: true, plan: weeklyPlan });
    } catch (error) {
        console.error('Error generating weekly plan:', error);
        res.status(500).json({ error: 'Failed to generate plan', details: error.message });
    }
});

// AI Brainstorming endpoint
app.post('/api/brainstorm', async (req, res) => {
    try {
        if (!credentials.token) {
            return res.status(400).json({ error: 'Please configure credentials first' });
        }

        const client = asana.Client.create().useAccessToken(credentials.token);
        let tasks = [];
        
        if (credentials.projectGid) {
            const projectTasks = await client.tasks.getTasksForProject(credentials.projectGid, {
                opt_fields: 'name,completed,due_on,assignee.name,tags.name,notes'
            });
            tasks = await projectTasks.collect();
        }

        // Analyze tasks
        const analysis = {
            totalTasks: tasks.length,
            completedTasks: tasks.filter(t => t.completed).length,
            pendingTasks: tasks.filter(t => !t.completed).length,
            tasksWithoutDueDate: tasks.filter(t => !t.due_on && !t.completed).length,
            unassignedTasks: tasks.filter(t => !t.assignee && !t.completed).length,
            overdueTasks: tasks.filter(t => {
                if (!t.due_on || t.completed) return false;
                return new Date(t.due_on) < new Date();
            }).length
        };

        // Generate suggestions
        const suggestions = [];
        
        if (analysis.tasksWithoutDueDate > 0) {
            suggestions.push({
                type: 'deadline',
                priority: 'high',
                message: `${analysis.tasksWithoutDueDate} tasks don't have due dates. Consider setting deadlines to improve planning.`,
                action: 'Set due dates for pending tasks'
            });
        }

        if (analysis.unassignedTasks > 0) {
            suggestions.push({
                type: 'assignment',
                priority: 'medium',
                message: `${analysis.unassignedTasks} tasks are unassigned. Assign them to team members to clarify ownership.`,
                action: 'Assign tasks to team members'
            });
        }

        if (analysis.overdueTasks > 0) {
            suggestions.push({
                type: 'overdue',
                priority: 'critical',
                message: `${analysis.overdueTasks} tasks are overdue. Review and reschedule or complete them.`,
                action: 'Address overdue tasks immediately'
            });
        }

        const completionRate = analysis.totalTasks > 0 
            ? ((analysis.completedTasks / analysis.totalTasks) * 100).toFixed(1)
            : 0;

        if (completionRate < 50) {
            suggestions.push({
                type: 'productivity',
                priority: 'medium',
                message: `Current completion rate is ${completionRate}%. Consider breaking down large tasks into smaller, manageable subtasks.`,
                action: 'Create subtasks for better progress tracking'
            });
        }

        // Task ideas based on gaps
        const taskIdeas = [];
        
        if (analysis.pendingTasks > 0) {
            taskIdeas.push('Schedule a sprint planning meeting to prioritize pending tasks');
            taskIdeas.push('Create a task review checkpoint to assess progress');
            taskIdeas.push('Set up automated reminders for upcoming deadlines');
        }

        res.json({ 
            success: true, 
            analysis, 
            suggestions,
            taskIdeas,
            completionRate: parseFloat(completionRate)
        });
    } catch (error) {
        console.error('Error during brainstorming:', error);
        res.status(500).json({ error: 'Failed to generate insights', details: error.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Asana Task Planner running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
