
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(
  process.env.PORT || process.env.KICK_BRIDGE_PORT || 3001
);
const KICK_ORIGIN = 'https://kick.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const RECONNECT_MS = 3000;
const PING_MS = 25000;

const DATA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'viewer-history.json'
);

let viewerHistory = {};
let saveQueue = Promise.resolve();

function today() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Europe/Istanbul',
  });
}

async function loadViewerHistory() {
  try {
    viewerHistory = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Kayıt dosyası okunamadı:', error.message);
    }
    viewerHistory = {};
  }
}

function saveViewerHistory() {
  saveQueue = saveQueue
    .then(() =>
      writeFile(DATA_FILE, JSON.stringify(viewerHistory, null, 2), 'utf8')
    )
    .catch((error) => {
      console.error('Kayıt dosyası yazılamadı:', error.message);
    });

  return saveQueue;
}

function recordMessage(message) {
  const name = String(message.author || 'Anonymous').trim();
  if (!name || name === 'Anonymous') return;

  const key = name.toLowerCase();
  const date = today();
  const time = new Date().toISOString();

  if (!viewerHistory[key]) {
    viewerHistory[key] = {
      name,
      days: [],
      messages: 0,
      firstSeen: time,
      lastSeen: time,
    };
  }

  const viewer = viewerHistory[key];
  viewer.name = name;
  viewer.messages = (viewer.messages || 0) + 1;
  viewer.lastSeen = time;

  if (!viewer.days.includes(date)) {
    viewer.days.push(date);
    viewer.days.sort();
  }

  let streak = 0;
  const daySet = new Set(viewer.days);
  const cursor = new Date(`${date}T12:00:00+03:00`);

  while (
    daySet.has(
      cursor.toLocaleDateString('en-CA', {
        timeZone: 'Europe/Istanbul',
      })
    )
  ) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  viewer.streak = streak;
  viewer.best = Math.max(viewer.best || 0, streak);

  void saveViewerHistory();
}

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ ok: true, service: 'kick-chat-bridge' }));
    return;
  }

  if (req.url === '/history') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(Object.values(viewerHistory)));
    return;
  }

  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
  });
  res.end(
    `Kick chat bridge is running. WebSocket endpoint: ws://localhost:${PORT}`
  );
});

const wss = new WebSocketServer({ server: httpServer });

function send(client, event, data = {}) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ event, data }));
  }
}

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'error',
    cache: 'no-store',
    ...options,
    headers: {
      accept: 'application/json, text/plain, */*',
      origin: KICK_ORIGIN,
      referer: KICK_ORIGIN + '/',
      'user-agent': USER_AGENT,
      ...(options.headers || {}),
    },
  });

  const bodyText = await response.text();
  let body;

  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Kick JSON olmayan veri döndürdü (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Kick API HTTP ${response.status}: ${
        body?.message || body?.error || 'İstek reddedildi'
      }`
    );
  }

  return body;
}

async function resolveChatroomId(slug) {
  for (const version of ['v2', 'v1']) {
    try {
      const data = await getJson(
        `https://kick.com/api/${version}/channels/${encodeURIComponent(slug)}`
      );
      const id = data?.chatroom?.id;
      if (id) return String(id);
    } catch (error) {
      console.warn(
        `[Kick bridge] ${version} kanal araması başarısız: ${error.message}`
      );
    }
  }

  if (slug.toLowerCase() === 'simitciabdu') return '1335964';

  throw new Error('Sohbet odası kimliği alınamadı.');
}

async function discoverPusherUrl(clientId) {
  const response = await getJson(
    'https://web.kick.com/api/v1/realtime/connection',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { id: clientId, type: 'web' },
        capabilities: {
          accepted_providers: [{ provider: 'pusher' }],
        },
      }),
    }
  );

  const descriptor = response?.data || response;
  const connection = Array.isArray(descriptor?.connections)
    ? descriptor.connections.find((item) => item?.provider === 'pusher')
    : null;
  const credentials = connection?.credentials;

  if (
    descriptor?.mode !== 'websocket' ||
    typeof credentials?.app_key !== 'string' ||
    !/^[a-zA-Z0-9]+$/.test(credentials.app_key) ||
    typeof credentials?.cluster !== 'string' ||
    !/^[a-z0-9-]+$/.test(credentials.cluster)
  ) {
    throw new Error('Kick geçerli Pusher bağlantı bilgisi döndürmedi.');
  }

  return `wss://ws-${credentials.cluster}.pusher.com/app/${credentials.app_key}?protocol=7&client=js&version=7.4.0&flash=false`;
}

wss.on('connection', (client) => {
  let channelSlug = null;
  let chatroomId = null;
  let upstream = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let generation = 0;
  let stopped = true;

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingTimer = null;
    reconnectTimer = null;
  };

  const closeUpstream = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;

    const old = upstream;
    upstream = null;

    if (old) {
      old.removeAllListeners('close');
      try {
        old.close();
      } catch {}
    }
  };

  const stop = () => {
    stopped = true;
    generation++;
    clearTimers();
    closeUpstream();
  };

  const connectUpstream = async () => {
    const myGeneration = generation;

    if (
      stopped ||
      !channelSlug ||
      !chatroomId ||
      client.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    send(client, 'status', { state: 'discovering-connection' });

    try {
      const socketUrl = await discoverPusherUrl(randomUUID());

      if (
        stopped ||
        myGeneration !== generation ||
        client.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      console.log(`[Kick bridge] Kanal: ${channelSlug} / oda: ${chatroomId}`);

      const socket = new WebSocket(socketUrl, {
        origin: KICK_ORIGIN,
        headers: { 'user-agent': USER_AGENT },
      });

      upstream = socket;

      socket.on('open', () => {
        if (upstream !== socket || stopped) return;

        console.log('[Kick bridge] Kick bağlantısı açıldı.');
        send(client, 'status', { state: 'socket-open' });

        if (pingTimer) clearInterval(pingTimer);

        pingTimer = setInterval(() => {
          if (upstream === socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
          }
        }, PING_MS);
      });

      socket.on('message', (raw) => {
        if (upstream !== socket || stopped) return;

        let msg;

        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (!msg?.event) return;

        if (msg.event === 'pusher:error') {
          const detail =
            typeof msg.data === 'string'
              ? (() => {
                  try {
                    return JSON.parse(msg.data);
                  } catch {
                    return msg.data;
                  }
                })()
              : msg.data;

          send(client, 'error', {
            message:
              typeof detail === 'string'
                ? detail
                : JSON.stringify(
                    detail || { message: 'Pusher bağlantı hatası' }
                  ),
          });
          return;
        }

        if (msg.event === 'pusher:connection_established') {
          socket.send(
            JSON.stringify({
              event: 'pusher:subscribe',
              data: { auth: '', channel: `chatrooms.${chatroomId}.v2` },
            })
          );
          return;
        }

        if (
          msg.event === 'pusher_internal:subscription_succeeded' &&
          msg.channel === `chatrooms.${chatroomId}.v2`
        ) {
          console.log('[Kick bridge] Sohbet aboneliği başarılı.');
          send(client, 'connected', { chatroomId });
          return;
        }

        if (msg.event === 'pusher:ping') {
          socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
          return;
        }

        if (msg.event === 'pusher:pong') return;

        if (
          msg.event === 'App\\Events\\ChatMessageEvent' ||
          msg.event === 'App\\Events\\ChatMessageSentEvent'
        ) {
          let chatData = msg.data;

          if (typeof chatData === 'string') {
            try {
              chatData = JSON.parse(chatData);
            } catch {
              return;
            }
          }

          const message = {
            author:
              chatData?.sender?.username ||
              chatData?.sender?.slug ||
              'Anonymous',
            text: chatData?.content || '',
            color: chatData?.sender?.identity?.color || null,
            raw: chatData,
          };

          recordMessage(message);
          send(client, 'message', message);
        }
      });

      socket.on('error', (error) => {
        if (upstream === socket && !stopped) {
          console.error('[Kick bridge] WebSocket hatası:', error.message);
          send(client, 'error', {
            message: `Kick WebSocket bağlantı hatası: ${error.message}`,
          });
        }
      });

      socket.on('close', (code, reason) => {
        if (upstream !== socket || stopped) return;

        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        upstream = null;

        console.warn(
          `[Kick bridge] Bağlantı kapandı (${code}): ${
            reason.toString() || 'sebep yok'
          }`
        );

        send(client, 'status', { state: 'reconnecting' });

        if (!reconnectTimer && client.readyState === WebSocket.OPEN) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectUpstream();
          }, RECONNECT_MS);
        }
      });
    } catch (error) {
      console.error('[Kick bridge] Bağlantı kurulamadı:', error.message);
      send(client, 'error', { message: error.message });

      if (
        !stopped &&
        myGeneration === generation &&
        client.readyState === WebSocket.OPEN &&
        !reconnectTimer
      ) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectUpstream();
        }, 10000);
      }
    }
  };

  client.on('message', async (raw) => {
    let request;

    try {
      request = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (request.type === 'disconnect') {
      stop();
      send(client, 'disconnected', {});
      return;
    }

    if (request.type !== 'connect') return;

    const slug = String(request.channel || '').trim().toLowerCase();

    if (!/^[a-z0-9_]+$/.test(slug)) {
      send(client, 'error', { message: 'Geçersiz Kick kanal adı.' });
      return;
    }

    stop();
    stopped = false;
    channelSlug = slug;
    chatroomId = null;

    const myGeneration = generation;
    send(client, 'status', { state: 'resolving' });

    try {
      chatroomId = await resolveChatroomId(slug);

      if (
        stopped ||
        myGeneration !== generation ||
        client.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      console.log(`[Kick bridge] ${slug} => sohbet odası ${chatroomId}`);
      await connectUpstream();
    } catch (error) {
      console.error('[Kick bridge] Kanal bulunamadı:', error.message);
      send(client, 'error', { message: error.message });
    }
  });

  client.on('close', stop);
  client.on('error', stop);
});

loadViewerHistory()
  .then(() => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Kick bridge ready on port ${PORT}`);
      console.log('Health check: /health');
      console.log(`Kayıtlı kullanıcı: ${Object.keys(viewerHistory).length}`);
    });
  })
  .catch((error) => {
    console.error('Sunucu başlatılamadı:', error);
    process.exitCode = 1;
  });
