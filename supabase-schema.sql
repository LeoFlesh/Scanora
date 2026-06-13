CREATE TABLE households (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_code TEXT UNIQUE DEFAULT upper(substr(md5(random()::text), 0, 7)),
  name TEXT DEFAULT 'My Household',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity NUMERIC DEFAULT 1,
  unit TEXT DEFAULT '',
  category TEXT CHECK (category IN ('fridge', 'pantry', 'freezer')) DEFAULT 'fridge',
  added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recipe_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient_hash TEXT UNIQUE NOT NULL,
  recipes_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE TABLE meal_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  plan_json JSONB NOT NULL,
  shopping_list_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID,
  agent_type TEXT NOT NULL,
  tool_calls_json JSONB DEFAULT '[]',
  final_output_json JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
