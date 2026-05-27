// Headless benchmark: new Monte Carlo extreme AI vs the previous heuristic.
// Reimplements the pure game logic from src/App.jsx (no React) and runs a tournament.

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [
  ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8],
  ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const [rank, value] of RANKS) deck.push({ id: `${rank}${suit}`, suit, rank, value, joker: false });
  deck.push({ id: "JOKER-RED", suit: "🃏", rank: "Joker", value: 1, joker: true });
  deck.push({ id: "JOKER-BLACK", suit: "🃏", rank: "Joker", value: 1, joker: true });
  return deck;
}
function shuffle(cards) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const isTrump = (card, t) => !t ? false : (card.joker || card.suit === t);
const effectiveSuit = (card, t) => isTrump(card, t) ? t : (card.joker ? "JOKER" : card.suit);
function orderFromDealer(dealer, n) { return Array.from({ length: n }, (_, i) => (dealer + 1 + i) % n); }
function legalCards(hand, trick, trumpSuit) {
  if (!trick.length) return hand;
  const leadSuit = effectiveSuit(trick[0].card, trumpSuit);
  if (trumpSuit) {
    const hasLed = hand.some((c) => effectiveSuit(c, trumpSuit) === leadSuit);
    if (hasLed) return hand.filter((c) => effectiveSuit(c, trumpSuit) === leadSuit || isTrump(c, trumpSuit));
    return hand;
  }
  const follow = hand.filter((c) => effectiveSuit(c, null) === leadSuit);
  return follow.length ? follow : hand;
}
function compareCards(a, b, leadSuit, trumpSuit) {
  const aT = isTrump(a, trumpSuit), bT = isTrump(b, trumpSuit);
  if (aT && !bT) return 1;
  if (!aT && bT) return -1;
  const aS = effectiveSuit(a, trumpSuit), bS = effectiveSuit(b, trumpSuit);
  if (aS === bS) return a.value - b.value;
  if (aS === leadSuit) return 1;
  if (bS === leadSuit) return -1;
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
function strength(card, t) { if (card.joker && t) return 1; if (card.joker) return 0; return card.value + (isTrump(card, t) ? 20 : 0); }
const low = (cards, t) => [...cards].sort((a, b) => strength(a, t) - strength(b, t))[0];
const high = (cards, t) => [...cards].sort((a, b) => strength(b, t) - strength(a, t))[0];
function isKnownVoid(voids, pi, suit) { return (voids?.[pi] ?? []).includes(suit); }
function updateVoids(voids, trick, t) {
  const leadSuit = effectiveSuit(trick[0].card, t);
  const result = { ...voids };
  for (const { playerIndex, card } of trick) {
    const eff = effectiveSuit(card, t);
    let v = null;
    if (leadSuit === t) { if (!isTrump(card, t)) v = t; }
    else if (eff !== leadSuit && !isTrump(card, t)) v = leadSuit;
    if (v) { const prev = result[playerIndex] ?? []; if (!prev.includes(v)) result[playerIndex] = [...prev, v]; }
  }
  return result;
}
function scoreRound(bid, tricks) {
  if (bid === 0 && tricks === 0) return 5;
  return tricks + (bid === tricks ? 10 : 0);
}

// ── NEW: Monte Carlo extreme ──────────────────────────────────────────────────
function getUnseen(game, pi) {
  const myIds = new Set(game.players[pi].hand.map((c) => c.id));
  const playedIds = new Set(game.played);
  const trickIds = new Set(game.trick.map((p) => p.card.id));
  const trumpId = game.trumpCard?.id;
  return makeDeck().filter((c) => !myIds.has(c.id) && !playedIds.has(c.id) && !trickIds.has(c.id) && c.id !== trumpId);
}
function simPolicy(hand, trick, t, need) {
  const options = legalCards(hand, trick, t);
  if (!trick.length) return need > 0 ? high(options, t) : low(options, t);
  const winners = options.filter((c) => wouldWin(c, trick, t));
  if (need > 0) { if (winners.length) return low(winners, t); return low(options, t); }
  const losers = options.filter((c) => !wouldWin(c, trick, t));
  if (losers.length) return high(losers, t);
  return high(options, t);
}
function dealDet(game, pi, unseen) {
  const n = game.players.length;
  const voids = game.voids ?? {};
  const hands = game.players.map((p, i) => (i === pi ? [...p.hand] : []));
  const targets = game.players.map((p, i) => (i === pi ? 0 : p.hand.length));
  for (const card of shuffle(unseen)) {
    const suit = effectiveSuit(card, game.trumpSuit);
    for (let pass = 0; pass < 2; pass++) {
      const eligible = [];
      for (let i = 0; i < n; i++) {
        if (i === pi || hands[i].length >= targets[i]) continue;
        if (pass === 0 && isKnownVoid(voids, i, suit)) continue;
        eligible.push(i);
      }
      if (eligible.length) {
        hands[eligible[Math.floor(Math.random() * eligible.length)]].push(card);
        break;
      }
    }
  }
  return hands;
}
function playout(hands, startTrick, leaderTurn, t, bids, baseTricks, n) {
  const won = [...baseTricks];
  let trick = startTrick.map((x) => ({ ...x }));
  let turn = leaderTurn, guard = 0;
  while (guard++ < 600) {
    while (trick.length < n) {
      const hand = hands[turn];
      if (!hand.length) break;
      const card = simPolicy(hand, trick, t, bids[turn] - won[turn]);
      hands[turn] = hand.filter((c) => c.id !== card.id);
      trick.push({ playerIndex: turn, card });
      turn = (turn + 1) % n;
    }
    if (!trick.length) break;
    const w = winningPlay(trick, t).playerIndex;
    won[w] += 1; trick = []; turn = w;
    if (hands.every((h) => h.length === 0)) break;
  }
  return won;
}
function bidNewMC(game, pi) {
  const unseen = getUnseen(game, pi);
  const n = game.players.length, leader = (game.dealer + 1) % n, sims = 200;
  const legal = Array.from({ length: game.handSize + 1 }, (_, i) => i);
  const scoreByBid = new Array(game.handSize + 1).fill(0);
  const hitsByBid = new Array(game.handSize + 1).fill(0);
  for (let s = 0; s < sims; s++) {
    const hands = dealDet(game, pi, unseen);
    const bids = game.players.map(() => game.handSize + 1);
    const won = playout(hands, [], leader, game.trumpSuit, bids, game.players.map(() => 0), n);
    const tricks = Math.min(won[pi], game.handSize);
    for (const bid of legal) {
      scoreByBid[bid] += scoreRound(bid, tricks);
      if (bid === tricks) hitsByBid[bid] += 1;
    }
  }
  let best = 0, bestScore = -Infinity, bestHits = -Infinity;
  for (const bid of legal) {
    const expectedScore = scoreByBid[bid] / sims;
    const hitRate = hitsByBid[bid] / sims;
    if (expectedScore > bestScore + 1e-9 ||
      (Math.abs(expectedScore - bestScore) <= 1e-9 && (hitRate > bestHits + 1e-9 ||
        (Math.abs(hitRate - bestHits) <= 1e-9 && bid > best)))) {
      best = bid; bestScore = expectedScore; bestHits = hitRate;
    }
  }
  return best;
}
const simCount = (h) => Math.max(30, Math.round(360 / Math.max(1, h)));
function cardNewMC(game, pi) {
  const options = legalCards(game.players[pi].hand, game.trick, game.trumpSuit);
  if (options.length === 1) return options[0];
  const n = game.players.length, unseen = getUnseen(game, pi);
  const bids = game.players.map((p) => p.bid), baseTricks = game.players.map((p) => p.tricks);
  const sims = simCount(game.players[pi].hand.length), target = bids[pi];
  let best = options[0], bestUtility = -Infinity, bestHit = -Infinity, bestErr = Infinity;
  for (const cand of options) {
    let hit = 0, err = 0, utilitySum = 0;
    for (let s = 0; s < sims; s++) {
      const hands = dealDet(game, pi, unseen);
      hands[pi] = hands[pi].filter((c) => c.id !== cand.id);
      const trick = [...game.trick, { playerIndex: pi, card: cand }];
      const won = playout(hands, trick, (pi + 1) % n, game.trumpSuit, bids, baseTricks, n);
      if (won[pi] === target) hit++; err += Math.abs(won[pi] - target);
      const scores = won.map((tricks, i) => scoreRound(bids[i], tricks));
      const bestOpponent = Math.max(...scores.filter((_, i) => i !== pi));
      const opponentHits = won.reduce((sum, tricks, i) => sum + (i !== pi && tricks === bids[i] ? 1 : 0), 0);
      utilitySum += scores[pi] - bestOpponent * 0.35 - opponentHits * 1.5;
    }
    const hr = hit / sims, me = err / sims, utility = utilitySum / sims;
    const better = utility > bestUtility + 1e-9 || (Math.abs(utility - bestUtility) <= 1e-9 &&
      (hr > bestHit + 1e-9 || (Math.abs(hr - bestHit) <= 1e-9 && (me < bestErr - 1e-9 ||
        (Math.abs(me - bestErr) <= 1e-9 && strength(cand, game.trumpSuit) < strength(best, game.trumpSuit))))));
    if (better) { bestUtility = utility; bestHit = hr; bestErr = me; best = cand; }
  }
  return best;
}

// ── OLD: previous heuristic extreme ───────────────────────────────────────────
function winProbIfLed(card, game, pi, unseen) {
  const n = unseen.length;
  const opp = game.players.reduce((s, p, i) => i !== pi ? s + p.hand.length : s, 0);
  if (n === 0 || opp === 0) return 1;
  const leadSuit = effectiveSuit(card, game.trumpSuit);
  const beaters = unseen.filter((c) => compareCards(c, card, leadSuit, game.trumpSuit) > 0).length;
  const k = Math.min(opp, n); let prob = 1;
  for (let i = 0; i < k; i++) { const num = n - beaters - i; if (num <= 0) return 0; prob *= num / (n - i); }
  return prob;
}
function bidOld(game, pi) {
  const unseen = getUnseen(game, pi);
  let e = 0; for (const c of game.players[pi].hand) e += winProbIfLed(c, game, pi, unseen);
  return Math.max(0, Math.min(game.handSize, Math.round(e)));
}
function leadOld(game, pi) {
  const p = game.players[pi], need = Math.max(0, p.bid - p.tricks), left = p.hand.length;
  const unseen = getUnseen(game, pi), voids = game.voids ?? {};
  const ranked = [...p.hand].map((c) => {
    let prob = winProbIfLed(c, game, pi, unseen); const ls = effectiveSuit(c, game.trumpSuit);
    for (let i = 0; i < game.players.length; i++) {
      if (i === pi || !isKnownVoid(voids, i, ls)) continue;
      const on = Math.max(0, game.players[i].bid - game.players[i].tricks);
      if (on > 0) prob *= 0.55; else prob = Math.min(1, prob * 1.2);
    }
    return { card: c, prob };
  }).sort((a, b) => b.prob - a.prob);
  if (need <= 0) return ranked[ranked.length - 1].card;
  if (need >= left) return ranked[0].card;
  if (need / left >= 0.5) return ranked[0].card;
  return ranked[ranked.length - 1].card;
}
function cardOld(game, pi) {
  const p = game.players[pi], options = legalCards(p.hand, game.trick, game.trumpSuit);
  if (!game.trick.length) return leadOld(game, pi);
  const need = Math.max(0, p.bid - p.tricks);
  const last = game.trick.length === game.players.length - 1;
  const playedIdx = new Set(game.trick.map((t) => t.playerIndex));
  const afterNeeds = game.players.some((pl, i) => i !== pi && !playedIdx.has(i) && pl.bid - pl.tricks > 0);
  const winners = options.filter((c) => wouldWin(c, game.trick, game.trumpSuit));
  const losers = options.filter((c) => !wouldWin(c, game.trick, game.trumpSuit));
  if (need > 0) {
    if (winners.length) { if (!last && afterNeeds) return high(winners, game.trumpSuit); return low(winners, game.trumpSuit); }
    return high(options, game.trumpSuit);
  }
  if (losers.length) return high(losers, game.trumpSuit);
  return low(options, game.trumpSuit);
}

// ── Game runner ───────────────────────────────────────────────────────────────
// agents[i] = { bid(game,i), card(game,i) }
function playRound(handSize, numPlayers, dealer, agents) {
  const deck = shuffle(makeDeck());
  const hands = Array.from({ length: numPlayers }, () => []);
  for (let c = 0; c < handSize; c++) for (let p = 0; p < numPlayers; p++) hands[p].push(deck.pop());
  const trumpCard = deck.pop();
  const trumpSuit = trumpCard?.joker ? null : trumpCard?.suit;
  const players = hands.map((h) => ({ hand: h, bid: null, tricks: 0 }));
  const game = { players, handSize, dealer, trumpCard, trumpSuit, trick: [], played: [], voids: {} };

  // Bidding (screw-the-dealer)
  const order = orderFromDealer(dealer, numPlayers);
  for (let bi = 0; bi < order.length; bi++) {
    const pi = order[bi];
    let bid = agents[pi].bid(game, pi);
    if (bi === order.length - 1) {
      const total = players.reduce((s, p) => s + (p.bid ?? 0), 0);
      const forbidden = handSize - total;
      if (bid === forbidden) bid = bid > 0 ? bid - 1 : bid + 1;
    }
    players[pi].bid = Math.max(0, Math.min(handSize, bid));
  }

  // Play tricks
  let leader = order[0];
  for (let tr = 0; tr < handSize; tr++) {
    game.trick = [];
    let turn = leader;
    for (let s = 0; s < numPlayers; s++) {
      const pi = turn;
      const chosen = agents[pi].card(game, pi);
      players[pi].hand = players[pi].hand.filter((c) => c.id !== chosen.id);
      game.trick.push({ playerIndex: pi, card: chosen });
      turn = (turn + 1) % numPlayers;
    }
    const w = winningPlay(game.trick, trumpSuit).playerIndex;
    players[w].tricks += 1;
    game.voids = updateVoids(game.voids, game.trick, trumpSuit);
    game.played = [...game.played, ...game.trick.map((p) => p.card.id)];
    leader = w;
  }
  return players.map((p) => ({ bid: p.bid, tricks: p.tricks, score: scoreRound(p.bid, p.tricks), hit: p.bid === p.tricks }));
}

const NEW = { bid: bidNewMC, card: cardNewMC };
const OLD = { bid: bidOld, card: cardOld };

function tournament(label, seatAgents, rounds, numPlayers) {
  const stat = Array.from({ length: numPlayers }, () => ({ score: 0, hits: 0, n: 0 }));
  const handSizes = [];
  // down 7..1 then up 2..7 repeated to fill `rounds`
  const seq = [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];
  for (let r = 0; r < rounds; r++) handSizes.push(seq[r % seq.length]);
  for (let r = 0; r < rounds; r++) {
    const res = playRound(handSizes[r], numPlayers, r % numPlayers, seatAgents);
    for (let i = 0; i < numPlayers; i++) { stat[i].score += res[i].score; stat[i].hits += res[i].hit ? 1 : 0; stat[i].n += 1; }
  }
  console.log(`\n=== ${label} (${rounds} rounds, ${numPlayers}p) ===`);
  for (let i = 0; i < numPlayers; i++) {
    const s = stat[i];
    console.log(`  seat${i} ${seatAgents[i].name.padEnd(4)}: avg score ${(s.score / s.n).toFixed(2)}  bid-hit ${(100 * s.hits / s.n).toFixed(1)}%`);
  }
}

NEW.name = "NEW"; OLD.name = "OLD";
const ROUNDS = Number(process.argv[2] ?? 400);

// 1 NEW vs 3 OLD
tournament("NEW vs OLD x3", [NEW, OLD, OLD, OLD], ROUNDS, 4);
// 2 NEW vs 2 OLD
tournament("2 NEW vs 2 OLD", [NEW, OLD, NEW, OLD], ROUNDS, 4);
