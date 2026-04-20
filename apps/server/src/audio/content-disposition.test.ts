import assert from "node:assert/strict";
import { validateHeaderValue } from "node:http";
import test from "node:test";

import { getAudioContentDisposition } from "../routes.ts";

test("encodes Unicode audio filenames for HTTP content disposition", () => {
  const header = getAudioContentDisposition("Город 312 - Останусь.flac");

  assert.doesNotThrow(() => validateHeaderValue("content-disposition", header));
  assert.match(header, /^inline; filename="[^"]+"; filename\*=UTF-8''/);
  assert.doesNotMatch(header.split("; filename*")[0] ?? "", /[А-Яа-яЁё]/);
  assert.match(header, /%D0%93%D0%BE%D1%80%D0%BE%D0%B4/);
  assert.match(header, /%D0%9E%D1%81%D1%82%D0%B0%D0%BD%D1%83%D1%81%D1%8C\.flac/);
});

test("sanitizes ASCII fallback filename separators", () => {
  const header = getAudioContentDisposition('mix "take"; one.flac');

  assert.doesNotThrow(() => validateHeaderValue("content-disposition", header));
  assert.match(header, /^inline; filename="mix _take_ one\.flac";/);
});
