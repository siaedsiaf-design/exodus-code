// Replace the existing `fetchDiscordWidget()` function in exoduscode.html's
// <script> block with this version. It calls your own backend instead of
// Discord directly, so the bot token stays server-side. Keep the existing
// DISCORD_INVITE_CODE constant and invite links as they are — this only
// replaces the stats/feed fetch logic.

const API_BASE = "http://localhost:8080"; // change to your deployed backend URL

async function fetchDiscordWidget() {
  const el = {
    online: document.getElementById('onlineCount'),
    total: document.getElementById('totalCount'),
    voice: document.getElementById('voiceCount'),
    updated: document.getElementById('lastUpdated'),
    feed: document.getElementById('feedList'),
  };

  // --- Stats -----------------------------------------------------------
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) throw new Error(`stats request failed: ${res.status}`);
    const data = await res.json();

    el.online.textContent = data.online ?? '—';
    el.total.textContent = data.total ?? '—';
    el.voice.textContent = data.voice ?? '—';
    el.updated.textContent = 'Last sync: ' + new Date().toLocaleTimeString();
  } catch (err) {
    el.updated.textContent = 'Last sync: backend unavailable';
    console.warn('Stats fetch failed:', err);
  }

  // --- Feed --------------------------------------------------------------
  try {
    const res = await fetch(`${API_BASE}/api/feed`);
    if (!res.ok) throw new Error(`feed request failed: ${res.status}`);
    const data = await res.json();
    const posts = data.posts || [];

    el.feed.innerHTML = posts.length
      ? posts
          .map(
            (p) => `
        <div class="feed-item">
          <span class="ch">${escapeHtml(p.author)}</span>
          <p>${escapeHtml(p.content)}</p>
        </div>
      `
          )
          .join('')
      : `<div class="feed-item"><span class="ch">#feed</span><p>No recent messages.</p></div>`;
  } catch (err) {
    console.warn('Feed fetch failed:', err);
  }
}

// Escapes HTML special characters so message content/usernames from Discord
// can't inject markup into the page (basic XSS prevention for innerHTML use).
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

fetchDiscordWidget();
setInterval(fetchDiscordWidget, 60000);
