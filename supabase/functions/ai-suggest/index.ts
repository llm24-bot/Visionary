// VISIONARY — AI Suggest Edge Function
// Supports:
// - next-action
// - insight
// - schedule-import

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "API key not configured" }, 500);
    }

    const body = await req.json();
    const mode = body.mode;
    const payload = body.payload ?? {};
    const tasks = payload.tasks ?? body.tasks ?? [];
    const history = payload.history ?? body.history ?? [];
    const currentHour = payload.currentHour ?? body.currentHour ?? new Date().getHours();

    if (mode === "next-action") {
      const incomplete = (tasks || []).filter((t: any) => !t.completed);
      const completed = (tasks || []).filter((t: any) => t.completed);

      const prompt = `You are a thoughtful productivity coach helping a user stay consistent with their daily routine. Respond with ONLY the suggestion text — no JSON, no labels, no preamble, no Markdown formatting.

It's currently ${currentHour}:00.

Today's INCOMPLETE tasks:
${incomplete.length > 0 ? incomplete.map((t: any) => `- "${t.text}" [${t.category}]${t.scheduledHour !== null ? ` (scheduled ${t.scheduledHour}:00)` : ""}`).join("\n") : "(none)"}

Already COMPLETED today:
${completed.length > 0 ? completed.map((t: any) => `- "${t.text}" [${t.category}]`).join("\n") : "(none)"}

Recent history (last few days):
${(history || []).slice(0, 3).map((h: any) => `- ${h.date}: completed ${h.completed}/${h.total} (energy ${h.energy}/10, focus ${h.focus}/10)`).join("\n") || "(no history yet)"}

Suggest the SINGLE next best action for this user right now. Be brief (max 2 sentences), warm, and direct. Reference a specific task by name. If they've completed everything, encourage them to rest or reflect.

Respond with ONLY the suggestion text.`;

      const data = await callAnthropic(apiKey, [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ]);

      const suggestion = extractText(data) || "Couldn't generate a suggestion.";
      return jsonResponse({ suggestion }, 200);
    }

    if (mode === "insight") {
      const recent = (history || []).slice(0, 7);

      const prompt = `You are a thoughtful productivity coach. Below is the user's recent reflection history.

${recent.map((h: any) => `${h.date}: ${h.completed}/${h.total} tasks, energy ${h.energy}/10, focus ${h.focus}/10${h.note ? ` — note: "${h.note}"` : ""}`).join("\n")}

Write ONE specific, encouraging insight (max 2 sentences) that reflects a pattern you noticed. Be warm and specific — not generic. If there's only one day of data, focus on celebrating the start. Respond with ONLY the insight text. No Markdown formatting.`;

      const data = await callAnthropic(apiKey, [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ]);

      const suggestion = extractText(data) || "Couldn't generate an insight.";
      return jsonResponse({ suggestion }, 200);
    }

    if (mode === "schedule-import") {
      const image = payload.image;
      const mimeType = payload.mimeType || "image/jpeg";
      const date = payload.date;
      const timezone = payload.timezone || "UTC";

      if (!image) {
        return jsonResponse({ error: "Missing image payload" }, 400);
      }

      const prompt = `You extract schedule items from uploaded schedule screenshots or planner photos.

Return ONLY valid JSON in this exact shape:
{
  "tasks": [
    {
      "text": "string",
      "category": "focus|health|learn|build|rest",
      "scheduledHour": 0-23 or null
    }
  ],
  "message": "short summary"
}

Rules:
- Keep task text concise and actionable.
- Convert visible times into a 24-hour integer scheduledHour when the image clearly implies an hour.
- If time is unclear, use null.
- Use only these categories: focus, health, learn, build, rest.
- Ignore decorative text, duplicate items, and non-task labels.
- The target planning date is ${date} in timezone ${timezone}.
- Respond with JSON only, no commentary.`;

      const data = await callAnthropic(apiKey, [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: image,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ]);

      const rawText = extractText(data) || "{}";
      let parsed: any;

      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = {
          tasks: [],
          message: "The model returned invalid JSON.",
          raw: rawText,
        };
      }

      parsed.tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks
            .map((task: any) => ({
              text: String(task.text || "").trim(),
              category: ["focus", "health", "learn", "build", "rest"].includes(task.category)
                ? task.category
                : "focus",
              scheduledHour:
                Number.isInteger(task.scheduledHour) &&
                task.scheduledHour >= 0 &&
                task.scheduledHour <= 23
                  ? task.scheduledHour
                  : null,
            }))
            .filter((task: any) => task.text)
        : [];

      return jsonResponse(parsed, 200);
    }

    return jsonResponse({ error: "Unknown mode" }, 400);
  } catch (err) {
    console.error("Function error:", err);
    return jsonResponse({ error: "Internal error", detail: String(err) }, 500);
  }
});

async function callAnthropic(apiKey: string, messages: any[]) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Claude API error:", errText);
    throw new Error(errText);
  }

  return await response.json();
}

function extractText(data: any) {
  return data?.content?.find((item: any) => item?.type === "text")?.text || "";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}