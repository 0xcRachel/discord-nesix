// src/steam/web.js
// Steam Web API: lấy thư viện game sở hữu (tuỳ chọn).

const BASE = 'https://api.steampowered.com';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Steam API trả về dữ liệu không hợp lệ (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Steam API HTTP ${res.status}`);
  return data;
}

export async function resolveVanity(key, vanity) {
  const url = `${BASE}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(vanity)}`;
  const data = await getJson(url);
  const response = data?.response || {};
  if (response.success !== 1 || !response.steamid) {
    throw new Error(`Không tìm thấy SteamID cho "${vanity}"`);
  }
  return String(response.steamid);
}

export async function getOwnedGames(key, steamId) {
  const url =
    `${BASE}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}` +
    `&steamid=${encodeURIComponent(steamId)}` +
    '&include_appinfo=1&include_played_free_games=1&format=json';

  const data = await getJson(url);
  const response = data?.response || {};

  if (!Array.isArray(response.games)) {
    throw new Error('Không lấy được danh sách game. Hồ sơ Steam có thể đang để private.');
  }

  return response.games.map((game) => ({
    appid: String(game.appid),
    name: game.name || `App ${game.appid}`,
    playtimeMinutes: Number(game.playtime_forever || 0),
  }));
}
