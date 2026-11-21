import { syncDirectory } from './firebaseDirectory.js';
/**
 * api/adminRoutes.ts — Admin read/write endpoints for the new admin panel.
 *
 * All routes are protected by requireAdmin from api/auth.ts.
 * Data comes from the service-role Supabase client (api/db.ts).
 */
import type { Express } from 'express';
import { requireAdmin, invalidateAccessCache, getDefaultDailyLimit } from './auth.js';
import type { VerifiedUser } from './auth.js';
import { adminDb } from './db.js';
import { istToday } from './usage.js';

export function registerAdminRoutes(app: Express) {
  // -----------------------------------------------------------------------
  // GET /api/admin/overview?range=7|30|90
  // -----------------------------------------------------------------------
  app.get('/api/admin/overview', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const range = Math.min(Number(req.query.range) || 30, 90);
      const today = istToday();
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - range);
      const since = sinceDate.toISOString().slice(0, 10);

      // KPIs
      const { count: totalUsers } = await adminDb.from('app_users').select('uid', { count: 'exact', head: true });
      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { count: newUsersWeek } = await adminDb.from('app_users').select('uid', { count: 'exact', head: true })
        .gte('first_seen_at', sevenDaysAgo.toISOString());

      // Active users by period
      const { data: activeToday } = await adminDb.from('usage_daily').select('uid').eq('day', today);
      const activeTodayCount = new Set(activeToday?.map(r => r.uid)).size;

      const { data: active7d } = await adminDb.from('usage_daily').select('uid')
        .gte('day', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
      const active7dCount = new Set(active7d?.map(r => r.uid)).size;

      const { data: active30d } = await adminDb.from('usage_daily').select('uid')
        .gte('day', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
      const active30dCount = new Set(active30d?.map(r => r.uid)).size;

      // Blocked users
      const { count: blockedUsers } = await adminDb.from('user_access').select('uid', { count: 'exact', head: true })
        .eq('status', 'blocked');

      // Aggregate stats for the range
      const { data: dailyAgg } = await adminDb.from('usage_daily')
        .select('day, feature, engine, requests, errors, pages, input_tokens, output_tokens')
        .gte('day', since)
        .order('day', { ascending: true });

      let totalRequests = 0, totalErrors = 0, totalPages = 0, totalInputTokens = 0, totalOutputTokens = 0;
      const perDay: Record<string, { requests: number; errors: number; pages: number; input_tokens: number; output_tokens: number }> = {};
      const perFeature: Record<string, number> = {};
      const perEngine: Record<string, number> = {};
      const perUser: Record<string, number> = {};

      for (const r of dailyAgg || []) {
        totalRequests += r.requests;
        totalErrors += r.errors;
        totalPages += r.pages;
        totalInputTokens += Number(r.input_tokens);
        totalOutputTokens += Number(r.output_tokens);

        const d = r.day;
        if (!perDay[d]) perDay[d] = { requests: 0, errors: 0, pages: 0, input_tokens: 0, output_tokens: 0 };
        perDay[d].requests += r.requests;
        perDay[d].errors += r.errors;
        perDay[d].pages += r.pages;
        perDay[d].input_tokens += Number(r.input_tokens);
        perDay[d].output_tokens += Number(r.output_tokens);

        perFeature[r.feature] = (perFeature[r.feature] || 0) + r.requests;
        perEngine[r.engine] = (perEngine[r.engine] || 0) + r.requests;
      }

      // Top users for the range
      const { data: topUsersRaw } = await adminDb.from('usage_daily')
        .select('uid, requests')
        .gte('day', since);

      const userTotals: Record<string, number> = {};
      for (const r of topUsersRaw || []) {
        userTotals[r.uid] = (userTotals[r.uid] || 0) + r.requests;
      }
      const topUids = Object.entries(userTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      // Look up names
      const topUsersList: { uid: string; name: string; email: string; requests: number }[] = [];
      if (topUids.length) {
        const { data: users } = await adminDb.from('app_users')
          .select('uid, name, email')
          .in('uid', topUids.map(u => u[0]));
        const nameMap = new Map((users || []).map(u => [u.uid, u]));
        for (const [uid, requests] of topUids) {
          const u = nameMap.get(uid);
          topUsersList.push({ uid, name: u?.name || '', email: u?.email || '', requests });
        }
      }

      // Per-day series
      const daySeries = Object.entries(perDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, ...v }));

      res.json({
        kpis: {
          totalUsers: totalUsers || 0,
          newUsersWeek: newUsersWeek || 0,
          activeToday: activeTodayCount,
          active7d: active7dCount,
          active30d: active30dCount,
          totalRequests,
          totalErrors,
          errorRate: totalRequests ? +(totalErrors / totalRequests * 100).toFixed(1) : 0,
          totalPages,
          totalInputTokens,
          totalOutputTokens,
          blockedUsers: blockedUsers || 0,
        },
        daySeries,
        byFeature: Object.entries(perFeature).map(([feature, requests]) => ({ feature, requests })),
        byEngine: Object.entries(perEngine).map(([engine, requests]) => ({ engine, requests })),
        topUsers: topUsersList,
      });
    } catch (err: any) {
      console.error('[admin/overview]', err);
      res.status(500).json({ error: err?.message || 'Failed to load overview.' });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/users?search=&status=&sort=&page=&pageSize=
  // -----------------------------------------------------------------------
  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const statusFilter = String(req.query.status || '');
      const sort = String(req.query.sort || 'last_seen');
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 5), 100);

      const directoryNotice = await syncDirectory();
      // Get all app_users with their access
      let query = adminDb.from('app_users')
        .select('uid, email, name, photo_url, first_seen_at, last_seen_at', { count: 'exact' });

      if (search) {
        query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
      }

      if (sort === 'name') {
        query = query.order('name', { ascending: true });
      } else if (sort === 'first_seen') {
        query = query.order('first_seen_at', { ascending: false });
      } else {
        query = query.order('last_seen_at', { ascending: false });
      }

      const { count: recent, error: recentError } = await adminDb.from('app_users').select('uid', {count:'exact',head:true}).gte('last_seen_at',new Date(Date.now()-300000).toISOString());
      if (recentError) throw recentError;
      const { data: allUsers, count, error } = await query
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (error) throw error;
      if (!allUsers || allUsers.length === 0) {
        return res.json({ users: [], total: count || 0, recent: recent || 0, directoryNotice, page, pageSize });
      }

      const uids = allUsers.map(u => u.uid);

      // Load access rows
      const { data: accessRows } = await adminDb.from('user_access')
        .select('uid, status, daily_limit, blocked_reason, note')
        .in('uid', uids);
      const accessMap = new Map((accessRows || []).map(a => [a.uid, a]));

      // Load today's and 30-day usage
      const today = istToday();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      const { data: dailyRows } = await adminDb.from('usage_daily')
        .select('uid, day, requests, errors, pages, input_tokens, output_tokens')
        .in('uid', uids)
        .gte('day', thirtyDaysAgo);

      const usageMap: Record<string, { today: number; thirtyDay: number }> = {};
      for (const r of dailyRows || []) {
        if (!usageMap[r.uid]) usageMap[r.uid] = { today: 0, thirtyDay: 0 };
        usageMap[r.uid].thirtyDay += r.requests;
        if (r.day === today) usageMap[r.uid].today += r.requests;
      }

      const users = allUsers.map(u => {
        const access = accessMap.get(u.uid);
        const usage = usageMap[u.uid] || { today: 0, thirtyDay: 0 };
        return {
          uid: u.uid,
          email: u.email,
          name: u.name,
          photo_url: u.photo_url,
          first_seen_at: u.first_seen_at,
          last_seen_at: u.last_seen_at,
          status: access?.status || 'active',
          daily_limit: access?.daily_limit ?? null,
          usageToday: usage.today,
          usage30d: usage.thirtyDay,
        };
      });

      // Client-side status filter (after loading since we need the access join)
      const filtered = statusFilter
        ? users.filter(u => u.status === statusFilter)
        : users;

      res.json({ users: filtered, total: count || 0, recent: recent || 0, directoryNotice, page, pageSize });
    } catch (err: any) {
      console.error('[admin/users]', err);
      res.status(500).json({ error: err?.message || 'Failed to load users.' });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/users/:uid
  // -----------------------------------------------------------------------
  app.get('/api/admin/users/:uid', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const uid = String(req.params.uid);

      // Profile
      const { data: user, error: profileError } = await adminDb.from('app_users')
        .select('*').eq('uid', uid).maybeSingle();
      if (profileError) throw profileError;
      if (!user) return res.status(404).json({ error: 'User not found.' });

      // Access
      const { data: access } = await adminDb.from('user_access')
        .select('*').eq('uid', uid).maybeSingle();

      // Daily series (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data: dailyRows } = await adminDb.from('usage_daily')
        .select('day, feature, engine, requests, errors, pages, input_tokens, output_tokens')
        .eq('uid', uid)
        .gte('day', thirtyDaysAgo)
        .order('day', { ascending: true });

      // Last 50 events
      const { data: events } = await adminDb.from('usage_events')
        .select('id, ts, feature, engine, provider, model, pages, input_tokens, output_tokens, duration_ms, status, error, source')
        .eq('uid', uid)
        .order('ts', { ascending: false })
        .limit(50);

      // Saved-work summary (from public.users tables — browser-written, not trusted)
      let savedWork = { historyCount: 0, mocktestCount: 0 };
      try {
        const { count: hCount } = await adminDb.from('user_history')
          .select('id', { count: 'exact', head: true }).eq('user_id', uid);
        const { count: mCount } = await adminDb.from('user_mocktests')
          .select('id', { count: 'exact', head: true }).eq('user_id', uid);
        savedWork = { historyCount: hCount || 0, mocktestCount: mCount || 0 };
      } catch {}

      // Audit entries for this user
      const { data: auditRows } = await adminDb.from('admin_audit')
        .select('*')
        .eq('target_uid', uid)
        .order('ts', { ascending: false })
        .limit(20);

      // Aggregate daily series
      const daySeries: Record<string, { requests: number; errors: number; pages: number; input_tokens: number; output_tokens: number }> = {};
      const featureSplit: Record<string, number> = {};

      for (const r of dailyRows || []) {
        const d = r.day;
        if (!daySeries[d]) daySeries[d] = { requests: 0, errors: 0, pages: 0, input_tokens: 0, output_tokens: 0 };
        daySeries[d].requests += r.requests;
        daySeries[d].errors += r.errors;
        daySeries[d].pages += r.pages;
        daySeries[d].input_tokens += Number(r.input_tokens);
        daySeries[d].output_tokens += Number(r.output_tokens);
        featureSplit[r.feature] = (featureSplit[r.feature] || 0) + r.requests;
      }

      res.json({
        user,
        access: access || { uid, status: 'active', daily_limit: null },
        daySeries: Object.entries(daySeries).map(([day, v]) => ({ day, ...v })),
        featureSplit: Object.entries(featureSplit).map(([feature, requests]) => ({ feature, requests })),
        events: events || [],
        savedWork,
        audit: auditRows || [],
      });
    } catch (err: any) {
      console.error('[admin/users/:uid]', err);
      res.status(500).json({ error: err?.message || 'Failed to load user.' });
    }
  });

  // -----------------------------------------------------------------------
  // PATCH /api/admin/users/:uid — set status, daily_limit, reason, note
  // -----------------------------------------------------------------------
  app.patch('/api/admin/users/:uid', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const admin: VerifiedUser = (res.locals as any).admin;
      const uid = String(req.params.uid);
      const { status, daily_limit, blocked_reason, note } = req.body;

      // Ensure app_users row exists
      const { data: existing } = await adminDb.from('app_users')
        .select('uid').eq('uid', uid).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'User not found.' });

      // Upsert user_access
      const update: Record<string, any> = { uid, updated_by: admin.email, updated_at: new Date().toISOString() };
      if (status !== undefined) update.status = status;
      if (daily_limit !== undefined) update.daily_limit = daily_limit;
      if (blocked_reason !== undefined) update.blocked_reason = blocked_reason;
      if (note !== undefined) update.note = note;

      await adminDb.from('user_access').upsert(update, { onConflict: 'uid' });

      // Write audit log
      await adminDb.from('admin_audit').insert({
        admin_uid: admin.uid,
        admin_email: admin.email,
        action: status === 'blocked' ? 'block_user' : status === 'active' ? 'unblock_user' : 'update_user',
        target_uid: uid,
        details: { status, daily_limit, blocked_reason, note },
      });

      // Invalidate the cached access for this user so changes take effect immediately
      invalidateAccessCache(uid);

      res.json({ success: true });
    } catch (err: any) {
      console.error('[admin/users/:uid PATCH]', err);
      res.status(500).json({ error: err?.message || 'Failed to update user.' });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/reports?from=&to=&groupBy=&format=json|csv
  // -----------------------------------------------------------------------
  app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
      const to = String(req.query.to || istToday());
      const groupBy = String(req.query.groupBy || 'day');
      const format = String(req.query.format || 'json');

      const { data: rows } = await adminDb.from('usage_daily')
        .select('day, uid, feature, engine, requests, errors, pages, input_tokens, output_tokens')
        .gte('day', from)
        .lte('day', to)
        .order('day', { ascending: true });

      if (!rows || rows.length === 0) {
        return format === 'csv'
          ? res.type('text/csv').send('No data')
          : res.json({ rows: [] });
      }

      // Group
      const grouped: Record<string, { requests: number; errors: number; pages: number; input_tokens: number; output_tokens: number }> = {};
      const keyFn = (r: any): string => {
        switch (groupBy) {
          case 'user': return r.uid;
          case 'feature': return r.feature;
          case 'engine': return r.engine;
          case 'model': return r.engine; // model not in daily table, use engine
          default: return r.day;
        }
      };

      for (const r of rows) {
        const k = keyFn(r);
        if (!grouped[k]) grouped[k] = { requests: 0, errors: 0, pages: 0, input_tokens: 0, output_tokens: 0 };
        grouped[k].requests += r.requests;
        grouped[k].errors += r.errors;
        grouped[k].pages += r.pages;
        grouped[k].input_tokens += Number(r.input_tokens);
        grouped[k].output_tokens += Number(r.output_tokens);
      }

      const result = Object.entries(grouped).map(([key, v]) => ({ [groupBy]: key, ...v }));

      if (format === 'csv') {
        const headers = [groupBy, 'requests', 'errors', 'pages', 'input_tokens', 'output_tokens'];
        const csvLines = [headers.join(',')];
        for (const row of result) {
          csvLines.push(headers.map(h => String((row as any)[h] ?? '')).join(','));
        }
        res.type('text/csv')
          .set('Content-Disposition', `attachment; filename="report-${from}-${to}.csv"`)
          .send(csvLines.join('\n'));
      } else {
        res.json({ rows: result, from, to, groupBy });
      }
    } catch (err: any) {
      console.error('[admin/reports]', err);
      res.status(500).json({ error: err?.message || 'Failed to generate report.' });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/activity?uid=&feature=&status=&cursor=&limit=
  // -----------------------------------------------------------------------
  app.get('/api/admin/activity', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      let query = adminDb.from('usage_events')
        .select('id, ts, uid, feature, engine, provider, model, pages, input_tokens, output_tokens, duration_ms, status, error, source')
        .order('ts', { ascending: false })
        .limit(limit);

      if (req.query.uid) query = query.eq('uid', String(req.query.uid));
      if (req.query.feature) query = query.eq('feature', String(req.query.feature));
      if (req.query.status) query = query.eq('status', String(req.query.status));
      if (req.query.cursor) query = query.lt('id', Number(req.query.cursor));

      const { data: events } = await query;

      // Look up user names for the uid values
      const uids = [...new Set((events || []).map(e => e.uid))];
      let nameMap = new Map<string, string>();
      if (uids.length) {
        const { data: users } = await adminDb.from('app_users')
          .select('uid, name, email').in('uid', uids);
        nameMap = new Map((users || []).map(u => [u.uid, u.name || u.email || u.uid]));
      }

      const enriched = (events || []).map(e => ({
        ...e,
        userName: nameMap.get(e.uid) || e.uid,
      }));

      const nextCursor = enriched.length === limit ? enriched[enriched.length - 1].id : null;

      res.json({ events: enriched, nextCursor });
    } catch (err: any) {
      console.error('[admin/activity]', err);
      res.status(500).json({ error: err?.message || 'Failed to load activity.' });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/audit?limit=&cursor=
  // -----------------------------------------------------------------------
  app.get('/api/admin/audit', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      let query = adminDb.from('admin_audit')
        .select('*')
        .order('ts', { ascending: false })
        .limit(limit);

      if (req.query.cursor) query = query.lt('id', Number(req.query.cursor));

      const { data: entries } = await query;
      const nextCursor = (entries || []).length === limit ? entries![entries!.length - 1].id : null;

      res.json({ entries: entries || [], nextCursor });
    } catch (err: any) {
      console.error('[admin/audit]', err);
      res.status(500).json({ error: err?.message || 'Failed to load audit log.' });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/settings
  // -----------------------------------------------------------------------
  app.get('/api/admin/settings', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const { data: rows } = await adminDb.from('app_settings').select('key, value');
      const settings: Record<string, any> = {};
      for (const r of rows || []) settings[r.key] = r.value;
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load settings.' });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/admin/settings
  // -----------------------------------------------------------------------
  app.put('/api/admin/settings', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    try {
      const admin: VerifiedUser = (res.locals as any).admin;
      const { default_daily_limit, retention_days } = req.body;

      if (default_daily_limit !== undefined) {
        const val = default_daily_limit === null ? null : Number(default_daily_limit);
        await adminDb.from('app_settings').upsert({ key: 'default_daily_limit', value: val });
      }
      if (retention_days !== undefined) {
        await adminDb.from('app_settings').upsert({ key: 'retention_days', value: Number(retention_days) || 90 });
      }

      // Audit
      await adminDb.from('admin_audit').insert({
        admin_uid: admin.uid,
        admin_email: admin.email,
        action: 'update_settings',
        details: req.body,
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to update settings.' });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/admin/purge — 90-day event purge (at most once/day)
  // -----------------------------------------------------------------------
  let lastPurge = 0;
  app.post('/api/admin/purge', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'DB not configured.' });
    const now = Date.now();
    if (now - lastPurge < 86400000) {
      return res.json({ purged: 0, message: 'Already purged today.' });
    }
    try {
      // Get retention days from settings
      const { data: setting } = await adminDb.from('app_settings')
        .select('value').eq('key', 'retention_days').maybeSingle();
      const retentionDays = Number(setting?.value) || 90;
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 10);

      const { count } = await adminDb.from('usage_events')
        .delete({ count: 'exact' })
        .lt('day', cutoff);

      lastPurge = now;
      res.json({ purged: count || 0, cutoff, retentionDays });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Purge failed.' });
    }
  });
}
