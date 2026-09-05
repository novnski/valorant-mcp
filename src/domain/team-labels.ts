/**
 * How a team is named for a reader.
 *
 * The provider identifies the two sides as `Red` and `Blue`, and the product
 * says the same thing everywhere it can: the round strip, the kill feed, the map
 * markers, the scoreboard spines and the score cards are all inked by those two
 * names. "Team A" and "Team B" said the same thing in a second vocabulary, and
 * the two paths into this app disagreed about which to use — the archive read
 * produced "Red Team" while the live normalizer produced "Team A", so the same
 * team was named differently depending on which one served the request.
 *
 * Modes without sides — deathmatch — identify each player as their own team by
 * puuid. Those keep their id rather than being dressed as a colour they do not
 * have.
 */
export function teamLabel(teamId: string): string {
  const normalized = teamId.trim().toLowerCase();
  if (normalized === "red") return "Red Team";
  if (normalized === "blue") return "Blue Team";
  /* Already named as a team by the provider: do not append a second "Team". */
  return /team$/i.test(teamId.trim()) ? teamId.trim() : `${teamId} Team`;
}
