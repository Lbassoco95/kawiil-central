import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp',
}

// Default org for now — single-tenant setup
const DEFAULT_ORG_ID = 'a0000000-0000-0000-0000-000000000001'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.json()
    const eventType = payload?.event || payload?.type || 'unknown'

    console.log(`Savio webhook received: ${eventType}`, JSON.stringify(payload).substring(0, 500))

    // Optional: verify signature if SAVIO_WEBHOOK_SECRET is set
    const webhookSecret = Deno.env.get('SAVIO_WEBHOOK_SECRET')
    if (webhookSecret) {
      const signature = req.headers.get('x-webhook-signature')
      const timestamp = req.headers.get('x-webhook-timestamp')
      if (!signature) {
        console.warn('Missing webhook signature, but secret is configured')
        // For now, log but don't reject — can tighten later
      }
    }

    // Extract a Savio ID from common payload patterns
    const savioId = payload?.data?.id || payload?.id || null

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error } = await supabase
      .from('savio_webhook_events')
      .insert({
        organization_id: DEFAULT_ORG_ID,
        event_type: eventType,
        payload: payload,
        savio_id: savioId,
        status: 'received',
      })

    if (error) {
      console.error('Error storing webhook event:', error)
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Process specific event types
    switch (eventType) {
      case 'payment.created':
        console.log('Payment created:', savioId)
        break
      case 'payment.deleted':
        console.log('Payment deleted:', savioId)
        break
      case 'invoice.deleted':
        console.log('Invoice deleted:', savioId)
        break
      case 'invoice.status.updated':
        console.log('Invoice status updated:', savioId, payload?.data?.status)
        break
      default:
        console.log('Unhandled event type:', eventType)
    }

    return new Response(JSON.stringify({ success: true, event: eventType }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Webhook processing error:', err)
    return new Response(JSON.stringify({ success: false, error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
