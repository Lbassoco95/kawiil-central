import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Base64 para cuerpos binarios grandes (Graph suele omitir contentBytes en JSON y usar /$value). */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Igual que en email-detail: evita doble codificación (%252F) y alinea rutas con /me/messages/{id} sin encodeURIComponent. */
function normalizeGraphMessageOrAttachmentId(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  return s;
}

const GRAPH_MAIL_PREFER_IMMUTABLE = { Prefer: 'IdType="ImmutableId"' };

async function graphRequest(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    const lower = errorBody.toLowerCase();
    if (res.status === 403 || lower.includes("insufficient") || lower.includes("permission")) {
      throw new Error(`MICROSOFT_PERMISSION_REQUIRED:${errorBody}`);
    }
    throw new Error(`Microsoft Graph error [${res.status}]: ${errorBody}`);
  }

  if (res.status === 204) return { success: true };
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

async function refreshTokenIfNeeded(supabaseAdmin: any, userId: string, tokenRow: any) {
  const expiresAt = new Date(tokenRow.expires_at);
  // Refresh 5 min before expiry
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("microsoft_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return data.access_token;
}

/** Descarga metadatos + bytes del adjunto (fileAttachment) vía Graph /$value. */
async function loadMessageFileAttachmentFromGraph(
  accessToken: string,
  rawMessageId: string | undefined,
  rawAttachmentId: string | undefined,
): Promise<{
  body: Uint8Array;
  contentType: string;
  name: string;
  size?: unknown;
  isInline?: unknown;
  contentId?: unknown;
}> {
  const messageId = normalizeGraphMessageOrAttachmentId(rawMessageId);
  const attachmentId = normalizeGraphMessageOrAttachmentId(rawAttachmentId);
  if (!messageId || !attachmentId) {
    throw new Error("messageId y attachmentId son requeridos");
  }
  const metaPath =
    `/me/messages/${messageId}/attachments/${attachmentId}?$select=id,name,contentType,size,isInline,contentId,@odata.type`;
  const att = await graphRequest(accessToken, metaPath, {
    headers: GRAPH_MAIL_PREFER_IMMUTABLE,
  });
  const odataType = (att as Record<string, unknown>)["@odata.type"] as string | undefined;
  if (odataType && String(odataType).includes("itemAttachment")) {
    throw new Error("Este tipo de adjunto no se puede previsualizar");
  }
  if (odataType && String(odataType).includes("referenceAttachment")) {
    throw new Error("Este tipo de adjunto no se puede previsualizar");
  }

  let contentType = String((att as Record<string, unknown>).contentType || "application/octet-stream");

  const valueUrl = `${GRAPH_BASE}/me/messages/${messageId}/attachments/${attachmentId}/$value`;
  const valueRes = await fetch(valueUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/octet-stream",
      ...GRAPH_MAIL_PREFER_IMMUTABLE,
    },
  });
  if (!valueRes.ok) {
    const errText = await valueRes.text();
    throw new Error(`Adjunto binario [${valueRes.status}]: ${errText}`);
  }
  const buf = new Uint8Array(await valueRes.arrayBuffer());
  const hdr = valueRes.headers.get("content-type");
  if (hdr) {
    const main = hdr.split(";")[0].trim().toLowerCase();
    if (main && main !== "application/octet-stream") {
      contentType = hdr.split(";")[0].trim();
    }
  }

  return {
    body: buf,
    contentType,
    name: String((att as Record<string, unknown>).name ?? "adjunto"),
    size: (att as Record<string, unknown>).size,
    isInline: (att as Record<string, unknown>).isInline,
    contentId: (att as Record<string, unknown>).contentId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub;

    // Get tokens using service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("microsoft_tokens")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(JSON.stringify({ error: "Microsoft not connected", code: "NOT_CONNECTED" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabaseAdmin, userId, tokenRow);

    const body = await req.json();
    const { action, params } = body;

    let result;

    switch (action) {
      case "calendar-events": {
        const start = params?.start || new Date().toISOString();
        const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const res = await fetch(
          `${GRAPH_BASE}/me/calendarview?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Prefer: 'outlook.timezone="America/Mexico_City"',
            },
          }
        );
        result = await res.json();
        break;
      }

      case "create-event": {
        const res = await fetch(`${GRAPH_BASE}/me/events`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params.event),
        });
        result = await res.json();
        break;
      }

      case "delete-event": {
        const res = await fetch(`${GRAPH_BASE}/me/events/${params.eventId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result = { success: res.ok };
        break;
      }

      case "event-detail": {
        const res = await fetch(`${GRAPH_BASE}/me/events/${params.eventId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'outlook.timezone="America/Mexico_City"',
          },
        });
        result = await res.json();
        break;
      }

      case "update-event": {
        const encodedEventId = encodeURIComponent(params.eventId);

        // Snapshot previo para fallback en ocurrencias recurrentes
        const beforeRes = await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const beforeEvent = beforeRes.ok ? await beforeRes.json() : null;

        const res = await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Prefer: 'outlook.timezone="America/Mexico_City", return=representation',
          },
          body: JSON.stringify(params.payload),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Update event failed [${res.status}]: ${errBody}`);
        }

        const patchText = await res.text();
        const patchEvent: any = patchText ? JSON.parse(patchText) : null;

        // Verifica estado persistido (no confiar solo en respuesta del PATCH)
        const verifyRes = await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const persistedEvent = verifyRes.ok ? await verifyRes.json() : null;

        const desiredStart = params?.payload?.start?.dateTime as string | undefined;
        const desiredEnd = params?.payload?.end?.dateTime as string | undefined;
        const appliedStart = persistedEvent?.start?.dateTime as string | undefined;
        const appliedEnd = persistedEvent?.end?.dateTime as string | undefined;

        // Si el evento ya no existe por ese ID, asumimos que Graph lo convirtió/reidentificó y sí aplicó
        const updateApplied = !verifyRes.ok
          ? true
          : (!desiredStart || (appliedStart && appliedStart.startsWith(desiredStart))) &&
            (!desiredEnd || (appliedEnd && appliedEnd.startsWith(desiredEnd)));

        // Fallback para ocurrencias que no aceptan PATCH directo: clonar en nuevo horario y eliminar ocurrencia original
        if (!updateApplied && beforeEvent?.type === "occurrence") {
          const clonePayload: Record<string, any> = {
            subject: beforeEvent.subject,
            start: params?.payload?.start || beforeEvent.start,
            end: params?.payload?.end || beforeEvent.end,
            body: beforeEvent.body,
            attendees: beforeEvent.attendees,
            categories: beforeEvent.categories,
            isOnlineMeeting: !!beforeEvent.isOnlineMeeting,
            onlineMeetingProvider: beforeEvent.isOnlineMeeting ? "teamsForBusiness" : undefined,
            location: beforeEvent?.location?.displayName
              ? { displayName: beforeEvent.location.displayName }
              : undefined,
          };

          const createRes = await fetch(`${GRAPH_BASE}/me/events`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(clonePayload),
          });

          if (!createRes.ok) {
            const errBody = await createRes.text();
            throw new Error(`Fallback create event failed [${createRes.status}]: ${errBody}`);
          }

          const createdEvent = await createRes.json();

          await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          result = {
            ...createdEvent,
            migratedFromOccurrence: true,
            previousEventId: params.eventId,
          };
        } else {
          result = persistedEvent || patchEvent || { success: true };
        }

        break;
      }

      case "outlook-categories": {
        const res = await fetch(`${GRAPH_BASE}/me/outlook/masterCategories`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json();
        result = json.value || [];
        break;
      }

      case "emails": {
        const top = params?.top || 25;
        const skip = params?.skip || 0;
        const folder = params?.folder || "inbox";
        const search = params?.search ? `&$search="${params.search}"` : "";
        const skipParam = skip > 0 ? `&$skip=${skip}` : "";
        const select =
          "$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,createdDateTime,isRead,hasAttachments,importance,conversationId";
        result = await graphRequest(
          accessToken,
          `/me/mailFolders/${folder}/messages?${select}&$top=${top}&$orderby=receivedDateTime desc&$count=true${skipParam}${search}`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
        );
        break;
      }

      case "mark-unread": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isRead: false }),
        });
        result = res.ok ? { success: true } : await res.json();
        break;
      }

      case "archive-email": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/move`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ destinationId: "archive" }),
        });
        result = await res.json();
        break;
      }

      case "email-detail": {
        const mid = normalizeGraphMessageOrAttachmentId(params?.messageId);
        if (!mid) throw new Error("messageId required");
        result = await graphRequest(accessToken, `/me/messages/${mid}`, {
          headers: GRAPH_MAIL_PREFER_IMMUTABLE,
        });
        break;
      }

      case "send-email": {
        const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: params.message }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`SendMail failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "check-connection": {
        result = await graphRequest(accessToken, "/me");
        break;
      }

      case "reply": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/reply`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: params.comment }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Reply failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "reply-all": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/replyAll`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: params.comment }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`ReplyAll failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "mark-read": {
        await graphRequest(
          accessToken,
          `/me/messages/${params.messageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isRead: true }),
          }
        );
        result = { success: true };
        break;
      }

      case "create-onedrive-doc": {
        const docType = params.docType || "docx";
        const fileName = params.fileName || `Documento.${docType}`;
        const folderPath = params.folderPath || "Kawiil";

        const getItemByPath = async (path: string) => {
          const res = await fetch(`${GRAPH_BASE}/me/drive/root:/${encodeURI(path)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (res.status === 404) return null;
          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Read OneDrive path failed [${res.status}]: ${errBody}`);
          }
          return await res.json();
        };

        const ensureFolderPathExists = async (path: string) => {
          const segments = path.split("/").filter(Boolean);
          let currentPath = "";

          for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = await getItemByPath(currentPath);
            if (existing) continue;

            const parentPath = currentPath.includes("/")
              ? currentPath.slice(0, currentPath.lastIndexOf("/"))
              : "";

            const createUrl = parentPath
              ? `${GRAPH_BASE}/me/drive/root:/${encodeURI(parentPath)}:/children`
              : `${GRAPH_BASE}/me/drive/root/children`;

            const createRes = await fetch(createUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: segment,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              }),
            });

            if (!createRes.ok && createRes.status !== 409) {
              const errBody = await createRes.text();
              throw new Error(`Create OneDrive folder failed [${createRes.status}]: ${errBody}`);
            }

            if (createRes.body) await createRes.text();
          }
        };

        await ensureFolderPathExists(folderPath);

        const mimeTypes: Record<string, string> = {
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        };

        let putRes = await fetch(
          `${GRAPH_BASE}/me/drive/root:/${encodeURI(folderPath)}/${encodeURIComponent(fileName)}:/content`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": mimeTypes[docType] || "application/octet-stream",
            },
            body: new Uint8Array(0),
          }
        );

        // Fallback: if nested path fails (common when tenant path behavior differs), create in root
        if (putRes.status === 404) {
          putRes = await fetch(
            `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/content`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": mimeTypes[docType] || "application/octet-stream",
              },
              body: new Uint8Array(0),
            }
          );
        }

        if (!putRes.ok) {
          const errBody = await putRes.text();
          throw new Error(`Create OneDrive doc failed [${putRes.status}]: ${errBody}`);
        }

        const createdFile = await putRes.json();
        result = {
          success: true,
          id: createdFile.id,
          name: createdFile.name,
          webUrl: createdFile.webUrl,
          parentPath: createdFile.parentReference?.path,
        };
        break;
      }

      case "forward": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/forward`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            comment: params.comment,
            toRecipients: params.toRecipients,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Forward failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "inbox-folder-meta": {
        result = await graphRequest(
          accessToken,
          "/me/mailFolders/inbox?$select=id,unreadItemCount,totalItemCount"
        );
        break;
      }

      case "mail-folders": {
        const data = await graphRequest(accessToken, "/me/mailFolders?$top=50");
        result = data?.value || [];
        break;
      }

      case "email-conversation": {
        const convId = params?.conversationId;
        if (!convId) throw new Error("conversationId required");
        // Use $search instead of $filter to avoid InefficientFilter error
        const data = await graphRequest(
          accessToken,
          `/me/messages?$search="conversationId:${convId}"&$top=20`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
        );
        result = data?.value || [];
        break;
      }

      case "create-reply-draft": {
        const messageId = params?.messageId;
        const replyAll = params?.replyAll || false;
        const endpoint = replyAll ? "createReplyAll" : "createReply";
        const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}/${endpoint}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: "" }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          let graphCode: string | undefined;
          try {
            const j = JSON.parse(errBody);
            graphCode = j?.error?.code;
          } catch {
            /* ignore */
          }
          /** Algunos mensajes (borradores, carpetas especiales, tipos raros) no admiten createReply en Graph. */
          const lower = errBody.toLowerCase();
          const invalidRef =
            graphCode === "ErrorInvalidReferenceItem" ||
            graphCode === "ErrorItemNotFound" ||
            lower.includes("errorinvalidreferenceitem") ||
            lower.includes("erroritemnotfound");
          if (invalidRef) {
            result = {
              code: "REFERENCE_NOT_SUPPORTED",
              error:
                "Este mensaje no admite respuesta con borrador. Puedes escribir y enviar; se usará envío simple.",
            };
            break;
          }
          throw new Error(`CreateReplyDraft failed [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      /** Borrador de reenvío (incluye plantilla y firma de Outlook como en el cliente). */
      case "create-forward-draft": {
        const messageId = params?.messageId;
        if (!messageId) throw new Error("messageId required");
        const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}/createForward`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: "" }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`CreateForwardDraft failed [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      /**
       * Firma para “Nuevo correo”: Graph no expone la firma HTML de Outlook de forma oficial.
       * Solo GET /me (perfil Microsoft). No creamos borradores aquí (evita 400/500 y confusión con otras acciones).
       */
      case "get-email-signature-html": {
        const escapeHtml = (s: string) =>
          s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const me = await graphRequest(
          accessToken,
          "/me?$select=displayName,mail,userPrincipalName,jobTitle,mobilePhone,officeLocation",
        );
        const displayName = String(me?.displayName || "").trim();
        const mail = String(me?.mail || me?.userPrincipalName || "").trim();
        const title = String(me?.jobTitle || "").trim();
        const phone = String(me?.mobilePhone || "").trim();
        const office = String(me?.officeLocation || "").trim();

        let fallbackHtml = `<p><br></p><p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#333;">`;
        if (displayName) fallbackHtml += `<strong>${escapeHtml(displayName)}</strong><br/>`;
        if (title) fallbackHtml += `${escapeHtml(title)}<br/>`;
        if (office) fallbackHtml += `${escapeHtml(office)}<br/>`;
        if (mail) {
          fallbackHtml += `<a href="mailto:${escapeHtml(mail)}">${escapeHtml(mail)}</a>`;
        }
        if (phone) fallbackHtml += `<br/>${escapeHtml(phone)}`;
        fallbackHtml += `</p>`;

        result = { html: fallbackHtml, source: "microsoft_profile", displayName, mail };
        break;
      }

      case "update-draft": {
        const draftId = params?.draftId;
        const payload = params?.payload;
        await graphRequest(accessToken, `/me/messages/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        result = { success: true };
        break;
      }

      case "send-draft": {
        const draftId = params?.draftId;
        const res = await fetch(`${GRAPH_BASE}/me/messages/${draftId}/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`SendDraft failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "add-draft-attachment": {
        const draftId = params?.draftId;
        const attachment = params?.attachment;
        if (!draftId || !attachment?.name || !attachment?.contentBytes) {
          throw new Error("draftId y attachment son requeridos");
        }
        await graphRequest(accessToken, `/me/messages/${draftId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.name,
            contentType: attachment.contentType || "application/octet-stream",
            contentBytes: attachment.contentBytes,
          }),
        });
        result = { success: true };
        break;
      }

      case "move-email": {
        const messageId = params?.messageId;
        const destinationId = params?.destinationId;
        if (!messageId || !destinationId) throw new Error("messageId and destinationId required");
        result = await graphRequest(accessToken, `/me/messages/${messageId}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationId }),
        });
        break;
      }

      case "delete-email": {
        const messageId = params?.messageId;
        if (!messageId) throw new Error("messageId required");
        const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result = { success: res.ok };
        break;
      }

      case "message-attachment-content": {
        /** JSON + base64: puede superar límites del gateway; preferir message-attachment-binary en el cliente. */
        const r = await loadMessageFileAttachmentFromGraph(accessToken, params?.messageId, params?.attachmentId);
        result = {
          name: r.name,
          contentType: r.contentType,
          contentBytes: uint8ArrayToBase64(r.body),
          size: r.size,
          isInline: r.isInline,
          contentId: r.contentId,
        };
        break;
      }

      /** Cuerpo binario sin base64 (evita respuestas JSON vacías/truncadas con PDFs grandes). */
      case "message-attachment-binary": {
        const r = await loadMessageFileAttachmentFromGraph(accessToken, params?.messageId, params?.attachmentId);
        return new Response(r.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": r.contentType || "application/octet-stream",
            "X-Kawiil-Attachment-Name": encodeURIComponent(r.name),
            "Access-Control-Expose-Headers": "Content-Type, X-Kawiil-Attachment-Name",
          },
        });
      }

      case "email-attachments": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        if (!messageId) throw new Error("messageId required");
        result = await graphRequest(
          accessToken,
          `/me/messages/${messageId}/attachments?$top=100`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
        );
        break;
      }

      case "create-mail-folder": {
        const displayName = params?.displayName;
        if (!displayName) throw new Error("displayName required");
        const res = await fetch(`${GRAPH_BASE}/me/mailFolders`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Create mail folder failed [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Microsoft API error:", error);
    const message = (error as Error).message || "Unknown error";
    const lower = message.toLowerCase();
    /** Red de seguridad: si createReply escapó sin mapear, no devolver 500 (evita runtime en cliente / Lovable). */
    if (lower.includes("createreplydraft") && lower.includes("errorinvalidreferenceitem")) {
      return new Response(
        JSON.stringify({
          code: "REFERENCE_NOT_SUPPORTED",
          error:
            "Este mensaje no admite respuesta con borrador. Puedes escribir y enviar; se usará envío simple.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (message.startsWith("MICROSOFT_PERMISSION_REQUIRED:")) {
      return new Response(JSON.stringify({
        error: "Tu conexión de Microsoft no tiene los permisos necesarios. Reconecta Microsoft para aplicar los permisos nuevos.",
        code: "PERMISSION_REQUIRED",
        details: message.replace("MICROSOFT_PERMISSION_REQUIRED:", ""),
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle 404 - item not found (e.g. stale recurring event occurrence)
    if (message.includes("[404]") || message.includes("ErrorItemNotFound")) {
      return new Response(JSON.stringify({
        error: "El elemento no fue encontrado. Es posible que haya sido eliminado o modificado. Recarga la vista para actualizar.",
        code: "ITEM_NOT_FOUND",
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
