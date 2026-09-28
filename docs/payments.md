# Payments (not enabled yet)

Visionary is free today. If paid plans are added, follow these two rules. Both are non-negotiable.

## 1. Prices are set on the server

The browser only ever sends a **plan name**. The server maps it to a Stripe Price ID from its own configuration. Never accept an amount, currency or price ID from the client.

```ts
// supabase/functions/create-checkout/index.ts (sketch)
const PRICES: Record<string, string> = {
  pro_monthly: Deno.env.get("STRIPE_PRICE_PRO_MONTHLY")!,
  pro_yearly: Deno.env.get("STRIPE_PRICE_PRO_YEARLY")!,
};

const user = await requireUser(req);                 // from _shared/security.ts
const { plan } = await readJsonLimited(req, 1024);
const price = PRICES[plan];
if (!price) throw new HttpError(400, "Unknown plan.");

const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price, quantity: 1 }],
  client_reference_id: user.id,
  customer_email: user.email,
  success_url: `${SITE_URL}/?checkout=success`,
  cancel_url: `${SITE_URL}/?checkout=cancelled`,
});
return json({ url: session.url }, 200, origin);
```

## 2. Webhooks are verified before anything happens

Grant or revoke access **only** from a verified webhook — never from the success redirect.

```ts
// supabase/functions/stripe-webhook/index.ts (sketch) — deploy with verify_jwt = false
import Stripe from "npm:stripe@^17";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();                       // raw body — do not JSON.parse first
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider,
    );
  } catch {
    await logSecurityEvent(req, "webhook_signature_invalid", null);
    return new Response("Invalid signature", { status: 400 });
  }

  // Idempotency: store event.id and skip if already processed.
  // Then update the user's plan using the service-role client.
  return new Response("ok", { status: 200 });
});
```

Checklist before launch:
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and price IDs stored as Supabase secrets
- [ ] Webhook endpoint subscribed only to the events you handle
- [ ] Processed `event.id`s stored to make handling idempotent
- [ ] Plan/entitlement columns writable only by the service role (not by RLS policies)
- [ ] Terms of Service updated with billing, renewal, cancellation and refund terms
- [ ] Privacy Policy updated to list Stripe as a processor
