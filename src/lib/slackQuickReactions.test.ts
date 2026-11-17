import { describe, expect, it } from "vitest";
import {
  resolveSlackQuickReactions,
  slackReactionNamesMatch,
  SLACK_WORKSPACE_DEFAULT_QUICK_REACTIONS,
} from "./slackQuickReactions";

describe("resolveSlackQuickReactions", () => {
  it("usa las tres reacciones personalizadas de la persona", () => {
    const resolved = resolveSlackQuickReactions({
      ok: true,
      show_quick_reactions: true,
      has_customized: true,
      emoji_1: "rocket",
      emoji_2: ":fire:",
      emoji_3: "kawiil",
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.quick).toEqual(["rocket", "fire", "kawiil"]);
  });

  it("usa los más usados cuando Slack está en ese modo", () => {
    const resolved = resolveSlackQuickReactions({
      ok: true,
      show_quick_reactions: true,
      use_frequently_used: true,
      has_customized: true,
      emoji_1: "rocket",
      emoji_use: { eyes: 2, tada: 9, "+1": 4, wave: 1 },
    });
    expect(resolved.quick).toEqual(["tada", "+1", "eyes"]);
    expect(resolved.frequent[0]).toBe("tada");
  });

  it("acepta emoji_use como JSON de texto", () => {
    const resolved = resolveSlackQuickReactions({
      ok: true,
      use_frequently_used: true,
      emoji_use: JSON.stringify({ clap: 3, pray: 8 }),
    });
    expect(resolved.quick[0]).toBe("pray");
    expect(resolved.quick[1]).toBe("clap");
    expect(resolved.quick).toHaveLength(3);
  });

  it("cae en las del workspace si la persona no eligió las suyas", () => {
    const resolved = resolveSlackQuickReactions({
      ok: true,
      show_quick_reactions: true,
      workspace_defaults: ["white_check_mark", "eyes", "raised_hands"],
    });
    expect(resolved.quick).toEqual([...SLACK_WORKSPACE_DEFAULT_QUICK_REACTIONS]);
  });

  it("oculta las de un clic si la persona las apagó en Slack", () => {
    const resolved = resolveSlackQuickReactions({
      ok: true,
      show_quick_reactions: false,
      emoji_1: "rocket",
      emoji_2: "eyes",
      emoji_3: "fire",
      has_customized: true,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.quick).toEqual([]);
    expect(resolved.frequent).toContain("rocket");
  });

  it("aplica el tono de piel preferido solo a los emojis que lo aceptan", () => {
    const resolved = resolveSlackQuickReactions({
      ok: true,
      has_customized: true,
      emoji_1: "white_check_mark",
      emoji_2: "raised_hands",
      emoji_3: "+1::skin-tone-3",
      preferred_skin_tone: "4",
    });
    expect(resolved.quick).toEqual([
      "white_check_mark",
      "raised_hands::skin-tone-4",
      "+1::skin-tone-3",
    ]);
  });

  it("si Slack no responde, muestra las tres de siempre del workspace", () => {
    const resolved = resolveSlackQuickReactions(null);
    expect(resolved.enabled).toBe(true);
    expect(resolved.quick).toEqual([...SLACK_WORKSPACE_DEFAULT_QUICK_REACTIONS]);
  });
});

describe("slackReactionNamesMatch", () => {
  it("trata thumbsup y +1 como la misma reacción", () => {
    expect(slackReactionNamesMatch("thumbsup", "+1")).toBe(true);
    expect(slackReactionNamesMatch("+1::skin-tone-4", "thumbsup::skin-tone-4")).toBe(true);
    expect(slackReactionNamesMatch("+1::skin-tone-4", "+1::skin-tone-2")).toBe(false);
    expect(slackReactionNamesMatch("eyes", "fire")).toBe(false);
  });
});
