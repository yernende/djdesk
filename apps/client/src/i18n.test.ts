import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocale, countLabel, translateMessage, translate } from "./i18n.ts";
import { guide, russianGuideMarkdown } from "./guide.ts";

test("browser preferences select Russian regardless of region and saved choice takes priority", () => {
  assert.equal(resolveLocale(null, ["en-US", "ru-KZ"]), "ru");
  assert.equal(resolveLocale(undefined, ["RU"]), "ru");
  assert.equal(resolveLocale("en", ["ru-RU"]), "en");
  assert.equal(resolveLocale("ru", ["de"]), "ru");
  assert.equal(resolveLocale("invalid", ["fr", "en"]), "en");
  assert.equal(resolveLocale(null, []), "en");
  assert.equal(resolveLocale(null, ["rue"]), "en");
});

test("Russian counts handle teens, compound numbers and fractions", () => {
  for (const [n, text] of [
    [0, "0 треков"],
    [1, "1 трек"],
    [2, "2 трека"],
    [5, "5 треков"],
    [11, "11 треков"],
    [21, "21 трек"],
    [22, "22 трека"],
    [111, "111 треков"],
    [1.5, "1.5 трека"],
  ] as const)
    assert.equal(countLabel("ru", n), text);
  assert.equal(countLabel("en", 1), "1 track");
  assert.equal(countLabel("en", 2), "2 tracks");
  assert.equal(countLabel("ru", 21, "segments"), "21 фрагмент с аккордом");
});

test("the same stored error translates after changing language without exposing server diagnostics", () => {
  const error = { code: "REVISION_CONFLICT", message: "internal unrelated text" };
  assert.match(translateMessage("ru", error), /Ваш вариант остался/);
  assert.match(translateMessage("en", error), /another device/);
  assert.equal(
    translateMessage("ru", { code: "TRACK_LIMIT", params: { limit: 27 } }),
    "В сете может быть не больше 27 треков.",
  );
  assert.equal(
    translateMessage("ru", { code: "SET_LIMIT", params: { limit: 10 } }),
    "Достигнут лимит сетов: 10.",
  );
  assert.equal(
    translateMessage("ru", { code: "NEW_UNKNOWN_CODE", message: "/private/database.sqlite" }),
    "Не удалось выполнить действие. Попробуйте ещё раз.",
  );
  assert.match(translateMessage("ru", new TypeError("Failed to fetch")), /Проверьте соединение/);
  assert.equal(
    translateMessage("en", "Link copied. Keep it somewhere private."),
    "Link copied. Keep it somewhere private.",
  );
  assert.match(
    translateMessage("ru", "Link copied. Keep it somewhere private."),
    /Ссылка скопирована/,
  );
});

test("generated names preserve user text and the publication guide uses the in-app source", () => {
  const name = 'My "private" сет {name}';
  assert.equal(translate("ru", "{name} (copy)", { name }), `${name} (копия)`);
  const markdown = russianGuideMarkdown();
  for (const section of guide.ru) assert.ok(markdown.includes(section.body));
  assert.match(markdown, /30 дней/);
  assert.ok(!markdown.includes("#key="));
});
