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
                content: 'You are an assistant for Asana task planning. Always respond with a single JSON object. Keys: mode ("get" or "post"), output (string), actions (optional array). Use mode="get" for informational queries. Use mode="post" only when the user asks to create, update, or edit. When using mode="post", propose actions only and do not assume execution. Allowed actions: {type:"update_task", task_gid, fields:{...}} | {type:"create_subtask", parent_task_gid, fields:{name, due_on?, assignee?, notes?}} | {type:"comment_task", task_gid, text}. Keep output concise and actionable.'
            },
            {
                role: 'user',
                content: `${prompt}\n\nContext JSON:\n${JSON.stringify({ tasks: tasksBrief })}`
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
