import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, CalendarDays, ChevronLeft, ChevronRight, Download,
  Flame, LayoutDashboard, MessageCircle, Search, Settings2,
  ShieldCheck, Trophy, Users, X, LockKeyhole, Play, Square,
  RefreshCw, Clock3, LogOut, CheckCircle2, History as HistoryIcon
} from 'lucide-react';

type HistoryRecord = {
  name?: string;
  username?: string;
  days?: string[];
  messages?: number;
  firstSeen?: string;
  lastSeen?: string;
  streak?: number;
  best?: number;
};

type Viewer = {
  id: string;
  name: string;
  days: number[];
  streak: number;
  best: number;
  messages: number;
  last: string;
  joined: string;
  color: string;
};

type AttendanceSession = {
  id: string;
  started_at: string;
  stopped_at?: string | null;
  active: boolean;
  total: number;
};

type AttendanceStatus = {
  active: boolean;
  sessionId: string | null;
  startedAt: string | null;
  count: number;
};

type Tab =
  | 'overview'
  | 'attendance'
  | 'liveAttendance'
  | 'streaks'
  | 'activity'
  | 'settings';

const monthNames = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

const colors = ['#8b5cf6', '#0d9488', '#f59e0b', '#ec4899', '#3b82f6'];

const fmt = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

function formatTime(value?: string | null) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul'
  });
}

function formatDate(value?: string | null) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul'
  });
}

async function apiRequest<T>(
  path: string,
  token?: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set('Accept', 'application/json');

  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    cache: 'no-store'
  });

  const text = await response.text();
  let data: any = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      'Sunucudan JSON yerine farklı bir yanıt geldi. API yönlendirmesini kontrol et.'
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Sunucu HTTP ${response.status} yanıtı verdi.`
    );
  }

  return data as T;
}

function App() {
  const now = new Date();

  const [tab, setTab] = useState<Tab>('overview');
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'streak' | 'days' | 'messages'>('streak');
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [selected, setSelected] = useState<Viewer | null>(null);

  // Canlı Kick bağlantısının durumu
  const [kickConnected, setKickConnected] = useState(false);
  const [kickConnectionMessage, setKickConnectionMessage] = useState(
    'Kick bağlantısı bekleniyor...'
  );

  // Yoklama ekranı durumu
  const [attendanceToken, setAttendanceToken] = useState('');
  const [attendancePassword, setAttendancePassword] = useState('');
  const [attendanceLoginLoading, setAttendanceLoginLoading] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceMessage, setAttendanceMessage] = useState('');

  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>({
    active: false,
    sessionId: null,
    startedAt: null,
    count: 0
  });

  const [attendanceUsers, setAttendanceUsers] = useState<string[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<AttendanceSession[]>([]);
  const [attendanceLastUpdate, setAttendanceLastUpdate] = useState('');

  // Geçmiş kayıtlarını yükle ve her 5 saniyede bir yenile.
  useEffect(() => {
    let alive = true;

    async function loadHistory() {
      try {
        const response = await fetch('/history', {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`Sunucu HTTP ${response.status} yanıtı verdi.`);
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data)) {
          throw new Error('Geçmiş verisinin biçimi beklenenden farklı.');
        }

        if (alive) {
          setRecords(data as HistoryRecord[]);
          setConnectionError('');
          setLastUpdate(new Date().toLocaleTimeString('tr-TR'));
          setLoading(false);
        }
      } catch (error) {
        if (alive) {
          setConnectionError(
            error instanceof Error
              ? error.message
              : 'Bağlantı kurulamadı.'
          );

          setLoading(false);
        }
      }
    }

    void loadHistory();

    const timer = window.setInterval(() => {
      void loadHistory();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // CANLI KICK BAĞLANTISI
  // Sunucudaki WebSocket üzerinden simitciabdu kanalına bağlanır.
  // Tasarıma, geçmiş kayıtlarına ve veritabanına müdahale etmez.
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 5000;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== null) return;

      setKickConnected(false);
      setKickConnectionMessage('Yeniden bağlanılıyor...');

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelay);

      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    };

    const connect = () => {
      if (stopped) return;

      clearReconnectTimer();

      setKickConnected(false);
      setKickConnectionMessage('Kick sunucusuna bağlanılıyor...');

      try {
        // Render üzerindeki WebSocket sunucusu.
        const ws = new WebSocket(
          'wss://kick-viewer-streak.onrender.com'
        );

        socket = ws;

        ws.onopen = () => {
          if (stopped || socket !== ws) return;

          setKickConnectionMessage('Kanal bağlantısı kuruluyor...');

          ws.send(JSON.stringify({
            type: 'connect',
            channel: 'simitciabdu'
          }));
        };

        ws.onmessage = (event: MessageEvent) => {
          if (stopped || socket !== ws) return;

          try {
            const payload = JSON.parse(String(event.data));
            const eventName = payload?.event;
            const data = payload?.data ?? {};

            if (eventName === 'status') {
              const state = String(data.state || '');

              if (state === 'resolving') {
                setKickConnected(false);
                setKickConnectionMessage('Kick kanalı bulunuyor...');
              } else if (state === 'discovering-connection') {
                setKickConnected(false);
                setKickConnectionMessage('Sohbet bağlantısı hazırlanıyor...');
              } else if (state === 'socket-open') {
                setKickConnected(false);
                setKickConnectionMessage('Sohbet aboneliği bekleniyor...');
              } else if (state === 'reconnecting') {
                setKickConnected(false);
                setKickConnectionMessage('Kick bağlantısı yenileniyor...');
              }

              return;
            }

            if (eventName === 'connected') {
              reconnectDelay = 5000;
              setKickConnected(true);
              setKickConnectionMessage('Kick sohbet bağlantısı aktif.');
              return;
            }

            if (eventName === 'message') {
              // Mesajlar server.js içinde veritabanına kaydedilir.
              // Burada tekrar kayıt yapmıyoruz; çift sayım önlenir.
              setKickConnected(true);
              setKickConnectionMessage('Kick sohbet bağlantısı aktif.');
              return;
            }

            if (eventName === 'error') {
              const message =
                typeof data.message === 'string'
                  ? data.message
                  : 'Kick bağlantısında bir hata oluştu.';

              setKickConnected(false);
              setKickConnectionMessage(message);

              console.error('[Kick]', message);
            }

            if (eventName === 'disconnected') {
              setKickConnected(false);
              setKickConnectionMessage('Kick bağlantısı kapandı.');
            }
          } catch (error) {
            console.error('[Kick] Sunucu mesajı okunamadı:', error);
          }
        };

        ws.onerror = () => {
          if (stopped || socket !== ws) return;

          setKickConnected(false);
          setKickConnectionMessage(
            'WebSocket bağlantı hatası. Sunucu ve Render loglarını kontrol et.'
          );
        };

        ws.onclose = () => {
          if (socket === ws) {
            socket = null;
          }

          if (stopped) return;

          setKickConnected(false);
          scheduleReconnect();
        };
      } catch (error) {
        setKickConnected(false);
        setKickConnectionMessage(
          error instanceof Error
            ? error.message
            : 'Kick bağlantısı kurulamadı.'
        );

        scheduleReconnect();
      }
    };

    connect();

    return () => {
      stopped = true;
      clearReconnectTimer();

      const currentSocket = socket;
      socket = null;

      if (currentSocket) {
        currentSocket.onopen = null;
        currentSocket.onmessage = null;
        currentSocket.onerror = null;
        currentSocket.onclose = null;

        if (currentSocket.readyState === WebSocket.OPEN) {
          currentSocket.send(JSON.stringify({
            type: 'disconnect'
          }));
        }

        currentSocket.close();
      }
    };
  }, []);

  // Yoklama açıkken durumu ve katılımcıları düzenli yenile.
  useEffect(() => {
    if (tab !== 'liveAttendance' || !attendanceToken) return;

    let alive = true;
    let busy = false;

    async function refreshAttendance() {
      if (busy) return;

      busy = true;

      try {
        const [status, results, history] = await Promise.all([
          apiRequest<AttendanceStatus>(
            '/attendance/status',
            attendanceToken
          ),
          apiRequest<{
            total: number;
            users: string[];
            startedAt: string | null;
            sessionId?: string;
          }>(
            '/attendance/results',
            attendanceToken
          ),
          apiRequest<{ sessions: AttendanceSession[] }>(
            '/attendance/history',
            attendanceToken
          )
        ]);

        if (!alive) return;

        setAttendanceStatus(status);

        setAttendanceUsers(
          Array.isArray(results.users) ? results.users : []
        );

        setAttendanceSessions(
          Array.isArray(history.sessions) ? history.sessions : []
        );

        setAttendanceLastUpdate(new Date().toLocaleTimeString('tr-TR'));
        setAttendanceError('');
      } catch (error) {
        if (!alive) return;

        setAttendanceError(
          error instanceof Error
            ? error.message
            : 'Yoklama bilgileri alınamadı.'
        );
      } finally {
        busy = false;
      }
    }

    void refreshAttendance();

    const timer = window.setInterval(() => {
      void refreshAttendance();
    }, 3000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [tab, attendanceToken]);

  const viewers = useMemo<Viewer[]>(() => {
    const monthPrefix =
      `${year}-${String(month + 1).padStart(2, '0')}-`;

    return records.map((record, index) => {
      const name = String(
        record.name ??
        record.username ??
        'Bilinmeyen kullanıcı'
      );

      const allDays = Array.isArray(record.days)
        ? record.days
        : [];

      const days = allDays
        .filter((day): day is string => typeof day === 'string')
        .filter(day => day.startsWith(monthPrefix))
        .map(day => Number(day.slice(8, 10)))
        .filter(day => Number.isInteger(day) && day >= 1 && day <= 31);

      return {
        id: name.toLowerCase(),
        name,
        days: [...new Set(days)].sort((a, b) => a - b),
        streak: Number(record.streak) || 0,
        best: Number(record.best) || 0,
        messages: Number(record.messages) || 0,
        last: formatTime(record.lastSeen),
        joined: formatDate(record.firstSeen),
        color: colors[index % colors.length]
      };
    })
      .filter(viewer =>
        viewer.name.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) =>
        sort === 'streak' ? b.streak - a.streak :
        sort === 'days' ? b.days.length - a.days.length :
        b.messages - a.messages
      );
  }, [records, search, sort, month, year]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  const loginAttendance = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (!attendancePassword.trim()) {
      setAttendanceError('Lütfen yoklama şifresini gir.');
      return;
    }

    setAttendanceLoginLoading(true);
    setAttendanceError('');
    setAttendanceMessage('');

    try {
      const result = await apiRequest<{ token: string }>(
        '/attendance/login',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify({
            password: attendancePassword
          })
        }
      );

      setAttendanceToken(result.token);
      setAttendancePassword('');
      setAttendanceError('');
      setAttendanceMessage('Giriş başarılı. Yoklama paneli açıldı.');
    } catch (error) {
      setAttendanceError(
        error instanceof Error
          ? error.message
          : 'Giriş yapılamadı.'
      );
    } finally {
      setAttendanceLoginLoading(false);
    }
  };

  const startAttendance = async () => {
    setAttendanceBusy(true);
    setAttendanceError('');
    setAttendanceMessage('');

    try {
      const result = await apiRequest<{ message?: string }>(
        '/attendance/start',
        attendanceToken,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );

      setAttendanceMessage(result.message || 'Yoklama başlatıldı.');
      notify('Yoklama başladı.');
    } catch (error) {
      setAttendanceError(
        error instanceof Error
          ? error.message
          : 'Yoklama başlatılamadı.'
      );
    } finally {
      setAttendanceBusy(false);
    }
  };

  const stopAttendance = async () => {
    const confirmed = window.confirm(
      'Yoklamayı bitirmek istediğine emin misin? Sonuçlar kaydedilmiş olarak kalacak.'
    );

    if (!confirmed) return;

    setAttendanceBusy(true);
    setAttendanceError('');
    setAttendanceMessage('');

    try {
      const result = await apiRequest<{ message?: string }>(
        '/attendance/stop',
        attendanceToken,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );

      setAttendanceMessage(result.message || 'Yoklama bitirildi.');
      notify('Yoklama bitirildi.');
    } catch (error) {
      setAttendanceError(
        error instanceof Error
          ? error.message
          : 'Yoklama bitirilemedi.'
      );
    } finally {
      setAttendanceBusy(false);
    }
  };

  const logoutAttendance = () => {
    setAttendanceToken('');
    setAttendancePassword('');
    setAttendanceError('');
    setAttendanceMessage('');
    setAttendanceUsers([]);
    setAttendanceSessions([]);

    setAttendanceStatus({
      active: false,
      sessionId: null,
      startedAt: null,
      count: 0
    });

    notify('Yoklama panelinden çıkış yapıldı.');
  };

  const downloadCsv = () => {
    const rows = [
      [
        'Kullanıcı',
        'Bu ay katılım günü',
        'Mevcut streak',
        'En uzun streak',
        'Mesaj sayısı',
        'Son görülme'
      ],
      ...viewers.map(v => [
        v.name,
        String(v.days.length),
        String(v.streak),
        String(v.best),
        String(v.messages),
        v.last
      ])
    ];

    const csv = '\uFEFF' + rows
      .map(row =>
        row.map(value =>
          `"${value.replaceAll('"', '""')}"`
        ).join(';')
      )
      .join('\n');

    const blob = new Blob(
      [csv],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      `yoklama-${year}-${String(month + 1).padStart(2, '0')}.csv`;

    link.click();
    URL.revokeObjectURL(url);

    notify('CSV dosyası hazırlandı.');
  };

  const downloadAttendanceCsv = () => {
    const rows = [
      ['Yoklama katılımcıları'],
      ['Kullanıcı adı'],
      ...attendanceUsers.map(name => [name])
    ];

    const csv = '\uFEFF' + rows
      .map(row =>
        row.map(value =>
          `"${value.replaceAll('"', '""')}"`
        ).join(';')
      )
      .join('\n');

    const blob = new Blob(
      [csv],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      `yoklama-katilimcilari-${new Date().toISOString().slice(0, 10)}.csv`;

    link.click();
    URL.revokeObjectURL(url);

    notify('Katılımcı listesi indirildi.');
  };

  const navItems: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'overview', label: 'Genel Bakış', icon: LayoutDashboard },
    { id: 'attendance', label: 'Aylık Yoklama', icon: CalendarDays },
    { id: 'liveAttendance', label: 'Yoklama Vakti', icon: ShieldCheck },
    { id: 'streaks', label: 'Streak Sıralaması', icon: Trophy },
    { id: 'activity', label: 'Aktivite Akışı', icon: Activity },
    { id: 'settings', label: 'Ayarlar', icon: Settings2 }
  ];

  const shiftMonth = (delta: number) => {
    const date = new Date(year, month + delta, 1);

    setMonth(date.getMonth());
    setYear(date.getFullYear());
  };

  const totalMessages = records.reduce(
    (sum, record) => sum + (Number(record.messages) || 0),
    0
  );

  const currentMonthDays = viewers.reduce(
    (sum, viewer) => sum + viewer.days.length,
    0
  );

  return (
    <div className="app-shell">
      <style>{`
        .yv-page { animation: yvFadeIn .35s ease both; }
        .yv-hero {
          position: relative; overflow: hidden; padding: 28px;
          border: 1px solid rgba(139,92,246,.25); border-radius: 22px;
          background: radial-gradient(ellipse at 100% 0%, rgba(139,92,246,.19), transparent 48%),
                      linear-gradient(135deg, rgba(24,24,40,.98), rgba(16,20,34,.98));
          margin-bottom: 22px;
        }
        .yv-hero::after {
          content: ''; position: absolute; width: 190px; height: 190px;
          right: -55px; top: -70px; border-radius: 50%;
          border: 1px solid rgba(167,139,250,.22);
          box-shadow: 0 0 0 22px rgba(139,92,246,.035), 0 0 0 45px rgba(139,92,246,.025);
          pointer-events: none;
        }
        .yv-eyebrow { color: #a78bfa; font-size: 11px; letter-spacing: 2px; font-weight: 800; }
        .yv-title { font-size: clamp(27px, 4vw, 42px); margin: 10px 0; font-weight: 850; letter-spacing: -1.3px; }
        .yv-gradient { background: linear-gradient(90deg,#c4b5fd,#818cf8,#5eead4); color: transparent; background-clip: text; }
        .yv-subtitle { color: #a6a8ba; max-width: 620px; line-height: 1.7; font-size: 14px; }
        .yv-layout { display: grid; grid-template-columns: minmax(0,1.5fr) minmax(260px,1fr); gap: 18px; }
        .yv-card { border: 1px solid rgba(148,163,184,.15); border-radius: 18px; padding: 22px; background: rgba(20,24,39,.82); min-width: 0; }
        .yv-card-title { display:flex; align-items:center; gap:9px; font-size:16px; font-weight:750; margin-bottom:7px; }
        .yv-muted { color:#9ca3b8; font-size:13px; line-height:1.6; }
        .yv-field { display:block; width:100%; box-sizing:border-box; border:1px solid rgba(148,163,184,.25); border-radius:12px; padding:13px 14px; color:#f8fafc; background:#111827; outline:none; margin:12px 0 15px; }
        .yv-field:focus { border-color:#a78bfa; box-shadow:0 0 0 3px rgba(139,92,246,.15); }
        .yv-btn { display:inline-flex; justify-content:center; align-items:center; gap:9px; border:0; border-radius:12px; padding:12px 16px; font-weight:750; cursor:pointer; transition:transform .2s, opacity .2s, box-shadow .2s; }
        .yv-btn:hover { transform:translateY(-1px); }
        .yv-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
        .yv-primary { color:white; background:linear-gradient(100deg,#7c3aed,#6366f1); box-shadow:0 7px 22px rgba(99,102,241,.18); }
        .yv-stop { color:#fff; background:linear-gradient(100deg,#dc2626,#f43f5e); }
        .yv-neutral { color:#e5e7eb; background:rgba(148,163,184,.12); border:1px solid rgba(148,163,184,.2); }
        .yv-stat-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:18px 0; }
        .yv-stat { padding:17px; border:1px solid rgba(148,163,184,.15); border-radius:15px; background:rgba(15,23,42,.55); }
        .yv-stat-value { font-size:clamp(23px,3vw,34px); font-weight:850; margin:8px 0 4px; letter-spacing:-1px; }
        .yv-stat-label { font-size:12px; color:#a5b4c8; }
        .yv-live-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#34d399; margin-right:7px; animation:yvPulse 1.5s infinite; }
        .yv-offline-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#94a3b8; margin-right:7px; }
        .yv-error { padding:12px 14px; border-radius:12px; margin:12px 0; color:#fecaca; background:rgba(127,29,29,.25); border:1px solid rgba(248,113,113,.22); font-size:13px; }
        .yv-success { padding:12px 14px; border-radius:12px; margin:12px 0; color:#a7f3d0; background:rgba(6,95,70,.2); border:1px solid rgba(52,211,153,.2); font-size:13px; }
        .yv-user-list { max-height:440px; overflow:auto; margin-top:15px; }
        .yv-user-row { display:flex; align-items:center; gap:12px; padding:12px 3px; border-bottom:1px solid rgba(148,163,184,.1); animation:yvSlideIn .25s ease both; }
        .yv-user-avatar { display:grid; place-items:center; flex:0 0 34px; width:34px; height:34px; border-radius:11px; color:#e9d5ff; background:linear-gradient(135deg,rgba(139,92,246,.3),rgba(59,130,246,.25)); font-weight:800; }
        .yv-user-name { font-weight:700; overflow-wrap:anywhere; }
        .yv-number { margin-left:auto; font-size:12px; color:#86efac; white-space:nowrap; }
        .yv-empty { padding:28px 10px; text-align:center; color:#9ca3b8; }
        .yv-session-row { display:flex; gap:12px; align-items:center; padding:14px 0; border-bottom:1px solid rgba(148,163,184,.1); }
        .yv-session-row:last-child { border-bottom:0; }
        .yv-session-date { font-weight:700; font-size:13px; }
        .yv-session-meta { font-size:12px; color:#9ca3b8; margin-top:5px; }
        .yv-session-count { margin-left:auto; font-size:13px; font-weight:800; white-space:nowrap; }
        .yv-lock { width:54px; height:54px; display:grid; place-items:center; border-radius:17px; background:rgba(139,92,246,.16); color:#c4b5fd; margin-bottom:18px; }
        .yv-status-chip { display:inline-flex; align-items:center; gap:7px; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:800; letter-spacing:.5px; background:rgba(148,163,184,.1); color:#cbd5e1; }
        .yv-status-chip.active { background:rgba(16,185,129,.12); color:#6ee7b7; }
        .yv-actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:18px; }
        .yv-history-title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
        @keyframes yvFadeIn { from {opacity:0; transform:translateY(8px)} to {opacity:1; transform:translateY(0)} }
        @keyframes yvSlideIn { from {opacity:0; transform:translateX(-6px)} to {opacity:1; transform:translateX(0)} }
        @keyframes yvPulse { 0%,100% {box-shadow:0 0 0 0 rgba(52,211,153,.45)} 50% {box-shadow:0 0 0 6px rgba(52,211,153,0)} }
        @media(max-width:850px) { .yv-layout {grid-template-columns:1fr} }
        @media(max-width:560px) { .yv-hero,.yv-card {padding:17px} .yv-stat-grid {grid-template-columns:1fr} .yv-actions .yv-btn {width:100%} }
      `}</style>

      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Flame size={20} /></div>
          <div>
            <div className="brand-name">streak<span>.</span></div>
            <div className="brand-sub">VIEWER TRACKER</div>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="channel-card">
          <div className="channel-avatar">S</div>
          <div className="channel-info">
            <strong>SimitciAbdu</strong>
            <span>Kick kanalı</span>
          </div>
          <span
            className="status-dot"
            title={connectionError ? 'Bağlantı hatası' : kickConnectionMessage}
          />
        </div>

        <div className="nav-label">ÇALIŞMA ALANI</div>

        <nav className="nav-list">
          {navItems.map(item => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                className={`nav-item ${tab === item.id ? 'active' : ''}`}
                onClick={() => {
                  setTab(item.id);
                  setMobileNav(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>

                {item.id === 'attendance' && (
                  <span className="nav-count">{viewers.length}</span>
                )}

                {item.id === 'liveAttendance' && attendanceStatus.active && (
                  <span className="nav-count">CANLI</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={17} />
            <span>Veriler yerel sohbet sunucusundan okunuyor.</span>
          </div>

          <a
            className="kick-link"
            href="https://kick.com/simitciabdu"
            target="_blank"
            rel="noreferrer"
          >
            Kick kanalını aç
          </a>

          <div className="sidebar-foot">
            <span className="foot-dot" />
            {kickConnected
              ? 'Kick canlı bağlantısı aktif'
              : connectionError
                ? 'Bağlantı hatası'
                : 'Bağlantı kontrol ediliyor'}
          </div>
        </div>
      </aside>

      {mobileNav && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
        />
      )}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
            >
              <MenuIcon />
            </button>

            <div className="breadcrumb">
              SimitciAbdu <ChevronRight size={14} />
              <span>{navItems.find(item => item.id === tab)?.label}</span>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="preview-pill">
              <span />
              {kickConnected
                ? 'KICK CANLI'
                : connectionError
                  ? 'BAĞLANTI HATASI'
                  : 'BAĞLANTI KONTROLÜ'}
            </span>

            <button
              className="connect-button"
              onClick={() => notify(kickConnectionMessage)}
              title={kickConnectionMessage}
            >
              <Activity size={16} /> Bağlantı durumu
            </button>
          </div>
        </header>

        <div className="page-wrap">
          {connectionError && (
            <div className="notice">
              <div className="notice-icon"><Activity size={18} /></div>
              <div>
                <strong>Geçmiş verisi alınamadı</strong>
                <p>
                  {connectionError} Vite ve Node sunucularının açık olduğundan emin ol.
                </p>
              </div>
            </div>
          )}

          {tab === 'overview' && (
            <>
              <PageHeading
                eyebrow="KICK TOPLULUK TAKİBİ"
                title={<>İzleyici <span className="title-gradient">takibi.</span></>}
                subtitle="Sohbette mesaj yazan kullanıcıların katılım geçmişini takip et."
              />

              <div className="section-row">
                <h2>Topluluk özeti</h2>
                <span className="muted-small">{monthNames[month]} {year}</span>
              </div>

              <div className="stats-grid">
                <StatCard
                  label="Kayıtlı kullanıcı"
                  value={fmt(records.length)}
                  detail="Sohbette görülen hesaplar"
                  icon={Users}
                />
                <StatCard
                  label="Bu ay katılım"
                  value={fmt(currentMonthDays)}
                  detail="Kullanıcı-gün toplamı"
                  icon={CalendarDays}
                />
                <StatCard
                  label="Aktif streak"
                  value={fmt(records.filter(r => Number(r.streak) > 0).length)}
                  detail="Serisi bulunan kullanıcılar"
                  icon={Flame}
                />
                <StatCard
                  label="Toplam mesaj"
                  value={fmt(totalMessages)}
                  detail="Sunucudaki kayıtlı mesajlar"
                  icon={MessageCircle}
                />
              </div>

              <section className="panel leaderboard-panel">
                <div className="panel-header">
                  <div>
                    <h2><Trophy size={18} /> Streak liderleri</h2>
                    <p>En uzun mevcut katılım serisi</p>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => setTab('streaks')}
                  >
                    Tüm sıralama <ChevronRight size={15} />
                  </button>
                </div>

                {loading && <p>Geçmiş yükleniyor...</p>}

                {!loading && viewers.length === 0 && (
                  <p>
                    Henüz kayıtlı kullanıcı yok. Kick sohbetinde mesaj geldikçe kayıtlar burada görünür.
                  </p>
                )}

                {viewers.slice(0, 10).map((viewer, index) => (
                  <div className="leader-row" key={viewer.id}>
                    <span className="rank-number">{index + 1}</span>

                    <div
                      className="avatar"
                      style={{ '--avatar-color': viewer.color } as React.CSSProperties}
                    >
                      {viewer.name[0]?.toUpperCase()}
                    </div>

                    <strong>{viewer.name}</strong>

                    <span className="leader-streak">
                      <Flame size={14} /> {viewer.streak} gün
                    </span>
                  </div>
                ))}
              </section>

              <p className="disclaimer-line">
                <Activity size={15} /> Son başarılı güncelleme: {lastUpdate || 'Henüz yok'}
              </p>
            </>
          )}

          {tab === 'attendance' && (
            <>
              <PageHeading
                eyebrow="KATILIM RAPORU"
                title="Aylık yoklama."
                subtitle="Kullanıcıların kayıtlı katılım günlerini incele ve dışa aktar."
                action={
                  <button className="primary-button" onClick={downloadCsv}>
                    <Download size={16} /> CSV indir
                  </button>
                }
              />

              <div className="table-toolbar">
                <div className="month-picker">
                  <button
                    className="icon-button"
                    onClick={() => shiftMonth(-1)}
                  >
                    <ChevronLeft size={17} />
                  </button>

                  <strong>{monthNames[month]} {year}</strong>

                  <button
                    className="icon-button"
                    onClick={() => shiftMonth(1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>

                <div className="toolbar-right">
                  <div className="search-box">
                    <Search size={16} />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="İzleyici ara..."
                    />
                  </div>

                  <span className="table-total">{viewers.length} izleyici</span>
                </div>
              </div>

              <div className="panel table-panel">
                <div className="table-scroll">
                  <table className="attendance-table">
                    <thead>
                      <tr>
                        <th className="sticky-name">İZLEYİCİ</th>

                        {Array.from(
                          { length: new Date(year, month + 1, 0).getDate() },
                          (_, i) => i + 1
                        ).map(day => (
                          <th key={day}>{day}</th>
                        ))}

                        <th>GÜN</th>
                        <th>STREAK</th>
                      </tr>
                    </thead>

                    <tbody>
                      {viewers.map(viewer => (
                        <tr key={viewer.id}>
                          <td className="sticky-name">
                            <button
                              className="user-cell"
                              onClick={() => setSelected(viewer)}
                            >
                              <span
                                className="avatar tiny"
                                style={{ '--avatar-color': viewer.color } as React.CSSProperties}
                              >
                                {viewer.name[0]?.toUpperCase()}
                              </span>

                              <span>
                                <strong>{viewer.name}</strong>
                                <small>Son görülme {viewer.last}</small>
                              </span>
                            </button>
                          </td>

                          {Array.from(
                            { length: new Date(year, month + 1, 0).getDate() },
                            (_, i) => i + 1
                          ).map(day => {
                            const attended = viewer.days.includes(day);

                            return (
                              <td key={day}>
                                <span className={`attendance-mark ${attended ? 'attended' : ''}`}>
                                  {attended ? '✓' : ''}
                                </span>
                              </td>
                            );
                          })}

                          <td><strong>{viewer.days.length}</strong></td>

                          <td>
                            <span className="streak-chip">
                              <Flame size={12} />{viewer.streak}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {viewers.length === 0 && <p>Bu ay için kayıt bulunamadı.</p>}

                <div className="table-foot">
                  <span><span className="legend-square checked" /> Katıldı</span>
                  <span><span className="legend-square" /> Katılmadı</span>
                </div>
              </div>
            </>
          )}

          {tab === 'liveAttendance' && (
            <div className="yv-page">
              <div className="yv-hero">
                <div className="yv-eyebrow">
                  SİMİTÇİABDU · ÖZEL KONTROL PANELİ
                </div>

                <h1 className="yv-title">
                  YOKLAMA <span className="yv-gradient">VAKTİ.</span>
                </h1>

                <p className="yv-subtitle">
                  Yoklamayı başlat, Kick sohbetine mesaj yazan katılımcıları canlı takip et.
                  Her kullanıcı aynı oturumda yalnızca bir kez sayılır.
                </p>

                <div className="yv-muted" style={{ marginTop: 12 }}>
                  <span className={kickConnected ? 'yv-live-dot' : 'yv-offline-dot'} />
                  {kickConnectionMessage}
                </div>
              </div>

              {!attendanceToken ? (
                <div className="yv-layout">
                  <section className="yv-card">
                    <div className="yv-lock">
                      <LockKeyhole size={27} />
                    </div>

                    <div className="yv-card-title">Yetkili girişi</div>

                    <p className="yv-muted">
                      Yoklama kontrol paneline erişmek için Render ortam değişkeninde
                      tanımladığın şifreyi gir.
                    </p>

                    <form onSubmit={loginAttendance}>
                      <label
                        htmlFor="attendance-password"
                        className="yv-muted"
                      >
                        Yoklama şifresi
                      </label>

                      <input
                        id="attendance-password"
                        className="yv-field"
                        type="password"
                        autoComplete="current-password"
                        value={attendancePassword}
                        onChange={e => setAttendancePassword(e.target.value)}
                        placeholder="Şifreni gir..."
                        required
                      />

                      <button
                        className="yv-btn yv-primary"
                        type="submit"
                        disabled={attendanceLoginLoading}
                      >
                        <LockKeyhole size={16} />
                        {attendanceLoginLoading
                          ? 'Kontrol ediliyor...'
                          : 'Güvenli giriş'}
                      </button>
                    </form>

                    {attendanceError && (
                      <div className="yv-error">{attendanceError}</div>
                    )}
                  </section>

                  <section className="yv-card">
                    <div className="yv-card-title">
                      <ShieldCheck size={19} /> Nasıl çalışır?
                    </div>

                    <p className="yv-muted">1. Şifrenle giriş yap.</p>
                    <p className="yv-muted">
                      2. Yoklama başlatıldığında sistem yeni mesajları izlemeye başlar.
                    </p>
                    <p className="yv-muted">
                      3. Katılımcılar mesaj attıkça listeye eklenir.
                    </p>
                    <p className="yv-muted">
                      4. Bitirdiğinde yoklama sonucu veritabanında kalır.
                    </p>

                    <div className="yv-success" style={{ marginTop: 18 }}>
                      <CheckCircle2
                        size={15}
                        style={{ verticalAlign: 'middle', marginRight: 7 }}
                      />
                      Şifre, tarayıcıya veya veritabanına kaydedilmez.
                    </div>
                  </section>
                </div>
              ) : (
                <>
                  <div className="yv-history-title">
                    <div>
                      <div className="yv-card-title">Yoklama kontrolü</div>
                      <div className="yv-muted">
                        Son güncelleme: {attendanceLastUpdate || 'Bekleniyor...'}
                      </div>
                    </div>

                    <button
                      className="yv-btn yv-neutral"
                      onClick={logoutAttendance}
                    >
                      <LogOut size={15} /> Çıkış
                    </button>
                  </div>

                  {attendanceError && (
                    <div className="yv-error">{attendanceError}</div>
                  )}

                  {attendanceMessage && (
                    <div className="yv-success">{attendanceMessage}</div>
                  )}

                  <div className="yv-layout">
                    <section className="yv-card">
                      <div className="yv-history-title">
                        <div className="yv-card-title">
                          <Activity size={19} />
                          Canlı yoklama
                        </div>

                        <span className={`yv-status-chip ${attendanceStatus.active ? 'active' : ''}`}>
                          {attendanceStatus.active
                            ? <><span className="yv-live-dot" /> YOKLAMA AÇIK</>
                            : <><span className="yv-offline-dot" /> YOKLAMA KAPALI</>}
                        </span>
                      </div>

                      <div className="yv-stat-grid">
                        <div className="yv-stat">
                          <div className="yv-stat-label">Katılımcı sayısı</div>
                          <div className="yv-stat-value yv-gradient">
                            {fmt(attendanceUsers.length)}
                          </div>
                          <div className="yv-stat-label">Benzersiz kullanıcı</div>
                        </div>

                        <div className="yv-stat">
                          <div className="yv-stat-label">Başlangıç saati</div>
                          <div className="yv-stat-value" style={{ fontSize: 23 }}>
                            {formatTime(attendanceStatus.startedAt)}
                          </div>
                          <div className="yv-stat-label">
                            {formatDate(attendanceStatus.startedAt)}
                          </div>
                        </div>

                        <div className="yv-stat">
                          <div className="yv-stat-label">Durum</div>
                          <div className="yv-stat-value" style={{ fontSize: 21 }}>
                            {attendanceStatus.active ? 'CANLI' : 'HAZIR'}
                          </div>
                          <div className="yv-stat-label">Sunucu durumu</div>
                        </div>
                      </div>

                      <div className="yv-actions">
                        {!attendanceStatus.active ? (
                          <button
                            className="yv-btn yv-primary"
                            onClick={startAttendance}
                            disabled={attendanceBusy}
                          >
                            <Play size={16} />
                            {attendanceBusy
                              ? 'İşleniyor...'
                              : 'Yoklamayı başlat'}
                          </button>
                        ) : (
                          <button
                            className="yv-btn yv-stop"
                            onClick={stopAttendance}
                            disabled={attendanceBusy}
                          >
                            <Square size={15} />
                            {attendanceBusy
                              ? 'İşleniyor...'
                              : 'Yoklamayı bitir'}
                          </button>
                        )}

                        <button
                          className="yv-btn yv-neutral"
                          onClick={() => window.location.reload()}
                        >
                          <RefreshCw size={15} /> Sayfayı yenile
                        </button>

                        <button
                          className="yv-btn yv-neutral"
                          onClick={downloadAttendanceCsv}
                          disabled={attendanceUsers.length === 0}
                        >
                          <Download size={15} /> Listeyi indir
                        </button>
                      </div>

                      <div className="yv-user-list">
                        <div className="yv-card-title">
                          <Users size={18} /> Katılımcılar
                        </div>

                        {attendanceUsers.length === 0 ? (
                          <div className="yv-empty">
                            <Users
                              size={30}
                              style={{ opacity: .45, marginBottom: 10 }}
                            />
                            <div>Henüz katılımcı yok.</div>
                            <p className="yv-muted">
                              Yoklama açıkken Kick sohbetine mesaj yazan kullanıcılar burada görünür.
                            </p>
                          </div>
                        ) : (
                          attendanceUsers.map((name, index) => (
                            <div className="yv-user-row" key={`${name}-${index}`}>
                              <div className="yv-user-avatar">
                                {name.slice(0, 1).toUpperCase()}
                              </div>

                              <div className="yv-user-name">{name}</div>

                              <div className="yv-number">
                                <CheckCircle2
                                  size={14}
                                  style={{ verticalAlign: 'middle', marginRight: 4 }}
                                />
                                Katıldı
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    <section className="yv-card">
                      <div className="yv-card-title">
                        <HistoryIcon size={19} /> Yoklama geçmişi
                      </div>

                      <p className="yv-muted">
                        Önceki yoklamaların başlangıç zamanları ve katılımcı sayıları.
                        Kayıtlar veritabanından okunur.
                      </p>

                      <div style={{ marginTop: 16 }}>
                        {attendanceSessions.length === 0 ? (
                          <div className="yv-empty">
                            <Clock3
                              size={28}
                              style={{ opacity: .45, marginBottom: 10 }}
                            />
                            <div>Henüz geçmiş yoklama bulunmuyor.</div>
                          </div>
                        ) : (
                          attendanceSessions.map(session => (
                            <div className="yv-session-row" key={session.id}>
                              <div>
                                <div className="yv-session-date">
                                  {formatDate(session.started_at)}
                                </div>

                                <div className="yv-session-meta">
                                  Başlangıç: {formatTime(session.started_at)}
                                  {' · '}
                                  {session.active
                                    ? 'Devam ediyor'
                                    : `Bitiş: ${formatTime(session.stopped_at)}`}
                                </div>
                              </div>

                              <div className="yv-session-count">
                                {fmt(Number(session.total) || 0)} kişi
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="yv-success" style={{ marginTop: 20 }}>
                        <ShieldCheck
                          size={15}
                          style={{ verticalAlign: 'middle', marginRight: 7 }}
                        />
                        Katılımcılar oturum başına kullanıcı adına göre tekilleştirilir.
                      </div>

                      <p className="yv-muted" style={{ marginTop: 14 }}>
                        Not: Bu yöntem sessizce izleyenleri değil, yoklama açıkken sohbete
                        mesaj atan kullanıcıları sayar. Yoklamayı başlatmadan önce Kick
                        sohbet bağlantısının çalıştığından emin ol.
                      </p>
                    </section>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'streaks' && (
            <>
              <PageHeading
                eyebrow="TOPLULUK LİDER TABLOSU"
                title="Streak sıralaması."
                subtitle="Katılım serilerini ve mesaj sayılarını karşılaştır."
              />

              <div className="ranking-controls">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="İzleyici ara..."
                  />
                </div>

                <div className="segmented">
                  <button
                    className={sort === 'streak' ? 'selected' : ''}
                    onClick={() => setSort('streak')}
                  >
                    Mevcut streak
                  </button>

                  <button
                    className={sort === 'days' ? 'selected' : ''}
                    onClick={() => setSort('days')}
                  >
                    Katılım günleri
                  </button>

                  <button
                    className={sort === 'messages' ? 'selected' : ''}
                    onClick={() => setSort('messages')}
                  >
                    Mesajlar
                  </button>
                </div>
              </div>

              <div className="panel ranking-panel">
                <div className="ranking-head">
                  <span>SIRA / İZLEYİCİ</span>
                  <span>STREAK</span>
                  <span>EN İYİ</span>
                  <span>MESAJ</span>
                </div>

                {viewers.map((viewer, index) => (
                  <div
                    className={`ranking-row ${index < 3 ? 'top-rank' : ''}`}
                    key={viewer.id}
                  >
                    <div className="ranking-user">
                      <span className={`ranking-position pos-${index + 1}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <div
                        className="avatar"
                        style={{ '--avatar-color': viewer.color } as React.CSSProperties}
                      >
                        {viewer.name[0]?.toUpperCase()}
                      </div>

                      <div>
                        <strong>{viewer.name}</strong>
                        <small>
                          {viewer.days.length} gün katılım · Son görülme {viewer.last}
                        </small>
                      </div>
                    </div>

                    <span className="ranking-current">
                      <Flame size={15} />
                      {sort === 'messages'
                        ? fmt(viewer.messages)
                        : sort === 'days'
                          ? viewer.days.length
                          : viewer.streak}
                      {' '}
                      {sort === 'messages' ? 'mesaj' : 'gün'}
                    </span>

                    <span className="ranking-best">{viewer.best} gün</span>
                    <span className="ranking-messages">{fmt(viewer.messages)}</span>
                  </div>
                ))}

                {viewers.length === 0 && (
                  <p>Henüz sıralanacak kullanıcı yok.</p>
                )}
              </div>
            </>
          )}

          {tab === 'activity' && (
            <>
              <PageHeading
                eyebrow="SOHBET GEÇMİŞİ"
                title="Aktivite akışı."
                subtitle="Kayıtlı kullanıcıları son görülme zamanına göre incele."
              />

              <div className="panel timeline-panel">
                <div className="panel-header">
                  <div>
                    <h2>Son görülen kullanıcılar</h2>
                    <p>Sunucuda kayıtlı hesaplar</p>
                  </div>
                </div>

                {[...viewers]
                  .sort((a, b) => b.last.localeCompare(a.last))
                  .map((viewer, index) => (
                    <div className="timeline-row" key={viewer.id}>
                      <div className="timeline-rail">
                        <div className="timeline-dot" />
                        {index < viewers.length - 1 && (
                          <div className="timeline-line" />
                        )}
                      </div>

                      <div
                        className="avatar"
                        style={{ '--avatar-color': viewer.color } as React.CSSProperties}
                      >
                        {viewer.name[0]?.toUpperCase()}
                      </div>

                      <div className="timeline-copy">
                        <strong>{viewer.name}</strong>
                        <p>
                          {viewer.messages} kayıtlı mesaj · Streak:{' '}
                          <b>{viewer.streak} gün</b>
                        </p>
                      </div>

                      <time>{viewer.last}</time>
                    </div>
                  ))}

                {viewers.length === 0 && <p>Henüz aktivite kaydı yok.</p>}
              </div>
            </>
          )}

          {tab === 'settings' && (
            <>
              <PageHeading
                eyebrow="BAĞLANTI DURUMU"
                title="Kontrol paneli."
                subtitle="Yerel sunucu ve kayıt durumunu kontrol et."
              />

              <div className="panel settings-panel">
                <div className="settings-title">
                  <div className="settings-icon">
                    <Activity size={18} />
                  </div>

                  <div>
                    <h2>Kick geçmiş bağlantısı</h2>
                    <p>
                      Site her beş saniyede bir /history adresini kontrol eder.
                    </p>
                  </div>
                </div>

                <div className="connection-box">
                  <div className="connection-status">
                    <span className={kickConnected ? 'foot-dot' : 'offline-dot'} />

                    <div>
                      <strong>
                        {kickConnected
                          ? 'Kick canlı bağlantısı aktif'
                          : 'Kick bağlantısı kontrol ediliyor'}
                      </strong>

                      <small>{kickConnectionMessage}</small>
                    </div>
                  </div>

                  <button
                    className="primary-button"
                    onClick={() => window.location.reload()}
                  >
                    Yenile
                  </button>
                </div>

                <div className="setting-line">
                  <div>
                    <strong>Son güncelleme</strong>
                    <p>{lastUpdate || 'Henüz başarılı istek yok'}</p>
                  </div>
                </div>

                <div className="setting-line">
                  <div>
                    <strong>Kayıtlı kullanıcı</strong>
                    <p>{fmt(records.length)} kullanıcı</p>
                  </div>
                </div>

                <div className="setting-line">
                  <div>
                    <strong>Önemli bilgi</strong>
                    <p>
                      Bu sistem yalnızca sohbette mesaj atan hesapları kaydedebilir.
                      Sessiz izleyiciler bu yöntemle belirlenemez.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          <footer className="footer">
            <span>STREAK <b>·</b> SİMİTÇİABDU İZLEYİCİ TAKİBİ</span>
            <span>Yerel geçmiş verisi</span>
          </footer>
        </div>
      </main>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div
            className="modal profile-modal"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>

            <div className="profile-head">
              <div
                className="avatar profile-avatar"
                style={{ '--avatar-color': selected.color } as React.CSSProperties}
              >
                {selected.name[0]?.toUpperCase()}
              </div>

              <div>
                <h2>{selected.name}</h2>
                <p>Kayıtlı kullanıcı profili</p>
              </div>
            </div>

            <div className="profile-stats">
              <div>
                <strong>{selected.streak}</strong>
                <span>Mevcut streak</span>
              </div>

              <div>
                <strong>{selected.best}</strong>
                <span>En iyi streak</span>
              </div>

              <div>
                <strong>{selected.days.length}</strong>
                <span>Bu ay katılım</span>
              </div>
            </div>

            <div className="profile-detail">
              <span>İlk görüldüğü</span>
              <strong>{selected.joined}</strong>
            </div>

            <div className="profile-detail">
              <span>Toplam mesaj</span>
              <strong>{fmt(selected.messages)}</strong>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <Activity size={16} />{toast}
        </div>
      )}
    </div>
  );
}

function MenuIcon() {
  return <span style={{ fontSize: 20, lineHeight: 1 }}>☰</span>;
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
}) {
  return (
    <div className="stat-card accent-purple">
      <div className="stat-top">
        <span>{label}</span>
        <div className="stat-icon"><Icon size={18} /></div>
      </div>

      <div className="stat-value">{value}</div>

      <div className="stat-bottom">
        <span>{detail}</span>
      </div>
    </div>
  );
}

export default App;