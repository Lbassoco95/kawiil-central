import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HELLOSIGN_API = 'https://api.hellosign.com/v3';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const API_KEY = Deno.env.get('DROPBOX_SIGN_API_KEY');
    if (!API_KEY) {
      throw new Error('DROPBOX_SIGN_API_KEY is not configured');
    }

    const authHeader = 'Basic ' + btoa(API_KEY + ':');
    const body = await req.json();
    const { action } = body;

    // Send signature request
    if (action === 'send_signature_request') {
      const { title, subject, message, signers, file_urls, test_mode = true } = body;

      if (!signers || signers.length === 0) {
        throw new Error('At least one signer is required');
      }

      const formData = new FormData();
      formData.append('title', title || 'Documento para firma');
      formData.append('subject', subject || 'Por favor firma este documento');
      formData.append('message', message || 'Se requiere tu firma en este documento.');
      formData.append('test_mode', test_mode ? '1' : '0');

      signers.forEach((signer: any, i: number) => {
        formData.append(`signers[${i}][email_address]`, signer.email);
        formData.append(`signers[${i}][name]`, signer.name);
        if (signer.order !== undefined) {
          formData.append(`signers[${i}][order]`, String(signer.order));
        }
      });

      if (file_urls && file_urls.length > 0) {
        file_urls.forEach((url: string, i: number) => {
          formData.append(`file_url[${i}]`, url);
        });
      }

      const response = await fetch(`${HELLOSIGN_API}/signature_request/send`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        const errMsg = data?.error?.error_msg || JSON.stringify(data);
        throw new Error(`Dropbox Sign error [${response.status}]: ${errMsg}`);
      }

      const sr = data.signature_request;
      return new Response(JSON.stringify({
        success: true,
        signature_request_id: sr?.signature_request_id,
        title: sr?.title,
        status: sr?.is_complete ? 'complete' : 'pending',
        signing_url: sr?.signing_url || null,
        signatures: (sr?.signatures || []).map((s: any) => ({
          signer_email: s.signer_email_address,
          signer_name: s.signer_name,
          status: s.status_code,
          signed_at: s.signed_at,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get signature request status
    if (action === 'get_status') {
      const { signature_request_id } = body;
      if (!signature_request_id) throw new Error('signature_request_id is required');

      const response = await fetch(`${HELLOSIGN_API}/signature_request/${signature_request_id}`, {
        method: 'GET',
        headers: { 'Authorization': authHeader },
      });

      const data = await response.json();
      if (!response.ok) {
        const errMsg = data?.error?.error_msg || JSON.stringify(data);
        throw new Error(`Dropbox Sign error [${response.status}]: ${errMsg}`);
      }

      const sr = data.signature_request;
      return new Response(JSON.stringify({
        signature_request_id: sr?.signature_request_id,
        title: sr?.title,
        is_complete: sr?.is_complete,
        is_declined: sr?.is_declined,
        signing_url: sr?.signing_url || null,
        files_url: sr?.files_url || null,
        signatures: (sr?.signatures || []).map((s: any) => ({
          signer_email: s.signer_email_address,
          signer_name: s.signer_name,
          status: s.status_code,
          signed_at: s.signed_at,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // List signature requests
    if (action === 'list') {
      const { page = 1, page_size = 20 } = body;

      const response = await fetch(
        `${HELLOSIGN_API}/signature_request/list?page=${page}&page_size=${page_size}`,
        {
          method: 'GET',
          headers: { 'Authorization': authHeader },
        },
      );

      const data = await response.json();
      if (!response.ok) {
        const errMsg = data?.error?.error_msg || JSON.stringify(data);
        throw new Error(`Dropbox Sign error [${response.status}]: ${errMsg}`);
      }

      const requests = (data.signature_requests || []).map((sr: any) => ({
        signature_request_id: sr.signature_request_id,
        title: sr.title,
        is_complete: sr.is_complete,
        is_declined: sr.is_declined,
        created_at: sr.created_at,
        signatures: (sr.signatures || []).map((s: any) => ({
          signer_email: s.signer_email_address,
          signer_name: s.signer_name,
          status: s.status_code,
        })),
      }));

      return new Response(JSON.stringify({
        requests,
        total: data.list_info?.num_results || requests.length,
        page: data.list_info?.page || page,
        num_pages: data.list_info?.num_pages || 1,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cancel signature request
    if (action === 'cancel') {
      const { signature_request_id } = body;
      if (!signature_request_id) throw new Error('signature_request_id is required');

      const response = await fetch(`${HELLOSIGN_API}/signature_request/cancel/${signature_request_id}`, {
        method: 'POST',
        headers: { 'Authorization': authHeader },
      });

      if (!response.ok && response.status !== 200) {
        const data = await response.json().catch(() => ({}));
        const errMsg = (data as any)?.error?.error_msg || `Status ${response.status}`;
        throw new Error(`Dropbox Sign cancel error: ${errMsg}`);
      }
      // Consume body
      await response.text();

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Dropbox Sign error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
