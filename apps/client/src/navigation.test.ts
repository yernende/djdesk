import assert from "node:assert/strict";
import test from "node:test";
import { readNavigation, trackHref, trackShareUrl, updateNavigationUrl } from "./navigation.ts";

test("root navigation restores only explicitly requested track and set", () => {
  assert.deepEqual(readNavigation("https://example.test/"), {
    trackId: null,
    setId: null,
    workspaceId: null,
    secret: null,
  });
  assert.deepEqual(readNavigation("/?track=track-one&set=set-one"), {
    trackId: "track-one",
    setId: "set-one",
    workspaceId: null,
    secret: null,
  });
});

test("workspace access and explicit selections can coexist without implicit set selection", () => {
  assert.deepEqual(readNavigation("/w/workspace-one/?track=t&set=s#key=access-secret&view=info"), {
    trackId: "t",
    setId: "s",
    workspaceId: "workspace-one",
    secret: "access-secret",
  });
  assert.equal(readNavigation("/w/workspace-one#key=secret").setId, null);
  for (const pathname of ["/w/", "/w/one/more", "/prefix/w/one", "/w/%ZZ", "/w/a%2Fb"])
    assert.equal(readNavigation(pathname).workspaceId, null, pathname);
});

test("navigation decodes Unicode and trims blank identifiers", () => {
  const id = "Мой трек + mix / №1";
  assert.equal(readNavigation(trackHref(id)).trackId, id);
  assert.deepEqual(readNavigation("/w/%20%20?track=%20&set=#key=+"), {
    trackId: null,
    setId: null,
    workspaceId: null,
    secret: null,
  });
  assert.equal(readNavigation("/?track=+one+&set=+two+").trackId, "one");
  assert.equal(readNavigation("/?track=+one+&set=+two+").setId, "two");
  assert.equal(trackHref("  "), "/");
});

test("changing selections preserves workspace path, unrelated query and hash", () => {
  const result = updateNavigationUrl(
    "https://example.test/w/one?track=old&set=s&view=compact&tag=a&tag=b#chapter&key=secret",
    { trackId: "new + трек", setId: null },
  );
  assert.equal(
    result,
    "/w/one?track=new+%2B+%D1%82%D1%80%D0%B5%D0%BA&view=compact&tag=a&tag=b#chapter&key=secret",
  );
  assert.equal(updateNavigationUrl(result, {}), result);
  assert.equal(updateNavigationUrl("/?track=t&set=s", { trackId: " " }), "/?set=s");
  assert.equal(updateNavigationUrl("/?track=t&set=s", {}), "/?track=t&set=s");
});

test("secret removal preserves explicit selections and unrelated fragments", () => {
  assert.equal(
    updateNavigationUrl(
      "/w/one?track=t&set=s#chapter&key=secret&view=a%20b",
      {},
      { stripSecret: true },
    ),
    "/w/one?track=t&set=s#chapter&view=a%20b",
  );
  assert.equal(
    updateNavigationUrl("/w/one?track=t#key=secret", {}, { stripSecret: true }),
    "/w/one?track=t",
  );
  assert.equal(
    updateNavigationUrl("/?track=t#key=one&k%65y=two&chapter", {}, { stripSecret: true }),
    "/?track=t#chapter",
  );
  assert.equal(updateNavigationUrl("/#chapter", {}, { stripSecret: true }), "/#chapter");
});

test("share links contain only the public origin and track identifier", () => {
  const result = trackShareUrl(
    "https://user:password@example.test/w/private?set=s#key=secret",
    "t + 1",
  );
  assert.equal(result, "https://example.test/?track=t+%2B+1");
  assert.equal(trackHref("t + 1"), "/?track=t+%2B+1");
  assert.equal(trackShareUrl("https://example.test/", ""), "https://example.test/");
});

test("malformed URLs do not restore a selection or produce an unsafe share link", () => {
  for (const value of ["http://[broken", "javascript:alert(1)", "data:text/plain,test"]) {
    assert.deepEqual(readNavigation(value), {
      trackId: null,
      setId: null,
      workspaceId: null,
      secret: null,
    });
    assert.equal(updateNavigationUrl(value, { trackId: "t" }), "/?track=t");
  }
  assert.throws(() => trackShareUrl("not an origin", "t"), TypeError);
  assert.throws(() => trackShareUrl("javascript:alert(1)", "t"), TypeError);
});
