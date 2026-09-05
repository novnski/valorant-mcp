export type ValorantMode =
  | "competitive"
  | "unrated"
  | "swiftplay"
  | "spikerush"
  | "deathmatch"
  | "teamdeathmatch"
  | "premier"
  | "custom"
  | "all"
  | (string & {});

export type RankSnapshot = {
  tierId: number | null;
  tierName: string | null;
  rr: number | null;
  elo: number | null;
  peakTierName: string | null;
  peakTierId?: number | null;
  peakSeasonId?: string | null;
  peakSeasonShort?: string | null;
  leaderboardPlacement: number | null;
  updatedAt: string;
};

export type MatchRankChange = {
  matchId: string;
  tierId: number | null;
  tierName: string | null;
  rr: number | null;
  rrDelta: number | null;
  elo: number | null;
  refundedRr: number | null;
  wasDerankProtected: boolean;
  seasonId: string | null;
  seasonShort: string | null;
  changedAt: string | null;
};

export type MatchSummary = {
  matchId: string;
  mode: ValorantMode | string;
  mapName: string | null;
  gameVersion: string | null;
  patch: string | null;
  agentName: string | null;
  seasonId: string | null;
  seasonShort: string | null;
  startedAt: string | null;
  durationMs: number | null;
  result: "win" | "loss" | "draw" | "unknown";
  roundsWon: number | null;
  roundsLost: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  tierId: number | null;
  tierName: string | null;
  placement: number | null;
  acs: number | null;
  adr: number | null;
  damageDelta: number | null;
  kast: number | null;
  headshots: number | null;
  bodyshots: number | null;
  legshots: number | null;
  weapons: string[];
  teammates: string[];
  opponents: string[];
  opponentAgents: string[];
  teamCompositions?: MatchTeamComposition[];
  highlights: string[];
  partySize: number | null;
  rankChange?: MatchRankChange | null;
};

export type MatchTeamComposition = { teamId: string; agents: string[]; won: boolean | null };

export type MatchPlayerDetail = {
  puuid: string | null;
  gameName: string;
  tagLine: string | null;
  teamId: string;
  partyId: string | null;
  agentName: string | null;
  level: number | null;
  tierId: number | null;
  tierName: string | null;
  score: number | null;
  trackerScore: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  acs: number | null;
  adr: number | null;
  damageDelta: number | null;
  headshotRate: number | null;
  kast: number | null;
  firstKills: number | null;
  firstDeaths: number | null;
  threePlusKillRounds: number | null;
  multiKills: number | null;
  highlights: string[];
  spentOverall: number | null;
  spentAverage: number | null;
  loadoutOverall: number | null;
  loadoutAverage: number | null;
  abilityCasts: {
    grenade: number | null;
    ability1: number | null;
    ability2: number | null;
    ultimate: number | null;
    total: number | null;
  };
};

export type MatchTeamDetail = {
  teamId: string;
  label: string;
  roundsWon: number | null;
  roundsLost: number | null;
  won: boolean | null;
  averageTierName: string | null;
  players: MatchPlayerDetail[];
};

export type MatchEndState = {
  kind: "completed" | "surrendered" | "remake" | "draw" | "unknown";
  label: string;
  evidence: "team-result" | "team-score" | "round-result" | "metadata" | null;
};

export type MatchPosition = { x: number; y: number };

export type MatchPlayerLocation = {
  puuid: string | null;
  gameName: string;
  tagLine: string | null;
  teamId: string | null;
  viewRadians: number | null;
  location: MatchPosition;
};

export type MatchDamageEvent = {
  targetPuuid: string | null;
  targetName: string;
  targetTag: string | null;
  targetTeam: string | null;
  damage: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
};

export type MatchRoundPlayerStat = {
  puuid: string | null;
  gameName: string;
  tagLine: string | null;
  teamId: string | null;
  score: number | null;
  kills: number | null;
  headshots: number | null;
  bodyshots: number | null;
  legshots: number | null;
  loadoutValue: number | null;
  remainingCredits: number | null;
  weaponName: string | null;
  armorName: string | null;
  damageEvents: MatchDamageEvent[];
  abilityCasts: {
    grenade: number | null;
    ability1: number | null;
    ability2: number | null;
    ultimate: number | null;
    total: number | null;
  };
  wasAfk: boolean;
  receivedPenalty: boolean;
  stayedInSpawn: boolean;
};

export type MatchSpikeEvent = {
  playerName: string | null;
  playerTag: string | null;
  teamId: string | null;
  site: string | null;
  timeInRoundMs: number | null;
};

export type MatchRoundDetail = {
  number: number;
  winningTeam: string | null;
  result: string | null;
  ceremony: string | null;
  spikePlant: MatchSpikeEvent | null;
  spikeDefuse: MatchSpikeEvent | null;
  teamScores: Array<{ teamId: string; roundsWon: number }>;
  playerStats: MatchRoundPlayerStat[];
};

export type MatchKillEvent = {
  round: number | null;
  timeInRoundMs: number | null;
  timeInMatchMs: number | null;
  killerPuuid: string | null;
  killerName: string;
  killerTag: string | null;
  killerTeam: string | null;
  victimPuuid: string | null;
  victimName: string;
  victimTag: string | null;
  victimTeam: string | null;
  weaponName: string | null;
  assistants: string[];
  assistantPuuids: string[];
  victimLocation: MatchPosition | null;
  playerLocations: MatchPlayerLocation[];
  distanceMeters: number | null;
};

export type MatchTurningPoint = {
  roundNumber: number;
  kind: "clutch" | "multikill" | "spike" | "eco" | "opening";
  tone: "focus" | "multi" | "spike" | "eco" | "entry";
  title: string;
  detail: string;
  score: string | null;
  teamId: string | null;
  player: { puuid: string | null; gameName: string; tagLine: string | null } | null;
  playerNote: string | null;
  weaponName: string | null;
  evidence: string[];
  priority: number;
};

export type MatchRecommendation = {
  kind: "coaching-inference" | "data-quality";
  title: string;
  observedFacts: string[];
  inference: string;
  confidence: "low" | "medium" | "high";
  evidenceRoundNumbers: number[];
};

export type MatchAnalysis = {
  modelVersion: "round-analysis-v1";
  focusPuuid: string | null;
  turningPoints: MatchTurningPoint[];
  recommendation: MatchRecommendation | null;
  evidence: { rounds: number; killEvents: number; economyRounds: number };
  warnings: string[];
};

export type CoachingEvidenceCoverage = {
  rounds: { available: number; expected: number | null };
  killEvents: { available: number; positioned: number };
  economyRounds: { available: number; complete: number };
  objectives: { available: number };
  sources?: { available: number; providers: string[]; conflictState: "aligned" | "conflict" | "unknown" };
  continuousPov: false;
  comms: false;
  intent: false;
  crosshairPlacement: false;
  continuousMovement: false;
};

export type CoachingClaim = {
  id: string;
  label: "observed" | "derived" | "inference";
  confidence: "low" | "medium" | "high";
  text: string;
  evidenceIds: string[];
};

export type CoachingProjection = {
  modelVersion: "evidence-coaching-v1" | "evidence-coaching-v2" | "evidence-coaching-v3" | "evidence-coaching-v4";
  promptVersion: "deterministic-v1" | "deterministic-v2" | "deterministic-v3" | "deterministic-v4";
  packetHash: string;
  matchId: string;
  focusPuuid: string;
  generatedAt: string;
  cached: boolean;
  coverage: CoachingEvidenceCoverage;
  claims: CoachingClaim[];
  strengths: string[];
  practicePriorities: string[];
  limitations: string[];
};

export type MatchPerformanceAnalysis = {
  modelVersion: "match-performance-v1";
  focusPuuid: string;
  rounds: Array<{
    roundNumber: number;
    side: "attack" | "defense" | null;
    kills: number;
    deaths: number;
    assists: number;
  }>;
  sideSplits: Array<{
    side: "attack" | "defense";
    rounds: number;
    kills: number;
    deaths: number;
    assists: number;
    kd: number | null;
  }>;
  opponents: Array<{
    puuid: string | null;
    gameName: string;
    tagLine: string | null;
    agentName: string | null;
    kills: number;
    deaths: number;
    damageDealt: number;
    damageReceived: number;
  }>;
  weapons: Array<{
    weaponName: string;
    kills: number;
    averageKillDistanceMeters: number | null;
    killsWithDistance: number;
  }>;
  impact: {
    firstKills: number | null;
    firstDeaths: number | null;
    roundsWonAfterFirstKill: number | null;
    roundsLostAfterFirstDeath: number | null;
    firstKillConversionRate: number | null;
    firstDeathPunishRate: number | null;
    lastDeaths: number | null;
    tradeKills: number | null;
    tradesPerRound: number | null;
    plants: number | null;
    defuses: number | null;
    killsPerMinute: number | null;
  };
  topRivalPuuid: string | null;
  warnings: string[];
};

export type MatchEconomyAnalysis = {
  modelVersion: "match-economy-v1";
  teams: Array<{
    teamId: string;
    label: string;
    averageBank: number | null;
    averageLoadout: number | null;
    averageTotal: number | null;
    roundsWithData: number;
    completeRounds: number;
    expectedRounds: number;
    rounds: Array<{
      roundNumber: number;
      bank: number | null;
      loadout: number | null;
      total: number | null;
      playerSamples: number;
      expectedPlayers: number;
      complete: boolean;
    }>;
  }>;
  warnings: string[];
};

export type MatchDuelPlayer = {
  puuid: string | null;
  gameName: string;
  tagLine: string | null;
  agentName: string | null;
  teamId: string;
};
export type MatchDuelMatchup = {
  left: MatchDuelPlayer;
  right: MatchDuelPlayer;
  leftKills: number;
  rightKills: number;
  totalKills: number;
  margin: number;
};
export type MatchDuelAnalysis = {
  modelVersion: "match-duels-v1";
  leftTeam: { teamId: string; label: string; players: MatchDuelPlayer[] };
  rightTeam: { teamId: string; label: string; players: MatchDuelPlayer[] };
  matchups: MatchDuelMatchup[];
  topRivalry: MatchDuelMatchup | null;
  biggestMismatch: MatchDuelMatchup | null;
  crossTeamKills: number;
  warnings: string[];
};

export type MatchRoundEvidenceAnalysis = {
  modelVersion: "match-round-evidence-v1";
  rounds: Array<{
    roundNumber: number;
    winningTeam: string | null;
    result: string | null;
    players: Array<{
      puuid: string | null;
      gameName: string;
      tagLine: string | null;
      teamId: string | null;
      agentName: string | null;
      score: number | null;
      kills: number;
      deaths: number;
      assists: number;
      loadoutValue: number | null;
      remainingCredits: number | null;
      weaponName: string | null;
      armorName: string | null;
    }>;
    events: Array<{
      id: string;
      kind: "kill" | "plant" | "defuse";
      timeInRoundMs: number | null;
      actor: { puuid: string | null; gameName: string; tagLine: string | null; teamId: string | null };
      target: { puuid: string | null; gameName: string; tagLine: string | null; teamId: string | null } | null;
      weaponName: string | null;
      assistants: string[];
      distanceMeters: number | null;
      targetLocation: MatchPosition | null;
      playerLocations: MatchPlayerLocation[];
      site: string | null;
    }>;
  }>;
  evidence: { rounds: number; killEvents: number; killsWithDistance: number; killsWithPlayerLocations: number };
  warnings: string[];
};

export type MatchDetail = {
  matchId: string;
  region: string;
  platform: string;
  mode: string;
  mapName: string | null;
  gameVersion: string | null;
  patch: string | null;
  startedAt: string | null;
  durationMs: number | null;
  averageTierName: string | null;
  endState: MatchEndState;
  teams: MatchTeamDetail[];
  rounds: MatchRoundDetail[];
  killEvents: MatchKillEvent[];
  analysis?: MatchAnalysis;
  performance?: MatchPerformanceAnalysis | null;
  economy?: MatchEconomyAnalysis | null;
  duels?: MatchDuelAnalysis | null;
  roundEvidence?: MatchRoundEvidenceAnalysis | null;
  focusRankChange?: MatchRankChange | null;
  coaching?: CoachingProjection | null;
  source: "live" | "cache";
  warnings: string[];
};
