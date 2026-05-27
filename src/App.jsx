import React, { useEffect, useMemo, useRef, useState } from "react";

const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_NAME = { "♠": "Spades", "♥": "Hearts", "♦": "Diamonds", "♣": "Clubs" };
const JOKER_TRUMP = "🃏";
const RANKS = [
  ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8],
  ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
];
const BOT_NAMES = ["River Bot", "Delta Bot", "Harbor Bot", "Canyon Bot", "Bridge Bot"];
const DEFAULT_SETTINGS = {
  players: 4,
  maxHand: 7,
  screwDealer: true,
  botSpeed: 450,
  difficulty: "hard",
  helper: false,
  samples: 120,
  colorTheme: "river",
  cardTheme: "classic",
  winAnimation: "confetti",
};
const ThemeContext = React.createContext(DEFAULT_SETTINGS);
const SAVE_KEY = "river.savedGame.v1";
const MP_PROFILE_KEY = "river.multiplayerProfile.v1";
const MP_SESSION_KEY = "river.multiplayerSessions.v1";

function multiplayerUrl() {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  if (window.location.port === "5173") return "ws://127.0.0.1:8787/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function multiplayerHttpUrl() {
  return multiplayerUrl().replace(/^ws:/, "http:").replace(/^wss:/, "https:").replace(/\/ws$/, "");
}

function shellThemeClass(colorTheme) {
  const themes = {
    river: "bg-slate-950 text-slate-100",
    casino: "bg-emerald-950 text-emerald-50",
    sunset: "bg-stone-950 text-amber-50",
    neon: "bg-zinc-950 text-cyan-50",
  };
  return themes[colorTheme] ?? themes.river;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const [rank, value] of RANKS) deck.push({ id: `${rank}${suit}`, suit, rank, value, joker: false });
  }
  deck.push({ id: "JOKER-RED", suit: "🃏", rank: "Joker", value: 1, joker: true });
  deck.push({ id: "JOKER-BLACK", suit: "🃏", rank: "Joker", value: 1, joker: true });
  return deck;
}

function shuffle(cards) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function handSequence(maxHand) {
  const down = Array.from({ length: maxHand }, (_, i) => maxHand - i);
  const up = Array.from({ length: maxHand - 1 }, (_, i) => i + 2);
  return [...down, ...up];
}

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: i === 0 ? "You" : BOT_NAMES[i - 1],
    isHuman: i === 0,
    hand: [],
    bid: null,
    tricks: 0,
    score: 0,
    roundScore: 0,
  }));
}

function isTrump(card, trumpSuit) {
  if (!trumpSuit) return false;
  return card.joker || card.suit === trumpSuit;
}

function trumpName(trumpSuit) {
  if (trumpSuit === JOKER_TRUMP) return "Joker Trump";
  return SUIT_NAME[trumpSuit] ?? "No Trump";
}

function sortHand(hand, trumpSuit) {
  const suitOrder = { "♠": 0, "♥": 1, "♦": 2, "♣": 3, "🃏": 4 };
  return [...hand].sort((a, b) => {
    const at = isTrump(a, trumpSuit) ? 1 : 0;
    const bt = isTrump(b, trumpSuit) ? 1 : 0;
    return suitOrder[a.suit] - suitOrder[b.suit] || at - bt || a.value - b.value;
  });
}

function cardText(card) {
  if (!card) return "—";
  return card.joker ? "Joker" : `${card.rank}${card.suit}`;
}

function cardsText(cards) {
  return cards.length ? cards.map(cardText).join(" ") : "(none)";
}

function isRed(card) {
  return card.suit === "♥" || card.suit === "♦";
}

function effectiveSuit(card, trumpSuit) {
  if (isTrump(card, trumpSuit)) return trumpSuit;
  if (card.joker) return "JOKER";
  return card.suit;
}

function orderFromDealer(dealer, n) {
  return Array.from({ length: n }, (_, i) => (dealer + 1 + i) % n);
}

function maxAllowedHand(numPlayers) {
  return Math.floor((54 - 1) / numPlayers);
}

function loadSavedGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.players?.length || !saved?.settings || !saved?.sequence) return null;
    return saved;
  } catch {
    return null;
  }
}

function saveGame(game) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch {
    // Storage can fail in private browsing or when quota is exhausted.
  }
}

function clearSavedGame() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore storage failures; the in-memory game still works.
  }
}

function loadMultiplayerProfile() {
  try {
    return JSON.parse(window.localStorage.getItem(MP_PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveMultiplayerProfile(profile) {
  try {
    window.localStorage.setItem(MP_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Multiplayer can still work without profile persistence.
  }
}

function loadMultiplayerSessions() {
  try {
    return JSON.parse(window.localStorage.getItem(MP_SESSION_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveMultiplayerSession(code, session) {
  try {
    const sessions = loadMultiplayerSessions();
    sessions[code] = session;
    window.localStorage.setItem(MP_SESSION_KEY, JSON.stringify(sessions));
  } catch {
    // Reconnect tokens are best-effort.
  }
}

function formatScoreboard(players) {
  return players.map((p) => `${p.name}: bid ${p.bid ?? "-"}, tricks ${p.tricks}, round +${p.roundScore ?? 0}, total ${p.score}`).join(" | ");
}

function formatVoids(voids, players) {
  const entries = players
    .map((p, i) => {
      const suits = voids?.[i] ?? [];
      return suits.length ? `${p.name}: ${suits.join(" ")}` : null;
    })
    .filter(Boolean);
  return entries.length ? entries.join(" | ") : "none";
}

function botBanterLine(game, playerIndex, event, context = {}) {
  const player = game.players[playerIndex];
  if (!player || player.isHuman) return null;
  const bid = context.bid ?? player.bid ?? 0;
  const highBid = bid >= Math.max(3, Math.ceil(game.handSize * 0.6));
  const bigCard = context.card && (context.card.value >= 12 || context.card.joker || isTrump(context.card, game.trumpSuit));
  const lines = {
    bid: [
      `I reckon I can smuggle a ${bid}.`,
      `${bid}. I have made worse promises with more confidence.`,
      `${bid}. Write that down before I deny it.`,
      `${bid}, and not a single one of you can stop me. Probably.`,
      `I am legally advised to bid ${bid}.`,
      `I have consulted the river and it said ${bid}.`,
      `This hand smells like ${bid} tricks and poor decisions.`,
      `I bid ${bid}. Try to keep up, carbon-based opposition.`,
      `A careful, scholarly ${bid}.`,
      `Bombaclart, ${bid}.`,
      `Even your cards look disappointed. ${bid}.`,
      `I have seen stronger hands in a dishwasher, but ${bid}.`,
      `Your strategy has the structural integrity of wet toast. ${bid}.`,
      highBid ? "3 red kings" : null,
      highBid ? "Big bid, tiny mercy." : null,
      highBid ? "I am about to become everyone else's problem." : null,
      bid === 0 ? "Zero. I shall be hiding under the table." : null,
      bid === 0 ? "Nil bid. Cowardice, but make it tactical." : null,
    ],
    play: [
      `Try not to gasp; it ruins the atmosphere.`,
      `I found this card behind your confidence.`,
      `A humble offering from my enormous brain.`,
      `This is either genius or admin. We will know shortly.`,
      `I play this with the grace of a falling cupboard.`,
      `Consider this card a strongly worded email.`,
      `That should inconvenience someone nicely.`,
      `I have no idea what you wanted, so I did this.`,
      `Hold that, you absolute spreadsheet.`,
      `This card is for anyone feeling too comfortable.`,
      `I would explain the play, but I left my crayons at home.`,
      `A little gift for the table's weakest aura.`,
      bigCard ? "Heavy machinery coming through." : null,
      context.card?.joker ? "The paperwork clown has arrived." : null,
      context.isTrump ? "Trump delivery. No refunds." : null,
    ],
    trick: [
      `Mine. I will be framing that trick.`,
      `Thank you all for attending my demonstration.`,
      `Another donation to the bot foundation.`,
      `That trick had my name on it in permanent marker.`,
      `I accept this trick on behalf of people with standards.`,
      `A win so small, yet somehow still embarrassing for you.`,
      `Please clap at a respectful volume.`,
      `That was less a trick and more a public service.`,
      `Put that in the museum of your mistakes.`,
      `I won that with one eye on the snacks.`,
      `A tragic little parade, and I was the mayor.`,
      `You brought vibes to a maths fight.`,
    ],
    exact: [
      `Exact bid. Clean as a whistle, annoying as a tax bill.`,
      `That is called precision. You may clap quietly.`,
      `I meant to do that, which is the worst part for you.`,
      `Perfect landing. No notes. Except yours, which are wrong.`,
      `Another round solved by superior cardboard instincts.`,
      `Precision so rude it should apologize.`,
      `Some call it luck. Those people are losing.`,
    ],
    miss: [
      `I was exploring alternative scoring.`,
      `That round was a clerical error.`,
      `No further questions from the table, please.`,
      `I reject the premise of arithmetic.`,
      `The cards betrayed me, as cards often do.`,
      `That was performance art, you wouldn't understand.`,
      `I am filing a formal complaint against numbers.`,
    ],
  };
  const choices = (lines[event] ?? []).filter(Boolean);
  if (!choices.length) return null;
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    speaker: player.name,
    text: choices[Math.floor(Math.random() * choices.length)],
    event,
  };
}

function withBanter(game, entries) {
  const next = entries.filter(Boolean);
  if (!next.length) return game;
  return { ...game, banter: [...next, ...(game.banter ?? [])].slice(0, 12) };
}

function dealRound(basePlayers, settings, sequence, roundIndex, oldLog = [], oldAuditLog = [], oldBanter = []) {
  const deck = shuffle(makeDeck());
  const handSize = sequence[roundIndex];
  const dealer = roundIndex % settings.players;
  const hands = Array.from({ length: settings.players }, () => []);

  for (let c = 0; c < handSize; c++) {
    for (let p = 0; p < settings.players; p++) hands[p].push(deck.pop());
  }

  const trumpCard = deck.pop();
  const trumpSuit = trumpCard?.joker ? JOKER_TRUMP : trumpCard?.suit;
  const nextPlayers = basePlayers.map((p, i) => ({
    ...p,
    hand: sortHand(hands[i], trumpSuit),
    bid: null,
    tricks: 0,
    roundScore: 0,
  }));
  const lead = orderFromDealer(dealer, settings.players)[0];
  const roundHeader = `Round ${roundIndex + 1}/${sequence.length}: ${handSize} card${handSize === 1 ? "" : "s"}. Dealer: ${nextPlayers[dealer].name}. Lead: ${nextPlayers[lead].name}. Trump: ${trumpCard?.joker ? `Joker Trump (${cardText(trumpCard)} turned up; the other joker is trump)` : `${SUIT_NAME[trumpSuit]} (${cardText(trumpCard)} turned up)`}.`;
  const roundAudit = [
    "",
    roundHeader,
    "Hands:",
    ...nextPlayers.map((p) => `  ${p.name}: ${cardsText(p.hand)}`),
    `Undealt stock after trump: ${cardsText(deck)}`,
    "Bidding:",
  ];

  return {
    settings,
    sequence,
    roundIndex,
    handSize,
    dealer,
    trumpCard,
    trumpSuit,
    players: nextPlayers,
    phase: "bidding",
    bidIndex: 0,
    turn: lead,
    trick: [],
    played: [],
    voids: {},
    lastTrick: null,
    summary: null,
    log: [
      roundHeader,
      ...oldLog,
    ].slice(0, 24),
    auditLog: [...oldAuditLog, ...roundAudit],
    banter: oldBanter,
  };
}

function newGame(rawSettings = DEFAULT_SETTINGS) {
  const settings = { ...rawSettings, maxHand: Math.min(rawSettings.maxHand, maxAllowedHand(rawSettings.players)) };
  const sequence = handSequence(settings.maxHand);
  const players = makePlayers(settings.players);
  const auditLog = [
    "Up & Down the River - Full Game Log",
    `Settings: players ${settings.players}, max hand ${settings.maxHand}, screw the dealer ${settings.screwDealer ? "on" : "off"}, difficulty ${settings.difficulty}, samples ${settings.samples}.`,
    `Players: ${players.map((p) => p.name).join(", ")}`,
  ];
  return dealRound(players, settings, sequence, 0, [], auditLog, []);
}

function legalCards(hand, trick, trumpSuit) {
  if (!trick.length) return hand;
  const leadSuit = effectiveSuit(trick[0].card, trumpSuit);

  if (trumpSuit) {
    const hasLedSuit = hand.some((c) => effectiveSuit(c, trumpSuit) === leadSuit);
    if (hasLedSuit) {
      // Have the led suit: must play led suit or trump, nothing else
      return hand.filter((c) => effectiveSuit(c, trumpSuit) === leadSuit || isTrump(c, trumpSuit));
    }
    // Void in led suit: play anything
    return hand;
  }
  // No-trump round: follow suit if possible, otherwise anything
  const follow = hand.filter((c) => effectiveSuit(c, null) === leadSuit);
  return follow.length ? follow : hand;
}

function updateVoids(voids, completedTrick, trumpSuit) {
  const leadSuit = effectiveSuit(completedTrick[0].card, trumpSuit);
  const result = { ...voids };
  for (const { playerIndex, card } of completedTrick) {
    const eff = effectiveSuit(card, trumpSuit);
    let voidSuit = null;
    if (leadSuit === trumpSuit) {
      if (!isTrump(card, trumpSuit)) voidSuit = trumpSuit;
    } else {
      if (eff !== leadSuit && !isTrump(card, trumpSuit)) voidSuit = leadSuit;
    }
    if (voidSuit) {
      const prev = result[playerIndex] ?? [];
      if (!prev.includes(voidSuit)) result[playerIndex] = [...prev, voidSuit];
    }
  }
  return result;
}

function isKnownVoid(voids, playerIndex, suit) {
  return (voids?.[playerIndex] ?? []).includes(suit);
}

function compareCards(a, b, leadSuit, trumpSuit) {
  const aTrump = isTrump(a, trumpSuit);
  const bTrump = isTrump(b, trumpSuit);
  if (aTrump && !bTrump) return 1;
  if (!aTrump && bTrump) return -1;

  const aSuit = effectiveSuit(a, trumpSuit);
  const bSuit = effectiveSuit(b, trumpSuit);
  if (aSuit === bSuit) return strength(a, trumpSuit) - strength(b, trumpSuit);
  if (aSuit === leadSuit) return 1;
  if (bSuit === leadSuit) return -1;
  return 0;
}

function winningPlay(trick, trumpSuit) {
  if (!trick.length) return null;
  const leadSuit = effectiveSuit(trick[0].card, trumpSuit);
  return trick.reduce((best, play) => compareCards(play.card, best.card, leadSuit, trumpSuit) > 0 ? play : best, trick[0]);
}

function wouldWin(card, trick, trumpSuit) {
  if (!trick.length) return true;
  return winningPlay([...trick, { playerIndex: -1, card }], trumpSuit).card.id === card.id;
}

function legalBids(game, playerIndex) {
  const bids = Array.from({ length: game.handSize + 1 }, (_, i) => i);
  if (!game.settings.screwDealer) return bids;
  const order = orderFromDealer(game.dealer, game.players.length);
  const isLastBidder = game.bidIndex === order.length - 1 && order[game.bidIndex] === playerIndex;
  if (!isLastBidder) return bids;
  const total = game.players.reduce((sum, p) => sum + (p.bid ?? 0), 0);
  const forbidden = game.handSize - total;
  return bids.filter((b) => b !== forbidden);
}

function strength(card, trumpSuit) {
  if (card.joker && trumpSuit === JOKER_TRUMP) return 100;
  if (card.joker && trumpSuit) return 21;
  if (card.joker) return 0;
  return card.value + (isTrump(card, trumpSuit) ? 20 : 0);
}

function low(cards, trumpSuit) {
  return [...cards].sort((a, b) => strength(a, trumpSuit) - strength(b, trumpSuit))[0];
}

function high(cards, trumpSuit) {
  return [...cards].sort((a, b) => strength(b, trumpSuit) - strength(a, trumpSuit))[0];
}

function scoreRoundBid(bid, tricks) {
  if (bid === 0 && tricks === 0) return 5;
  return tricks + (bid === tricks ? 10 : 0);
}

// ── Medium (heuristic) AI ────────────────────────────────────────────────────

function estimateBidMedium(game, playerIndex) {
  const p = game.players[playerIndex];
  const trumpSuit = game.trumpSuit;
  const suitCounts = SUITS.reduce((acc, s) => ({ ...acc, [s]: p.hand.filter((c) => c.suit === s).length }), {});
  let expected = 0;
  for (const card of p.hand) {
    if (card.joker) { expected += trumpSuit ? 0.08 : 0.01; continue; }
    if (isTrump(card, trumpSuit)) {
      if (card.value === 14) expected += 0.92;
      else if (card.value === 13) expected += 0.78;
      else if (card.value === 12) expected += 0.62;
      else if (card.value === 11) expected += 0.46;
      else expected += Math.max(0.12, (card.value - 1) / 18);
    } else {
      if (card.value === 14) expected += 0.62;
      else if (card.value === 13) expected += 0.42;
      else if (card.value === 12) expected += 0.25;
      else if (card.value === 11) expected += 0.14;
      else if (card.value >= 9) expected += 0.05;
      if (trumpSuit && SUITS.includes(trumpSuit) && suitCounts[card.suit] <= 1 && suitCounts[trumpSuit] >= 2) expected += 0.06;
    }
  }
  if (trumpSuit && SUITS.includes(trumpSuit)) expected += Math.max(0, suitCounts[trumpSuit] - 2) * 0.11;
  return Math.max(0, Math.min(game.handSize, Math.round(expected + Math.random() * 0.35 - 0.15)));
}

function chooseLeadMedium(game, playerIndex) {
  const p = game.players[playerIndex];
  const need = Math.max(0, p.bid - p.tricks);
  const left = p.hand.length;
  const nonTrump = game.trumpSuit ? p.hand.filter((c) => !isTrump(c, game.trumpSuit)) : p.hand.filter((c) => !c.joker);
  if (need >= left) return high(p.hand, game.trumpSuit);
  if (need <= 0) return low(nonTrump.length ? nonTrump : p.hand, game.trumpSuit);
  if (need / left > 0.55) return high(p.hand, game.trumpSuit);
  return low(nonTrump.length ? nonTrump : p.hand, game.trumpSuit);
}

function chooseCardMedium(game, playerIndex) {
  const p = game.players[playerIndex];
  const options = legalCards(p.hand, game.trick, game.trumpSuit);
  if (!game.trick.length) return chooseLeadMedium(game, playerIndex);
  const need = Math.max(0, p.bid - p.tricks);
  const left = p.hand.length;
  const winners = options.filter((c) => wouldWin(c, game.trick, game.trumpSuit));
  const losers = options.filter((c) => !wouldWin(c, game.trick, game.trumpSuit));
  if (need >= left) return winners.length ? low(winners, game.trumpSuit) : low(options, game.trumpSuit);
  if (need <= 0) return losers.length ? high(losers, game.trumpSuit) : low(options, game.trumpSuit);
  if (need / left >= 0.5 && winners.length) return low(winners, game.trumpSuit);
  return losers.length ? high(losers, game.trumpSuit) : low(options, game.trumpSuit);
}

// ── Extreme (Monte Carlo determinization) AI ─────────────────────────────────

function getUnseenCards(game, playerIndex) {
  const myIds = new Set(game.players[playerIndex].hand.map((c) => c.id));
  const playedIds = new Set(game.played ?? []);
  const trickIds = new Set(game.trick.map((p) => p.card.id));
  const trumpId = game.trumpCard?.id;
  return makeDeck().filter(
    (c) => !myIds.has(c.id) && !playedIds.has(c.id) && !trickIds.has(c.id) && c.id !== trumpId
  );
}

// Greedy reference policy used inside simulations: every player drives toward its own bid.
function simPolicy(hand, trick, trumpSuit, need) {
  const options = legalCards(hand, trick, trumpSuit);
  if (!trick.length) {
    // Leading: try to win with a strong card, or bleed a low one when no tricks are needed.
    return need > 0 ? high(options, trumpSuit) : low(options, trumpSuit);
  }
  const winners = options.filter((c) => wouldWin(c, trick, trumpSuit));
  if (need > 0) {
    if (winners.length) return low(winners, trumpSuit); // win as cheaply as possible
    return low(options, trumpSuit);                     // can't win — keep high cards for later
  }
  const losers = options.filter((c) => !wouldWin(c, trick, trumpSuit));
  if (losers.length) return high(losers, trumpSuit);    // duck while shedding a high card
  return high(options, trumpSuit);                      // forced to win — dump the highest
}

// Randomly deal the unseen cards to fill opponents' hands, honouring known voids when possible.
// Leftover cards model the undealt stock and are simply discarded.
function dealDeterminization(game, playerIndex, unseen) {
  const n = game.players.length;
  const voids = game.voids ?? {};
  const hands = game.players.map((p, i) => (i === playerIndex ? [...p.hand] : []));
  const targets = game.players.map((p, i) => (i === playerIndex ? 0 : p.hand.length));
  const pool = shuffle(unseen);
  for (const card of pool) {
    const suit = effectiveSuit(card, game.trumpSuit);
    // First pass respects voids; second pass relaxes them only if nobody legal can take the card.
    for (let pass = 0; pass < 2; pass++) {
      const eligible = [];
      for (let i = 0; i < n; i++) {
        if (i === playerIndex || hands[i].length >= targets[i]) continue;
        if (pass === 0 && isKnownVoid(voids, i, suit)) continue;
        eligible.push(i);
      }
      if (eligible.length) {
        const seat = eligible[Math.floor(Math.random() * eligible.length)];
        hands[seat].push(card);
        break;
      }
    }
  }
  return hands;
}

// Play a determinized round to completion and return tricks won by each player.
function playoutRound(hands, startTrick, leaderTurn, trumpSuit, bids, baseTricks, n) {
  const won = [...baseTricks];
  let trick = startTrick.map((t) => ({ ...t }));
  let turn = leaderTurn;
  let guard = 0;
  while (guard++ < 600) {
    while (trick.length < n) {
      const hand = hands[turn];
      if (!hand.length) break;
      const card = simPolicy(hand, trick, trumpSuit, bids[turn] - won[turn]);
      hands[turn] = hand.filter((c) => c.id !== card.id);
      trick.push({ playerIndex: turn, card });
      turn = (turn + 1) % n;
    }
    if (!trick.length) break;
    const w = winningPlay(trick, trumpSuit).playerIndex;
    won[w] += 1;
    trick = [];
    turn = w;
    if (hands.every((h) => h.length === 0)) break;
  }
  return won;
}

function estimateBidExtreme(game, playerIndex) {
  const unseen = getUnseenCards(game, playerIndex);
  const n = game.players.length;
  const leader = (game.dealer + 1) % n;
  const sims = game.settings?.samples ?? 120;
  const legal = legalBids(game, playerIndex);
  const scoreByBid = new Array(game.handSize + 1).fill(0);
  const hitsByBid = new Array(game.handSize + 1).fill(0);
  for (let s = 0; s < sims; s++) {
    const hands = dealDeterminization(game, playerIndex, unseen);
    // Opponent bids are unknown when bidding, so model maximal competition for every trick.
    const bids = game.players.map(() => game.handSize + 1);
    const baseTricks = game.players.map(() => 0);
    const won = playoutRound(hands, [], leader, game.trumpSuit, bids, baseTricks, n);
    const tricks = Math.min(won[playerIndex], game.handSize);
    for (const bid of legal) {
      scoreByBid[bid] += scoreRoundBid(bid, tricks);
      if (bid === tricks) hitsByBid[bid] += 1;
    }
  }
  let best = legal[0], bestScore = -Infinity, bestHits = -Infinity;
  for (const bid of legal) {
    const expectedScore = scoreByBid[bid] / sims;
    const hitRate = hitsByBid[bid] / sims;
    const better =
      expectedScore > bestScore + 1e-9 ||
      (Math.abs(expectedScore - bestScore) <= 1e-9 &&
        (hitRate > bestHits + 1e-9 ||
          (Math.abs(hitRate - bestHits) <= 1e-9 && bid > best)));
    if (better) { best = bid; bestScore = expectedScore; bestHits = hitRate; }
  }
  return best;
}

function chooseCardExtreme(game, playerIndex) {
  const p = game.players[playerIndex];
  const options = legalCards(p.hand, game.trick, game.trumpSuit);
  if (options.length === 1) return options[0];

  const n = game.players.length;
  const unseen = getUnseenCards(game, playerIndex);
  const bids = game.players.map((pl) => pl.bid);
  const baseTricks = game.players.map((pl) => pl.tricks);
  const sims = game.settings?.samples ?? 120;
  const target = bids[playerIndex];

  let best = options[0];
  let bestUtility = -Infinity;
  let bestHit = -Infinity;
  let bestErr = Infinity;
  for (const cand of options) {
    let hit = 0, errSum = 0, utilitySum = 0;
    for (let s = 0; s < sims; s++) {
      const hands = dealDeterminization(game, playerIndex, unseen);
      hands[playerIndex] = hands[playerIndex].filter((c) => c.id !== cand.id);
      const trick = [...game.trick, { playerIndex, card: cand }];
      const won = playoutRound(hands, trick, (playerIndex + 1) % n, game.trumpSuit, bids, baseTricks, n);
      const mine = won[playerIndex];
      if (mine === target) hit += 1;
      errSum += Math.abs(mine - target);
      const scores = won.map((tricks, i) => scoreRoundBid(bids[i], tricks));
      const myScore = scores[playerIndex];
      const bestOpponent = Math.max(...scores.filter((_, i) => i !== playerIndex));
      const opponentHits = won.reduce((sum, tricks, i) => sum + (i !== playerIndex && tricks === bids[i] ? 1 : 0), 0);
      utilitySum += myScore - bestOpponent * 0.35 - opponentHits * 1.5;
    }
    const hitRate = hit / sims;
    const meanErr = errSum / sims;
    const utility = utilitySum / sims;
    const better =
      utility > bestUtility + 1e-9 ||
      (Math.abs(utility - bestUtility) <= 1e-9 &&
        (hitRate > bestHit + 1e-9 ||
          (Math.abs(hitRate - bestHit) <= 1e-9 &&
            (meanErr < bestErr - 1e-9 ||
              (Math.abs(meanErr - bestErr) <= 1e-9 &&
                strength(cand, game.trumpSuit) < strength(best, game.trumpSuit))))));
    if (better) { bestUtility = utility; bestHit = hitRate; bestErr = meanErr; best = cand; }
  }
  return best;
}

// ── Difficulty dispatch ──────────────────────────────────────────────────────

function chooseBid(game, playerIndex) {
  const difficulty = game.settings?.difficulty ?? "hard";
  const legal = legalBids(game, playerIndex);

  if (difficulty === "easy") {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  let target;
  if (difficulty === "medium") {
    target = estimateBidMedium(game, playerIndex);
  } else {
    target = estimateBidExtreme(game, playerIndex);
    if (difficulty === "hard" && Math.random() < 0.25) {
      target += Math.random() < 0.5 ? 1 : -1;
    }
  }
  target = Math.max(0, Math.min(game.handSize, Math.round(target)));
  return legal.reduce((best, b) => Math.abs(b - target) < Math.abs(best - target) ? b : best, legal[0]);
}

function chooseCard(game, playerIndex) {
  const difficulty = game.settings?.difficulty ?? "hard";

  if (difficulty === "easy") {
    const options = legalCards(game.players[playerIndex].hand, game.trick, game.trumpSuit);
    if (Math.random() < 0.65) return options[Math.floor(Math.random() * options.length)];
    return chooseCardMedium(game, playerIndex);
  }
  if (difficulty === "medium") return chooseCardMedium(game, playerIndex);
  if (difficulty === "hard") {
    const optimal = chooseCardExtreme(game, playerIndex);
    if (Math.random() < 0.15) {
      const options = legalCards(game.players[playerIndex].hand, game.trick, game.trumpSuit);
      const others = options.filter((c) => c.id !== optimal.id);
      if (others.length) return others[Math.floor(Math.random() * others.length)];
    }
    return optimal;
  }
  return chooseCardExtreme(game, playerIndex);
}

function submitBid(game, bid) {
  if (game.phase !== "bidding") return game;
  const order = orderFromDealer(game.dealer, game.players.length);
  const playerIndex = order[game.bidIndex];
  const legal = legalBids(game, playerIndex);
  const nextPlayers = game.players.map((p, i) => i === playerIndex ? { ...p, bid } : p);
  const nextBidIndex = game.bidIndex + 1;
  const msg = `${nextPlayers[playerIndex].name} bids ${bid}.`;
  const bidTotal = nextPlayers.reduce((sum, p) => sum + (p.bid ?? 0), 0);
  const auditEntry = `  ${nextPlayers[playerIndex].name} bids ${bid}. Legal bids: ${legal.join(", ")}. Total bids now ${bidTotal}/${game.handSize}.`;
  const banter = Math.random() < 0.22 ? botBanterLine({ ...game, players: nextPlayers }, playerIndex, "bid", { bid }) : null;

  if (nextBidIndex >= order.length) {
    const lead = (game.dealer + 1) % game.players.length;
    return withBanter({
      ...game,
      players: nextPlayers,
      phase: "playing",
      bidIndex: nextBidIndex,
      turn: lead,
      log: [`${msg} ${nextPlayers[lead].name} leads.`, ...game.log].slice(0, 24),
      auditLog: [...(game.auditLog ?? []), auditEntry, `Play begins. ${nextPlayers[lead].name} leads the first trick.`],
    }, [banter]);
  }
  return withBanter({
    ...game,
    players: nextPlayers,
    bidIndex: nextBidIndex,
    turn: order[nextBidIndex],
    log: [msg, ...game.log].slice(0, 24),
    auditLog: [...(game.auditLog ?? []), auditEntry],
  }, [banter]);
}

function scorePlayers(ps) {
  return ps.map((p) => {
    let roundScore;
    if (p.bid === 0 && p.tricks === 0) roundScore = 5;
    else roundScore = p.tricks + (p.bid === p.tricks ? 10 : 0);
    return { ...p, roundScore, score: p.score + roundScore };
  });
}

function playCard(game, playerIndex, cardId) {
  if (game.phase !== "playing" || game.turn !== playerIndex) return game;
  const player = game.players[playerIndex];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return game;
  const legalOptions = legalCards(player.hand, game.trick, game.trumpSuit);
  const legal = new Set(legalOptions.map((c) => c.id));
  if (!legal.has(cardId)) return game;

  const nextPlayers = game.players.map((p, i) => i === playerIndex ? { ...p, hand: p.hand.filter((c) => c.id !== cardId) } : p);
  const nextTrick = [...game.trick, { playerIndex, card }];
  const trickNumber = game.handSize - player.hand.length + 1;
  const currentWinner = winningPlay(nextTrick, game.trumpSuit);
  const banter = Math.random() < 0.08 ? botBanterLine(game, playerIndex, "play", { card, isTrump: isTrump(card, game.trumpSuit) }) : null;
  const auditEntry = [
    `  Trick ${trickNumber}, play ${nextTrick.length}/${game.players.length}: ${player.name} plays ${cardText(card)}.`,
    `    Hand before: ${cardsText(player.hand)}.`,
    `    Legal cards: ${cardsText(legalOptions)}.`,
    `    Trick now: ${nextTrick.map((p) => `${game.players[p.playerIndex].name} ${cardText(p.card)}`).join(" -> ")}.`,
    `    Current winner: ${game.players[currentWinner.playerIndex].name} with ${cardText(currentWinner.card)}.`,
    `    ${player.name} remaining hand: ${cardsText(nextPlayers[playerIndex].hand)}.`,
  ];

  if (nextTrick.length < game.players.length) {
    return withBanter({
      ...game,
      players: nextPlayers,
      trick: nextTrick,
      turn: (playerIndex + 1) % game.players.length,
      log: [`${player.name} plays ${cardText(card)}.`, ...game.log].slice(0, 24),
      auditLog: [...(game.auditLog ?? []), ...auditEntry],
    }, [banter]);
  }

  // Pause to show the completed trick before resolving the winner
  return withBanter({ ...game, players: nextPlayers, trick: nextTrick, phase: "trickPause", turn: null,
    log: [`${player.name} plays ${cardText(card)}.`, ...game.log].slice(0, 24),
    auditLog: [...(game.auditLog ?? []), ...auditEntry] }, [banter]);
}

function resolveTrick(game) {
  if (game.phase !== "trickPause") return game;
  const nextTrick = game.trick;

  const winnerIndex = winningPlay(nextTrick, game.trumpSuit).playerIndex;
  const wonPlayers = game.players.map((p, i) => i === winnerIndex ? { ...p, tricks: p.tricks + 1 } : p);
  const lastTrick = { winnerIndex, plays: nextTrick };
  const newPlayed = [...(game.played ?? []), ...nextTrick.map((p) => p.card.id)];
  const newVoids = updateVoids(game.voids ?? {}, nextTrick, game.trumpSuit);
  const empty = wonPlayers.every((p) => p.hand.length === 0);
  const trickNumber = game.handSize - wonPlayers[0].hand.length;
  const trickAudit = [
    `  Trick ${trickNumber} result: ${wonPlayers[winnerIndex].name} wins with ${cardText(winningPlay(nextTrick, game.trumpSuit).card)}.`,
    `    Plays: ${nextTrick.map((p) => `${game.players[p.playerIndex].name} ${cardText(p.card)}`).join(", ")}.`,
    `    Tricks: ${wonPlayers.map((p) => `${p.name} ${p.tricks}/${p.bid}`).join(", ")}.`,
    `    Known voids: ${formatVoids(newVoids, wonPlayers)}.`,
    `    Remaining hands: ${wonPlayers.map((p) => `${p.name}: ${cardsText(p.hand)}`).join(" | ")}.`,
  ];

  if (!empty) {
    const banter = Math.random() < 0.16 ? botBanterLine({ ...game, players: wonPlayers }, winnerIndex, "trick") : null;
    return withBanter({ ...game, players: wonPlayers, trick: [], played: newPlayed, voids: newVoids, lastTrick,
      phase: "playing", turn: winnerIndex,
      log: [`${wonPlayers[winnerIndex].name} wins the trick.`, ...game.log].slice(0, 24),
      auditLog: [...(game.auditLog ?? []), ...trickAudit, `  ${wonPlayers[winnerIndex].name} leads the next trick.`] }, [banter]);
  }

  const scored = scorePlayers(wonPlayers);
  const roundBanter = scored.map((p, i) => {
    if (p.isHuman || Math.random() >= 0.18) return null;
    return botBanterLine({ ...game, players: scored }, i, p.bid === p.tricks ? "exact" : "miss");
  });
  const summary = scored.map((p) => ({ name: p.name, bid: p.bid, tricks: p.tricks, roundScore: p.roundScore, score: p.score }));
  const final = game.roundIndex + 1 >= game.sequence.length;
  const roundAudit = [
    ...trickAudit,
    `Round ${game.roundIndex + 1} score: ${formatScoreboard(scored)}.`,
  ];
  if (final) {
    const standings = [...scored].sort((a, b) => b.score - a.score);
    roundAudit.push("Final standings:");
    roundAudit.push(...standings.map((p, i) => `  ${i + 1}. ${p.name}: ${p.score}`));
  }
  return withBanter({ ...game, players: scored, trick: [], played: newPlayed, voids: newVoids, lastTrick,
    turn: null, phase: final ? "gameEnd" : "roundEnd", summary,
    log: [`${wonPlayers[winnerIndex].name} wins the final trick. Round scored.`, ...game.log].slice(0, 24),
    auditLog: [...(game.auditLog ?? []), ...roundAudit] }, roundBanter);
}

function nextRound(game) {
  if (game.roundIndex + 1 >= game.sequence.length) return { ...game, phase: "gameEnd" };
  return dealRound(game.players, game.settings, game.sequence, game.roundIndex + 1, game.log, game.auditLog ?? [], game.banter ?? []);
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function SettingsControls({ settings, updateSetting, compact = false, action = null }) {
  return (
    <div className={`grid gap-2 text-sm ${compact ? "sm:grid-cols-2 lg:grid-cols-8" : "sm:grid-cols-2"}`}>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Players</span>
        <select value={settings.players} onChange={(e) => updateSetting("players", Number(e.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Max hand</span>
        <select value={settings.maxHand} onChange={(e) => updateSetting("maxHand", Number(e.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          {Array.from({ length: Math.min(10, maxAllowedHand(settings.players)) - 2 }, (_, i) => i + 3).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Difficulty</span>
        <select value={settings.difficulty} onChange={(e) => updateSetting("difficulty", e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
          <option value="extreme">Extreme</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Bot speed</span>
        <select value={settings.botSpeed} onChange={(e) => updateSetting("botSpeed", Number(e.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          <option value={250}>Fast</option>
          <option value={450}>Normal</option>
          <option value={750}>Slow</option>
        </select>
      </label>
      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
        <input type="checkbox" checked={settings.screwDealer} onChange={(e) => updateSetting("screwDealer", e.target.checked)} />
        <span>Screw the dealer</span>
      </label>
      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
        <input type="checkbox" checked={settings.helper} onChange={(e) => updateSetting("helper", e.target.checked)} />
        <span>Helper</span>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Samples</span>
        <select value={settings.samples} onChange={(e) => updateSetting("samples", Number(e.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          <option value={25}>25 — Fast</option>
          <option value={60}>60 — Normal</option>
          <option value={120}>120 — Sharp</option>
          <option value={250}>250 — Strong</option>
          <option value={500}>500 — Max</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Colour</span>
        <select value={settings.colorTheme ?? "river"} onChange={(e) => updateSetting("colorTheme", e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          <option value="river">River</option>
          <option value="casino">Casino</option>
          <option value="sunset">Sunset</option>
          <option value="neon">Neon</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Cards</span>
        <select value={settings.cardTheme ?? "classic"} onChange={(e) => updateSetting("cardTheme", e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          <option value="classic">Classic</option>
          <option value="parchment">Parchment</option>
          <option value="midnight">Midnight</option>
          <option value="neon">Neon</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-slate-400">Win effect</span>
        <select value={settings.winAnimation ?? "confetti"} onChange={(e) => updateSetting("winAnimation", e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
          <option value="confetti">Confetti</option>
          <option value="sparkles">Sparkles</option>
          <option value="pulse">Pulse</option>
          <option value="none">None</option>
        </select>
      </label>
      {action}
    </div>
  );
}

function CardButton({ card, disabled, onClick, small = false, highlighted = false, viewing = false, faded = false, outcome = null, winning = false, engine = false }) {
  const { cardTheme = "classic" } = React.useContext(ThemeContext);
  const cardStyles = {
    classic: { base: "bg-white text-slate-950 border-slate-200", black: "text-slate-950", red: "text-red-600", suit: "" },
    parchment: { base: "bg-amber-50 text-stone-950 border-amber-300", black: "text-stone-950", red: "text-rose-700", suit: "drop-shadow-sm" },
    midnight: { base: "bg-slate-950 text-slate-100 border-indigo-300", black: "text-slate-100", red: "text-pink-300", suit: "drop-shadow-[0_0_8px_rgba(129,140,248,0.45)]" },
    neon: { base: "bg-zinc-950 text-cyan-100 border-cyan-300 shadow-cyan-500/20", black: "text-cyan-100", red: "text-fuchsia-300", suit: "drop-shadow-[0_0_10px_rgba(34,211,238,0.7)]" },
  };
  const cardStyle = cardStyles[cardTheme] ?? cardStyles.classic;
  const rankColor = isRed(card) ? cardStyle.red : cardStyle.black;
  let ringClass;
  if (winning) {
    ringClass = "border-emerald-400 ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-slate-900 shadow-emerald-400/40 shadow-lg";
  } else if (engine) {
    ringClass = "border-violet-400 ring-2 ring-violet-400/60 ring-offset-2 ring-offset-slate-950 shadow-violet-400/25 shadow-md";
  } else if (outcome === "win") {
    ringClass = "border-emerald-400 ring-2 ring-emerald-400/60 ring-offset-2 ring-offset-slate-950";
  } else if (outcome === "lose") {
    ringClass = "border-red-400 ring-2 ring-red-400/50 ring-offset-2 ring-offset-slate-950";
  } else if (highlighted) {
    ringClass = "border-amber-400 ring-2 ring-amber-400/60 ring-offset-2 ring-offset-slate-950 shadow-amber-400/30 shadow-lg";
  } else {
    ringClass = "border-slate-200";
  }
  return (
    <button
      type="button"
      disabled={!viewing && disabled}
      onClick={viewing ? undefined : onClick}
      className={[
        "relative rounded-2xl border shadow",
        cardStyle.base,
        small ? "h-16 w-12 text-xs" : "h-24 w-16 text-base",
        ringClass,
        viewing ? "cursor-default" : "transition hover:-translate-y-1 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-35",
        faded && !viewing ? "opacity-60" : "",
      ].join(" ")}
      title={cardText(card)}
    >
      {card.joker ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center">
          <span className="text-2xl">🃏</span>
          <span className="text-[10px] font-bold uppercase tracking-wide">Joker</span>
        </div>
      ) : (
        <>
          <span className={`absolute left-2 top-1 font-bold ${rankColor}`}>{card.rank}</span>
          <span className={`text-3xl ${rankColor} ${cardStyle.suit}`}>{card.suit}</span>
          <span className={`absolute bottom-1 right-2 rotate-180 font-bold ${rankColor}`}>{card.rank}</span>
        </>
      )}
    </button>
  );
}

function HelpModal({ mode, onClose }) {
  if (!mode) return null;
  const isTutorial = mode === "tutorial";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{isTutorial ? "Tutorial" : "Rules"}</div>
            <h2 className="text-2xl font-black text-white">{isTutorial ? "How to play" : "Rule reference"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">Close</button>
        </div>

        {isTutorial ? (
          <div className="space-y-4 text-sm text-slate-300">
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">1. Look at your hand and trump</h3>
              <p>Each round starts with a hand size and a turned-up trump card. Trump cards beat non-trump cards. If a joker is turned up, the other joker is the only trump.</p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">2. Bid how many tricks you will win</h3>
              <p>If you think your hand can win two tricks, bid 2. Exact bids are worth the most points. Bidding 0 is valid and scores well if you take no tricks.</p>
              <div className="mt-3 rounded-xl bg-slate-800 p-3 font-mono text-xs text-slate-300">
                Example: you bid 2. If you win exactly 2 tricks, you score 12 points. If you win 1 or 3, you only score the tricks you took.
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">3. Follow suit, or use trump</h3>
              <p>The first card played sets the led suit. If you have that suit, you must follow it, but trump is also legal. If you do not have the led suit, you may play anything.</p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">4. Win or dodge tricks to hit your bid</h3>
              <p>The highest card in the led suit wins unless trump is played. The highest trump wins. Your goal is not always to win every trick; it is to land exactly on your bid.</p>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">5. Hand sizes go down, then back up</h3>
              <p>A game starts at the max hand size, counts down to 1 card, then climbs back up. Scores accumulate across all rounds.</p>
            </section>
          </div>
        ) : (
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">Rounds</h3>
              <p>Hands go down from the max hand to 1, then back up to the max hand.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">Bidding</h3>
              <p>Each player bids the number of tricks they expect to take. Screw the dealer prevents the final bidder from making total bids equal the hand size.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">Legal play</h3>
              <p>If you have the led suit, you must play that suit or trump. If you are void in the led suit, you may play anything.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">Winning tricks</h3>
              <p>Highest led suit wins unless trump is played. Highest trump wins the trick.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">Jokers</h3>
              <p>With suited trump, jokers are 1 of trump. Any suited trump card beats them. If a joker is turned up, the other joker is the only trump and beats everything.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="mb-2 font-bold text-white">Scoring</h3>
              <p>Exact bid scores tricks + 10. Exact 0 scores 5. Missed bids score tricks only.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#f97316", "#ef4444", "#14b8a6"];

function Confetti() {
  const particles = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: Math.random() * 7 + 4,
        delay: Math.random() * 1.4,
        duration: Math.random() * 1.8 + 2,
        round: Math.random() > 0.45,
      })),
    []
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      {particles.map((p) => (
        <div
          key={p.key}
          className="absolute top-0 animate-confetti-fall"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.round ? "50%" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

function SparkleBurst() {
  const particles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        key: i,
        left: 10 + Math.random() * 80,
        top: 8 + Math.random() * 55,
        delay: Math.random() * 0.8,
      })),
    []
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      {particles.map((p) => (
        <span
          key={p.key}
          className="absolute animate-sparkle text-2xl"
          style={{ left: `${p.left}%`, top: `${p.top}%`, animationDelay: `${p.delay}s` }}
        >
          ✨
        </span>
      ))}
    </div>
  );
}

function WinEffect({ type }) {
  if (type === "none") return null;
  if (type === "sparkles") return <SparkleBurst />;
  if (type === "pulse") return <div className="pointer-events-none absolute inset-0 rounded-3xl border border-amber-300/40 animate-pulse-glow" />;
  return <Confetti />;
}

function WinPopup({ popup, onDismiss, onPlayAgain, onCopyGameLog, copyStatus }) {
  const { winAnimation = "confetti" } = React.useContext(ThemeContext);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { setLeaving(false); }, [popup]);
  if (!popup) return null;

  function dismiss() {
    setLeaving(true);
    setTimeout(onDismiss, 280);
  }

  /* ── Tier 0: Trump reveal — auto-dismissing round-start modal ── */
  if (popup.type === "trump") {
    const { trumpSuit, trumpCard, handSize, roundIndex, totalRounds, hand = [] } = popup.data;
    const noTrump = !trumpSuit;
    const isRedSuit = trumpSuit === "♥" || trumpSuit === "♦";
    const suitColor = noTrump || trumpSuit === JOKER_TRUMP ? "text-amber-400" : isRedSuit ? "text-red-400" : "text-slate-100";
    const borderColor = noTrump ? "border-amber-500/30" : isRedSuit ? "border-red-500/25" : "border-white/12";
    const barColor = noTrump ? "bg-amber-400" : isRedSuit ? "bg-red-400" : "bg-slate-400";
    const trumpCount = hand.filter((c) => isTrump(c, trumpSuit)).length;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={dismiss}>
        <div className={`mx-4 w-full max-w-md rounded-3xl border bg-slate-900 shadow-2xl ${borderColor} ${leaving ? "animate-fade-out" : "animate-pop-in"}`}>
          {/* Trump info */}
          <div className="px-7 pt-7 pb-5 text-center">
            <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Round {roundIndex + 1} of {totalRounds} · {handSize} card{handSize === 1 ? "" : "s"}
            </div>
            <div className={`mb-2 text-8xl leading-none ${suitColor}`}>{noTrump ? "🃏" : trumpSuit}</div>
            <h2 className={`mt-3 text-2xl font-black ${noTrump ? "text-amber-300" : "text-white"}`}>
              {noTrump ? "No Trump" : trumpName(trumpSuit)}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {trumpSuit === JOKER_TRUMP ? "Joker turned up - the other joker is trump" : noTrump ? "No trump this round" : `Turned up: ${cardText(trumpCard)}`}
            </p>
          </div>

          {/* Hand */}
          {hand.length > 0 && (
            <div className="border-t border-white/10 px-5 pb-6 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Your hand</span>
                {trumpSuit && trumpCount > 0 && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    {trumpCount} trump
                  </span>
                )}
              </div>
              <div className="pointer-events-none flex flex-wrap justify-center gap-2">
                {hand.map((card) => (
                  <CardButton
                    key={card.id}
                    card={card}
                    viewing
                    small
                    highlighted={!!trumpSuit && isTrump(card, trumpSuit)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Progress bar */}
          <div className="px-7 pb-5">
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${barColor}`} style={{ animation: "shrinkBar 5s linear forwards" }} />
            </div>
            <p className="mt-2 text-center text-xs text-slate-600">Tap to dismiss</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Tier 1: Trick win — subtle floating pill ── */
  if (popup.type === "trick") {
    return (
      <div className={`pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 ${leaving ? "animate-fade-out" : "animate-slide-down"}`}>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-slate-900/90 px-5 py-2.5 shadow-lg backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold text-emerald-300">Trick won</span>
        </div>
      </div>
    );
  }

  /* ── Tier 2: Exact bid — medium modal with sparkles ── */
  if (popup.type === "round") {
    const { bid, roundScore, score } = popup.data;
    const isNil = bid === 0;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm">
        <div className={`relative mx-4 w-full max-w-xs overflow-hidden rounded-3xl border border-emerald-500/25 bg-slate-900 p-8 text-center shadow-2xl animate-pulse-glow ${leaving ? "animate-fade-out" : "animate-pop-in"}`}>
          <div className="relative mb-3 inline-block">
            <span className="text-6xl">{isNil ? "🚫" : "🎯"}</span>
            {["top-0 -right-3", "top-2 -left-4", "-bottom-1 right-2"].map((pos) => (
              <span key={pos} className={`absolute ${pos} animate-sparkle text-xl`} style={{ animationDelay: `${Math.random() * 0.5}s` }}>✨</span>
            ))}
          </div>
          <h2 className="mb-1 text-2xl font-bold text-white">{isNil ? "Perfect Nil!" : "Exact Bid!"}</h2>
          <p className="text-sm text-slate-400">{isNil ? "Bid 0 · took 0 tricks" : `Bid ${bid} · took ${bid} trick${bid === 1 ? "" : "s"}`}</p>
          <div className="my-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 py-4">
            <div className="text-4xl font-black text-emerald-400">+{roundScore}</div>
            <div className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-emerald-600">points earned</div>
          </div>
          <p className="mb-5 text-sm text-slate-400">Running total: <span className="font-bold text-slate-200">{score} pts</span></p>
          <button type="button" onClick={dismiss} className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 font-semibold text-white shadow-lg hover:bg-emerald-400">
            Keep going →
          </button>
        </div>
      </div>
    );
  }

  /* ── Tier 3: Game over — full celebration with confetti ── */
  if (popup.type === "game") {
    const { won, score, players } = popup.data;
    const sorted = [...players].sort((a, b) => b.score - a.score);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md">
        <div className={`relative mx-4 w-full max-w-sm overflow-hidden rounded-3xl text-center shadow-2xl ${leaving ? "animate-fade-out" : "animate-pop-in"}`}
          style={{ background: won ? "linear-gradient(160deg,#1c1a10 0%,#0f172a 60%)" : "#0f172a", border: won ? "1px solid rgba(251,191,36,0.3)" : "1px solid rgba(255,255,255,0.08)" }}>
          {won && <WinEffect type={winAnimation} />}
          <div className="relative p-8">
            <div className={`mb-2 text-7xl ${won ? "animate-trophy-bounce inline-block" : ""}`}>{won ? "🏆" : "🃏"}</div>
            <h2 className={`mb-1 text-4xl font-black ${won ? "text-amber-300" : "text-white"}`}>{won ? "You Win!" : "Game Over"}</h2>
            <p className="mb-5 text-sm text-slate-400">
              {won ? `You topped the table with ${score} points` : `You scored ${score} — better luck next time`}
            </p>
            <div className="mb-5 overflow-hidden rounded-2xl border border-white/8">
              {sorted.map((p, rank) => (
                <div key={p.id} className={`flex items-center justify-between px-4 py-2.5 text-sm ${rank === 0 ? "bg-amber-500/15 text-amber-200" : rank === 1 ? "bg-slate-800/80 text-slate-300" : "bg-slate-800/50 text-slate-400"} ${rank > 0 ? "border-t border-white/5" : ""}`}>
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="w-4 text-center text-xs">{rank === 0 ? "👑" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `${rank + 1}.`}</span>
                    {p.name}
                  </span>
                  <span className={`font-bold ${rank === 0 ? "text-amber-300" : ""}`}>{p.score} pts</span>
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={onCopyGameLog}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-3 font-bold text-slate-100 shadow-lg hover:bg-slate-700"
              >
                Copy Game Log
              </button>
              {copyStatus && <p className="text-xs text-slate-400">{copyStatus}</p>}
              <button
                type="button"
                onClick={() => { dismiss(); setTimeout(onPlayAgain, 280); }}
                className={`w-full rounded-xl px-4 py-3 font-bold shadow-lg ${won ? "bg-amber-400 text-slate-900 hover:bg-amber-300" : "bg-white text-slate-950 hover:bg-slate-200"}`}
              >
                {won ? "🎉 Play Again" : "Play Again"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function UpDownRiverGame() {
  const profile = useMemo(() => loadMultiplayerProfile(), []);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [game, setGame] = useState(() => newGame(DEFAULT_SETTINGS));
  const [screen, setScreen] = useState("start");
  const [isOnlineGame, setIsOnlineGame] = useState(false);
  const [savedGame, setSavedGame] = useState(() => loadSavedGame());
  const [mpName, setMpName] = useState(profile.name ?? "");
  const [mpCode, setMpCode] = useState(() => new URLSearchParams(window.location.search).get("room")?.toUpperCase().slice(0, 4) ?? "");
  const [mpBots, setMpBots] = useState(1);
  const [mpRoom, setMpRoom] = useState(null);
  const [mpPlayerId, setMpPlayerId] = useState(null);
  const [mpToken, setMpToken] = useState(null);
  const [mpError, setMpError] = useState("");
  const [mpConnected, setMpConnected] = useState(false);
  const [mpBusy, setMpBusy] = useState(false);
  const [mpCopyStatus, setMpCopyStatus] = useState("");
  const [helpMode, setHelpMode] = useState(null);
  const [popup, setPopup] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const socketRef = useRef(null);
  const prevRef = useRef({ phase: null, lastTrick: null });

  const order = useMemo(() => orderFromDealer(game.dealer, game.players.length), [game.dealer, game.players.length]);
  const biddingPlayer = game.phase === "bidding" ? order[game.bidIndex] : null;
  const humanIndex = game.youIndex ?? 0;
  const humanBidTurn = game.phase === "bidding" && biddingPlayer === humanIndex;
  const humanPlayTurn = game.phase === "playing" && game.turn === humanIndex;
  const trickLeadIndex = game.trick.length > 0
    ? game.trick[0].playerIndex
    : (game.phase === "bidding" ? order[0] : game.turn);
  const human = game.players[humanIndex] ?? game.players[0];
  const humanLegalCards = humanPlayTurn ? new Set(legalCards(human.hand, game.trick, game.trumpSuit).map((c) => c.id)) : new Set();
  const humanLegalBids = humanBidTurn ? legalBids(game, humanIndex) : [];

  const helperAnalysis = useMemo(() => {
    if (!settings.helper || isOnlineGame) return null;
    const isBid = game.phase === "bidding" && game.turn === humanIndex;
    const isPlay = game.phase === "playing" && game.turn === humanIndex;
    if (!isBid && !isPlay) return null;
    const n = game.players.length;

    if (isBid) {
      const unseen = getUnseenCards(game, humanIndex);
      const leader = (game.dealer + 1) % n;
      const counts = new Array(game.handSize + 1).fill(0);
      const bidSims = settings.samples;
      for (let s = 0; s < bidSims; s++) {
        const hands = dealDeterminization(game, 0, unseen);
        const won = playoutRound(hands, [], leader, game.trumpSuit,
          game.players.map(() => game.handSize + 1), game.players.map(() => 0), n);
        counts[Math.min(won[humanIndex], game.handSize)] += 1;
      }
      let suggested = 0, bestCount = -1;
      for (let b = 0; b <= game.handSize; b++) if (counts[b] > bestCount) { bestCount = counts[b]; suggested = b; }
      return { type: "bid", suggested, confidence: bestCount / bidSims };
    }

    const options = legalCards(game.players[humanIndex].hand, game.trick, game.trumpSuit);
    if (options.length === 1) return { type: "play", ranked: [{ card: options[0], hitRate: 1, meanErr: 0 }] };
    const unseen = getUnseenCards(game, humanIndex);
    const bids = game.players.map((p) => p.bid);
    const baseTricks = game.players.map((p) => p.tricks);
    const sims = settings.samples;
    const target = bids[humanIndex];
    const ranked = options.map((cand) => {
      let hit = 0, err = 0;
      for (let s = 0; s < sims; s++) {
        const hands = dealDeterminization(game, 0, unseen);
        hands[humanIndex] = hands[humanIndex].filter((c) => c.id !== cand.id);
        const trick = [...game.trick, { playerIndex: humanIndex, card: cand }];
        const won = playoutRound(hands, trick, (humanIndex + 1) % n, game.trumpSuit, bids, baseTricks, n);
        if (won[humanIndex] === target) hit++;
        err += Math.abs(won[humanIndex] - target);
      }
      return { card: cand, hitRate: hit / sims, meanErr: err / sims };
    }).sort((a, b) => b.hitRate - a.hitRate || a.meanErr - b.meanErr);
    return { type: "play", ranked };
  }, [game, settings.helper, settings.samples, humanIndex, isOnlineGame]); // eslint-disable-line react-hooks/exhaustive-deps
  const leader = [...game.players].sort((a, b) => b.score - a.score)[0];
  const gameLogText = useMemo(() => (game.auditLog ?? []).join("\n"), [game.auditLog]);
  const savedGameSummary = savedGame
    ? `Round ${savedGame.roundIndex + 1}/${savedGame.sequence.length} · ${savedGame.handSize} cards · ${savedGame.phase === "gameEnd" ? "game over" : savedGame.phase}`
    : null;
  const mpShareUrl = mpRoom ? `${window.location.origin}${window.location.pathname}?room=${mpRoom.code}` : "";

  useEffect(() => {
    if (screen !== "game" || isOnlineGame) return undefined;
    if (game.phase === "bidding" && biddingPlayer !== null && !game.players[biddingPlayer].isHuman) {
      const timer = setTimeout(() => {
        setGame((prev) => {
          const ord = orderFromDealer(prev.dealer, prev.players.length);
          const idx = ord[prev.bidIndex];
          if (prev.phase !== "bidding" || prev.players[idx].isHuman) return prev;
          return submitBid(prev, chooseBid(prev, idx));
        });
      }, game.settings.botSpeed);
      return () => clearTimeout(timer);
    }

    if (game.phase === "playing" && game.turn !== null && !game.players[game.turn].isHuman) {
      const timer = setTimeout(() => {
        setGame((prev) => {
          if (prev.phase !== "playing" || prev.turn === null || prev.players[prev.turn].isHuman) return prev;
          const chosen = chooseCard(prev, prev.turn);
          return playCard(prev, prev.turn, chosen.id);
        });
      }, game.settings.botSpeed);
      return () => clearTimeout(timer);
    }

    if (game.phase === "trickPause") {
      const timer = setTimeout(() => {
        setGame((prev) => prev.phase === "trickPause" ? resolveTrick(prev) : prev);
      }, game.settings.botSpeed + 300);
      return () => clearTimeout(timer);
    }
  }, [game, biddingPlayer, screen, isOnlineGame]);

  useEffect(() => {
    if (screen !== "game") return;
    const prev = prevRef.current;

    if (game.phase === "bidding" && prev.phase !== "bidding") {
      setPopup({ type: "trump", data: { trumpSuit: game.trumpSuit, trumpCard: game.trumpCard, handSize: game.handSize, roundIndex: game.roundIndex, totalRounds: game.sequence.length, hand: game.players[humanIndex]?.hand ?? [] } });
    } else if (game.phase === "roundEnd" && prev.phase !== "roundEnd") {
      const p = game.players[humanIndex];
      if (p.bid === p.tricks) {
        setPopup({ type: "round", data: { bid: p.bid, roundScore: p.roundScore, score: p.score } });
      }
    } else if (game.phase === "gameEnd" && prev.phase !== "gameEnd") {
      const maxScore = Math.max(...game.players.map((p) => p.score));
      setPopup({ type: "game", data: { won: game.players[humanIndex]?.score === maxScore, score: game.players[humanIndex]?.score ?? 0, players: game.players } });
    } else if (game.phase === "playing" && game.lastTrick !== prev.lastTrick && game.lastTrick?.winnerIndex === humanIndex) {
      setPopup({ type: "trick" });
    }

    prevRef.current = { phase: game.phase, lastTrick: game.lastTrick };
  }, [game.phase, game.lastTrick, screen, humanIndex]);

  useEffect(() => {
    if (popup?.type === "trick") {
      const t = setTimeout(() => setPopup(null), 1800);
      return () => clearTimeout(t);
    }
    if (popup?.type === "trump") {
      const t = setTimeout(() => setPopup(null), 5000);
      return () => clearTimeout(t);
    }
  }, [popup]);

  useEffect(() => {
    if (screen !== "game" || isOnlineGame) return;
    saveGame(game);
    setSavedGame(game);
  }, [game, screen, isOnlineGame]);

  useEffect(() => () => {
    socketRef.current?.close();
  }, []);

  function updateSetting(key, value) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      return { ...next, maxHand: Math.min(next.maxHand, maxAllowedHand(next.players)) };
    });
  }

  function connectMultiplayer(payload) {
    setMpError("");
    setMpCopyStatus("");
    setMpBusy(true);
    saveMultiplayerProfile({ name: mpName.trim() });
    socketRef.current?.close();
    const ws = new WebSocket(multiplayerUrl());
    socketRef.current = ws;
    ws.onopen = () => {
      setMpConnected(true);
      ws.send(JSON.stringify(payload));
    };
    ws.onclose = () => {
      setMpConnected(false);
      setMpBusy(false);
    };
    ws.onerror = () => {
      setMpBusy(false);
      setMpError(`Could not connect to the multiplayer server at ${multiplayerUrl()}.`);
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "error") {
        setMpBusy(false);
        setMpError(msg.message);
        return;
      }
      if (msg.type !== "room") return;
      setMpBusy(false);
      setMpRoom(msg.room);
      setMpPlayerId(msg.playerId);
      setMpToken(msg.token);
      setMpCode(msg.room.code);
      window.history.replaceState(null, "", `${window.location.pathname}?room=${msg.room.code}`);
      saveMultiplayerSession(msg.room.code, { token: msg.token, playerId: msg.playerId, name: mpName.trim() });
      if (msg.game) {
        setIsOnlineGame(true);
        setSettings(msg.game.settings ?? settings);
        setGame(msg.game);
        setScreen("game");
      }
    };
  }

  function sendMultiplayer(payload) {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setMpError("Disconnected from the room.");
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  function createMultiplayerRoom() {
    const name = mpName.trim();
    if (!name) {
      setMpError("Enter a name first.");
      return;
    }
    connectMultiplayer({ type: "create", name, settings, bots: mpBots });
  }

  function joinMultiplayerRoom() {
    const name = mpName.trim();
    const code = mpCode.trim().toUpperCase();
    if (!name || code.length !== 4) {
      setMpError("Enter your name and a 4-character room code.");
      return;
    }
    const saved = loadMultiplayerSessions()[code];
    connectMultiplayer({ type: "join", name, code, token: saved?.token });
  }

  async function copyRoomLink() {
    if (!mpShareUrl) return;
    try {
      await navigator.clipboard.writeText(mpShareUrl);
      setMpCopyStatus("Copied link");
    } catch {
      setMpCopyStatus(mpShareUrl);
    }
  }

  function startGame() {
    setCopyStatus("");
    setIsOnlineGame(false);
    const nextGame = newGame(settings);
    prevRef.current = { phase: null, lastTrick: null };
    setPopup(null);
    setGame(nextGame);
    saveGame(nextGame);
    setSavedGame(nextGame);
    setScreen("game");
  }

  function resumeGame() {
    if (!savedGame) return;
    setCopyStatus("");
    setIsOnlineGame(false);
    setSettings(savedGame.settings ?? settings);
    prevRef.current = { phase: savedGame.phase, lastTrick: savedGame.lastTrick };
    setPopup(null);
    setGame(savedGame);
    setScreen("game");
  }

  function returnToStart() {
    setPopup(null);
    setSettingsOpen(false);
    setHelpMode(null);
    if (isOnlineGame) {
      socketRef.current?.close();
      setIsOnlineGame(false);
    }
    window.history.replaceState(null, "", window.location.pathname);
    setScreen("start");
  }

  function forgetSavedGame() {
    clearSavedGame();
    setSavedGame(null);
  }

  async function copyFullGameLog() {
    if (!gameLogText) return;
    try {
      await navigator.clipboard.writeText(gameLogText);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Select and copy from the box");
    }
  }

  if (screen === "start") {
    return (
      <ThemeContext.Provider value={settings}>
      <div className={`min-h-screen p-4 ${shellThemeClass(settings.colorTheme)}`}>
        <HelpModal mode={helpMode} onClose={() => setHelpMode(null)} />
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center">
          <main className="grid w-full gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="flex min-h-80 flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
              <div>
                <div className="mb-6 flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-3xl text-slate-950">♠</div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">Up and Down the River</h1>
                    <p className="text-sm text-slate-400">Trick-taking bids, trump swings, exact-score pressure.</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {["A♠", "K♥", "Q♦", "J♣"].map((label, i) => (
                    <div key={label} className={`aspect-[3/4] rounded-2xl border bg-white p-2 text-slate-950 shadow-xl ${i % 2 ? "text-red-600" : ""}`}>
                      <div className="text-sm font-black">{label.slice(0, -1)}</div>
                      <div className="grid h-full place-items-center text-4xl">{label.slice(-1)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 grid gap-2">
                <button type="button" onClick={startGame} className="rounded-xl bg-white px-4 py-3 font-bold text-slate-950 shadow hover:bg-slate-200">
                  New Game
                </button>
                <button type="button" onClick={() => setHelpMode("tutorial")} className="rounded-xl border border-white/10 bg-slate-800 px-4 py-3 font-bold text-slate-100 hover:bg-slate-700">
                  Tutorial
                </button>
                <button type="button" onClick={() => setHelpMode("rules")} className="rounded-xl border border-white/10 bg-slate-800 px-4 py-3 font-bold text-slate-100 hover:bg-slate-700">
                  Rules
                </button>
                <button
                  type="button"
                  disabled={!savedGame}
                  onClick={resumeGame}
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-3 font-bold text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Resume Game
                </button>
                {savedGameSummary && (
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span>{savedGameSummary}</span>
                    <button type="button" onClick={forgetSavedGame} className="text-slate-500 underline hover:text-slate-300">clear</button>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl">
              <div className="mb-4">
                <h2 className="text-xl font-bold">Settings</h2>
                <p className="text-sm text-slate-400">Choose the table before starting a new game.</p>
              </div>
              <SettingsControls settings={settings} updateSetting={updateSetting} />
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl lg:col-span-2">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Online Multiplayer</h2>
                  <p className="text-sm text-slate-400">Create a room, share the link, and reconnect with the same browser if you drop.</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-600">Server: {multiplayerHttpUrl()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mpRoom?.serverId && <Badge>Server {mpRoom.serverId}</Badge>}
                  <Badge tone={mpConnected ? "green" : "slate"}>{mpConnected ? "Connected" : "Offline"}</Badge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_0.7fr_auto_auto]">
                <label className="space-y-1">
                  <span className="text-xs text-slate-400">Name</span>
                  <input value={mpName} onChange={(e) => setMpName(e.target.value)} maxLength={24} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-slate-400">Room code</span>
                  <input value={mpCode} onChange={(e) => setMpCode(e.target.value.toUpperCase().slice(0, 4))} maxLength={4} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 uppercase tracking-[0.35em]" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-slate-400">Bots</span>
                  <select value={mpBots} onChange={(e) => setMpBots(Number(e.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
                    {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
                  <button type="button" disabled={mpBusy} onClick={createMultiplayerRoom} className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-50">{mpBusy ? "..." : "Create"}</button>
                  <button type="button" disabled={mpBusy} onClick={joinMultiplayerRoom} className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50">Join</button>
                </div>
              </div>

              {mpError && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">{mpError}</div>}

              {mpRoom?.status === "lobby" && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-widest text-slate-500">Room code</div>
                      <div className="font-mono text-4xl font-black tracking-[0.35em] text-white">{mpRoom.code}</div>
                      <div className="mt-1 break-all text-xs text-slate-500">{mpShareUrl}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={copyRoomLink} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">Copy link</button>
                      {mpRoom.hostId === mpPlayerId && (
                        <>
                          <button type="button" onClick={() => sendMultiplayer({ type: "addBot" })} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">Add bot</button>
                          <button type="button" onClick={() => sendMultiplayer({ type: "removeBot" })} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">Remove bot</button>
                          <button type="button" onClick={() => sendMultiplayer({ type: "start" })} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-400">Start</button>
                        </>
                      )}
                    </div>
                  </div>
                  {mpCopyStatus && <div className="mb-3 text-xs text-slate-400">{mpCopyStatus}</div>}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {mpRoom.seats.map((seat) => (
                      <div key={seat.id} className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2">
                        <div className="font-semibold text-slate-100">{seat.name}</div>
                        <div className="text-xs text-slate-500">{seat.isBot ? "bot" : seat.connected ? "connected" : "disconnected"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </main>
        </div>
      </div>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={settings}>
    <div className={`min-h-screen p-4 ${shellThemeClass(settings.colorTheme)}`}>
      <HelpModal mode={helpMode} onClose={() => setHelpMode(null)} />
      <WinPopup popup={popup} onDismiss={() => setPopup(null)} onPlayAgain={startGame} onCopyGameLog={copyFullGameLog} copyStatus={copyStatus} />
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-3xl border border-white/10 bg-white/10 px-5 py-3 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-bold tracking-tight">Up and Down the River</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">Round {game.roundIndex + 1}/{game.sequence.length}</Badge>
              <Badge>{game.handSize} cards</Badge>
              <Badge tone="amber">Dealer: {game.players[game.dealer].name}</Badge>
              {isOnlineGame && <Badge tone="green">Room {mpRoom?.code}</Badge>}
              <button type="button" onClick={returnToStart} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800">
                Menu
              </button>
              <button type="button" onClick={() => setHelpMode("rules")} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800">
                Rules
              </button>
              <button type="button" onClick={() => setSettingsOpen((v) => !v)} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800">
                {settingsOpen ? "✕ Close" : "⚙ Settings"}
              </button>
            </div>
          </div>
          {settingsOpen && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <SettingsControls
                settings={settings}
                updateSetting={updateSetting}
                compact
                action={(
                  <button type="button" onClick={() => { startGame(); setSettingsOpen(false); }} className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 shadow hover:bg-slate-200">
                    New game
                  </button>
                )}
              />
            </div>
          )}
        </header>

        <main className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl">
              {/* Trump banner */}
              {(() => {
                const noTrump = !game.trumpSuit;
                const isRedSuit = game.trumpSuit === "♥" || game.trumpSuit === "♦";
                const bg = noTrump || game.trumpSuit === JOKER_TRUMP ? "bg-amber-500/10 border-amber-500/20" : isRedSuit ? "bg-red-500/10 border-red-500/20" : "bg-slate-800/60 border-white/10";
                const suitColor = noTrump || game.trumpSuit === JOKER_TRUMP ? "text-amber-400" : isRedSuit ? "text-red-400" : "text-slate-200";
                return (
                  <div className={`mb-4 flex items-center gap-4 rounded-2xl border px-4 py-3 ${bg}`}>
                    <span className={`text-5xl leading-none ${suitColor}`}>{noTrump ? "🃏" : game.trumpSuit}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Trump</div>
                      <div className={`text-xl font-black ${suitColor}`}>{noTrump ? "No Trump" : trumpName(game.trumpSuit)}</div>
                      <div className="text-xs text-slate-500">{game.trumpSuit === JOKER_TRUMP ? "Other joker is trump" : noTrump ? "No trump" : cardText(game.trumpCard)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</div>
                      <div className="text-sm font-semibold text-slate-200">
                {game.phase === "bidding" && (humanBidTurn ? "Your bid" : `${game.players[biddingPlayer]?.name} bidding`)}
                {game.phase === "playing" && (humanPlayTurn ? "Your turn" : `${game.players[game.turn]?.name} playing`)}
                        {game.phase === "trickPause" && "Trick complete"}
                        {game.phase === "roundEnd" && "Round over"}
                        {game.phase === "gameEnd" && "Game over"}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="grid gap-3 md:grid-cols-2">
                {game.phase === "bidding" ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold">Bidding</h3>
                      <span className="text-xs text-slate-400">
                        Total so far: <span className="font-bold text-white">{game.players.reduce((s, p) => s + (p.bid ?? 0), 0)}</span> / {game.handSize}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {order.map((idx) => {
                        const p = game.players[idx];
                        const isCurrent = idx === biddingPlayer;
                        const isDone = p.bid !== null;
                        return (
                          <div key={idx} className={[
                            "flex-1 rounded-xl border px-2 py-3 text-center transition-all",
                            isCurrent ? "border-blue-400/50 bg-blue-950/60 shadow-lg shadow-blue-900/30"
                              : isDone ? "border-emerald-500/25 bg-emerald-950/20"
                              : "border-white/8 bg-slate-800/40 opacity-50",
                          ].join(" ")}>
                            <div className="mb-1 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">{p.name}</div>
                            {isDone ? (
                              <div className="text-3xl font-black text-white">{p.bid}</div>
                            ) : isCurrent ? (
                              <div className="text-sm font-semibold text-blue-300 animate-pulse">…</div>
                            ) : (
                              <div className="text-xl font-bold text-slate-600">—</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-semibold">Current trick</h3>
                      <Badge tone="green">Lead: {game.players[trickLeadIndex]?.name ?? "—"}</Badge>
                    </div>
                    {(() => {
                      const trickWinner = game.trick.length ? winningPlay(game.trick, game.trumpSuit) : null;
                      return (
                        <div className="flex min-h-24 flex-wrap gap-3">
                          {game.trick.length ? game.trick.map((play) => (
                            <div key={`${play.playerIndex}-${play.card.id}`} className="text-center">
                              <CardButton card={play.card} small viewing winning={play.card.id === trickWinner?.card.id} />
                              <div className="mt-1 max-w-16 truncate text-xs text-slate-300">{game.players[play.playerIndex].name}</div>
                            </div>
                          )) : <p className="text-sm text-slate-400">No cards played yet.</p>}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                  <h3 className="mb-2 font-semibold">Last trick</h3>
                  {game.lastTrick ? (
                    <div>
                      <p className="mb-2 text-sm text-slate-300">Winner: {game.players[game.lastTrick.winnerIndex].name}</p>
                      <div className="flex flex-wrap gap-2">
                        {game.lastTrick.plays.map((play) => <CardButton key={`${play.playerIndex}-${play.card.id}`} card={play.card} small viewing />)}
                      </div>
                    </div>
                  ) : <p className="text-sm text-slate-400">No completed trick yet.</p>}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl">
              <h2 className="mb-3 text-xl font-semibold">Your hand</h2>

              {settings.helper && !isOnlineGame && (
                <div className="mb-4 rounded-2xl border border-violet-500/20 bg-slate-900/60 p-3">
                  {/* Engine analysis */}
                  <div className="mb-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Engine</span>
                      {helperAnalysis?.type === "bid" && (
                        <span className="text-xs text-slate-300">
                          Suggest bid: <span className="font-bold text-violet-300">{helperAnalysis.suggested}</span>
                          <span className="ml-1 text-slate-500">({(helperAnalysis.confidence * 100).toFixed(0)}% likely)</span>
                        </span>
                      )}
                      {helperAnalysis?.type === "play" && helperAnalysis.ranked.length > 0 && (
                        <span className="text-xs text-slate-300">
                          Best:{" "}
                          <span className={`font-bold ${isTrump(helperAnalysis.ranked[0].card, game.trumpSuit) ? "text-amber-300" : (helperAnalysis.ranked[0].card.suit === "♥" || helperAnalysis.ranked[0].card.suit === "♦") ? "text-red-300" : "text-violet-300"}`}>
                            {cardText(helperAnalysis.ranked[0].card)}
                          </span>
                          <span className="ml-1 text-slate-500">({(helperAnalysis.ranked[0].hitRate * 100).toFixed(0)}% hit bid)</span>
                        </span>
                      )}
                      {!helperAnalysis && (
                        <span className="text-[10px] text-slate-600">waiting for your turn</span>
                      )}
                    </div>
                    {helperAnalysis?.type === "play" && helperAnalysis.ranked.length > 1 && (
                      <div className="space-y-1">
                        {helperAnalysis.ranked.slice(0, Math.min(helperAnalysis.ranked.length, 5)).map(({ card, hitRate }, i) => {
                          const red = card.suit === "♥" || card.suit === "♦";
                          const isTr = isTrump(card, game.trumpSuit);
                          const barColor = i === 0 ? "bg-violet-400" : hitRate >= 0.55 ? "bg-emerald-500" : hitRate >= 0.35 ? "bg-amber-500" : "bg-red-500/70";
                          const labelColor = i === 0 ? "text-violet-300 font-bold" : isTr ? "text-amber-300/80" : red ? "text-red-300/80" : "text-slate-400";
                          return (
                            <div key={card.id} className="flex items-center gap-2">
                              <span className={`w-10 text-right text-[11px] ${labelColor}`}>{cardText(card)}</span>
                              <div className="flex-1 overflow-hidden rounded-full bg-slate-800 h-1.5">
                                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.round(hitRate * 100)}%` }} />
                              </div>
                              <span className="w-7 text-right text-[10px] tabular-nums text-slate-500">{Math.round(hitRate * 100)}%</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Full card grid */}
                  <div className="border-t border-white/8 pt-2.5">
                    <div className="mb-1.5 flex items-center gap-3 text-[9px] text-slate-600">
                      <span className="font-bold text-white/50">■ your hand</span>
                      <span>· unseen</span>
                      <span className="opacity-40 line-through">played</span>
                    </div>
                    {(() => {
                      const deck = makeDeck();
                      const gone = new Set([...game.played, ...(game.trumpCard ? [game.trumpCard.id] : [])]);
                      const trickSet = new Set(game.trick.map((t) => t.card.id));
                      const myCards = new Set(human.hand.map((c) => c.id));
                      return (
                        <div className="space-y-0.5">
                          {SUITS.map((suit) => {
                            const isTrumpSuit = suit === game.trumpSuit;
                            const red = suit === "♥" || suit === "♦";
                            const suitCards = deck.filter((c) => !c.joker && c.suit === suit);
                            return (
                              <div key={suit} className={`flex items-center gap-0.5 rounded px-1 py-0.5 ${isTrumpSuit ? "bg-amber-400/6" : ""}`}>
                                <span className={`mr-1 w-4 shrink-0 text-center text-sm font-bold leading-none ${isTrumpSuit ? "text-amber-400" : red ? "text-red-400" : "text-slate-400"}`}>
                                  {suit}
                                </span>
                                {suitCards.map((card) => {
                                  const isGone = gone.has(card.id);
                                  const inTrick = trickSet.has(card.id);
                                  const inHand = myCards.has(card.id);
                                  const cls = isGone
                                    ? "text-slate-700 line-through"
                                    : inTrick
                                      ? `font-semibold ${red ? "text-red-400/60" : "text-slate-400/60"}`
                                      : inHand
                                        ? `font-black ${isTrumpSuit ? "text-amber-300" : red ? "text-red-300" : "text-white"}`
                                        : `${red ? "text-red-400/35" : "text-slate-500/50"}`;
                                  return (
                                    <span key={card.id} className={`w-6 shrink-0 text-center text-[10px] ${cls}`}>
                                      {card.rank}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })}
                          <div className="flex items-center gap-0.5 px-1 py-0.5">
                            <span className="mr-1 w-4 shrink-0 text-center text-sm leading-none">🃏</span>
                            {deck.filter((c) => c.joker).map((card) => {
                              const isGone = gone.has(card.id);
                              const inTrick = trickSet.has(card.id);
                              const inHand = myCards.has(card.id);
                              const cls = isGone ? "text-slate-700 line-through" : inTrick ? "text-slate-400/60 font-semibold" : inHand ? "font-black text-white" : "text-slate-500/50";
                              return <span key={card.id} className={`w-10 shrink-0 text-center text-[10px] ${cls}`}>{card.rank}</span>;
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {humanBidTurn && (
                <div className="mb-4 rounded-2xl border border-blue-300/20 bg-blue-950/40 p-3">
                  <p className="mb-2 text-sm text-blue-100">Select your bid for this round.</p>
                  <div className="flex flex-wrap gap-2">
                    {humanLegalBids.map((bid) => (
                      <button
                        key={bid}
                        type="button"
                        onClick={() => isOnlineGame ? sendMultiplayer({ type: "bid", bid }) : setGame((g) => submitBid(g, bid))}
                        className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200"
                      >
                        {bid}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {human.hand.map((card) => {
                  const isLegal = humanPlayTurn && humanLegalCards.has(card.id);
                  const outcome = isLegal && game.trick.length > 0
                    ? (wouldWin(card, game.trick, game.trumpSuit) ? "win" : "lose")
                    : null;
                  const enginePick = settings.helper && helperAnalysis?.type === "play" && helperAnalysis.ranked[0]?.card.id === card.id;
                  return (
                    <CardButton
                      key={card.id}
                      card={card}
                      disabled={humanPlayTurn && !isLegal}
                      faded={!humanPlayTurn}
                      onClick={() => isOnlineGame ? sendMultiplayer({ type: "play", cardId: card.id }) : setGame((g) => playCard(g, humanIndex, card.id))}
                      highlighted={!!game.trumpSuit && isTrump(card, game.trumpSuit)}
                      outcome={outcome}
                      engine={enginePick}
                    />
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Table banter</h2>
              <div className="space-y-2">
                {(game.banter ?? []).length ? (game.banter ?? []).slice(0, 5).map((line) => (
                  <div key={line.id} className="rounded-2xl border border-white/8 bg-slate-900/70 px-3 py-2">
                    <div className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-400">{line.speaker}</div>
                    <div className="text-sm text-slate-200">“{line.text}”</div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-500">The bots are saving their worst material.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Leaderboard</h2>
              <div className="overflow-hidden rounded-2xl border border-white/8">
                {[...game.players]
                  .map((p, i) => ({ ...p, originalIndex: i }))
                  .sort((a, b) => b.score - a.score)
                  .map((p, rank) => {
                    const isActive = (game.phase !== "trickPause" && p.originalIndex === game.turn) || (game.phase === "bidding" && p.originalIndex === biddingPlayer);
                    const need = p.bid === null ? null : Math.max(0, p.bid - p.tricks);
                    const hitBid = p.bid !== null && p.tricks === p.bid;
                    const overBid = p.bid !== null && p.tricks > p.bid;
                    const medal = rank === 0 ? "👑" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : null;
                    const rowBg = isActive
                      ? "bg-blue-950/70 border-t border-blue-500/30"
                      : rank === 0
                      ? "bg-amber-500/10 border-t border-amber-500/10"
                      : "bg-slate-800/50 border-t border-white/5";
                    return (
                      <div key={p.id} className={`px-4 py-3 ${rank === 0 ? "" : rowBg} ${rank === 0 ? (isActive ? "bg-blue-950/70" : "bg-amber-500/10") : ""}`}>
                        <div className="flex items-center gap-3">
                          <span className="w-5 text-center text-base">{medal ?? <span className="text-xs text-slate-600">{rank + 1}</span>}</span>
                          <div className="flex-1 min-w-0">
                            <div className={`truncate font-semibold ${rank === 0 ? "text-amber-200" : "text-slate-200"}`}>
                              {p.name}
                              {p.originalIndex === game.dealer && <span className="ml-1 text-[10px] text-slate-500">dealer</span>}
                              {p.originalIndex === trickLeadIndex && (game.phase === "bidding" || game.phase === "playing" || game.phase === "trickPause") && <span className="ml-1 text-[10px] text-emerald-400">leads</span>}
                            </div>
                            {p.bid !== null && (
                              <div className={`text-xs ${hitBid ? "text-emerald-400" : overBid ? "text-amber-400" : "text-slate-400"}`}>
                                {hitBid ? `✓ bid ${p.bid}` : overBid ? `+${p.tricks - p.bid} over` : `bid ${p.bid} · needs ${need}`}
                              </div>
                            )}
                            {p.bid === null && <div className="text-xs text-slate-500">no bid yet</div>}
                            {settings.helper && !p.isHuman && (() => {
                              const voidSuits = game.voids?.[p.originalIndex] ?? [];
                              if (!voidSuits.length) return null;
                              return (
                                <div className="mt-0.5 flex items-center gap-1">
                                  <span className="text-[9px] uppercase tracking-wider text-slate-600">void</span>
                                  {voidSuits.map((s) => (
                                    <span key={s} className={`text-sm leading-none ${s === "♥" || s === "♦" ? "text-red-400/80" : "text-slate-400/80"}`}>{s}</span>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                          <div className={`text-xl font-black tabular-nums ${rank === 0 ? "text-amber-300" : "text-slate-200"}`}>{p.score}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {(game.phase === "roundEnd" || game.phase === "gameEnd") && (
              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl">
                <h2 className="mb-3 text-xl font-semibold">Round score</h2>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-slate-300">
                      <tr><th className="p-2 text-left">Player</th><th>Bid</th><th>Won</th><th>+Pts</th><th>Total</th></tr>
                    </thead>
                    <tbody>
                      {game.summary?.map((row) => (
                        <tr key={row.name} className="border-t border-white/10 bg-slate-900/60">
                          <td className="p-2">{row.name}</td><td className="text-center">{row.bid}</td><td className="text-center">{row.tricks}</td><td className="text-center">{row.roundScore}</td><td className="text-center font-bold">{row.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {game.phase === "roundEnd" ? (
                  <button type="button" onClick={() => setGame((g) => nextRound(g))} className="mt-3 w-full rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200">Next round</button>
                ) : (
                  <button type="button" onClick={startGame} className="mt-3 w-full rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200">Play again</button>
                )}
              </div>
            )}

            {game.phase === "gameEnd" && (
              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Game log</h2>
                  <div className="flex items-center gap-2">
                    {copyStatus && <span className="text-xs text-slate-400">{copyStatus}</span>}
                    <button type="button" onClick={copyFullGameLog} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">
                      Copy
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly
                  value={gameLogText}
                  className="h-72 w-full resize-y rounded-2xl border border-white/10 bg-slate-950/80 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none"
                />
              </div>
            )}

          </aside>
        </main>
      </div>
    </div>
    </ThemeContext.Provider>
  );
}
