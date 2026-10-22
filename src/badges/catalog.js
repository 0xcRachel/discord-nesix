// src/badges/catalog.js
// Định nghĩa tier badge Discord (Game Variety + Game Time).

export const VARIETY_TIERS = [
  { tier: 1, name: 'Sampler', games: 2 },
  { tier: 2, name: 'Dabbler', games: 5 },
  { tier: 3, name: 'Enthusiast', games: 10 },
  { tier: 4, name: 'Ranger', games: 15 },
  { tier: 5, name: 'Explorer', games: 20 },
  { tier: 6, name: 'Adventurer', games: 30 },
  { tier: 7, name: 'Voyager', games: 40 },
  { tier: 8, name: 'Maverick', games: 60 },
  { tier: 9, name: 'Polymath', games: 80 },
  { tier: 10, name: 'Universalist', games: 100 },
];

export const TIME_TIERS = [
  { tier: 1, name: 'Casual', hours: 1 },
  { tier: 2, name: 'Recreational', hours: 5 },
  { tier: 3, name: 'Dedicated', hours: 20 },
  { tier: 4, name: 'Committed', hours: 75 },
  { tier: 5, name: 'Serious', hours: 150 },
  { tier: 6, name: 'Devoted', hours: 300 },
  { tier: 7, name: 'Seasoned', hours: 500 },
  { tier: 8, name: 'Ironclad', hours: 1000 },
  { tier: 9, name: 'Unshakeable', hours: 2000 },
  { tier: 10, name: 'Eternal', hours: 5000 },
];

export function evaluateTiers(tiers, field, value) {
  const numeric = Number(value) || 0;
  let current = null;
  let next = null;

  for (const tier of tiers) {
    if (numeric >= tier[field]) current = tier;
    else {
      next = tier;
      break;
    }
  }

  return { current, next, value: numeric };
}

export function evaluateVariety(games) {
  return evaluateTiers(VARIETY_TIERS, 'games', games);
}

export function evaluateTime(seconds) {
  return evaluateTiers(TIME_TIERS, 'hours', (Number(seconds) || 0) / 3600);
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = total / 3600;
  return `${hours.toFixed(1)}h`;
}
