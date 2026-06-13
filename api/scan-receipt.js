import Anthropic from '@anthropic-ai/sdk';
import { setCors, supabaseClient } from './_shared.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = supabaseClient();

const TOOLS = [
  {
    name: 'finalize_receipt_items',
    description: 'Submit the complete list of extracted, normalized, and categorized food items from this receipt. Call this once you have processed all items.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: "Clean normalized name e.g. 'chicken breast' not 'CHKN BRST'" },
              quantity: { type: 'number', default: 1 },
              unit: { type: 'string', default: '' },
              category: { type: 'string', enum: ['fridge', 'pantry', 'freezer'] },
              confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Flag under 0.7 as ambiguous' },
              raw_text: { type: 'string', description: 'Original text from receipt' }
            },
            required: ['name', 'category', 'confidence', 'raw_text']
          }
        },
        filtered_out: {
          type: 'array',
          items: { type: 'string' },
          description: 'Non-food items that were excluded (paper towels, soap, etc.)'
        }
      },
      required: ['items', 'filtered_out']
    }
  }
];

const SYSTEM_PROMPT = `You are Scanora's receipt scanning agent. Analyze grocery receipts and extract food items.

For each item on the receipt:
- Normalize abbreviations: CHKN BRST -> chicken breast, WHL MLK 1GAL -> whole milk (1 gallon), ORG BNLS -> organic boneless
- Assign category: fridge (dairy, deli, produce, eggs), pantry (canned, dry goods, oils, spices), freezer (frozen items)
- Extract quantity and unit from the receipt line where possible
- Set confidence 0-1. Flag anything under 0.7 (ambiguous abbreviations, unclear items)
- Filter out ALL non-food items (cleaning products, paper goods, personal care, batteries, etc.)

When you have processed all items, call finalize_receipt_items with the complete results.`;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image_base64: imageBase64, media_type: mediaType = 'image/jpeg', household_id: householdId } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'image_base64 required' });

  const startTime = Date.now();
  const agentSteps = [];
  let finalResult = null;

  try {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Please scan this grocery receipt and extract all food items using the finalize_receipt_items tool.' }
        ]
      }
    ];

    for (let turn = 0; turn < 4 && !finalResult; turn += 1) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages
      });

      agentSteps.push({
        step: agentSteps.length + 1,
        stop_reason: response.stop_reason,
        content_types: response.content.map((block) => block.type)
      });

      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        if (block.name === 'finalize_receipt_items') {
          finalResult = block.input;
          agentSteps.push({
            step: agentSteps.length + 1,
            tool: 'finalize_receipt_items',
            items_extracted: block.input.items?.length || 0,
            items_filtered: block.input.filtered_out?.length || 0,
            ambiguous_count: (block.input.items || []).filter((item) => Number(item.confidence) < 0.7).length
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ success: true })
          });
        }
      }

      if (toolResults.length) messages.push({ role: 'user', content: toolResults });
    }

    const duration = Date.now() - startTime;

    if (householdId) {
      await supabase.from('agent_logs').insert({
        household_id: householdId,
        agent_type: 'receipt_scanner',
        tool_calls_json: agentSteps,
        final_output_json: finalResult,
        duration_ms: duration
      });
    }

    return res.status(200).json({
      success: true,
      items: finalResult?.items || [],
      filtered_out: finalResult?.filtered_out || [],
      agent_steps: agentSteps,
      duration_ms: duration
    });
  } catch (error) {
    console.error('Receipt agent error:', error);
    return res.status(500).json({ error: error.message });
  }
}
