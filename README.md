# Scanora

**Grocery inventory management + AI-powered recipe suggestions and meal planning**

Scanora helps college students and young adults figure out what to cook based on what they already have. Scan a grocery receipt, build a digital fridge inventory, get recipe suggestions color-coded by feasibility, and let the Scanora AI Agent autonomously plan your entire week of dinners.

---

## Live Demo

[https://scanora.vercel.app](https://scanora.vercel.app)

---

## The Problem

The gap between "I have random stuff in my fridge" and "I know what to cook tonight" is a real daily frustration. Every existing app (Supercook, Fridge Pal, NoWaste) has failed to solve this elegantly because they require manual inventory management that users abandon within a week. Scanora solves this with AI-powered receipt scanning and an autonomous meal planning agent that reads your real inventory and makes decisions — not just API calls.

---

## Features

- **Receipt Scanning Agent** — photograph a grocery receipt and the AI agent extracts, normalizes, and categorizes every food item (CHKN BRST → chicken breast, automatically sorted into fridge/pantry/freezer)
- **Green / Yellow / Red recipe matching** — instantly see what you can make right now (Ready ✓), almost make (Almost), or need more ingredients for (Missing X items)
- **Weekly Meal Planning Agent** — autonomous multi-step AI agent that reads your inventory, searches recipes, evaluates candidates, reasons about variety and feasibility, and builds a complete 7-day plan with a unified shopping list
- **Household sharing** — share an invite code with roommates; anyone who scans a receipt updates everyone's inventory
- **Agent Reasoning Log** — every tool call the AI agent makes is logged and displayed in the UI, showing the decision trail

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML / CSS / JavaScript | Single-file UI, no framework |
| Backend | Vercel Serverless Functions (Node.js) | API proxy, agent orchestration |
| Database | Supabase (PostgreSQL) | Persistent inventory, caching, logs |
| AI | Anthropic Claude claude-sonnet-4-6 | Receipt scanning + meal planning agents |
| Recipes | Spoonacular API | Recipe search and matching |

---

## Project Structure

```
scanora/
├── api/                    ← Vercel serverless functions (the backend)
│   ├── _shared.js          ← Shared utilities: CORS headers, Supabase client
│   ├── household.js        ← POST/GET: create or join a household
│   ├── inventory.js        ← GET/POST/DELETE: inventory item CRUD
│   ├── meal-plan.js        ← POST: Meal Planning AI Agent (multi-step tool use)
│   ├── recipes.js          ← GET: Spoonacular proxy with 24hr Supabase cache
│   └── scan-receipt.js     ← POST: Receipt Scanning AI Agent (Claude Vision)
├── public/
│   └── index.html          ← Entire frontend (HTML + CSS + JS, ~1800 lines)
├── .gitignore              ← Excludes node_modules, secrets
├── package.json            ← Node.js dependencies
├── supabase-schema.sql     ← Database schema (run once in Supabase SQL editor)
└── vercel.json             ← Vercel routing: /api/* → functions, /* → index.html
```

### What each file does

**`api/_shared.js`**
Exports three utilities used by every API file: `setCors()` sets the CORS headers that allow the browser to call the API, `supabaseClient()` initializes the Supabase database connection using environment variables, and `normalizeItem()` sanitizes inventory item data before saving.

**`api/household.js`**
Manages the household concept — a shared inventory space for roommates. `POST /api/household` creates a new household with a random invite code. `GET /api/household?invite_code=XXXX` looks up an existing household. The household ID is stored in the browser's localStorage so it persists across sessions.

**`api/inventory.js`**
CRUD operations for inventory items. `GET /api/inventory?household_id=UUID` returns all items for a household. `POST /api/inventory` inserts one or more items. `DELETE /api/inventory?id=UUID` removes a single item. All items are stored under `household_id` rather than `user_id` so roommates share the same inventory automatically.

**`api/recipes.js`**
Proxies requests to Spoonacular's `findByIngredients` endpoint. Before calling Spoonacular, it hashes the ingredient string and checks the `recipe_cache` table in Supabase. If a valid cached result exists (under 24 hours old), it returns that without making an API call. This prevents burning Spoonacular's free-tier points (150/day) on every page load.

**`api/scan-receipt.js`** — AI Agent 1
The Receipt Scanning Agent. Uses Claude claude-sonnet-4-6 with the Anthropic tool_use API. Claude receives the receipt image (base64) along with a single tool definition (`finalize_receipt_items`). Claude analyzes the image, normalizes abbreviations, assigns fridge/pantry/freezer categories, sets confidence scores, filters non-food items, then calls the tool with a structured JSON array. The system receives this structured output and returns it to the frontend for user confirmation.

**`api/meal-plan.js`** — AI Agent 2
The Meal Planning Agent. Uses Claude claude-sonnet-4-6 with four tools in a multi-turn agentic loop (up to 12 turns). Claude autonomously calls `get_inventory()` → `search_recipes()` → `get_recipe_details()` (multiple times) → `finalize_meal_plan()`. At each step, Claude reads real data, evaluates options, and decides what to do next. The system executes each tool call (Supabase queries, Spoonacular API calls), returns results to Claude, and continues until Claude calls `finalize_meal_plan` with a complete 7-day plan and shopping list.

**`public/index.html`**
The entire frontend in one file. Handles: household setup, manual inventory entry, receipt upload, recipe display with green/yellow/red cards, the meal planning UI with animated agent step display, shopping list grouped by category, and toast notifications. All API calls go to `/api/*` routes on the same Vercel deployment.

**`supabase-schema.sql`**
The SQL to run once in the Supabase SQL Editor to create all five tables.

**`vercel.json`**
Two routing rules: requests to `/api/*` go to the serverless functions in the `api/` folder; everything else serves `public/index.html`.

---

## AI Agent Architecture

### Why this is agentic (not just an API call)

A single API call sends a prompt and receives a response. An agent uses **tool use** — the model decides which tools to call, in what order, based on what it finds at each step. Claude is not following a script; it is making decisions.

### Agent 1: Receipt Scanning Agent

```
Input: base64 grocery receipt image
↓
Claude claude-sonnet-4-6 (Vision) receives image + tool definition
↓
Claude analyzes image, normalizes items, decides on categories
↓
Claude calls: finalize_receipt_items({ items: [...], filtered_out: [...] })
↓
System receives structured JSON, logs to Supabase agent_logs
↓
Output: categorized items with confidence scores for user review
```

**Tool defined:**
```javascript
finalize_receipt_items({
  items: [{ name, quantity, unit, category, confidence, raw_text }],
  filtered_out: ["paper towels", "shampoo", ...]
})
```

Claude decides what counts as food, how to normalize abbreviations, which section each item belongs in, and which items to flag as ambiguous (confidence < 0.7).

### Agent 2: Meal Planning Agent

```
Input: household_id
↓
Turn 1: Claude calls get_inventory() → reads 15 items from Supabase
Turn 2: Claude calls search_recipes(["chicken", "sweet potato", ...]) → 12 Spoonacular results
Turn 3: Claude calls search_recipes([...], ranking=2) → 12 more results
Turn 4-11: Claude calls get_recipe_details(recipe_id) × 8 times → evaluates each candidate
Turn 12: Claude calls finalize_meal_plan({ plan: [...7 days...], shopping_list: [...] })
↓
System saves meal plan to Supabase, logs all tool calls
↓
Output: 7-day plan with reasoning per day + unified grouped shopping list
```

**Tools available to Claude:**
- `get_inventory()` — real Supabase query, returns current household items
- `search_recipes({ ingredients, number, ranking })` — Spoonacular API call, cached
- `get_recipe_details({ recipe_id })` — Spoonacular API call for full ingredient list
- `finalize_meal_plan({ plan, shopping_list, summary })` — saves and returns the plan

**Why this requires multiple turns:** Claude cannot know which 7 recipes to select without first seeing what's available. It searches, evaluates, and makes qualitative judgments (variety, protein rotation, cuisine diversity) across multiple tool calls. This is not achievable in a single API call.

---

## Database Schema (Supabase)

```sql
households         -- id, invite_code, name, created_at
inventory_items    -- id, household_id, name, quantity, unit, category, added_at
recipe_cache       -- id, ingredient_hash, recipes_json, expires_at
meal_plans         -- id, household_id, plan_json, shopping_list_json, created_at
agent_logs         -- id, household_id, agent_type, tool_calls_json, duration_ms, created_at
```

The `agent_logs` table stores every tool call made by both agents, including input summaries and output summaries. This provides full transparency into the agent's decision trail and is displayed in the UI's "Agent Reasoning Log" panel.

---

## Setup & Deployment

### Prerequisites
- Node.js 18+
- Vercel account (free)
- Supabase account (free)
- Anthropic API key
- Spoonacular API key

### 1. Clone and install
```bash
git clone https://github.com/your-username/scanora.git
cd scanora
npm install
```

### 2. Set up Supabase
1. Create a new Supabase project at supabase.com
2. Go to SQL Editor → New Query
3. Paste and run the contents of `supabase-schema.sql`
4. Go to Project Settings → API → copy your Project URL and service_role key

### 3. Deploy to Vercel
```bash
npm install -g vercel
vercel login
vercel
```

In the Vercel dashboard → Settings → Environment Variables, add:
```
ANTHROPIC_API_KEY       = sk-ant-...
SPOONACULAR_API_KEY     = your-key
SUPABASE_URL            = https://xxxx.supabase.co
SUPABASE_SERVICE_KEY    = eyJ...
```

Then redeploy:
```bash
vercel --prod
```

### 4. Use the app
1. Open your Vercel deployment URL
2. Click **Start** to create a household
3. Add items manually or click **Upload Receipt** to scan a grocery receipt
4. Click **Refresh Recipes** to see what you can make
5. Go to the Recipes tab and click **Plan My Week with AI**

---

## Dependencies (package.json)

This project uses Node.js, not Python. The equivalent of `requirements.txt` is `package.json`.

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.20.0",
    "@supabase/supabase-js": "^2.39.0",
    "node-fetch": "^3.3.0"
  }
}
```

Run `npm install` to install all dependencies.

---

## API Keys & Security

**No API keys are stored in this repository.** All secrets are stored exclusively in Vercel's Environment Variables dashboard and injected at runtime into serverless functions. The frontend (browser) never sees any API key — it only calls `/api/*` routes on the same domain, which are server-side functions that make the actual external API calls.

---

## Key Design Decisions

**Why Vercel serverless instead of a traditional server?**
Vercel's free tier handles up to 100,000 function invocations/month. There is no always-on server to pay for. Each API file becomes its own endpoint automatically. For a project at this scale, it's the right tradeoff between cost and capability.

**Why Supabase instead of localStorage?**
V1 used localStorage — data was lost on cache clear, couldn't be shared between devices or roommates, and the browser had to hold API keys. Supabase gives a real PostgreSQL database with a generous free tier (50k users), and the `household_id` data model means roommate sharing required no restructuring.

**Why Claude tool_use instead of prompt engineering?**
Prompt engineering ("respond with JSON in this format") produces unreliable structured output. The tool_use API enforces the schema — Claude cannot return malformed data. It also enables the multi-turn agentic loop where Claude makes real decisions between turns, which is architecturally impossible with a single prompt.

**Why Spoonacular instead of building a recipe database?**
Spoonacular has 360,000 recipes and handles ingredient synonyms and fuzzy matching invisibly. Building this in V1/V2 would add weeks of engineering for no additional user-facing value. The dependency is mitigated by server-side caching. The V3 roadmap migrates to an owned recipe database with pgvector semantic matching.

**Why household_id instead of user_id on inventory items?**
Storing inventory under `household_id` from day one means roommate sharing is a free unlock — no database restructure required. A user who joins a household immediately sees and contributes to the shared inventory.

---

## Roadmap

| Version | Focus |
|---|---|
| V1 / V1.5 ✅ | Working prototype, localStorage, Spoonacular integration |
| V2 / V-C ✅ | Vercel backend, Supabase, working AI agents, household sharing |
| V3 | Own recipe database (TheMealDB + Claude-generated), pgvector semantic matching |
| V4 | iOS App Store launch (React Native / Expo, Sign in with Apple) |
| V5 | Gamification: Tinder-style fridge check, streaks, waste score |

---

## Author

Leo — Cal Poly MSBA 2025-26
