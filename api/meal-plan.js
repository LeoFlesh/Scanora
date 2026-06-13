import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { setCors, supabaseClient } from './_shared.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = supabaseClient();

const TOOLS = [
  {
    name: 'get_inventory',
    description: 'Retrieve the current fridge, pantry, and freezer inventory for this household.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'search_recipes',
    description: 'Search for recipes based on a list of ingredients. Returns recipes ranked by ingredient match.',
    input_schema: {
      type: 'object',
      properties: {
        ingredients: { type: 'array', items: { type: 'string' }, description: 'Ingredient names to search for' },
        number: { type: 'integer', default: 12, description: 'Number of recipes to return' },
        ranking: { type: 'integer', enum: [1, 2], description: '1 = maximize used ingredients, 2 = minimize missing' }
      },
      required: ['ingredients']
    }
  },
  {
    name: 'get_recipe_details',
    description: 'Get the full ingredient list for a specific recipe to check exactly what is needed.',
    input_schema: {
      type: 'object',
      properties: { recipe_id: { type: 'integer' } },
      required: ['recipe_id']
    }
  },
  {
    name: 'finalize_meal_plan',
    description: 'Submit the complete 7-day meal plan once you have selected the best recipes.',
    input_schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'array',
          minItems: 7,
          maxItems: 7,
          items: {
            type: 'object',
            properties: {
              day: { type: 'string', enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
              recipe_id: { type: 'integer' },
              recipe_name: { type: 'string' },
              recipe_image: { type: 'string' },
              feasibility: { type: 'string', enum: ['green', 'yellow', 'red'] },
              missing_ingredients: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string', description: '1-2 sentences explaining why this meal fits this day' }
            },
            required: ['day', 'recipe_name', 'feasibility', 'missing_ingredients', 'reasoning']
          }
        },
        shopping_list: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ingredient: { type: 'string' },
              category: {
                type: 'string',
                enum: ['produce', 'meat', 'dairy', 'pantry', 'other'],
                description: 'Grocery store category for this ingredient'
              },
              needed_for_recipes: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        summary: { type: 'string', description: "2-3 sentence overview of the week's plan" }
      },
      required: ['plan', 'shopping_list', 'summary']
    }
  }
];

const SYSTEM_PROMPT = `You are Scanora's meal planning agent. Your job is to build a practical 7-day dinner plan.

Follow this strategy:
1. Call get_inventory() to see what ingredients are available
2. Call search_recipes() with the main ingredients - get 12 candidates
3. Call get_recipe_details() on 8-10 of the most promising ones to check exact ingredient overlap
4. Select 7 recipes that together:
   - Prioritize green recipes (fully achievable now) for weeknights
   - Allow 1-3 yellow recipes (small shop needed) for variety
   - Avoid repeating the same protein on back-to-back days
   - Mix cuisines and cooking styles across the week
5. Deduplicate the shopping list across all 7 recipes
6. Call finalize_meal_plan with your complete selection

Be decisive. Reason through trade-offs. The reasoning field for each day should explain your choice briefly.`;

async function executeTool(toolName, toolInput, householdId) {
  switch (toolName) {
    case 'get_inventory': {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('household_id', householdId);
      if (error) throw error;
      return data || [];
    }

    case 'search_recipes': {
      const { ingredients = [], number = 12, ranking = 1 } = toolInput;
      const ingredientStr = ingredients.filter(Boolean).join(',');
      const hash = createHash('md5').update(`${ingredientStr}:${ranking}:${number}`).digest('hex');

      const { data: cached } = await supabase
        .from('recipe_cache')
        .select('recipes_json')
        .eq('ingredient_hash', hash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (cached?.recipes_json) return cached.recipes_json;

      const params = new URLSearchParams({
        ingredients: ingredientStr,
        number: String(number),
        ranking: String(ranking),
        ignorePantry: 'true',
        apiKey: process.env.SPOONACULAR_API_KEY
      });

      const resp = await fetch(`https://api.spoonacular.com/recipes/findByIngredients?${params}`);
      const recipes = await resp.json();
      if (!resp.ok) throw new Error(recipes?.message || `Spoonacular search failed: ${resp.status}`);

      await supabase.from('recipe_cache').upsert({
        ingredient_hash: hash,
        recipes_json: recipes,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

      return recipes;
    }

    case 'get_recipe_details': {
      const params = new URLSearchParams({ apiKey: process.env.SPOONACULAR_API_KEY });
      const resp = await fetch(`https://api.spoonacular.com/recipes/${toolInput.recipe_id}/information?${params}`);
      const details = await resp.json();
      if (!resp.ok) throw new Error(details?.message || `Spoonacular detail failed: ${resp.status}`);
      return details;
    }

    default:
      return { error: 'Unknown tool' };
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { household_id: householdId, user_message: userMessage = 'Plan my dinners for the week based on what I have.' } = req.body || {};
  if (!householdId) return res.status(400).json({ error: 'household_id required' });

  const startTime = Date.now();
  const agentSteps = [];
  let finalPlan = null;

  try {
    const messages = [{ role: 'user', content: userMessage }];

    for (let turn = 0; turn < 12 && !finalPlan; turn += 1) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages
      });

      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const stepLog = {
          step: agentSteps.length + 1,
          tool: block.name,
          input_summary: summarizeInput(block.name, block.input)
        };

        let result;
        if (block.name === 'finalize_meal_plan') {
          finalPlan = block.input;
          result = { success: true };
          stepLog.output_summary = `Meal plan finalized: ${block.input.plan?.length || 0} days, ${block.input.shopping_list?.length || 0} items to buy`;
        } else {
          result = await executeTool(block.name, block.input || {}, householdId);
          stepLog.output_summary = summarizeOutput(block.name, result);
        }

        agentSteps.push(stepLog);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    const duration = Date.now() - startTime;

    if (finalPlan) {
      await supabase.from('meal_plans').insert({
        household_id: householdId,
        plan_json: finalPlan.plan,
        shopping_list_json: finalPlan.shopping_list
      });
      await supabase.from('agent_logs').insert({
        household_id: householdId,
        agent_type: 'meal_planner',
        tool_calls_json: agentSteps,
        final_output_json: finalPlan,
        duration_ms: duration
      });
    }

    return res.status(200).json({
      success: true,
      plan: finalPlan?.plan || [],
      shopping_list: finalPlan?.shopping_list || [],
      summary: finalPlan?.summary || '',
      agent_steps: agentSteps,
      duration_ms: duration
    });
  } catch (error) {
    console.error('Meal plan agent error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function summarizeInput(toolName, input = {}) {
  switch (toolName) {
    case 'get_inventory':
      return 'Fetching current inventory';
    case 'search_recipes':
      return `Searching with ${input.ingredients?.length || 0} ingredients (ranking: ${input.ranking === 2 ? 'minimize missing' : 'maximize used'})`;
    case 'get_recipe_details':
      return `Getting full details for recipe #${input.recipe_id}`;
    case 'finalize_meal_plan':
      return `Finalizing ${input.plan?.length || 0}-day plan`;
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

function summarizeOutput(toolName, output) {
  switch (toolName) {
    case 'get_inventory':
      return `Found ${output.length} inventory items`;
    case 'search_recipes':
      return `Found ${output.length} recipe matches`;
    case 'get_recipe_details':
      return `Recipe: ${output.title || 'Untitled'}, ${output.extendedIngredients?.length || 0} ingredients`;
    default:
      return 'Done';
  }
}
