const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_NAME = { "♠": "Spades", "♥": "Hearts", "♦": "Diamonds", "♣": "Clubs" };
const JOKER_TRUMP = "🃏";
const RANKS = [
  ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8],
  ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
];
const BOT_NAMES = ["River Bot", "Delta Bot", "Harbor Bot", "Canyon Bot", "Bridge Bot"];

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

function isTrump(card, trumpSuit) {
  return !!trumpSuit && (card.joker || card.suit === trumpSuit);
}

function effectiveSuit(card, trumpSuit) {
  if (isTrump(card, trumpSuit)) return trumpSuit;
  if (card.joker) return "JOKER";
  return card.suit;
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
  if (!card) return "-";
  return card.joker ? "Joker" : `${card.rank}${card.suit}`;
}

function cardsText(cards) {
  return cards.length ? cards.map(cardText).join(" ") : "(none)";
}

function orderFromDealer(dealer, n) {
  return Array.from({ length: n }, (_, i) => (dealer + 1 + i) % n);
}

function maxAllowedHand(numPlayers) {
  return Math.floor((54 - 1) / numPlayers);
}

function legalCards(hand, trick, trumpSuit) {
  if (!trick.length) return hand;
  const leadSuit = effectiveSuit(trick[0].card, trumpSuit);
  if (trumpSuit) {
    const hasLedSuit = hand.some((c) => effectiveSuit(c, trumpSuit) === leadSuit);
    return hasLedSuit ? hand.filter((c) => effectiveSuit(c, trumpSuit) === leadSuit || isTrump(c, trumpSuit)) : hand;
  }
  const follow = hand.filter((c) => effectiveSuit(c, null) === leadSuit);
  return follow.length ? follow : hand;
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
  const leadSuit = effectiveSuit(trick[0].card, trumpSuit);
  return trick.reduce((best, play) => compareCards(play.card, best.card, leadSuit, trumpSuit) > 0 ? play : best, trick[0]);
}

function wouldWin(card, trick, trumpSuit) {
  if (!trick.length) return true;
  return winningPlay([...trick, { playerIndex: -1, card }], trumpSuit).card.id === card.id;
}

function updateVoids(voids, completedTrick, trumpSuit) {
  const leadSuit = effectiveSuit(completedTrick[0].card, trumpSuit);
  const result = { ...voids };
  for (const { playerIndex, card } of completedTrick) {
    const eff = effectiveSuit(card, trumpSuit);
    let voidSuit = null;
    if (leadSuit === trumpSuit) {
      if (!isTrump(card, trumpSuit)) voidSuit = trumpSuit;
    } else if (eff !== leadSuit && !isTrump(card, trumpSuit)) {
      voidSuit = leadSuit;
    }
    if (voidSuit) {
      const prev = result[playerIndex] ?? [];
      if (!prev.includes(voidSuit)) result[playerIndex] = [...prev, voidSuit];
    }
  }
  return result;
}

function legalBids(game, playerIndex) {
  const bids = Array.from({ length: game.handSize + 1 }, (_, i) => i);
  if (!game.settings.screwDealer) return bids;
  const order = orderFromDealer(game.dealer, game.players.length);
  const isLastBidder = game.bidIndex === order.length - 1 && order[game.bidIndex] === playerIndex;
  if (!isLastBidder) return bids;
  const total = game.players.reduce((sum, p) => sum + (p.bid ?? 0), 0);
  return bids.filter((b) => b !== game.handSize - total);
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

function scorePlayers(players) {
  return players.map((p) => {
    const roundScore = p.bid === 0 && p.tricks === 0 ? 5 : p.tricks + (p.bid === p.tricks ? 10 : 0);
    return { ...p, roundScore, score: p.score + roundScore };
  });
}

function formatScoreboard(players) {
  return players.map((p) => `${p.name}: bid ${p.bid ?? "-"}, tricks ${p.tricks}, round +${p.roundScore ?? 0}, total ${p.score}`).join(" | ");
}

function botBanterLine(game, playerIndex, event, context = {}) {
  const player = game.players[playerIndex];
  if (!player?.isBot) return null;
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
    ],
    exact: [
      `Exact bid. Clean as a whistle, annoying as a tax bill.`,
      `That is called precision. You may clap quietly.`,
      `I meant to do that, which is the worst part for you.`,
      `Perfect landing. No notes. Except yours, which are wrong.`,
      `Another round solved by superior cardboard instincts.`,
    ],
    miss: [
      `I was exploring alternative scoring.`,
      `That round was a clerical error.`,
      `No further questions from the table, please.`,
      `I reject the premise of arithmetic.`,
      `The cards betrayed me, as cards often do.`,
    ],
  };
  const choices = (lines[event] ?? []).filter(Boolean);
  if (!choices.length) return null;
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, speaker: player.name, text: choices[Math.floor(Math.random() * choices.length)], event };
}

function withBanter(game, entries) {
  const next = entries.filter(Boolean);
  if (!next.length) return game;
  return { ...game, banter: [...next, ...(game.banter ?? [])].slice(0, 12) };
}

function dealRound(basePlayers, settings, sequence, roundIndex, oldLog = [], oldAuditLog = [], oldBanter = []) {
  const activePlayers = basePlayers.filter((p) => !p.removed);
  const n = activePlayers.length;
  const nextSettings = { ...settings, players: n, maxHand: Math.min(settings.maxHand, maxAllowedHand(n)) };
  const handSize = sequence[roundIndex];
  const dealer = roundIndex % n;
  const deck = shuffle(makeDeck());
  const hands = Array.from({ length: n }, () => []);
  for (let c = 0; c < handSize; c++) for (let p = 0; p < n; p++) hands[p].push(deck.pop());
  const trumpCard = deck.pop();
  const trumpSuit = trumpCard?.joker ? JOKER_TRUMP : trumpCard?.suit;
  const players = activePlayers.map((p, i) => ({
    ...p,
    hand: sortHand(hands[i], trumpSuit),
    bid: null,
    tricks: 0,
    roundScore: 0,
  }));
  const lead = orderFromDealer(dealer, n)[0];
  const roundHeader = `Round ${roundIndex + 1}/${sequence.length}: ${handSize} cards. Dealer: ${players[dealer].name}. Lead: ${players[lead].name}. Trump: ${trumpCard?.joker ? `Joker Trump (${cardText(trumpCard)} turned up; the other joker is trump)` : `${SUIT_NAME[trumpSuit]} (${cardText(trumpCard)})`}.`;
  return {
    settings: nextSettings,
    sequence,
    roundIndex,
    handSize,
    dealer,
    trumpCard,
    trumpSuit,
    players,
    phase: "bidding",
    bidIndex: 0,
    turn: lead,
    trick: [],
    played: [],
    voids: {},
    lastTrick: null,
    summary: null,
    log: [roundHeader, ...oldLog].slice(0, 24),
    auditLog: [...oldAuditLog, "", roundHeader, "Hands:", ...players.map((p) => `  ${p.name}: ${cardsText(p.hand)}`), `Undealt stock after trump: ${cardsText(deck)}`, "Bidding:"],
    banter: oldBanter,
  };
}

function createGame(settings, seats) {
  const n = Math.max(3, Math.min(6, seats.length));
  const cleanSettings = { ...settings, players: n, maxHand: Math.min(settings.maxHand ?? 7, maxAllowedHand(n)) };
  const sequence = handSequence(cleanSettings.maxHand);
  const players = seats.slice(0, n).map((seat, i) => ({
    id: seat.id,
    name: seat.name || BOT_NAMES[i] || `Player ${i + 1}`,
    isHuman: !seat.isBot,
    isBot: !!seat.isBot,
    connected: !seat.isBot,
    hand: [],
    bid: null,
    tricks: 0,
    score: 0,
    roundScore: 0,
  }));
  const auditLog = [
    "Up & Down the River - Multiplayer Full Game Log",
    `Settings: players ${cleanSettings.players}, max hand ${cleanSettings.maxHand}, screw the dealer ${cleanSettings.screwDealer ? "on" : "off"}, difficulty ${cleanSettings.difficulty}.`,
    `Players: ${players.map((p) => p.name).join(", ")}`,
  ];
  return dealRound(players, cleanSettings, sequence, 0, [], auditLog, []);
}

function chooseBidBot(game, playerIndex) {
  const legal = legalBids(game, playerIndex);
  const p = game.players[playerIndex];
  const trumpSuit = game.trumpSuit;
  let expected = 0;
  for (const card of p.hand) {
    if (card.joker) expected += trumpSuit ? 0.1 : 0.02;
    else if (isTrump(card, trumpSuit)) expected += card.value >= 11 ? 0.75 : 0.25;
    else if (card.value === 14) expected += 0.55;
    else if (card.value >= 12) expected += 0.3;
  }
  const target = Math.max(0, Math.min(game.handSize, Math.round(expected)));
  return legal.reduce((best, b) => Math.abs(b - target) < Math.abs(best - target) ? b : best, legal[0]);
}

function chooseCardBot(game, playerIndex) {
  const p = game.players[playerIndex];
  const options = legalCards(p.hand, game.trick, game.trumpSuit);
  if (!game.trick.length) {
    const need = Math.max(0, (p.bid ?? 0) - p.tricks);
    return need > 0 ? high(options, game.trumpSuit) : low(options, game.trumpSuit);
  }
  const need = Math.max(0, (p.bid ?? 0) - p.tricks);
  const winners = options.filter((c) => wouldWin(c, game.trick, game.trumpSuit));
  const losers = options.filter((c) => !wouldWin(c, game.trick, game.trumpSuit));
  if (need > 0) return winners.length ? low(winners, game.trumpSuit) : low(options, game.trumpSuit);
  return losers.length ? high(losers, game.trumpSuit) : low(options, game.trumpSuit);
}

function submitBid(game, playerIndex, bid) {
  if (game.phase !== "bidding") return game;
  const order = orderFromDealer(game.dealer, game.players.length);
  if (order[game.bidIndex] !== playerIndex) return game;
  const legal = legalBids(game, playerIndex);
  if (!legal.includes(bid)) return game;
  const players = game.players.map((p, i) => i === playerIndex ? { ...p, bid } : p);
  const bidIndex = game.bidIndex + 1;
  const entry = `  ${players[playerIndex].name} bids ${bid}. Legal bids: ${legal.join(", ")}.`;
  const banter = Math.random() < 0.22 ? botBanterLine({ ...game, players }, playerIndex, "bid", { bid }) : null;
  if (bidIndex >= order.length) {
    const lead = (game.dealer + 1) % players.length;
    return withBanter({ ...game, players, bidIndex, phase: "playing", turn: lead, log: [`${players[playerIndex].name} bids ${bid}. ${players[lead].name} leads.`, ...game.log].slice(0, 24), auditLog: [...game.auditLog, entry, `Play begins. ${players[lead].name} leads.`] }, [banter]);
  }
  return withBanter({ ...game, players, bidIndex, turn: order[bidIndex], log: [`${players[playerIndex].name} bids ${bid}.`, ...game.log].slice(0, 24), auditLog: [...game.auditLog, entry] }, [banter]);
}

function playCard(game, playerIndex, cardId) {
  if (game.phase !== "playing" || game.turn !== playerIndex) return game;
  const player = game.players[playerIndex];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return game;
  const options = legalCards(player.hand, game.trick, game.trumpSuit);
  if (!options.some((c) => c.id === cardId)) return game;
  const players = game.players.map((p, i) => i === playerIndex ? { ...p, hand: p.hand.filter((c) => c.id !== cardId) } : p);
  const trick = [...game.trick, { playerIndex, card }];
  const winner = winningPlay(trick, game.trumpSuit);
  const banter = Math.random() < 0.08 ? botBanterLine(game, playerIndex, "play", { card, isTrump: isTrump(card, game.trumpSuit) }) : null;
  const audit = [
    `  ${player.name} plays ${cardText(card)}.`,
    `    Legal cards: ${cardsText(options)}.`,
    `    Current winner: ${players[winner.playerIndex].name} with ${cardText(winner.card)}.`,
  ];
  if (trick.length < players.length) {
    return withBanter({ ...game, players, trick, turn: (playerIndex + 1) % players.length, log: [`${player.name} plays ${cardText(card)}.`, ...game.log].slice(0, 24), auditLog: [...game.auditLog, ...audit] }, [banter]);
  }
  return withBanter({ ...game, players, trick, phase: "trickPause", turn: null, log: [`${player.name} plays ${cardText(card)}.`, ...game.log].slice(0, 24), auditLog: [...game.auditLog, ...audit] }, [banter]);
}

function resolveTrick(game) {
  if (game.phase !== "trickPause") return game;
  const winnerIndex = winningPlay(game.trick, game.trumpSuit).playerIndex;
  const players = game.players.map((p, i) => i === winnerIndex ? { ...p, tricks: p.tricks + 1 } : p);
  const played = [...game.played, ...game.trick.map((p) => p.card.id)];
  const voids = updateVoids(game.voids, game.trick, game.trumpSuit);
  const lastTrick = { winnerIndex, plays: game.trick };
  const empty = players.every((p) => p.hand.length === 0);
  const audit = [
    `  Trick result: ${players[winnerIndex].name} wins.`,
    `    Plays: ${game.trick.map((p) => `${players[p.playerIndex].name} ${cardText(p.card)}`).join(", ")}.`,
    `    Tricks: ${players.map((p) => `${p.name} ${p.tricks}/${p.bid}`).join(", ")}.`,
  ];
  if (!empty) {
    const banter = Math.random() < 0.16 ? botBanterLine({ ...game, players }, winnerIndex, "trick") : null;
    return withBanter({ ...game, players, trick: [], played, voids, lastTrick, phase: "playing", turn: winnerIndex, log: [`${players[winnerIndex].name} wins the trick.`, ...game.log].slice(0, 24), auditLog: [...game.auditLog, ...audit, `  ${players[winnerIndex].name} leads.`] }, [banter]);
  }
  const scored = scorePlayers(players);
  const roundBanter = scored.map((p, i) => {
    if (!p.isBot || Math.random() >= 0.18) return null;
    return botBanterLine({ ...game, players: scored }, i, p.bid === p.tricks ? "exact" : "miss");
  });
  const summary = scored.map((p) => ({ name: p.name, bid: p.bid, tricks: p.tricks, roundScore: p.roundScore, score: p.score }));
  const final = game.roundIndex + 1 >= game.sequence.length || scored.filter((p) => !p.removed).length < 3;
  const nextLog = [...game.auditLog, ...audit, `Round ${game.roundIndex + 1} score: ${formatScoreboard(scored)}.`];
  if (final) {
    nextLog.push("Final standings:");
    nextLog.push(...[...scored].sort((a, b) => b.score - a.score).map((p, i) => `  ${i + 1}. ${p.name}: ${p.score}`));
  }
  return withBanter({ ...game, players: scored, trick: [], played, voids, lastTrick, turn: null, phase: final ? "gameEnd" : "roundEnd", summary, log: [`${scored[winnerIndex].name} wins the final trick. Round scored.`, ...game.log].slice(0, 24), auditLog: nextLog }, roundBanter);
}

function nextRound(game) {
  if (game.phase !== "roundEnd") return game;
  return dealRound(game.players, game.settings, game.sequence, game.roundIndex + 1, game.log, game.auditLog, game.banter ?? []);
}

function sanitizeGame(game, playerId) {
  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  return {
    ...game,
    youIndex: playerIndex,
    players: game.players.map((p, i) => ({
      ...p,
      hand: i === playerIndex || game.phase === "gameEnd" ? p.hand : [],
      handCount: p.hand.length,
    })),
  };
}

export {
  BOT_NAMES,
  createGame,
  legalBids,
  legalCards,
  chooseBidBot,
  chooseCardBot,
  submitBid,
  playCard,
  resolveTrick,
  nextRound,
  sanitizeGame,
};
