// Supabase Edge Function: reads a photographed invoice with Claude and returns structured JSON.
// Deploy:  supabase functions deploy extract-invoice
// Secrets: supabase secrets set ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-sonnet-5-5
// JWT verification stays on, so only signed-in users can call it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5"; // cheapest model

function buildPrompt(categories: string[]): string {
  return [
    "This is a Croatian invoice (racun), given as a photo, a PDF, or extracted text.",
    "Extract the data and reply with ONLY a JSON object, no other text, in this shape:",
    "{",
    '  "invoice_number": string or null,',
    '  "invoice_date": string or null (date the invoice was issued, format YYYY-MM-DD; Croatian dates look like 22.11.2026.),',
    '  "company_name": string or null (the seller / issuer of the invoice),',
    '  "oib": string or null (the seller\'s 11-digit OIB, digits only),',
    '  "vat_breakdown": [{"rate": 5 or 13 or 25, "net": number, "vat": number}] (one entry per VAT rate that appears),',
    '  "gross_total": number or null (total to pay, including VAT),',
    `  "expense_class": string or null (best match from: ${categories.join(", ")})`,
    "}",
    "Numbers use a dot as the decimal separator and no thousands separator.",
    "Use null for anything you cannot read clearly. Do not invent values.",
  ].join("\n");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { fileBase64, mediaType, text, categories } = await req.json();
    if (!fileBase64 && !text) throw new Error("No file content received");

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              ...(text
                ? [{ type: "text", text: `Text of the invoice:\n${text}` }]
                : mediaType === "application/pdf"
                  ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }]
                  : [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fileBase64 } }]),
              { type: "text", text: buildPrompt(categories ?? []) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON");

    return json(JSON.parse(match[0]));
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
