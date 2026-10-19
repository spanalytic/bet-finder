"""Explicit public competition catalogue; no national teams or domestic cups."""

# code: (display name, country/region, event directory, calendar-year season)
COMPETITIONS = {
    "E0": ("EPL", "England", "match_events_epl", False),
    "E1": ("Championship", "England", "match_events_efl_championship", False),
    "E2": ("League One", "England", None, False),
    "E3": ("League Two", "England", None, False),
    "EC": ("National League", "England", None, False),
    "SC0": ("Scottish Premiership", "Scotland", "match_events_sco-premiership", False),
    "SC1": ("Scottish Championship", "Scotland", None, False),
    "SC2": ("Scottish League One", "Scotland", None, False),
    "SC3": ("Scottish League Two", "Scotland", None, False),
    "D1": ("Bundesliga", "Germany", "match_events_ger-bundesliga", False),
    "D2": ("2. Bundesliga", "Germany", "match_events_ger-2_bundesliga", False),
    "SP1": ("La Liga", "Spain", "match_events_esp-la_liga", False),
    "SP2": ("La Liga 2", "Spain", None, False),
    "I1": ("Serie A", "Italy", "match_events_ita-serie_a", False),
    "I2": ("Serie B", "Italy", None, False),
    "F1": ("Ligue 1", "France", "match_events_fra-ligue_1", False),
    "F2": ("Ligue 2", "France", None, False),
    "N1": ("Eredivisie", "Netherlands", "match_events_ned-eredivisie", False),
    "B1": ("Belgian Pro League", "Belgium", None, False),
    "P1": ("Liga Portugal", "Portugal", "match_events_por-liga_portugal", False),
    "T1": ("Turkish Super Lig", "Turkey", "match_events_tur-super_lig", False),
    "G1": ("Greek Super League", "Greece", "match_events_gre-super_league", False),
    "USA": ("MLS", "USA / Canada", "match_events_usa-mls", True),
    "BRA": ("Brasileirao", "Brazil", "match_events_bra-serie_a", True),
    "MEX": ("Liga MX", "Mexico", "match_events_mex-liga_mx", False),
    "ARG": ("Liga Profesional", "Argentina", "match_events_arg-liga_profesional", True),
    "JPN": ("J1 League", "Japan", "match_events_jpn-j_league", True),
    "NOR": ("Eliteserien", "Norway", "match_events_nor-eliteserien", True),
    "AUS": ("A-League", "Australia", "match_events_aus-a_league", False),
    "SAU": ("Saudi Pro League", "Saudi Arabia", "match_events_sau-saudi_pro_league", False),
    "UCL": ("Champions League", "UEFA", "match_events_ucl", False),
    "UEL": ("Europa League", "UEFA", "match_events_uel-europa_league", False),
    "UECL": ("Conference League", "UEFA", "match_events_uecl-conference_league", False),
}

EUROPEAN_CSV_CODES = [code for code in COMPETITIONS if code not in {
    "USA", "BRA", "MEX", "ARG", "JPN", "NOR", "AUS", "SAU", "UCL", "UEL", "UECL",
}]
EXTRA_CSV_CODES = ["USA", "BRA", "MEX", "ARG", "JPN", "NOR", "AUS"]
UEFA_CODES = {"UCL", "UEL", "UECL"}
