import React, { useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// GAME ENGINE — unchanged from the original implementation
// ─────────────────────────────────────────────────────────────────────────────

const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_NAME = { "♠": "Spades", "♥": "Hearts", "♦": "Diamonds", "♣": "Clubs" };
const JOKER_TRUMP = "🃏";
const RANKS = [
  ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8],
  ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
];
function botNamesForPersonality(personality) {
  if (personality === "brandon") return ["BrandonBot 1", "BrandonBot 2", "BrandonBot 3", "BrandonBot 4", "BrandonBot 5"];
  if (personality === "trump") return ["TrumpBot 1", "TrumpBot 2", "TrumpBot 3", "TrumpBot 4", "TrumpBot 5"];
  if (personality === "cabbage") return ["CabbageBot 1", "CabbageBot 2", "CabbageBot 3", "CabbageBot 4", "CabbageBot 5"];
  return ["RiverBot 1", "RiverBot 2", "RiverBot 3", "RiverBot 4", "RiverBot 5"];
}
const DEFAULT_SETTINGS = {
  players: 4,
  maxHand: 7,
  screwDealer: true,
  botSpeed: 450,
  botPersonality: "river",
  helper: false,
  samples: 120,
  colorTheme: "river",
  cardTheme: "classic",
  winAnimation: "confetti",
};
const TRICK_REVEAL_DELAY_MS = 2200;
const ROUND_END_DELAY_MS = 12000;
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

function makePlayers(n, settings = {}) {
  const names = botNamesForPersonality(settings.botPersonality);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: i === 0 ? "You" : (names[i - 1] ?? `Bot ${i}`),
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

function makeBanterEntry(player, text, event) {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, speaker: player.name, text, event };
}

function botBanterLine(game, playerIndex, event, context = {}) {
  const player = game.players[playerIndex];
  if (!player || player.isHuman) return null;
  const bid = context.bid ?? player.bid ?? 0;
  const highBid = bid >= Math.max(3, Math.ceil(game.handSize * 0.6));
  const bigCard = context.card && (context.card.value >= 12 || context.card.joker || isTrump(context.card, game.trumpSuit));
  const personality = game.settings?.botPersonality ?? "river";

  if (personality === "brandon") {
    const lines = {
      bid: [
        `I can smuggle a ${bid}.`,
        `BOMBACLART, ${bid}.`,
        `${bid}. I've made better bids and worse decisions.`,
        `${bid}. Get your arse in gear.`,
        `I have consulted the river and it said ${bid}.`,
        `This hand smells like ${bid} tricks and absolutely zero regrets.`,
        highBid ? "3 red kings. HELL YEAH BROTHA." : null,
        highBid ? "Big bid. I am about to become everyone else's problem." : null,
        bid === 0 ? "Zero. Strategic genius. RASTACLARRRRTTTT." : null,
        bid === 0 ? "Nil bid. Cowardice, but make it tactical." : null,
      ],
      play: [
        `RASTACLARRRRTTTT`,
        `I just love playing Bridge over the river kwai`,
        `PUSSYCLART`,
        `Get your arse out`,
        `This is either genius or BOMBACLART. We will know shortly.`,
        `A humble offering from my enormous brain.`,
        bigCard ? "HELL YEAH BROTHA" : null,
        context.card?.joker ? "The joker clown has arrived. BOMBARASTAPUSSYCLART!!!!" : null,
        context.isTrump ? "Trump delivery. No refunds." : null,
      ],
      trick: [
        `HELL YEAH BROTHA`,
        `Mine. I'll be framing that trick.`,
        `Get your arse out of my way.`,
        `RASTACLARRRRTTTT`,
        `Another donation to the BrandonBot foundation.`,
        `You brought vibes to a maths fight.`,
      ],
      exact: [
        `HELL YEAH BROTHA`,
        `RASTACLARRRRTTTT, I did it!`,
        `Exact bid. Clean as a whistle.`,
        `That is called precision. You may clap quietly.`,
        `Some call it luck. Those people are losing.`,
      ],
      miss: [
        `BOMBACLART!!!`,
        `BOMBARASTAPUSSYCLART!!!!`,
        `Battyclart :(`,
        `The cards betrayed me, as cards often do.`,
        null, // slot for the paired "Ceri smells" quip — handled below
      ],
    };
    if (event === "miss" && Math.random() < 0.25) {
      return [
        makeBanterEntry(player, "Ceri smells", event),
        makeBanterEntry(player, "jk jk pls babe you smell lovely", event),
      ];
    }
    const choices = (lines[event] ?? []).filter(Boolean);
    if (!choices.length) return null;
    return makeBanterEntry(player, choices[Math.floor(Math.random() * choices.length)], event);
  }

  if (personality === "trump") {
    const lines = {
      bid: [
        `${bid}. Nobody bids better than me. Nobody.`,
        `I'm bidding ${bid}, and it's going to be TREMENDOUS, believe me.`,
        `${bid}. I looked at this hand and said, "That's a beautiful hand."`,
        `Many people are saying my ${bid} is the greatest bid they've ever seen.`,
        `They say I can smuggle a ${bid}. I don't say that, but that's what they say.`,
        `${bid}. The fake news media will say it's a bad bid. Wrong.`,
        `${bid}. I know cards. I know them better than anybody. It's true.`,
        highBid ? "They say I have 3 red kings. I don't say that, but that's what they say." : null,
        highBid ? "HUGE bid. Possibly the biggest bid in the history of this game." : null,
        highBid ? "I am about to be everyone's problem. Tremendous." : null,
        bid === 0 ? "Zero. Strategic genius. The fake news won't cover it." : null,
        bid === 0 ? "Nil bid. I call it a perfect nil. Nobody nils like me." : null,
      ],
      play: [
        `That card is beautiful. Very powerful. The best card.`,
        `Nobody plays cards like me. Nobody. It's true.`,
        `I just made this game great again.`,
        `Believe me, this play is tremendous. Many people are saying it.`,
        `I play this card and everyone claps. True story.`,
        `This is either a perfect play or a perfect play. We will know shortly.`,
        `That should inconvenience the losers. Sad!`,
        bigCard ? "They said it couldn't be done. It can be done." : null,
        context.card?.joker ? "The joker. Very powerful card. I love jokers." : null,
        context.isTrump ? "Trump card. I'm the only one who can play it. Believe me." : null,
      ],
      trick: [
        `I win tricks. That's what I do. I win. Always.`,
        `Another WIN. I win so much, people get tired of it.`,
        `That's what winning looks like. You're welcome.`,
        `TREMENDOUS trick. The best. Maybe ever.`,
        `WINNER. That's what they call me. It's true.`,
        `I've been winning tricks since before you were born.`,
        `That trick had my name on it. In gold letters. Big letters.`,
        `You brought vibes to a maths fight. Very unfair. Sad!`,
      ],
      exact: [
        `Exact bid. I said it, I did it. That's what I do.`,
        `Perfect score. Like everything I do. Perfect.`,
        `Nobody hits their bid like me. Nobody. It's a fact.`,
        `I told you I'd get it. I always get it right. Always.`,
        `That is called precision. You may clap. Loudly.`,
      ],
      miss: [
        `The cards were rigged. Totally rigged. Sad!`,
        `That was sabotage. I'm calling for a full investigation.`,
        `The dealer is corrupt. Absolutely corrupt. Everyone knows it.`,
        `Fake result. We've seen this before. Total witch hunt.`,
        `This is the greatest witch hunt in the history of card games.`,
        `I reject these numbers. The real numbers are beautiful. Believe me.`,
        `I am filing a formal complaint. Many people agree with me.`,
      ],
    };
    const choices = (lines[event] ?? []).filter(Boolean);
    if (!choices.length) return null;
    return makeBanterEntry(player, choices[Math.floor(Math.random() * choices.length)], event);
  }

  // normal / river / cabbage
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
  return makeBanterEntry(player, choices[Math.floor(Math.random() * choices.length)], event);
}

function withBanter(game, entries) {
  const next = entries.flat().filter(Boolean);
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
  const players = makePlayers(settings.players, settings);
  const auditLog = [
    "Up & Down the River - Full Game Log",
    `Settings: players ${settings.players}, max hand ${settings.maxHand}, screw the dealer ${settings.screwDealer ? "on" : "off"}, personality ${settings.botPersonality}, samples ${settings.samples}.`,
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

// Prune equivalent candidates before MC evaluation.
// Within winners and losers separately, keep only the highest and lowest card per effective suit.
// This reduces O(hand) candidates to O(2 * suits) without losing strategic coverage.
function pruneCardOptions(options, trick, trumpSuit) {
  if (options.length <= 2) return options;
  function keepExtremes(cards) {
    if (cards.length <= 2) return cards;
    const bySuit = {};
    for (const c of cards) {
      const s = effectiveSuit(c, trumpSuit);
      if (!bySuit[s]) bySuit[s] = [];
      bySuit[s].push(c);
    }
    return Object.values(bySuit).flatMap((g) => g.length <= 2 ? g : [low(g, trumpSuit), high(g, trumpSuit)]);
  }
  if (!trick.length) return keepExtremes(options);
  const winners = options.filter((c) => wouldWin(c, trick, trumpSuit));
  const losers = options.filter((c) => !wouldWin(c, trick, trumpSuit));
  const pruned = [...keepExtremes(winners), ...keepExtremes(losers)];
  return pruned.length >= 2 ? pruned : options.slice(0, 2);
}

function chooseCardExtreme(game, playerIndex) {
  const p = game.players[playerIndex];
  const allOptions = legalCards(p.hand, game.trick, game.trumpSuit);
  if (allOptions.length === 1) return allOptions[0];
  const options = pruneCardOptions(allOptions, game.trick, game.trumpSuit);

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
  // If the pruned best isn't in allOptions (shouldn't happen) fall back safely
  return allOptions.find((c) => c.id === best.id) ?? best;
}

// ── Personality dispatch ─────────────────────────────────────────────────────

function withMoreSamples(game, minSamples) {
  const current = game.settings?.samples ?? 120;
  if (current >= minSamples) return game;
  return { ...game, settings: { ...game.settings, samples: minSamples } };
}

function chooseBid(game, playerIndex) {
  const personality = game.settings?.botPersonality ?? "river";
  const legal = legalBids(game, playerIndex);

  if (personality === "cabbage") {
    return legal[Math.floor(Math.random() * legal.length)];
  }
  if (personality === "river") {
    const target = Math.max(0, Math.min(game.handSize, Math.round(estimateBidMedium(game, playerIndex))));
    return legal.reduce((best, b) => Math.abs(b - target) < Math.abs(best - target) ? b : best, legal[0]);
  }

  // brandon + trump: full MC, brandon bids 1 lower to target losing fewer tricks
  const gameForSim = personality === "brandon" ? withMoreSamples(game, 300) : game;
  let target = estimateBidExtreme(gameForSim, playerIndex);
  if (personality === "brandon") target = Math.max(0, target - 1);
  target = Math.max(0, Math.min(game.handSize, Math.round(target)));
  return legal.reduce((best, b) => Math.abs(b - target) < Math.abs(best - target) ? b : best, legal[0]);
}

function chooseCard(game, playerIndex) {
  const personality = game.settings?.botPersonality ?? "river";

  if (personality === "cabbage") {
    const options = legalCards(game.players[playerIndex].hand, game.trick, game.trumpSuit);
    if (Math.random() < 0.65) return options[Math.floor(Math.random() * options.length)];
    return chooseCardMedium(game, playerIndex);
  }
  if (personality === "river") return chooseCardMedium(game, playerIndex);

  // brandon: more samples, optimal play toward lower bid target; trump: optimal + tiny noise
  const gameForSim = personality === "brandon" ? withMoreSamples(game, 400) : game;
  const optimal = chooseCardExtreme(gameForSim, playerIndex);
  if (personality === "trump" && Math.random() < 0.05) {
    const options = legalCards(game.players[playerIndex].hand, game.trick, game.trumpSuit);
    const others = options.filter((c) => c.id !== optimal.id);
    if (others.length) return others[Math.floor(Math.random() * others.length)];
  }
  return optimal;
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

// ─────────────────────────────────────────────────────────────────────────────
// THEME SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_THEMES = {
  river: {
    label: "River",
    shell: "text-[#f0e7d4]",
    shellBg: "radial-gradient(1200px 700px at 50% -10%, #3a2519 0%, #241710 45%, #170e0a 100%)",
    felt: "radial-gradient(ellipse at 50% 36%, #2f7a5c 0%, #1f5742 48%, #133527 100%)",
    railFix: "linear-gradient(155deg, #4a311e 0%, #2c1d12 50%, #1d130c 100%)",
    accent: "#c9a35c",
    accentSoft: "rgba(201,163,92,0.16)",
    panel: "bg-[#241a12]/90 border-[#c9a35c]/20",
    panelInner: "bg-[#1a120c]/80 border-[#c9a35c]/15",
    button: "bg-[#c9a35c] text-[#221507] hover:bg-[#dbb873]",
    buttonQuiet: "border border-[#c9a35c]/25 bg-[#2c2014] text-[#f0e7d4] hover:bg-[#3a2b1b]",
    subtle: "text-[#a8957a]",
    faint: "text-[#7d6b53]",
  },
  casino: {
    label: "Casino",
    shell: "text-[#ecefe9]",
    shellBg: "radial-gradient(1200px 700px at 50% -10%, #1d1d1f 0%, #121214 50%, #09090a 100%)",
    felt: "radial-gradient(ellipse at 50% 36%, #237544 0%, #16512e 48%, #0c2f1b 100%)",
    railFix: "linear-gradient(155deg, #2c2c30 0%, #1a1a1d 50%, #101012 100%)",
    accent: "#d4af37",
    accentSoft: "rgba(212,175,55,0.15)",
    panel: "bg-[#17171a]/90 border-[#d4af37]/20",
    panelInner: "bg-[#101013]/80 border-[#d4af37]/15",
    button: "bg-[#d4af37] text-[#1c1503] hover:bg-[#e3c45a]",
    buttonQuiet: "border border-[#d4af37]/25 bg-[#202024] text-[#ecefe9] hover:bg-[#2a2a30]",
    subtle: "text-[#a8a89a]",
    faint: "text-[#73736a]",
  },
  sunset: {
    label: "Sunset",
    shell: "text-[#f6e8da]",
    shellBg: "radial-gradient(1200px 700px at 50% -10%, #3a1a20 0%, #25101a 50%, #150a10 100%)",
    felt: "radial-gradient(ellipse at 50% 36%, #8a3a42 0%, #5e2630 48%, #381521 100%)",
    railFix: "linear-gradient(155deg, #4a2a1a 0%, #2e1a10 50%, #1d110a 100%)",
    accent: "#e8a04c",
    accentSoft: "rgba(232,160,76,0.16)",
    panel: "bg-[#2a161c]/90 border-[#e8a04c]/20",
    panelInner: "bg-[#1d0f14]/80 border-[#e8a04c]/15",
    button: "bg-[#e8a04c] text-[#2a1505] hover:bg-[#f2b46a]",
    buttonQuiet: "border border-[#e8a04c]/25 bg-[#341d23] text-[#f6e8da] hover:bg-[#43262e]",
    subtle: "text-[#c39a85]",
    faint: "text-[#8a6a5c]",
  },
  neon: {
    label: "Neon",
    shell: "text-[#dffaff]",
    shellBg: "radial-gradient(1200px 700px at 50% -10%, #101626 0%, #0a0e1a 50%, #05070e 100%)",
    felt: "radial-gradient(ellipse at 50% 36%, #14424e 0%, #0c2c38 48%, #061a23 100%)",
    railFix: "linear-gradient(155deg, #16202e 0%, #0e1520 50%, #090e16 100%)",
    accent: "#22d3ee",
    accentSoft: "rgba(34,211,238,0.14)",
    panel: "bg-[#0d1420]/90 border-[#22d3ee]/25",
    panelInner: "bg-[#080d16]/80 border-[#22d3ee]/15",
    button: "bg-[#22d3ee] text-[#04222a] hover:bg-[#56e0f5]",
    buttonQuiet: "border border-[#22d3ee]/25 bg-[#121b2a] text-[#dffaff] hover:bg-[#1a2638]",
    subtle: "text-[#8fb7c4]",
    faint: "text-[#5e7e8c]",
  },
};

function useTheme() {
  const settings = React.useContext(ThemeContext);
  return TABLE_THEMES[settings.colorTheme] ?? TABLE_THEMES.river;
}

function Chip({ children, tone = "plain" }) {
  const t = useTheme();
  const style =
    tone === "accent" ? { borderColor: `${t.accent}55`, background: t.accentSoft, color: t.accent }
    : tone === "green" ? { borderColor: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.12)", color: "#6ee7b7" }
    : tone === "red" ? { borderColor: "rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.12)", color: "#fca5a5" }
    : { borderColor: "rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${tone === "plain" ? t.subtle : ""}`}
      style={style}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CARDS
// ─────────────────────────────────────────────────────────────────────────────

const CARD_FACE_THEMES = {
  classic:   { face: "#faf5e9", edge: "#d9cfb6", black: "#23201a", red: "#b03434", pipShadow: "none" },
  parchment: { face: "#f1e3c2", edge: "#cdb585", black: "#3a2f1d", red: "#a13c2e", pipShadow: "none" },
  midnight:  { face: "#171a2c", edge: "#5b5fa8", black: "#e8eaff", red: "#ff8fa8", pipShadow: "0 0 8px rgba(129,140,248,0.5)" },
  neon:      { face: "#0a1018", edge: "#22d3ee", black: "#bdf3ff", red: "#ff7ad9", pipShadow: "0 0 10px rgba(34,211,238,0.7)" },
};

function PlayingCard({ card, disabled, onClick, small = false, highlighted = false, viewing = false, outcome = null, winning = false, engine = false }) {
  const settings = React.useContext(ThemeContext);
  const t = TABLE_THEMES[settings.colorTheme] ?? TABLE_THEMES.river;
  const ct = CARD_FACE_THEMES[settings.cardTheme] ?? CARD_FACE_THEMES.classic;
  const red = isRed(card);
  const pipColor = red ? ct.red : ct.black;

  let ring = "";
  let ringStyle = {};
  if (winning) {
    ring = "ring-2 ring-offset-2";
    ringStyle = { "--tw-ring-color": "#34d399", "--tw-ring-offset-color": "transparent", boxShadow: "0 0 18px rgba(52,211,153,0.45)" };
  } else if (engine) {
    ring = "ring-2 ring-offset-1";
    ringStyle = { "--tw-ring-color": "#a78bfa", "--tw-ring-offset-color": "transparent", boxShadow: "0 0 14px rgba(167,139,250,0.4)" };
  } else if (outcome === "win") {
    ring = "ring-2";
    ringStyle = { "--tw-ring-color": "rgba(52,211,153,0.7)" };
  } else if (outcome === "lose") {
    ring = "ring-2";
    ringStyle = { "--tw-ring-color": "rgba(248,113,113,0.55)" };
  } else if (highlighted) {
    ring = "ring-[3px] ring-offset-1 animate-trump-glow";
    ringStyle = { "--tw-ring-color": t.accent, "--tw-ring-offset-color": "transparent", "--glow-color": `${t.accent}99` };
  }

  return (
    <button
      type="button"
      disabled={!viewing && disabled}
      onClick={viewing ? undefined : onClick}
      title={cardText(card)}
      className={[
        "relative select-none rounded-lg border font-display shadow-[0_4px_10px_rgba(0,0,0,0.45)]",
        small ? "h-[4.4rem] w-12" : "h-[6.8rem] w-[4.7rem]",
        ring,
        viewing ? "cursor-default" : "transition-transform duration-150 hover:-translate-y-2 hover:shadow-[0_10px_20px_rgba(0,0,0,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0",
      ].join(" ")}
      style={{ background: ct.face, borderColor: ct.edge, outlineColor: t.accent, ...ringStyle }}
    >
      {card.joker ? (
        <div className="flex h-full flex-col items-center justify-center gap-0.5 px-1 text-center" style={{ color: ct.black }}>
          <span className={small ? "text-xl" : "text-3xl"}>🃏</span>
          <span className={`font-body font-extrabold uppercase tracking-widest ${small ? "text-[7px]" : "text-[9px]"}`}>Joker</span>
        </div>
      ) : (
        <>
          <span className={`absolute left-1 top-0.5 leading-none font-bold ${small ? "text-[11px]" : "text-base"}`} style={{ color: pipColor }}>
            {card.rank}
            <span className={`block ${small ? "text-[9px]" : "text-xs"}`}>{card.suit}</span>
          </span>
          <span
            className={`absolute inset-0 flex items-center justify-center ${small ? "text-2xl" : "text-[2.6rem]"}`}
            style={{ color: pipColor, textShadow: ct.pipShadow }}
          >
            {card.suit}
          </span>
          <span className={`absolute bottom-0.5 right-1 rotate-180 leading-none font-bold ${small ? "text-[11px]" : "text-base"}`} style={{ color: pipColor }}>
            {card.rank}
            <span className={`block ${small ? "text-[9px]" : "text-xs"}`}>{card.suit}</span>
          </span>
        </>
      )}
    </button>
  );
}

function CardBack({ tiny = false }) {
  const t = useTheme();
  return (
    <div
      className={`rounded-[5px] border shadow-[0_2px_5px_rgba(0,0,0,0.5)] ${tiny ? "h-8 w-[1.45rem]" : "h-12 w-9"}`}
      style={{
        borderColor: `${t.accent}66`,
        background: `repeating-linear-gradient(45deg, ${t.accent}26 0 3px, transparent 3px 6px), linear-gradient(160deg, #1c2a24, #101a16)`,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE — seats, trick area, banter bubbles
// ─────────────────────────────────────────────────────────────────────────────

function seatAngles(k) {
  // angles in degrees across the top arc of the table, left → right
  const presets = {
    1: [90],
    2: [136, 44],
    3: [158, 90, 22],
    4: [168, 116, 64, 12],
    5: [172, 131, 90, 49, 8],
  };
  return presets[k] ?? presets[5];
}

function seatPosition(angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + 43 * Math.cos(a), y: 44 - 38 * Math.sin(a) };
}

function trickSpot(anchor) {
  // pull the played card 45% of the way from table centre toward the seat
  const cx = 50, cy = 52;
  return { x: cx + (anchor.x - cx) * 0.45, y: cy + (anchor.y - cy) * 0.45 };
}

function Seat({ player, playerIndex, game, anchor, isActive, isDealer, isLead, showVoids, banterLine, bubbleSide = "center" }) {
  const t = useTheme();
  const bidSet = player.bid !== null;
  const hit = bidSet && player.tricks === player.bid;
  const over = bidSet && player.tricks > player.bid;
  const backs = Math.min(player.hand.length, 7);
  const voidSuits = showVoids ? (game.voids?.[playerIndex] ?? []) : [];

  return (
    <div
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
    >
      {banterLine && (
        <div
          className={[
            "pointer-events-none absolute bottom-full z-40 mb-2 w-max max-w-[9rem]",
            bubbleSide === "left" ? "left-0" : bubbleSide === "right" ? "right-0" : "left-1/2 -translate-x-1/2",
          ].join(" ")}
        >
          <div
            key={banterLine.id}
            className={`animate-bubble rounded-2xl border px-3 py-2 text-xs font-semibold leading-snug shadow-xl ${bubbleSide === "right" ? "rounded-br-sm" : "rounded-bl-sm"}`}
            style={{ background: "#f6efdd", color: "#2a2118", borderColor: `${t.accent}88` }}
          >
            {banterLine.text}
          </div>
        </div>
      )}

      {/* fan of card backs */}
      {backs > 0 && (
        <div className="pointer-events-none mb-1 flex justify-center">
          {Array.from({ length: backs }, (_, i) => (
            <div
              key={i}
              className={i > 0 ? "-ml-3" : ""}
              style={{ transform: `rotate(${(i - (backs - 1) / 2) * 7}deg) translateY(${Math.abs(i - (backs - 1) / 2) * 1.5}px)` }}
            >
              <CardBack tiny />
            </div>
          ))}
        </div>
      )}

      {/* name plate */}
      <div
        className={`relative rounded-xl border px-2.5 py-1.5 text-center backdrop-blur-sm ${isActive ? "animate-seat-breath" : ""}`}
        style={{
          background: "rgba(12,9,6,0.75)",
          borderColor: isActive ? "#7dd3fc" : `${t.accent}40`,
        }}
      >
        <div className="flex items-center justify-center gap-1.5">
          <span className="max-w-[7.5rem] truncate text-xs font-extrabold tracking-wide" style={{ color: isActive ? "#bae6fd" : "#f0e7d4" }}>
            {player.name}
          </span>
          {isDealer && (
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black" style={{ background: t.accent, color: "#221507" }} title="Dealer">
              D
            </span>
          )}
          {isLead && (
            <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-emerald-300" title="Leads this trick">lead</span>
          )}
        </div>
        <div className={`mt-0.5 text-[11px] font-bold tabular-nums ${hit ? "text-emerald-300" : over ? "text-amber-300" : ""}`} style={!hit && !over ? { color: "#a8957a" } : undefined}>
          {bidSet ? `${player.tricks} / ${player.bid}` : "bidding…"}
          {hit && " ✓"}
        </div>
        {voidSuits.length > 0 && (
          <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px]">
            <span className="uppercase tracking-wider" style={{ color: "#7d6b53" }}>void</span>
            {voidSuits.map((s) => (
              <span key={s} className={s === "♥" || s === "♦" ? "text-red-400" : "text-slate-300"}>{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrumpPlaque({ game, compact = false }) {
  const t = useTheme();
  const noTrump = !game.trumpSuit;
  const jokerTrump = game.trumpSuit === JOKER_TRUMP;
  const redSuit = game.trumpSuit === "♥" || game.trumpSuit === "♦";
  const glyphColor = noTrump || jokerTrump ? t.accent : redSuit ? "#f87171" : "#f0e7d4";
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border ${compact ? "px-2.5 py-1" : "px-3 py-1.5"}`}
      style={{ borderColor: `${t.accent}40`, background: t.accentSoft }}
    >
      <span className={compact ? "text-xl leading-none" : "text-2xl leading-none"} style={{ color: glyphColor }}>
        {noTrump || jokerTrump ? "🃏" : game.trumpSuit}
      </span>
      <div className="leading-tight">
        <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: t.accent }}>Trump</div>
        <div className="text-xs font-extrabold">{noTrump ? "No trump" : trumpName(game.trumpSuit)}</div>
      </div>
      {!compact && !noTrump && (
        <span className="ml-1 text-[10px]" style={{ color: "#a8957a" }}>
          {jokerTrump ? "other joker rules" : cardText(game.trumpCard)}
        </span>
      )}
    </div>
  );
}

function GameTable({ game, humanIndex, biddingPlayer, trickLeadIndex, showVoids, banter }) {
  const t = useTheme();
  const n = game.players.length;
  const opponents = Array.from({ length: n - 1 }, (_, i) => (humanIndex + 1 + i) % n);
  const angles = seatAngles(opponents.length);
  const anchorFor = (playerIndex) => {
    if (playerIndex === humanIndex) return { x: 50, y: 102 };
    const slot = opponents.indexOf(playerIndex);
    return seatPosition(angles[slot]);
  };

  // most recent banter entry shown as a bubble over its speaker's seat
  const latest = banter?.[0] ?? null;
  const bubbleFor = (player) => (latest && latest.speaker === player.name ? latest : null);

  const trickWinner = game.trick.length ? winningPlay(game.trick, game.trumpSuit) : null;
  const resolved = game.phase === "trickPause";
  const resolvedWinner = resolved && trickWinner ? game.players[trickWinner.playerIndex] : null;

  return (
    <div className="relative w-full" style={{ aspectRatio: "16 / 10.5" }}>
      {/* brass rail */}
      <div
        className="absolute inset-0 rounded-[48%/42%] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        style={{ background: t.railFix, border: `1px solid ${t.accent}33` }}
      />
      {/* felt */}
      <div
        className="felt-grain absolute inset-[4.5%] rounded-[48%/42%] shadow-[inset_0_10px_40px_rgba(0,0,0,0.55)]"
        style={{ background: t.felt, border: `1px solid rgba(0,0,0,0.4)` }}
      />
      {/* centre mark */}
      <div className="pointer-events-none absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 select-none text-center opacity-[0.13]">
        <div className="font-display text-4xl font-black tracking-wide sm:text-5xl" style={{ color: t.accent }}>♠ ♥ ♦ ♣</div>
      </div>

      {/* opponent seats */}
      {opponents.map((idx) => {
        const p = game.players[idx];
        const isActive = (game.phase === "playing" && game.turn === idx) || (game.phase === "bidding" && biddingPlayer === idx);
        return (
          <Seat
            key={p.id}
            player={p}
            playerIndex={idx}
            game={game}
            anchor={anchorFor(idx)}
            isActive={isActive}
            isDealer={game.dealer === idx}
            isLead={trickLeadIndex === idx && (game.phase === "playing" || game.phase === "trickPause" || game.phase === "bidding")}
            showVoids={showVoids}
            banterLine={bubbleFor(p)}
            bubbleSide={anchorFor(idx).x < 35 ? "left" : anchorFor(idx).x > 65 ? "right" : "center"}
          />
        );
      })}

      {/* your seat marker (hand is rendered below the table) */}
      <div className="absolute bottom-[2%] left-1/2 z-20 -translate-x-1/2">
        <div
          className={`rounded-xl border px-3 py-1 text-center backdrop-blur-sm ${((game.phase === "playing" && game.turn === humanIndex) || (game.phase === "bidding" && biddingPlayer === humanIndex)) ? "animate-seat-breath" : ""}`}
          style={{ background: "rgba(12,9,6,0.75)", borderColor: `${t.accent}40` }}
        >
          <div className="flex items-center justify-center gap-1.5 text-xs font-extrabold">
            <span>{game.players[humanIndex]?.name ?? "You"}</span>
            {game.dealer === humanIndex && (
              <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-black" style={{ background: t.accent, color: "#221507" }}>D</span>
            )}
            {trickLeadIndex === humanIndex && <span className="text-[9px] font-black uppercase tracking-wider text-emerald-300">lead</span>}
          </div>
          <div className="text-[11px] font-bold tabular-nums" style={{ color: "#a8957a" }}>
            {game.players[humanIndex]?.bid !== null ? `${game.players[humanIndex]?.tricks} / ${game.players[humanIndex]?.bid}` : "bidding…"}
          </div>
        </div>
      </div>

      {/* trick cards thrown to the middle */}
      {game.trick.map((play) => {
        const anchor = anchorFor(play.playerIndex);
        const spot = trickSpot(anchor);
        const rot = ((play.playerIndex * 47 + play.card.value * 13) % 17) - 8;
        const isWin = resolved && play.card.id === trickWinner?.card.id;
        return (
          <div
            key={`${play.playerIndex}-${play.card.id}`}
            className="animate-throw-in absolute z-10"
            style={{ left: `${spot.x}%`, top: `${spot.y}%`, transform: `translate(-50%, -50%) rotate(${rot}deg)`, "--throw-rot": `${rot}deg` }}
          >
            <PlayingCard card={play.card} small viewing winning={isWin} />
            <div className="mt-0.5 max-w-[3.6rem] truncate text-center text-[9px] font-bold" style={{ color: "rgba(240,231,212,0.75)" }}>
              {game.players[play.playerIndex].name}
            </div>
          </div>
        );
      })}

      {resolvedWinner && (
        <div className="pointer-events-none absolute left-1/2 top-[52%] z-30 w-[min(22rem,70%)] -translate-x-1/2 -translate-y-1/2 text-center">
          <div
            className="animate-pop-in rounded-2xl border px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.55)] backdrop-blur-md"
            style={{ background: "rgba(7, 18, 13, 0.88)", borderColor: "#34d399aa" }}
          >
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">Trick winner</div>
            <div className="mt-1 truncate font-display text-2xl font-black leading-tight text-white sm:text-3xl">
              {resolvedWinner.name}
            </div>
            <div className="mt-1 text-sm font-bold text-emerald-200">
              wins with {cardText(trickWinner.card)}
            </div>
          </div>
        </div>
      )}

      {/* bidding board in the centre while bids come in */}
      {game.phase === "bidding" && (
        <div className="absolute left-1/2 top-[52%] z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-2xl border px-4 py-2 text-center backdrop-blur-sm" style={{ background: "rgba(8,6,4,0.55)", borderColor: `${t.accent}33` }}>
            <div className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: t.accent }}>Bids</div>
            <div className="text-lg font-black tabular-nums">
              {game.players.reduce((s, p) => s + (p.bid ?? 0), 0)} <span className="text-xs font-bold" style={{ color: "#a8957a" }}>of {game.handSize}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HandFan({ hand, humanPlayTurn, humanLegalCards, game, settings, helperAnalysis, onPlay }) {
  const len = hand.length;
  const spread = len > 9 ? 2.4 : len > 6 ? 3.2 : 4.5;
  return (
    <div className="flex justify-center overflow-x-auto px-2 pb-2 pt-4">
      <div className="flex">
        {hand.map((card, i) => {
          const isLegal = humanPlayTurn && humanLegalCards.has(card.id);
          const outcome = isLegal && game.trick.length > 0
            ? (wouldWin(card, game.trick, game.trumpSuit) ? "win" : "lose")
            : null;
          const enginePick = settings.helper && helperAnalysis?.type === "play" && helperAnalysis.ranked[0]?.card.id === card.id;
          const mid = (len - 1) / 2;
          const rot = (i - mid) * spread;
          return (
            <div
              key={card.id}
              className={`animate-deal-in ${i > 0 ? "-ml-5 sm:-ml-4" : ""}`}
              style={{
                transform: `rotate(${rot}deg) translateY(${Math.abs(i - mid) * 3}px)`,
                transformOrigin: "50% 120%",
                animationDelay: `${i * 0.03}s`,
                "--deal-rot": `${rot}deg`,
                zIndex: i,
              }}
            >
              <PlayingCard
                card={card}
                disabled={humanPlayTurn && !isLegal}
                onClick={() => onPlay(card)}
                highlighted={!!game.trumpSuit && isTrump(card, game.trumpSuit)}
                outcome={outcome}
                engine={enginePick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BidTray({ bids, onBid, handSize }) {
  const t = useTheme();
  return (
    <div className="mx-auto w-fit max-w-full rounded-2xl border px-4 py-3 text-center shadow-xl" style={{ background: "rgba(12,9,6,0.85)", borderColor: `${t.accent}55` }}>
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: t.accent }}>
        Your bid · {handSize} card{handSize === 1 ? "" : "s"} this round
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {bids.map((bid) => (
          <button
            key={bid}
            type="button"
            onClick={() => onBid(bid)}
            className="grid h-11 w-11 place-items-center rounded-full border-2 text-lg font-black shadow-md transition hover:scale-110 focus-visible:outline focus-visible:outline-2"
            style={{
              borderColor: t.accent,
              background: `radial-gradient(circle at 35% 30%, ${t.accent}, ${t.accent}99)`,
              color: "#221507",
              outlineColor: t.accent,
            }}
          >
            {bid}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER ENGINE PANEL — same analysis, restyled
// ─────────────────────────────────────────────────────────────────────────────

function HelperPanel({ game, human, helperAnalysis }) {
  const t = useTheme();
  return (
    <div className={`rounded-2xl border p-3 ${t.panelInner}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Engine</span>
        {helperAnalysis?.type === "bid" && (
          <span className="text-xs">
            Suggested bid: <span className="font-black text-violet-300">{helperAnalysis.suggested}</span>
            <span className={`ml-1 ${t.faint}`}>({(helperAnalysis.confidence * 100).toFixed(0)}% likely)</span>
          </span>
        )}
        {helperAnalysis?.type === "play" && helperAnalysis.ranked.length > 0 && (
          <span className="text-xs">
            Best:{" "}
            <span className={`font-black ${isTrump(helperAnalysis.ranked[0].card, game.trumpSuit) ? "text-amber-300" : (helperAnalysis.ranked[0].card.suit === "♥" || helperAnalysis.ranked[0].card.suit === "♦") ? "text-red-300" : "text-violet-300"}`}>
              {cardText(helperAnalysis.ranked[0].card)}
            </span>
            <span className={`ml-1 ${t.faint}`}>({(helperAnalysis.ranked[0].hitRate * 100).toFixed(0)}% hit bid)</span>
          </span>
        )}
        {!helperAnalysis && <span className={`text-[10px] ${t.faint}`}>waiting for your turn</span>}
      </div>

      {helperAnalysis?.type === "play" && helperAnalysis.ranked.length > 1 && (
        <div className="mb-3 space-y-1">
          {helperAnalysis.ranked.slice(0, Math.min(helperAnalysis.ranked.length, 5)).map(({ card, hitRate }, i) => {
            const red = card.suit === "♥" || card.suit === "♦";
            const isTr = isTrump(card, game.trumpSuit);
            const barColor = i === 0 ? "bg-violet-400" : hitRate >= 0.55 ? "bg-emerald-500" : hitRate >= 0.35 ? "bg-amber-500" : "bg-red-500/70";
            const labelColor = i === 0 ? "text-violet-300 font-black" : isTr ? "text-amber-300/80" : red ? "text-red-300/80" : t.subtle;
            return (
              <div key={card.id} className="flex items-center gap-2">
                <span className={`w-10 text-right text-[11px] ${labelColor}`}>{cardText(card)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.round(hitRate * 100)}%` }} />
                </div>
                <span className={`w-7 text-right text-[10px] tabular-nums ${t.faint}`}>{Math.round(hitRate * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* full card-counting grid */}
      <div className="border-t border-white/10 pt-2.5">
        <div className={`mb-1.5 flex items-center gap-3 text-[9px] ${t.faint}`}>
          <span className="font-black text-white/60">■ your hand</span>
          <span>· unseen</span>
          <span className="line-through opacity-50">played</span>
        </div>
        {(() => {
          const deck = makeDeck();
          const gone = new Set([...game.played, ...(game.trumpCard ? [game.trumpCard.id] : [])]);
          const trickSet = new Set(game.trick.map((tk) => tk.card.id));
          const myCards = new Set(human.hand.map((c) => c.id));
          return (
            <div className="space-y-0.5">
              {SUITS.map((suit) => {
                const isTrumpSuit = suit === game.trumpSuit;
                const red = suit === "♥" || suit === "♦";
                const suitCards = deck.filter((c) => !c.joker && c.suit === suit);
                return (
                  <div key={suit} className={`flex items-center gap-0.5 rounded px-1 py-0.5 ${isTrumpSuit ? "bg-amber-400/10" : ""}`}>
                    <span className={`mr-1 w-4 shrink-0 text-center text-sm font-bold leading-none ${isTrumpSuit ? "text-amber-400" : red ? "text-red-400" : "text-slate-400"}`}>
                      {suit}
                    </span>
                    {suitCards.map((card) => {
                      const isGone = gone.has(card.id);
                      const inTrick = trickSet.has(card.id);
                      const inHand = myCards.has(card.id);
                      const cls = isGone
                        ? "opacity-30 line-through"
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
                  const cls = isGone ? "opacity-30 line-through" : inTrick ? "text-slate-400/60 font-semibold" : inHand ? "font-black text-white" : "text-slate-500/50";
                  return <span key={card.id} className={`w-10 shrink-0 text-center text-[10px] ${cls}`}>{card.rank}</span>;
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS, HELP, POPUPS
// ─────────────────────────────────────────────────────────────────────────────

function SettingsControls({ settings, updateSetting, compact = false, action = null }) {
  const t = useTheme();
  const sel = "w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm";
  const lbl = "min-w-0 space-y-1";
  const cap = `text-[10px] font-black uppercase tracking-[0.15em]`;
  const chk = "flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm";
  const grid = compact
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10"
    : "grid-cols-2 lg:grid-cols-5";
  return (
    <div className={`grid gap-2 ${grid}`}>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Players</span>
        <select value={settings.players} onChange={(e) => updateSetting("players", Number(e.target.value))} className={sel}>
          {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Max hand</span>
        <select value={settings.maxHand} onChange={(e) => updateSetting("maxHand", Number(e.target.value))} className={sel}>
          {Array.from({ length: Math.min(10, maxAllowedHand(settings.players)) - 2 }, (_, i) => i + 3).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Bot personality</span>
        <select value={settings.botPersonality ?? "river"} onChange={(e) => updateSetting("botPersonality", e.target.value)} className={sel}>
          <option value="cabbage">Cabbage · Easy</option>
          <option value="river">River · Medium</option>
          <option value="brandon">Brandon · Extreme</option>
          <option value="trump">Trump · Extreme</option>
        </select>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Bot speed</span>
        <select value={settings.botSpeed} onChange={(e) => updateSetting("botSpeed", Number(e.target.value))} className={sel}>
          <option value={250}>Fast</option>
          <option value={450}>Normal</option>
          <option value={750}>Slow</option>
        </select>
      </label>
      <label className={chk}>
        <input type="checkbox" checked={settings.screwDealer} onChange={(e) => updateSetting("screwDealer", e.target.checked)} />
        <span>Screw dealer</span>
      </label>
      <label className={chk}>
        <input type="checkbox" checked={settings.helper} onChange={(e) => updateSetting("helper", e.target.checked)} />
        <span>Helper</span>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Samples</span>
        <select value={settings.samples} onChange={(e) => updateSetting("samples", Number(e.target.value))} className={sel}>
          <option value={25}>25 · Fast</option>
          <option value={60}>60 · Normal</option>
          <option value={120}>120 · Sharp</option>
          <option value={250}>250 · Strong</option>
          <option value={500}>500 · Max</option>
        </select>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Table</span>
        <select value={settings.colorTheme ?? "river"} onChange={(e) => updateSetting("colorTheme", e.target.value)} className={sel}>
          <option value="river">River</option>
          <option value="casino">Casino</option>
          <option value="sunset">Sunset</option>
          <option value="neon">Neon</option>
        </select>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Cards</span>
        <select value={settings.cardTheme ?? "classic"} onChange={(e) => updateSetting("cardTheme", e.target.value)} className={sel}>
          <option value="classic">Classic</option>
          <option value="parchment">Parchment</option>
          <option value="midnight">Midnight</option>
          <option value="neon">Neon</option>
        </select>
      </label>
      <label className={lbl}>
        <span className={cap} style={{ color: t.accent }}>Win effect</span>
        <select value={settings.winAnimation ?? "confetti"} onChange={(e) => updateSetting("winAnimation", e.target.value)} className={sel}>
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

function HelpModal({ mode, onClose }) {
  const t = useTheme();
  if (!mode) return null;
  const isTutorial = mode === "tutorial";
  const card = `rounded-2xl border p-4 ${t.panelInner}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={`max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border p-5 shadow-2xl ${t.panel}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: t.accent }}>{isTutorial ? "Tutorial" : "Rules"}</div>
            <h2 className="font-display text-3xl font-black">{isTutorial ? "How to play" : "Rule reference"}</h2>
          </div>
          <button type="button" onClick={onClose} className={`rounded-xl px-3 py-2 text-sm font-bold ${t.buttonQuiet}`}>Close</button>
        </div>

        {isTutorial ? (
          <div className="space-y-3 text-sm leading-relaxed">
            <section className={card}>
              <h3 className="mb-1 font-display text-base font-black">1 · Look at your hand and trump</h3>
              <p className={t.subtle}>Each round starts with a hand size and a turned-up trump card. Trump cards beat non-trump cards. If a joker is turned up, the other joker is the only trump.</p>
            </section>
            <section className={card}>
              <h3 className="mb-1 font-display text-base font-black">2 · Bid how many tricks you will win</h3>
              <p className={t.subtle}>If you think your hand can win two tricks, bid 2. Exact bids are worth the most points. Bidding 0 is valid and scores well if you take no tricks.</p>
              <div className="mt-2 rounded-xl bg-black/30 p-3 font-mono text-xs">
                Example: you bid 2. If you win exactly 2 tricks, you score 12 points. If you win 1 or 3, you only score the tricks you took.
              </div>
            </section>
            <section className={card}>
              <h3 className="mb-1 font-display text-base font-black">3 · Follow suit, or use trump</h3>
              <p className={t.subtle}>The first card played sets the led suit. If you have that suit, you must follow it, but trump is also legal. If you do not have the led suit, you may play anything.</p>
            </section>
            <section className={card}>
              <h3 className="mb-1 font-display text-base font-black">4 · Win or dodge tricks to hit your bid</h3>
              <p className={t.subtle}>The highest card in the led suit wins unless trump is played. The highest trump wins. Your goal is not always to win every trick; it is to land exactly on your bid.</p>
            </section>
            <section className={card}>
              <h3 className="mb-1 font-display text-base font-black">5 · Hand sizes go down, then back up</h3>
              <p className={t.subtle}>A game starts at the max hand size, counts down to 1 card, then climbs back up. Scores accumulate across all rounds.</p>
            </section>
          </div>
        ) : (
          <div className="grid gap-3 text-sm leading-relaxed md:grid-cols-2">
            {[
              ["Rounds", "Hands go down from the max hand to 1, then back up to the max hand."],
              ["Bidding", "Each player bids the number of tricks they expect to take. Screw the dealer prevents the final bidder from making total bids equal the hand size."],
              ["Legal play", "If you have the led suit, you must play that suit or trump. If you are void in the led suit, you may play anything."],
              ["Winning tricks", "Highest led suit wins unless trump is played. Highest trump wins the trick."],
              ["Jokers", "With suited trump, jokers are 1 of trump. Any suited trump card beats them. If a joker is turned up, the other joker is the only trump and beats everything."],
              ["Scoring", "Exact bid scores tricks + 10. Exact 0 scores 5. Missed bids score tricks only."],
            ].map(([title, body]) => (
              <div key={title} className={card}>
                <h3 className="mb-1 font-display text-base font-black">{title}</h3>
                <p className={t.subtle}>{body}</p>
              </div>
            ))}
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

function WinPopup({ popup, onDismiss, onNextRound, onPlayAgain, onCopyGameLog, copyStatus }) {
  const settings = React.useContext(ThemeContext);
  const t = TABLE_THEMES[settings.colorTheme] ?? TABLE_THEMES.river;
  const winAnimation = settings.winAnimation ?? "confetti";
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
    const jokerTrump = trumpSuit === JOKER_TRUMP;
    const isRedSuit = trumpSuit === "♥" || trumpSuit === "♦";
    const suitColor = noTrump || jokerTrump ? t.accent : isRedSuit ? "#f87171" : "#f0e7d4";
    const trumpCount = hand.filter((c) => isTrump(c, trumpSuit)).length;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={dismiss}>
        <div className={`mx-4 w-full max-w-md rounded-3xl border shadow-2xl ${t.panel} ${leaving ? "animate-fade-out" : "animate-pop-in"}`}>
          <div className="px-7 pt-7 pb-5 text-center">
            <div className="mb-4 text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: t.accent }}>
              Round {roundIndex + 1} of {totalRounds} · {handSize} card{handSize === 1 ? "" : "s"}
            </div>
            <div className="mb-2 text-8xl leading-none" style={{ color: suitColor }}>{noTrump ? "🃏" : trumpSuit}</div>
            <h2 className="mt-3 font-display text-3xl font-black" style={noTrump ? { color: t.accent } : undefined}>
              {noTrump ? "No Trump" : trumpName(trumpSuit)}
            </h2>
            <p className={`mt-1 text-sm ${t.subtle}`}>
              {jokerTrump ? "Joker turned up — the other joker is trump" : noTrump ? "No trump this round" : `Turned up: ${cardText(trumpCard)}`}
            </p>
          </div>

          {hand.length > 0 && (
            <div className="border-t border-white/10 px-5 pb-6 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: t.accent }}>Your hand</span>
                {trumpSuit && trumpCount > 0 && (
                  <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: `${t.accent}55`, background: t.accentSoft, color: t.accent }}>
                    {trumpCount} trump
                  </span>
                )}
              </div>
              <div className="pointer-events-none flex flex-wrap justify-center gap-2">
                {hand.map((card) => (
                  <PlayingCard key={card.id} card={card} viewing small highlighted={!!trumpSuit && isTrump(card, trumpSuit)} />
                ))}
              </div>
            </div>
          )}

          <div className="px-7 pb-5">
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ background: t.accent, animation: "shrinkBar 5s linear forwards" }} />
            </div>
            <p className={`mt-2 text-center text-xs ${t.faint}`}>Tap to dismiss</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Tier 1: Trick win — subtle floating pill ── */
  if (popup.type === "trick") {
    return (
      <div className={`pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 ${leaving ? "animate-fade-out" : "animate-slide-down"}`}>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-black/85 px-5 py-2.5 shadow-lg backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-bold text-emerald-300">Trick won</span>
        </div>
      </div>
    );
  }

  /* ── Tier 2: Round summary — always shown at round end ── */
  if (popup.type === "roundSummary") {
    const { players, humanIndex, roundIndex } = popup.data;
    const human = players[humanIndex];
    const others = players.filter((_, i) => i !== humanIndex);
    const isExact = human.bid === human.tricks;
    const isPerfectNil = human.bid === 0 && human.tricks === 0;

    function handleNext() {
      setLeaving(true);
      setTimeout(() => { onDismiss(); onNextRound?.(); }, 280);
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className={`relative mx-4 w-full max-w-sm overflow-hidden rounded-3xl border shadow-2xl ${isExact ? "border-emerald-500/40" : ""} ${t.panel} ${leaving ? "animate-fade-out" : "animate-pop-in"}`}>
          <div className="p-6">
            <div className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: t.accent }}>
              Round {roundIndex + 1} over
            </div>

            <div className={`mb-3 rounded-2xl border p-4 text-center ${isExact ? "border-emerald-500/30 bg-emerald-500/10" : `${t.panelInner}`}`}>
              <div className={`mb-1 text-[10px] font-black uppercase tracking-[0.2em] ${t.faint}`}>You</div>
              {isPerfectNil ? (
                <div className="mb-2 flex items-center justify-center gap-2 text-base font-black text-emerald-300">
                  <span>🚫</span> Perfect Nil
                </div>
              ) : isExact ? (
                <div className="mb-2 flex items-center justify-center gap-1.5 text-sm font-bold text-emerald-300">
                  <span>🎯</span> Exact bid · bid {human.bid}, won {human.tricks}
                </div>
              ) : (
                <div className={`mb-2 text-sm ${t.subtle}`}>
                  Bid {human.bid} · Won {human.tricks}
                </div>
              )}
              <div className={`font-display text-5xl font-black ${isExact ? "text-emerald-400" : ""}`}>
                +{human.roundScore}
              </div>
              <div className={`mt-1 text-xs ${t.faint}`}>{human.score} pts total</div>
            </div>

            {others.length > 0 && (
              <div className="mb-4 space-y-1.5">
                {others.map((p) => {
                  const exact = p.bid === p.tricks;
                  const perfNil = p.bid === 0 && p.tricks === 0;
                  return (
                    <div key={p.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${exact ? "border-emerald-500/20 bg-emerald-500/10" : t.panelInner}`}>
                      <span className="min-w-0 flex-1 truncate font-bold">{p.name}</span>
                      <span className={`shrink-0 text-xs ${t.faint}`}>
                        {perfNil ? "nil" : `bid ${p.bid} · won ${p.tricks}`}
                      </span>
                      <span className={`w-10 shrink-0 text-right font-black tabular-nums ${exact ? "text-emerald-400" : t.subtle}`}>
                        +{p.roundScore}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <button type="button" onClick={handleNext} className={`w-full rounded-xl px-4 py-2.5 font-black ${t.button}`}>
              Next round →
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Tier 3: Game over — full celebration ── */
  if (popup.type === "game") {
    const { won, score, players } = popup.data;
    const sorted = [...players].sort((a, b) => b.score - a.score);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md">
        <div
          className={`relative mx-4 w-full max-w-sm overflow-hidden rounded-3xl border text-center shadow-2xl ${t.panel} ${leaving ? "animate-fade-out" : "animate-pop-in"}`}
          style={won ? { borderColor: `${t.accent}66` } : undefined}
        >
          {won && <WinEffect type={winAnimation} />}
          <div className="relative p-8">
            <div className={`mb-2 text-7xl ${won ? "animate-trophy-bounce inline-block" : ""}`}>{won ? "🏆" : "🃏"}</div>
            <h2 className="mb-1 font-display text-5xl font-black" style={won ? { color: t.accent } : undefined}>{won ? "You win" : "Game over"}</h2>
            <p className={`mb-5 text-sm ${t.subtle}`}>
              {won ? `You topped the table with ${score} points` : `You scored ${score} — better luck next time`}
            </p>
            <div className="mb-5 overflow-hidden rounded-2xl border border-white/10">
              {sorted.map((p, rank) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-4 py-2.5 text-sm ${rank > 0 ? "border-t border-white/5" : ""}`}
                  style={rank === 0 ? { background: t.accentSoft, color: t.accent } : { background: "rgba(0,0,0,0.25)" }}
                >
                  <span className="flex items-center gap-2 font-bold">
                    <span className="w-4 text-center text-xs">{rank === 0 ? "👑" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `${rank + 1}.`}</span>
                    {p.name}
                  </span>
                  <span className="font-black tabular-nums">{p.score} pts</span>
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              <button type="button" onClick={onCopyGameLog} className={`w-full rounded-xl px-4 py-3 font-black ${t.buttonQuiet}`}>
                Copy game log
              </button>
              {copyStatus && <p className={`text-xs ${t.subtle}`}>{copyStatus}</p>}
              <button
                type="button"
                onClick={() => { dismiss(); setTimeout(onPlayAgain, 280); }}
                className={`w-full rounded-xl px-4 py-3 font-black ${t.button}`}
              >
                {won ? "🎉 Play again" : "Play again"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const HERO_CARDS = [
  { id: "A♠", suit: "♠", rank: "A", value: 14, joker: false },
  { id: "K♥", suit: "♥", rank: "K", value: 13, joker: false },
  { id: "Q♦", suit: "♦", rank: "Q", value: 12, joker: false },
  { id: "J♣", suit: "♣", rank: "J", value: 11, joker: false },
];

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
  const gameLogText = useMemo(() => (game.auditLog ?? []).join("\n"), [game.auditLog]);
  const savedGameSummary = savedGame
    ? `Round ${savedGame.roundIndex + 1}/${savedGame.sequence.length} · ${savedGame.handSize} cards · ${savedGame.phase === "gameEnd" ? "game over" : savedGame.phase}`
    : null;
  const mpShareUrl = mpRoom ? `${window.location.origin}${window.location.pathname}?room=${mpRoom.code}` : "";

  useEffect(() => {
    if (screen !== "game" || isOnlineGame) return undefined;
    if (game.phase === "bidding" && biddingPlayer !== null && !game.players[biddingPlayer].isHuman) {
      const isRoundStart = game.players.every((p) => p.bid === null);
      const delay = isRoundStart ? Math.max(game.settings.botSpeed, 1500) : game.settings.botSpeed;
      const timer = setTimeout(() => {
        setGame((prev) => {
          const ord = orderFromDealer(prev.dealer, prev.players.length);
          const idx = ord[prev.bidIndex];
          if (prev.phase !== "bidding" || prev.players[idx].isHuman) return prev;
          return submitBid(prev, chooseBid(prev, idx));
        });
      }, delay);
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
      }, Math.max(TRICK_REVEAL_DELAY_MS, game.settings.botSpeed + 900));
      return () => clearTimeout(timer);
    }
  }, [game, biddingPlayer, screen, isOnlineGame]);

  useEffect(() => {
    if (screen !== "game") return;
    const prev = prevRef.current;

    if (game.phase === "bidding" && prev.phase !== "bidding") {
      setPopup({ type: "trump", data: { trumpSuit: game.trumpSuit, trumpCard: game.trumpCard, handSize: game.handSize, roundIndex: game.roundIndex, totalRounds: game.sequence.length, hand: game.players[humanIndex]?.hand ?? [] } });
    } else if (game.phase === "roundEnd" && prev.phase !== "roundEnd") {
      const { players, roundIndex } = game;
      setTimeout(() => setPopup({ type: "roundSummary", data: { players, humanIndex, roundIndex } }), 800);
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
    if (game.phase !== "roundEnd" || isOnlineGame) return;
    const t = setTimeout(() => setGame((g) => g.phase === "roundEnd" ? nextRound(g) : g), ROUND_END_DELAY_MS);
    return () => clearTimeout(t);
  }, [game.phase, isOnlineGame]);

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

  const t = TABLE_THEMES[settings.colorTheme] ?? TABLE_THEMES.river;
  const pauseWinner = game.phase === "trickPause" && game.trick.length ? winningPlay(game.trick, game.trumpSuit) : null;
  const statusText =
    game.phase === "bidding" ? (humanBidTurn ? "Your bid" : `${game.players[biddingPlayer]?.name} is bidding…`)
    : game.phase === "playing" ? (humanPlayTurn ? "Your turn — play a card" : `${game.players[game.turn]?.name} is thinking…`)
    : game.phase === "trickPause" ? `${game.players[pauseWinner?.playerIndex]?.name ?? "Someone"} wins this trick`
    : game.phase === "roundEnd" ? "Round over"
    : "Game over";

  /* ── START SCREEN ── */

  if (screen === "start") {
    return (
      <ThemeContext.Provider value={settings}>
        <div className={`min-h-screen p-4 ${t.shell}`} style={{ background: t.shellBg }}>
          <HelpModal mode={helpMode} onClose={() => setHelpMode(null)} />
          <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center">
            <main className="grid w-full gap-4 lg:grid-cols-[0.9fr_1.1fr]">

              {/* Hero */}
              <section className={`flex min-h-80 flex-col justify-between overflow-hidden rounded-3xl border p-6 shadow-2xl ${t.panel}`}>
                <div>
                  <div className="mb-2 text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: t.accent }}>
                    The card parlour presents
                  </div>
                  <h1 className="font-display text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                    Up &amp; Down<br />the River
                  </h1>
                  <p className={`mt-2 text-sm ${t.subtle}`}>Trick-taking bids, trump swings, exact-score pressure.</p>

                  <div className="mt-6 flex justify-center py-3">
                    {HERO_CARDS.map((card, i) => (
                      <div
                        key={card.id}
                        className={i > 0 ? "-ml-6" : ""}
                        style={{ transform: `rotate(${(i - 1.5) * 7}deg) translateY(${Math.abs(i - 1.5) * 6}px)`, transformOrigin: "50% 130%", zIndex: i }}
                      >
                        <PlayingCard card={card} viewing />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-2">
                  <button type="button" onClick={startGame} className={`rounded-xl px-4 py-3 font-bold shadow ${t.button}`}>
                    New Game
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setHelpMode("tutorial")} className={`rounded-xl px-4 py-3 font-bold ${t.buttonQuiet}`}>
                      Tutorial
                    </button>
                    <button type="button" onClick={() => setHelpMode("rules")} className={`rounded-xl px-4 py-3 font-bold ${t.buttonQuiet}`}>
                      Rules
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!savedGame}
                    onClick={resumeGame}
                    className={`rounded-xl px-4 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-40 ${t.buttonQuiet}`}
                  >
                    Resume Game
                  </button>
                  {savedGameSummary && (
                    <div className={`flex items-center justify-between gap-3 text-xs ${t.subtle}`}>
                      <span>{savedGameSummary}</span>
                      <button type="button" onClick={forgetSavedGame} className={`underline hover:opacity-80 ${t.faint}`}>clear</button>
                    </div>
                  )}
                </div>
              </section>

              {/* Settings */}
              <section className={`rounded-3xl border p-5 shadow-2xl ${t.panel}`}>
                <div className="mb-4">
                  <h2 className="font-display text-xl font-bold">Table settings</h2>
                  <p className={`text-sm ${t.subtle}`}>Set the table before you sit down.</p>
                </div>
                <SettingsControls settings={settings} updateSetting={updateSetting} />
              </section>

              {/* Multiplayer */}
              <section className={`rounded-3xl border p-5 shadow-2xl lg:col-span-2 ${t.panel}`}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-bold">Online multiplayer</h2>
                    <p className={`text-sm ${t.subtle}`}>Create a room, share the link, and reconnect with the same browser if you drop.</p>
                    <p className={`mt-1 break-all font-mono text-[11px] ${t.faint}`}>Server: {multiplayerHttpUrl()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mpRoom?.serverId && <Chip>Server {mpRoom.serverId}</Chip>}
                    <Chip tone={mpConnected ? "green" : "plain"}>{mpConnected ? "Connected" : "Offline"}</Chip>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_0.7fr_auto_auto]">
                  <label className="space-y-1">
                    <span className={`text-xs ${t.subtle}`}>Name</span>
                    <input value={mpName} onChange={(e) => setMpName(e.target.value)} maxLength={24}
                      className={`w-full rounded-xl border px-3 py-2 ${t.panelInner}`} />
                  </label>
                  <label className="space-y-1">
                    <span className={`text-xs ${t.subtle}`}>Room code</span>
                    <input value={mpCode} onChange={(e) => setMpCode(e.target.value.toUpperCase().slice(0, 4))} maxLength={4}
                      className={`w-full rounded-xl border px-3 py-2 uppercase tracking-[0.35em] ${t.panelInner}`} />
                  </label>
                  <label className="space-y-1">
                    <span className={`text-xs ${t.subtle}`}>Bots</span>
                    <select value={mpBots} onChange={(e) => setMpBots(Number(e.target.value))} className={`w-full rounded-xl border px-3 py-2 ${t.panelInner}`}>
                      {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
                    <button type="button" disabled={mpBusy} onClick={createMultiplayerRoom} className={`rounded-xl px-4 py-2 font-semibold disabled:opacity-50 ${t.button}`}>
                      {mpBusy ? "..." : "Create"}
                    </button>
                    <button type="button" disabled={mpBusy} onClick={joinMultiplayerRoom} className={`rounded-xl px-4 py-2 font-semibold disabled:opacity-50 ${t.buttonQuiet}`}>
                      Join
                    </button>
                  </div>
                </div>

                {mpError && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">{mpError}</div>}

                {mpRoom?.status === "lobby" && (
                  <div className={`mt-4 rounded-2xl border p-4 ${t.panelInner}`}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className={`text-xs uppercase tracking-widest ${t.faint}`}>Room code</div>
                        <div className="font-display font-mono text-4xl font-black tracking-[0.35em]" style={{ color: t.accent }}>{mpRoom.code}</div>
                        <div className={`mt-1 break-all text-xs ${t.faint}`}>{mpShareUrl}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={copyRoomLink} className={`rounded-xl px-3 py-2 text-sm ${t.buttonQuiet}`}>Copy link</button>
                        {mpRoom.hostId === mpPlayerId && (
                          <>
                            <button type="button" onClick={() => sendMultiplayer({ type: "addBot" })} className={`rounded-xl px-3 py-2 text-sm ${t.buttonQuiet}`}>Add bot</button>
                            <button type="button" onClick={() => sendMultiplayer({ type: "removeBot" })} className={`rounded-xl px-3 py-2 text-sm ${t.buttonQuiet}`}>Remove bot</button>
                            <button type="button" onClick={() => sendMultiplayer({ type: "start" })} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-400">Start</button>
                          </>
                        )}
                      </div>
                    </div>
                    {mpCopyStatus && <div className={`mb-3 text-xs ${t.subtle}`}>{mpCopyStatus}</div>}
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {mpRoom.seats.map((seat) => (
                        <div key={seat.id} className={`rounded-xl border px-3 py-2 ${t.panelInner}`}>
                          <div className="font-semibold">{seat.name}</div>
                          <div className={`text-xs ${seat.isBot ? t.faint : seat.connected ? "text-emerald-400" : "text-red-400"}`}>
                            {seat.isBot ? "bot" : seat.connected ? "connected" : "disconnected"}
                          </div>
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

  /* ── GAME SCREEN ── */

  return (
    <ThemeContext.Provider value={settings}>
      <div className={`min-h-screen p-3 sm:p-4 ${t.shell}`} style={{ background: t.shellBg }}>
        <HelpModal mode={helpMode} onClose={() => setHelpMode(null)} />
        <WinPopup
          popup={popup}
          onDismiss={() => setPopup(null)}
          onNextRound={() => setGame((g) => g.phase === "roundEnd" ? nextRound(g) : g)}
          onPlayAgain={startGame}
          onCopyGameLog={copyFullGameLog}
          copyStatus={copyStatus}
        />

        <div className="mx-auto max-w-7xl space-y-3">

          {/* HUD */}
          <header className={`rounded-3xl border px-4 py-3 shadow-2xl backdrop-blur sm:px-5 ${t.panel}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="font-display text-lg font-black tracking-tight">Up &amp; Down the River</h1>
                <span className={`hidden text-sm sm:inline ${t.subtle}`}>{statusText}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="accent">Round {game.roundIndex + 1}/{game.sequence.length}</Chip>
                <Chip>{game.handSize} card{game.handSize === 1 ? "" : "s"}</Chip>
                <Chip>Dealer · {game.players[game.dealer].name}</Chip>
                {isOnlineGame && <Chip tone="green">Room {mpRoom?.code}</Chip>}
                <button type="button" onClick={returnToStart} className={`rounded-xl px-3 py-1.5 text-sm ${t.buttonQuiet}`}>Menu</button>
                <button type="button" onClick={() => setHelpMode("rules")} className={`rounded-xl px-3 py-1.5 text-sm ${t.buttonQuiet}`}>Rules</button>
                <button type="button" onClick={() => setSettingsOpen((v) => !v)} className={`rounded-xl px-3 py-1.5 text-sm ${t.buttonQuiet}`}>
                  {settingsOpen ? "✕ Close" : "⚙ Settings"}
                </button>
              </div>
            </div>
            <div className={`mt-1 text-sm sm:hidden ${t.subtle}`}>{statusText}</div>
            {settingsOpen && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <SettingsControls
                  settings={settings}
                  updateSetting={updateSetting}
                  compact
                  action={(
                    <button type="button" onClick={() => { startGame(); setSettingsOpen(false); }} className={`rounded-xl px-4 py-2 font-semibold shadow ${t.button}`}>
                      New game
                    </button>
                  )}
                />
              </div>
            )}
          </header>

          <main className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">

            {/* Table column */}
            <section className="min-w-0 space-y-3">
              <GameTable
                game={game}
                humanIndex={humanIndex}
                biddingPlayer={biddingPlayer}
                trickLeadIndex={trickLeadIndex}
                showVoids={settings.helper}
                banter={game.banter ?? []}
              />

              {humanBidTurn && (
                <BidTray
                  bids={humanLegalBids}
                  handSize={game.handSize}
                  onBid={(bid) => isOnlineGame ? sendMultiplayer({ type: "bid", bid }) : setGame((g) => submitBid(g, bid))}
                />
              )}

              <div className={`rounded-3xl border px-2 pb-1 pt-2 shadow-xl ${t.panel}`}>
                <div className="flex items-center justify-between px-3">
                  <span className={`text-[10px] font-black uppercase tracking-[0.22em] ${t.faint}`}>Your hand</span>
                  <TrumpPlaque game={game} compact />
                </div>
                <HandFan
                  hand={human.hand}
                  humanPlayTurn={humanPlayTurn}
                  humanLegalCards={humanLegalCards}
                  game={game}
                  settings={settings}
                  helperAnalysis={helperAnalysis}
                  onPlay={(card) => isOnlineGame ? sendMultiplayer({ type: "play", cardId: card.id }) : setGame((g) => playCard(g, humanIndex, card.id))}
                />
              </div>

              {settings.helper && !isOnlineGame && (
                <HelperPanel game={game} human={human} helperAnalysis={helperAnalysis} />
              )}
            </section>

            {/* Sidebar */}
            <aside className="min-w-0 space-y-3">

              {/* Last trick */}
              <div className={`rounded-3xl border p-4 shadow-xl ${t.panel}`}>
                <h2 className={`mb-2 text-[10px] font-black uppercase tracking-[0.22em] ${t.faint}`}>Last trick</h2>
                {game.lastTrick ? (
                  <div>
                    <p className={`mb-2 text-sm ${t.subtle}`}>
                      Won by <span className="font-bold" style={{ color: t.accent }}>{game.players[game.lastTrick.winnerIndex].name}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {game.lastTrick.plays.map((play) => (
                        <div key={`${play.playerIndex}-${play.card.id}`} className="text-center">
                          <PlayingCard card={play.card} small viewing winning={play.playerIndex === game.lastTrick.winnerIndex} />
                          <div className={`mt-1 max-w-12 truncate text-[10px] ${t.faint}`}>{game.players[play.playerIndex].name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <p className={`text-sm ${t.faint}`}>No completed trick yet.</p>}
              </div>

              {/* Leaderboard */}
              <div className={`rounded-3xl border p-4 shadow-xl ${t.panel}`}>
                <h2 className={`mb-3 text-[10px] font-black uppercase tracking-[0.22em] ${t.faint}`}>Leaderboard</h2>
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
                      return (
                        <div
                          key={p.id}
                          className={`px-4 py-3 ${rank > 0 ? "border-t border-white/5" : ""}`}
                          style={{
                            background: isActive ? t.accentSoft : rank === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.25)",
                            boxShadow: isActive ? `inset 3px 0 0 ${t.accent}` : "none",
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-5 text-center text-base">{medal ?? <span className={`text-xs ${t.faint}`}>{rank + 1}</span>}</span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-semibold" style={{ color: rank === 0 ? t.accent : undefined }}>
                                {p.name}
                                {p.originalIndex === game.dealer && <span className={`ml-1 text-[10px] ${t.faint}`}>dealer</span>}
                                {p.originalIndex === trickLeadIndex && (game.phase === "bidding" || game.phase === "playing" || game.phase === "trickPause") && <span className="ml-1 text-[10px] text-emerald-400">leads</span>}
                              </div>
                              {p.bid !== null ? (
                                <div className={`text-xs ${hitBid ? "text-emerald-400" : overBid ? "text-amber-400" : t.subtle}`}>
                                  {hitBid ? `✓ bid ${p.bid}` : overBid ? `+${p.tricks - p.bid} over` : `bid ${p.bid} · needs ${need}`}
                                </div>
                              ) : (
                                <div className={`text-xs ${t.faint}`}>no bid yet</div>
                              )}
                              {settings.helper && !p.isHuman && (() => {
                                const voidSuits = game.voids?.[p.originalIndex] ?? [];
                                if (!voidSuits.length) return null;
                                return (
                                  <div className="mt-0.5 flex items-center gap-1">
                                    <span className={`text-[9px] uppercase tracking-wider ${t.faint}`}>void</span>
                                    {voidSuits.map((s) => (
                                      <span key={s} className={`text-sm leading-none ${s === "♥" || s === "♦" ? "text-red-400/80" : "opacity-70"}`}>{s}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-black tabular-nums leading-none" style={{ color: rank === 0 ? t.accent : undefined }}>{p.score}</div>
                              {(game.phase === "roundEnd" || game.phase === "gameEnd") && p.roundScore != null && (
                                <div className={`text-xs font-semibold tabular-nums ${p.bid === p.tricks ? "text-emerald-400" : t.faint}`}>+{p.roundScore}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Table talk */}
              <div className={`rounded-3xl border p-4 shadow-xl ${t.panel}`}>
                <h2 className={`mb-3 text-[10px] font-black uppercase tracking-[0.22em] ${t.faint}`}>Table talk</h2>
                <div className="space-y-2">
                  {(game.banter ?? []).length ? (game.banter ?? []).slice(0, 5).map((line) => (
                    <div key={line.id} className={`rounded-2xl border px-4 py-2.5 ${t.panelInner}`}>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-widest" style={{ color: t.accent }}>{line.speaker}</div>
                      <div className="text-sm leading-snug">"{line.text}"</div>
                    </div>
                  )) : (
                    <p className={`text-sm ${t.faint}`}>The bots are saving their worst material.</p>
                  )}
                </div>
              </div>

              {/* Final scores */}
              {game.phase === "gameEnd" && (
                <div className={`rounded-3xl border p-4 shadow-xl ${t.panel}`}>
                  <h2 className="mb-3 font-display text-xl font-semibold">Final scores</h2>
                  <div className="overflow-hidden rounded-2xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead style={{ background: "rgba(0,0,0,0.35)" }}>
                        <tr className={t.subtle}><th className="p-2 text-left">Player</th><th>Bid</th><th>Won</th><th>+Pts</th><th>Total</th></tr>
                      </thead>
                      <tbody>
                        {game.summary?.map((row) => (
                          <tr key={row.name} className="border-t border-white/10" style={{ background: "rgba(0,0,0,0.2)" }}>
                            <td className="p-2">{row.name}</td><td className="text-center">{row.bid}</td><td className="text-center">{row.tricks}</td><td className="text-center text-emerald-400">+{row.roundScore}</td><td className="text-center font-bold">{row.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={startGame} className={`mt-3 w-full rounded-xl px-4 py-2 font-semibold ${t.button}`}>Play again</button>
                </div>
              )}

              {/* Game log */}
              {game.phase === "gameEnd" && (
                <div className={`rounded-3xl border p-4 shadow-xl ${t.panel}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="font-display text-xl font-semibold">Game log</h2>
                    <div className="flex items-center gap-2">
                      {copyStatus && <span className={`text-xs ${t.subtle}`}>{copyStatus}</span>}
                      <button type="button" onClick={copyFullGameLog} className={`rounded-xl px-3 py-2 text-sm font-semibold ${t.button}`}>
                        Copy
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={gameLogText}
                    className={`h-72 w-full resize-y rounded-2xl border p-3 font-mono text-xs leading-relaxed outline-none ${t.panelInner}`}
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
