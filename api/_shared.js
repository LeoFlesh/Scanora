import { createClient } from '@supabase/supabase-js';

export function setCors(res, methods = 'GET, POST, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function supabaseClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export function normalizeItem(item) {
  return {
    household_id: item.household_id,
    name: String(item.name || '').trim(),
    quantity: Number(item.quantity) || 1,
    unit: String(item.unit || '').trim(),
    category: ['fridge', 'pantry', 'freezer'].includes(item.category) ? item.category : 'fridge'
  };
}

export function httpError(res, status, error) {
  return res.status(status).json({ error: error?.message || error || 'Unexpected error' });
}
