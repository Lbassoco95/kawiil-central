// Desactivada: función temporal de una sola prueba (1 nov 2026). No lee secretos ni llama a ningún servicio externo.
// Pendiente de borrar desde el panel de Supabase.
Deno.serve(() => new Response(JSON.stringify({ error: "función retirada" }), { status: 410, headers: { "Content-Type": "application/json" } }));
