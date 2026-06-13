import { createHash } from 'crypto';
import { httpError, setCors, supabaseClient } from './_shared.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const householdId = String(req.query?.household_id || '').trim();
  if (!householdId) return res.status(400).json({ error: 'household_id required' });

  const supabase = supabaseClient();

  try {
    const { data: items, error: inventoryError } = await supabase
      .from('inventory_items')
      .select('name')
      .eq('household_id', householdId);

    if (inventoryError) throw inventoryError;

    const ingredients = [...new Set((items || []).map((item) => item.name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    if (!ingredients.length) return res.status(200).json([]);

    const ingredientString = ingredients.join(',');
    const ingredientHash = createHash('md5').update(ingredientString).digest('hex');

    const { data: cached } = await supabase
      .from('recipe_cache')
      .select('recipes_json')
      .eq('ingredient_hash', ingredientHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached?.recipes_json) return res.status(200).json(cached.recipes_json);

    const params = new URLSearchParams({
      ingredients: ingredientString,
      number: '20',
      ranking: '1',
      ignorePantry: 'true',
      apiKey: process.env.SPOONACULAR_API_KEY
    });

    const response = await fetch(`https://api.spoonacular.com/recipes/findByIngredients?${params}`);
    const recipes = await response.json();
    if (!response.ok) {
      const detail = recipes?.message || `${response.status} ${response.statusText}`;
      return res.status(response.status).json({ error: detail });
    }

    await supabase.from('recipe_cache').upsert({
      ingredient_hash: ingredientHash,
      recipes_json: recipes,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });

    return res.status(200).json(recipes);
  } catch (error) {
    return httpError(res, 500, error);
  }
}
