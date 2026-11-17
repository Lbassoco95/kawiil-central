import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveSlackEmoji,
  searchSlackEmoji,
  slackMrkdwnToReact,
  type FormatContext,
} from "./slackFormatting";
import { normalizeSlackCustomEmoji } from "@/hooks/useSlackCustomEmoji";
import { formatSlackEmojiUploadError, validateSlackEmojiUpload } from "./slackEmojiUpload";

const ctx: FormatContext = { userMap: {} };

function html(text: string, extra?: Partial<FormatContext>) {
  return renderToStaticMarkup(<>{slackMrkdwnToReact(text, { ...ctx, ...extra })}</>);
}

describe("slack mrkdwn", () => {
  it("convierte shortcodes, aunque lleven guion bajo, y el enlace que va entre ellos", () => {
    const text = [
      "1. Descubre a quién te toca regalarle :gift:",
      "Entra al sorteo :point_right:",
      "<https://drawnames.app/t/30KTrWM|drawnames.app/t/30KTrWM> para ver",
      "quién te tocó.",
      ":shushingface:",
      "",
      "2. Escribe tu cartita :loveletter:",
      "formulario :point_right: *<https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=abc|Intercambio Kawiil 18 de diciembre: Rellenar formulario>*",
    ].join("\n");
    const out = html(text);
    expect(out).toContain("🎁");
    expect(out).toContain("👉");
    expect(out).toContain("🤫");
    expect(out).toContain("💌");
    expect(out).toContain('href="https://drawnames.app/t/30KTrWM"');
    expect(out).toContain("drawnames.app/t/30KTrWM");
    expect(out).toContain('href="https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=abc"');
    expect(out).toContain("Intercambio Kawiil 18 de diciembre: Rellenar formulario");
    expect(out).toContain("<strong>");
    expect(out).not.toContain(":point_right:");
    expect(out).not.toContain(":gift:");
    expect(out).not.toContain(":shushingface:");
    expect(out).not.toContain("<https://");
  });

  it("arma el enlace de Forms en negrita aunque el vínculo vaya partido en varias líneas", () => {
    const text = [
      "formulario :point_right: *&lt;https://forms.cloud.microsoft/Pages/ResponsePage.aspx?",
      "id=bb6BJ-sdgkiGK-",
      "INvIytYC8vmvz4QRAqmYEZNSvq1ZUM1owREY5NJZTQUVJTFU2ODUwVUUQ2UFFXT",
      "S4u|/Intercambio Kawiil 18 de diciembre: Rellenar formulario&gt;*",
    ].join("\n");
    const out = html(text);
    expect(out).toContain(
      'href="https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=bb6BJ-sdgkiGK-INvIytYC8vmvz4QRAqmYEZNSvq1ZUM1owREY5NJZTQUVJTFU2ODUwVUUQ2UFFXTS4u"',
    );
    expect(out).toContain("/Intercambio Kawiil 18 de diciembre: Rellenar formulario");
    expect(out).toContain("<strong>");
    expect(out).toContain("👉");
    expect(out).not.toContain("&lt;");
    expect(out).not.toContain(":point_right:");
  });

  it("descodifica entidades de Slack antes de armar el enlace", () => {
    const out = html("&lt;https://drawnames.app/t/30KTrWM|drawnames.app/t/30KTrWM&gt;");
    expect(out).toContain('href="https://drawnames.app/t/30KTrWM"');
    expect(out).not.toContain("&lt;");
  });

  it("no parte snake_case ni una url con guion bajo", () => {
    const out = html("usa foo_bar_baz y https://example.com/a_b_c.");
    expect(out).not.toContain("<em>");
    expect(out).toContain("foo_bar_baz");
    expect(out).toContain('href="https://example.com/a_b_c"');
  });

  it("deja el shortcode dentro de código inline", () => {
    const out = html("mira `:gift:` tal cual");
    expect(out).toContain("<code");
    expect(out).toContain(":gift:");
    expect(out).not.toContain("🎁");
  });

  it("muestra el emoji personalizado del workspace", () => {
    const out = html("hola :kawiil:", {
      customEmoji: { kawiil: "https://emoji.slack-edge.com/T/kawiil/abc.png" },
    });
    expect(out).toContain('src="https://emoji.slack-edge.com/T/kawiil/abc.png"');
    expect(out).toContain('class="sl-emoji-custom"');
    expect(out).toContain('alt=":kawiil:"');
  });

  it("menciona a la persona", () => {
    const out = html("hey <@U123ABC|Ana>");
    expect(out).toContain("@Ana");
  });
});

describe("catálogo de emojis", () => {
  it("usa el nombre corto de Slack y el glifo vigente", () => {
    expect(resolveSlackEmoji("gift").kind === "unicode" && resolveSlackEmoji("gift")).toMatchObject({
      kind: "unicode",
      char: "🎁",
    });
    expect(resolveSlackEmoji("point_right")).toMatchObject({ kind: "unicode", char: "👉" });
    expect(resolveSlackEmoji("raised_hands::skin-tone-4")).toMatchObject({
      kind: "unicode",
      char: "🙌\u{1F3FD}",
    });
    expect(resolveSlackEmoji("shushingface")).toMatchObject({ kind: "unicode", char: "🤫" });
    expect(resolveSlackEmoji("loveletter")).toMatchObject({ kind: "unicode", char: "💌" });
    expect(resolveSlackEmoji("candy")).toMatchObject({ kind: "unicode", char: "🍬" });
  });

  it("incluye emojis de Unicode reciente que gemoji aún no nombra", () => {
    const bags = resolveSlackEmoji("face_with_bags_under_eyes");
    expect(bags).toMatchObject({ kind: "unicode", char: "🫩" });
  });

  it("prioriza el emoji subido al workspace sobre el estándar", () => {
    const resolved = resolveSlackEmoji("gift", {
      gift: "https://emoji.slack-edge.com/T/gift/custom.png",
    });
    expect(resolved).toMatchObject({
      kind: "image",
      url: "https://emoji.slack-edge.com/T/gift/custom.png",
    });
  });

  it("busca por nombre y mete primero los del workspace", () => {
    const hits = searchSlackEmoji("kaw", { kawiil: "https://emoji.slack-edge.com/T/k/a.png" }, 5);
    expect(hits[0]).toMatchObject({ name: "kawiil", url: "https://emoji.slack-edge.com/T/k/a.png" });
    const point = searchSlackEmoji("point_ri", undefined, 4);
    expect(point.some((hit) => hit.name === "point_right" && hit.emoji === "👉")).toBe(true);
  });
});

describe("emojis personalizados de Slack", () => {
  it("resuelve alias:nombre hasta la imagen", () => {
    const map = normalizeSlackCustomEmoji({
      shipit: "alias:squirrel",
      squirrel: "https://emoji.slack-edge.com/T/squirrel/1.png",
      loop: "alias:loop",
    });
    expect(map.shipit).toBe("https://emoji.slack-edge.com/T/squirrel/1.png");
    expect(map.squirrel).toBe("https://emoji.slack-edge.com/T/squirrel/1.png");
    expect(map.loop).toBeUndefined();
  });

  it("valida nombre, tipo y peso antes de subir", () => {
    expect(validateSlackEmojiUpload("ok_name", { type: "image/png", size: 1000 })).toBeNull();
    expect(validateSlackEmojiUpload("Mal Nombre", { type: "image/png", size: 1000 })).toMatch(/minúsculas/);
    expect(validateSlackEmojiUpload("ok", { type: "image/webp", size: 1000 })).toMatch(/PNG/);
    expect(validateSlackEmojiUpload("ok", { type: "image/png", size: 200 * 1024 })).toMatch(/128 KB/);
  });

  it("traduce el rechazo de Slack al subir", () => {
    expect(formatSlackEmojiUploadError("unknown_method")).toMatch(/Sincronizar/);
    expect(formatSlackEmojiUploadError("error_name_taken")).toMatch(/ya existe/);
  });
});
