// ExodusCode API server
// ---------------------------------------------------------------------
// Thin Express proxy between the landing page and Discord. The bot token
// lives only in this process (via .env) and is never sent to the browser.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';

const {
  BOT_TOKEN,
  GUILD_ID,
  CHANNEL_ID,
  PORT = 8080,
  CORS_ORIGIN = '*',
} = process.env;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env — see .env.example.');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('Missing GUILD_ID in .env — see .env.example.');
  process.exit(1);
}

const DISCORD_API = 'https://discord.com/api/v10';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

// --- tiny in-process cache -------------------------------------------
// Discord rate-limits aggressively. Cache each endpoint's result for a
// short window so a burst of visitors doesn't turn into a burst of calls
// against Discord. If a refresh fails, we keep serving the last good
// value instead of breaking the widget on the page.
function makeCache(ttlMs) {
  return { value: null, fetchedAt: 0, ttlMs };
}
function isFresh(cache) {
  return cache.value !== null && Date.now() - cache.fetchedAt < cache.ttlMs;
}

const statsCache = makeCache(30_000);
const feedCache = makeCache(30_000);

// --- GET /api/ping -----------------------------------------------------
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok' });
});

// --- GET /api/stats ------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  if (!isFresh(statsCache)) {
    try {
      const { data } = await axios.get(
        `${DISCORD_API}/guilds/${GUILD_ID}/widget.json`
      );

      // The widget only exposes online presence, not true membership —
      // Discord's public widget API has no "total members" field. `total`
      // is set equal to `online` here to match the requested shape; for a
      // real total, call GET /guilds/{id}?with_counts=true with the bot
      // token (same auth pattern as /api/feed below) and read
      // `approximate_member_count` from the response.
      const online = data.presence_count ?? 0;
      const voiceChannelsActive = (data.channels || []).filter(
        (ch) => Array.isArray(ch.members) && ch.members.length > 0
      ).length;

      statsCache.value = { online, total: online, voice: voiceChannelsActive };
      statsCache.fetchedAt = Date.now();
    } catch (err) {
      console.error('[/api/stats]', err.response?.status, err.message);
      if (statsCache.value === null) {
        const status = err.response?.status === 403 || err.response?.status === 404
          ? 'widget_disabled'
          : 'stats_unavailable';
        return res.status(502).json({
          error: status,
          detail:
            status === 'widget_disabled'
              ? 'Discord widget is not enabled for this guild. Enable it in Server Settings -> Widget.'
              : err.message,
        });
      }
      // fall through and serve the stale cached value below
    }
  }

  res.json(statsCache.value);
});

// --- GET /api/feed -------------------------------------------------------
app.get('/api/feed', async (req, res) => {
  if (!CHANNEL_ID) {
    return res.status(500).json({ error: 'channel_not_configured' });
  }

  if (!isFresh(feedCache)) {
    try {
      const { data } = await axios.get(
        `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=5`,
        { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
      );

      const posts = data
        .filter((msg) => !msg.author?.bot && msg.content?.trim().length > 0)
        .map((msg) => ({
          author: msg.author?.username ?? 'unknown',
          content: msg.content,
          timestamp: msg.timestamp,
        }));

      feedCache.value = posts;
      feedCache.fetchedAt = Date.now();
    } catch (err) {
      console.error('[/api/feed]', err.response?.status, err.message);
      if (feedCache.value === null) {
        const status = err.response?.status;
        const detail =
          status === 401
            ? 'Discord rejected the bot token. Check BOT_TOKEN in .env.'
            : status === 403
            ? "Bot lacks 'View Channel' / 'Read Message History' on this channel."
            : err.message;
        return res.status(502).json({ error: 'feed_unavailable', detail });
      }
    }
  }

  res.json({ posts: feedCache.value ?? [] });
});

app.listen(PORT, () => {
  console.log(`ExodusCode API listening on port ${PORT}`);
});
