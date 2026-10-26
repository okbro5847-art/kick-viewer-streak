// Browser-side bridge for the local Node.js Kick chat reader.
// The upstream Kick socket is opened by server.js, not by the browser.

class KickChat {
  constructor(channel) {
    if (typeof channel !== 'string' || !channel.trim()) {
      throw new Error('Geçerli bir Kick kanal adı gir.');
    }
    this._channel = channel.trim().toLowerCase();
    this._listeners = {};
    this._ws = null;
    this._destroyed = false;
  }

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (!list) return this;
    this._listeners[event] = fn ? list.filter((item) => item !== fn) : [];
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach((fn) => {
      try { fn(data); } catch (error) { console.error('KickChat listener error:', error); }
    });
  }

  connect() {
    this._destroyed = false;
    this.disconnect(false);
    this._destroyed = false;
    this._emit('status', { state: 'resolving' });

    let ws;
    try {
      ws = new WebSocket('ws://127.0.0.1:3001');
    } catch (error) {
      this._emit('error', { message: `Yerel köprü açılamadı: ${error.message}` });
      return this;
    }
    this._ws = ws;

    ws.onopen = () => {
      if (this._ws !== ws || this._destroyed) return;
      ws.send(JSON.stringify({ type: 'connect', channel: this._channel }));
    };

    ws.onmessage = (event) => {
      if (this._ws !== ws) return;
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (packet && typeof packet.event === 'string') {
        this._emit(packet.event, packet.data || {});
      }
    };

    ws.onerror = () => {
      if (this._ws === ws) {
        this._emit('error', {
          message: 'Yerel köprüye bağlanılamadı. Ayrı terminalde `node server.js` çalışıyor mu kontrol et.',
        });
      }
    };

    ws.onclose = () => {
      if (this._ws === ws) this._ws = null;
      if (!this._destroyed) this._emit('status', { state: 'bridge-disconnected' });
    };

    return this;
  }

  disconnect(notify = true) {
    this._destroyed = true;
    const ws = this._ws;
    this._ws = null;
    if (ws) {
      try {
        if (notify && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'disconnect' }));
        }
        ws.close();
      } catch { /* already closed */ }
    }
    if (notify) this._emit('disconnected', {});
  }
}

window.KickChat = KickChat;
