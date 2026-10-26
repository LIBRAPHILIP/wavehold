import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSubjects,
  sourceUrls,
  safeHref,
  parseGenToWei,
  formatGen,
  protestBondWei,
  splitFinder,
  outcomeFor,
} from "../src/genlayer/rules.js";

const GABE = "76561197960287930";

test("contract-shaped source URLs", () => {
  assert.deepEqual(sourceUrls("steam_vac", [GABE]), [
    "https://steamcommunity.com/profiles/76561197960287930/?xml=1",
  ]);
  assert.deepEqual(sourceUrls("steam_roster", [GABE]), [
    "https://steamcommunity.com/profiles/76561197960287930/?xml=1",
    "https://steamcommunity.com/profiles/76561197960287930/",
  ]);
  assert.equal(sourceUrls("lichess", ["lichess"])[0], "https://lichess.org/api/user/lichess");
});

test("subjects reject pasted URLs and short ids", () => {
  assert.deepEqual(parseSubjects("lichess", "Lichess"), ["lichess"]);
  assert.throws(() => parseSubjects("steam_vac", "https://evil.example/" + GABE), /bad_steam_id/);
  assert.throws(() => parseSubjects("lichess", "a"), /bad_lichess_id/);
});

test("safe links stay on the authority hosts", () => {
  assert.equal(safeHref(sourceUrls("steam_vac", [GABE])[0]).includes("steamcommunity.com"), true);
  assert.equal(safeHref("https://evil.example/profiles/" + GABE), "");
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref("https://lichess.org/api/user/lichess"), "https://lichess.org/api/user/lichess");
});

test("wei math matches the contract", () => {
  assert.equal(parseGenToWei("0.01"), 10n ** 16n);
  assert.equal(parseGenToWei("1"), 10n ** 18n);
  assert.equal(formatGen(10n ** 16n), "0.0100");
  assert.equal(protestBondWei(10n ** 16n), 10n ** 15n);
  assert.deepEqual(splitFinder(1000n), { fee: 100n, rest: 900n });
});

test("an increase forfeits and a closure without tosViolation does not", () => {
  const clean = { subject: "player", readable: true, vac_banned: -1, vac_count: -1, game_count: -1, tos_violation: 0 };
  const closed = { ...clean, tos_violation: 0 };
  const marked = { ...clean, tos_violation: 1 };
  assert.equal(outcomeFor("lichess", [clean], [closed]), "clean");
  assert.equal(outcomeFor("lichess", [clean], [marked]), "ban_delta");
  const steam = { subject: GABE, readable: true, vac_banned: 0, vac_count: -1, game_count: -1, tos_violation: -1 };
  const waved = { ...steam, vac_banned: 1 };
  assert.equal(outcomeFor("steam_vac", [steam], [steam]), "clean");
  assert.equal(outcomeFor("steam_vac", [steam], [waved]), "ban_delta");
  assert.equal(outcomeFor("steam_vac", [steam], [{ ...steam, readable: false }]), "unreadable");
});
