import { httpError, setCors, supabaseClient } from './_shared.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = supabaseClient();

  try {
    if (req.method === 'POST') {
      const name = String(req.body?.name || 'My Household').trim() || 'My Household';
      const { data, error } = await supabase
        .from('households')
        .insert({ name })
        .select('id, invite_code, name, created_at')
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'GET') {
      const inviteCode = String(req.query?.invite_code || '').trim().toUpperCase();

      if (inviteCode) {
        const { data, error } = await supabase
          .from('households')
          .select('id, invite_code, name, created_at')
          .eq('invite_code', inviteCode)
          .single();

        if (error || !data) return res.status(404).json({ error: 'Household not found' });
        return res.status(200).json(data);
      }

      return res.status(200).json({ ok: true, connected: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return httpError(res, 500, error);
  }
}
