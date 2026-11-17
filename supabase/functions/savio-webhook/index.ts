import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp',
}

// Default org for now — single-tenant setup
const DEFAULT_ORG_ID = 'a0000000-0000-0000-0000-000000000001'
const MAX_TIMESTAMP_SKEW_SEC = 5 * 60

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)))
}

/**
 * Fail-closed: exige SAVIO_WEBHOOK_SECRET y firma válida.
 * Acepta: (1) header == secreto compartido, o (2) HMAC-SHA256 hex de body / timestamp.body.
 */
async function verifySavioSignature(
  secret: string,
  signature: string,
  timestamp: string | null,
  rawBody: string,
): Promise<boolean> {
  if (safeEqual(signature, secret)) return true

  const candidates = [rawBody]
  if (timestamp) candidates.push(`${timestamp}.${rawBody}`)

  for (const msg of candidates) {
    const expected = await hmacSha256Hex(secret, msg)
    if (safeEqual(signature.toLowerCase(), expected.toLowerCase())) return true
    if (signature.startsWith('sha256=')) {
      const hex = signature.slice('sha256='.length)
      if (safeEqual(hex.toLowerCase(), expected.toLowerCase())) return true
    }
  }
  return false
}

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
    const webhookSecret = Deno.env.get('SAVIO_WEBHOOK_SECRET')?.trim()
    if (!webhookSecret) {
      console.error('savio-webhook: SAVIO_WEBHOOK_SECRET no configurado')
      return new Response(JSON.stringify({ success: false, error: 'webhook_not_configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const signature = req.headers.get('x-webhook-signature')?.trim()
    const timestamp = req.headers.get('x-webhook-timestamp')?.trim() || null
    if (!signature) {
      return new Response(JSON.stringify({ success: false, error: 'missing_signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (timestamp) {
      const ts = Number(timestamp)
      const now = Math.floor(Date.now() / 1000)
      if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SEC) {
        return new Response(JSON.stringify({ success: false, error: 'stale_timestamp' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const rawBody = await req.text()
    const valid = await verifySavioSignature(webhookSecret, signature, timestamp, rawBody)
    if (!valid) {
      return new Response(JSON.stringify({ success: false, error: 'invalid_signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'invalid_json' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const eventType =
      (typeof payload?.event === 'string' && payload.event) ||
      (typeof payload?.type === 'string' && payload.type) ||
      'unknown'

    console.log(`Savio webhook received: ${eventType}`, rawBody.substring(0, 500))

    const dataObj = payload?.data && typeof payload.data === 'object' && payload.data !== null
      ? payload.data as Record<string, unknown>
      : null
    const savioId =
      (dataObj && typeof dataObj.id === 'string' ? dataObj.id : null) ||
      (typeof payload?.id === 'string' ? payload.id : null)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
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
        console.log('Invoice status updated:', savioId, dataObj?.status)
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
