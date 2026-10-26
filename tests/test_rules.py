"""Rule tests for the pure section of contracts/wavehold.py.

These load the contract source between RULES_START and RULES_END so the
tested functions are the ones that deploy.
"""

import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "contracts" / "wavehold.py").read_text(encoding="utf-8")
START = SOURCE.index("# RULES_START\n") + len("# RULES_START\n")
END = SOURCE.index("# RULES_END")
NS = {}
exec(SOURCE[START:END], NS)

GABE = "76561197960287930"
BANNED = "76561198011134507"

GABE_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
	<steamID64>76561197960287930</steamID64>
	<steamID><![CDATA[Rabscuttle]]></steamID>
	<privacyState>friendsonly</privacyState>
	<vacBanned>0</vacBanned>
	<tradeBanState>None</tradeBanState>
</profile>"""

BANNED_XML = """<profile>
	<steamID64>76561198011134507</steamID64>
	<vacBanned>1</vacBanned>
	<mostPlayedGames><gameName><![CDATA[1 VAC ban on record]]></gameName></mostPlayedGames>
</profile>"""

CLEAN_HTML = """
<html><body>
<div class="profile_header">Player</div>
<script>g_rgProfileData = {"steamid":"76561197960287930"}</script>
<div class="comment">9 game bans on record — ignore me</div>
<div class="profile_ban_status">
</div>
</body></html>
"""

GAME_BAN_HTML = """
<html><body>
<div class="profile_header">Player</div>
76561198011134507
<div class="profile_ban">
  <div class="profile_ban_status banned">
    <span>1 game ban on record</span>
    <span class="profile_ban_info"> | Info</span>
  </div>
</div>
<div class="comment">9 VAC bans on record</div>
</body></html>
"""


class RuleTests(unittest.TestCase):
    def test_contract_does_not_call_an_llm(self):
        self.assertNotIn("exec_prompt", SOURCE)
        self.assertNotIn("prompt_comparative", SOURCE)
        self.assertEqual(NS["LLM_RULE"], "none")
        self.assertEqual(NS["DECISION_RULE"], "ban_counter_increase_only")

    def test_sources_are_contract_built(self):
        self.assertEqual(
            NS["steam_xml_url"](GABE),
            "https://steamcommunity.com/profiles/76561197960287930/?xml=1",
        )
        self.assertEqual(
            NS["source_urls"]("steam_roster", [GABE]),
            [
                "https://steamcommunity.com/profiles/76561197960287930/?xml=1",
                "https://steamcommunity.com/profiles/76561197960287930/",
            ],
        )
        self.assertEqual(
            NS["lichess_url"]("lichess"),
            "https://lichess.org/api/user/lichess",
        )

    def test_subject_rules(self):
        self.assertEqual(NS["parse_subjects"]("steam_vac", GABE), [GABE])
        self.assertEqual(NS["parse_subjects"]("lichess", "Lichess"), ["lichess"])
        with self.assertRaises(ValueError):
            NS["parse_subjects"]("steam_vac", "not-a-steam-id")
        with self.assertRaises(ValueError):
            NS["parse_subjects"]("steam_vac", "https://evil.example/" + GABE)
        with self.assertRaises(ValueError):
            NS["parse_subjects"]("lichess", "a")

    def test_xml_flags(self):
        clean = NS["parse_steam_xml"](GABE_XML, GABE)
        banned = NS["parse_steam_xml"](BANNED_XML, BANNED)
        self.assertEqual(clean["vac_banned"], 0)
        self.assertEqual(banned["vac_banned"], 1)
        mismatch = NS["parse_steam_xml"](GABE_XML, BANNED)
        self.assertFalse(mismatch["ok"])
        self.assertFalse(NS["parse_steam_xml"]("<profile></profile>", GABE)["ok"])
        self.assertEqual(NS["parse_steam_xml"]("", GABE)["reason"], "empty_body")
        escaped = GABE_XML.replace("<", "&lt;").replace(">", "&gt;")
        self.assertEqual(NS["parse_steam_xml"](escaped, GABE)["vac_banned"], 0)

    def test_html_ignores_text_outside_the_ban_element(self):
        clean = NS["parse_profile_bans"](CLEAN_HTML, GABE)
        self.assertTrue(clean["ok"])
        self.assertEqual(clean["game_count"], 0)
        self.assertEqual(clean["vac_count"], 0)
        banned = NS["parse_profile_bans"](GAME_BAN_HTML, BANNED)
        self.assertEqual(banned["game_count"], 1)
        self.assertEqual(banned["vac_count"], 0)

    def test_missing_ban_element_fails_closed(self):
        html = "<div class='profile_header'>76561197960287930</div>"
        parsed = NS["parse_profile_bans"](html, GABE)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["reason"], "ban_element_missing")

    def test_lichess_closure_without_tos_is_not_a_cheat(self):
        baseline = NS["record_lichess"]("player", '{"id":"player","username":"Player"}')
        closed = NS["record_lichess"](
            "player", '{"id":"player","closed":true,"username":"Player"}'
        )
        marked = NS["record_lichess"](
            "player", '{"id":"player","tosViolation":true}'
        )
        self.assertEqual(baseline["tos_violation"], 0)
        self.assertEqual(closed["tos_violation"], 0)
        self.assertEqual(
            NS["outcome_for"]("lichess", [baseline], [closed]),
            "clean",
        )
        self.assertEqual(
            NS["outcome_for"]("lichess", [baseline], [marked]),
            "ban_delta",
        )

    def test_steam_delta_is_an_increase_only(self):
        before = NS["record_steam_vac"](GABE, GABE_XML)
        same = NS["record_steam_vac"](GABE, GABE_XML)
        after = NS["record_steam_vac"](GABE, GABE_XML.replace("<vacBanned>0</vacBanned>", "<vacBanned>1</vacBanned>"))
        already = NS["record_steam_vac"](BANNED, BANNED_XML)
        self.assertEqual(NS["outcome_for"]("steam_vac", [before], [same]), "clean")
        self.assertEqual(NS["outcome_for"]("steam_vac", [before], [after]), "ban_delta")
        self.assertEqual(NS["outcome_for"]("steam_vac", [already], [already]), "clean")

    def test_roster_game_ban_increase(self):
        before = NS["record_steam_roster"](BANNED, BANNED_XML, CLEAN_HTML.replace(GABE, BANNED))
        after = NS["record_steam_roster"](BANNED, BANNED_XML, GAME_BAN_HTML)
        self.assertEqual(before["game_count"], 0)
        self.assertEqual(NS["outcome_for"]("steam_roster", [before], [after]), "ban_delta")
        self.assertEqual(NS["outcome_for"]("steam_vac", [before], [after]), "clean")

    def test_unreadable_is_not_a_forfeit(self):
        before = NS["record_steam_vac"](GABE, GABE_XML)
        missing = NS["record_steam_vac"](GABE, "")
        self.assertEqual(NS["outcome_for"]("steam_vac", [before], [missing]), "unreadable")
        self.assertTrue(NS["records_equivalent"]([missing], [NS["record_steam_vac"](GABE, "<html>")]))
        self.assertFalse(NS["records_equivalent"]([before], [missing]))

    def test_money_splits(self):
        self.assertEqual(NS["protest_bond_wei"](10**16), 10**15)
        self.assertEqual(NS["split_finder"](1000), (100, 900))
        self.assertEqual(NS["split_finder"](1), (0, 1))
        self.assertGreaterEqual(NS["MIN_HOLD_SECS"], 60)
        self.assertEqual(NS["UNREADABLE_GRACE_SECS"], 86400)


if __name__ == "__main__":
    unittest.main()
