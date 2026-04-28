// VISIONARY — AI Suggest Edge Function
// Calls Anthropic Claude API to generate task suggestions

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle browser preflight CORS check
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse what the frontend sent us
    const { mode, tasks, history, currentHour } = await req.json();

    let prompt = "";

    if (mode === "next-action") {
      // Mode 1: Suggest the single next best action
      const incomplete = (tasks || []).filter((t: any) => !t.completed);
      const completed = (tasks || []).filter((t: any) => t.completed);

      prompt = `You are a thoughtful productivity coach helping a user stay consistent with their daily routine. Respond with ONLY the suggestion text — no JSON, no labels, no preamble, no Markdown formatting (no asterisks, no bold).

It's currently ${currentHour}:00.

Today's INCOMPLETE tasks:
${incomplete.length > 0 ? incomplete.map((t: any) => `- "${t.text}" [${t.category}]${t.scheduledHour !== null ? ` (scheduled ${t.scheduledHour}:00)` : ""}`).join("\n") : "(none)"}

Already COMPLETED today:
${completed.length > 0 ? completed.map((t: any) => `- "${t.text}" [${t.category}]`).join("\n") : "(none)"}

Recent history (last few days):
${(history || []).slice(0, 3).map((h: any) => `- ${h.date}: completed ${h.completed}/${h.total} (energy ${h.energy}/10, focus ${h.focus}/10)`).join("\n") || "(no history yet)"}

Suggest the SINGLE next best action for this user right now. Be brief (max 2 sentences), warm, and direct. Reference a specific task by name. If they've completed everything, encourage them to rest or reflect.

Respond with ONLY the suggestion text — no JSON, no labels, no preamble.`;
    } else if (mode === "insight") {
      // Mode 2: End-of-day insight
      const recent = (history || []).slice(0, 7);
      prompt = `You are a thoughtful productivity coach. Below is the user's recent reflection history.

${recent.map((h: any) => `${h.date}: ${h.completed}/${h.total} tasks, energy ${h.energy}/10, focus ${h.focus}/10${h.note ? ` — note: "${h.note}"` : ""}`).join("\n")}

Write ONE specific, encouraging insight (max 2 sentences) that reflects a pattern you noticed. Be warm and specific — not generic. If there's only one day of data, focus on celebrating the start. Respond with ONLY the insight text. No Markdown formatting (no asterisks, no bold, plain prose only)..`;
    } else {
      return new Response(
        JSON.stringify({ error: "Unknown mode" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Anthropic Claude API
    const claudeResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI service unavailable", detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await claudeResponse.json();
    const suggestion = data.content?.[0]?.text || "Couldn't generate a suggestion.";

    return new Response(
      JSON.stringify({ suggestion }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});