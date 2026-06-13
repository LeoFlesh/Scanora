import { httpError, normalizeItem, setCors, supabaseClient } from './_shared.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = supabaseClient();

  try {
    if (req.method === 'GET') {
      const householdId = String(req.query?.household_id || '').trim();
      if (!householdId) return res.status(400).json({ error: 'household_id required' });

      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('household_id', householdId)
        .order('category', { ascending: true })
        .order('added_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const householdId = String(req.body?.household_id || '').trim();
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!householdId) return res.status(400).json({ error: 'household_id required' });
      if (!items.length) return res.status(400).json({ error: 'items required' });

      const rows = items
        .map((item) => normalizeItem({ ...item, household_id: householdId }))
        .filter((item) => item.name);

      if (!rows.length) return res.status(400).json({ error: 'No valid items supplied' });

      const { data, error } = await supabase
        .from('inventory_items')
        .insert(rows)
        .select('*');

      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });

      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return httpError(res, 500, error);
  }
}
