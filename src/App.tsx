
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, CalendarDays, ChevronLeft, ChevronRight, Download,
  Flame, LayoutDashboard, MessageCircle, Search, Settings2,
  ShieldCheck, Trophy, Users, X
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

type Tab = 'overview' | 'attendance' | 'streaks' | 'activity' | 'settings';

const monthNames = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

const colors = ['#8b5cf6', '#0d9488', '#f59e0b', '#ec4899', '#3b82f6'];

const fmt = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul'
  });
}

function formatDate(value?: string) {
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

  useEffect(() => {
    let alive = true;

    async function loadHistory() {
      try {
        const response = await fetch('/history', { cache: 'no-store' });
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
            error instanceof Error ? error.message : 'Bağlantı kurulamadı.'
          );
          setLoading(false);
        }
      }
    }

    void loadHistory();
    const timer = window.setInterval(() => void loadHistory(), 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const viewers = useMemo<Viewer[]>(() => {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;

    return records.map((record, index) => {
      const name = String(record.name ?? record.username ?? 'Bilinmeyen kullanıcı');
      const allDays = Array.isArray(record.days) ? record.days : [];

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
      .filter(viewer => viewer.name.toLowerCase().includes(search.toLowerCase()))
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

  const downloadCsv = () => {
    const rows = [
      ['Kullanıcı', 'Bu ay katılım günü', 'Mevcut streak', 'En uzun streak', 'Mesaj sayısı', 'Son görülme'],
      ...viewers.map(v => [
        v.name, String(v.days.length), String(v.streak),
        String(v.best), String(v.messages), v.last
      ])
    ];

    const csv = '\uFEFF' + rows
      .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yoklama-${year}-${String(month + 1).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify('CSV dosyası hazırlandı.');
  };

  const navItems: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'overview', label: 'Genel Bakış', icon: LayoutDashboard },
    { id: 'attendance', label: 'Aylık Yoklama', icon: CalendarDays },
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
    (sum, record) => sum + (Number(record.messages) || 0), 0
  );

  const currentMonthDays = viewers.reduce((sum, viewer) => sum + viewer.days.length, 0);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Flame size={20} /></div>
          <div>
            <div className="brand-name">streak<span>.</span></div>
            <div className="brand-sub">VIEWER TRACKER</div>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setMobileNav(false)}>
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
            title={connectionError ? 'Bağlantı hatası' : 'Geçmiş bağlantısı'}
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
            {connectionError ? 'Bağlantı hatası' : 'Geçmiş bağlantısı'}
          </div>
        </div>
      </aside>

      {mobileNav && (
        <button className="mobile-scrim" onClick={() => setMobileNav(false)} />
      )}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)}>
              <MenuIcon />
            </button>
            <div className="breadcrumb">
              SimitciAbdu <ChevronRight size={14} />
              <span>{navItems.find(item => item.id === tab)?.label}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="preview-pill">
              <span /> {connectionError ? 'BAĞLANTI HATASI' : 'GEÇMİŞ VERİSİ'}
            </span>
            <button className="connect-button" onClick={() => notify(
              connectionError
                ? 'Sunucuyu ve Vite bağlantısını kontrol et.'
                : 'Geçmiş sunucusu erişilebilir.'
            )}>
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
                <p>{connectionError} Vite ve Node sunucularının açık olduğundan emin ol.</p>
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
                <StatCard label="Kayıtlı kullanıcı" value={fmt(records.length)} detail="Sohbette görülen hesaplar" icon={Users} />
                <StatCard label="Bu ay katılım" value={fmt(currentMonthDays)} detail="Kullanıcı-gün toplamı" icon={CalendarDays} />
                <StatCard label="Aktif streak" value={fmt(records.filter(r => Number(r.streak) > 0).length)} detail="Serisi bulunan kullanıcılar" icon={Flame} />
                <StatCard label="Toplam mesaj" value={fmt(totalMessages)} detail="Sunucudaki kayıtlı mesajlar" icon={MessageCircle} />
              </div>

              <section className="panel leaderboard-panel">
                <div className="panel-header">
                  <div><h2><Trophy size={18} /> Streak liderleri</h2><p>En uzun mevcut katılım serisi</p></div>
                  <button className="text-button" onClick={() => setTab('streaks')}>Tüm sıralama <ChevronRight size={15} /></button>
                </div>
                {loading && <p>Geçmiş yükleniyor...</p>}
                {!loading && viewers.length === 0 && (
                  <p>Henüz kayıtlı kullanıcı yok. Kick sohbetinde mesaj geldikçe kayıtlar burada görünür.</p>
                )}
                {viewers.slice(0, 10).map((viewer, index) => (
                  <div className="leader-row" key={viewer.id}>
                    <span className="rank-number">{index + 1}</span>
                    <div className="avatar" style={{ '--avatar-color': viewer.color } as React.CSSProperties}>
                      {viewer.name[0]?.toUpperCase()}
                    </div>
                    <strong>{viewer.name}</strong>
                    <span className="leader-streak"><Flame size={14} /> {viewer.streak} gün</span>
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
                action={<button className="primary-button" onClick={downloadCsv}><Download size={16} /> CSV indir</button>}
              />
              <div className="table-toolbar">
                <div className="month-picker">
                  <button className="icon-button" onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button>
                  <strong>{monthNames[month]} {year}</strong>
                  <button className="icon-button" onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button>
                </div>
                <div className="toolbar-right">
                  <div className="search-box">
                    <Search size={16} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="İzleyici ara..." />
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
                        {Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1)
                          .map(day => <th key={day}>{day}</th>)}
                        <th>GÜN</th><th>STREAK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewers.map(viewer => (
                        <tr key={viewer.id}>
                          <td className="sticky-name">
                            <button className="user-cell" onClick={() => setSelected(viewer)}>
                              <span className="avatar tiny" style={{ '--avatar-color': viewer.color } as React.CSSProperties}>
                                {viewer.name[0]?.toUpperCase()}
                              </span>
                              <span><strong>{viewer.name}</strong><small>Son görülme {viewer.last}</small></span>
                            </button>
                          </td>
                          {Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1)
                            .map(day => {
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
                          <td><span className="streak-chip"><Flame size={12} />{viewer.streak}</span></td>
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

          {tab === 'streaks' && (
            <>
              <PageHeading eyebrow="TOPLULUK LİDER TABLOSU" title="Streak sıralaması." subtitle="Katılım serilerini ve mesaj sayılarını karşılaştır." />
              <div className="ranking-controls">
                <div className="search-box"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="İzleyici ara..." /></div>
                <div className="segmented">
                  <button className={sort === 'streak' ? 'selected' : ''} onClick={() => setSort('streak')}>Mevcut streak</button>
                  <button className={sort === 'days' ? 'selected' : ''} onClick={() => setSort('days')}>Katılım günleri</button>
                  <button className={sort === 'messages' ? 'selected' : ''} onClick={() => setSort('messages')}>Mesajlar</button>
                </div>
              </div>
              <div className="panel ranking-panel">
                <div className="ranking-head"><span>SIRA / İZLEYİCİ</span><span>STREAK</span><span>EN İYİ</span><span>MESAJ</span></div>
                {viewers.map((viewer, index) => (
                  <div className={`ranking-row ${index < 3 ? 'top-rank' : ''}`} key={viewer.id}>
                    <div className="ranking-user">
                      <span className={`ranking-position pos-${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                      <div className="avatar" style={{ '--avatar-color': viewer.color } as React.CSSProperties}>{viewer.name[0]?.toUpperCase()}</div>
                      <div><strong>{viewer.name}</strong><small>{viewer.days.length} gün katılım · Son görülme {viewer.last}</small></div>
                    </div>
                    <span className="ranking-current"><Flame size={15} />{sort === 'messages' ? fmt(viewer.messages) : sort === 'days' ? viewer.days.length : viewer.streak} {sort === 'messages' ? 'mesaj' : 'gün'}</span>
                    <span className="ranking-best">{viewer.best} gün</span>
                    <span className="ranking-messages">{fmt(viewer.messages)}</span>
                  </div>
                ))}
                {viewers.length === 0 && <p>Henüz sıralanacak kullanıcı yok.</p>}
              </div>
            </>
          )}

          {tab === 'activity' && (
            <>
              <PageHeading eyebrow="SOHBET GEÇMİŞİ" title="Aktivite akışı." subtitle="Kayıtlı kullanıcıları son görülme zamanına göre incele." />
              <div className="panel timeline-panel">
                <div className="panel-header"><div><h2>Son görülen kullanıcılar</h2><p>Sunucuda kayıtlı hesaplar</p></div></div>
                {[...viewers].sort((a, b) => b.last.localeCompare(a.last)).map((viewer, index) => (
                  <div className="timeline-row" key={viewer.id}>
                    <div className="timeline-rail"><div className="timeline-dot" />{index < viewers.length - 1 && <div className="timeline-line" />}</div>
                    <div className="avatar" style={{ '--avatar-color': viewer.color } as React.CSSProperties}>{viewer.name[0]?.toUpperCase()}</div>
                    <div className="timeline-copy"><strong>{viewer.name}</strong><p>{viewer.messages} kayıtlı mesaj · Streak: <b>{viewer.streak} gün</b></p></div>
                    <time>{viewer.last}</time>
                  </div>
                ))}
                {viewers.length === 0 && <p>Henüz aktivite kaydı yok.</p>}
              </div>
            </>
          )}

          {tab === 'settings' && (
            <>
              <PageHeading eyebrow="BAĞLANTI DURUMU" title="Kontrol paneli." subtitle="Yerel sunucu ve kayıt durumunu kontrol et." />
              <div className="panel settings-panel">
                <div className="settings-title">
                  <div className="settings-icon"><Activity size={18} /></div>
                  <div><h2>Kick geçmiş bağlantısı</h2><p>Site her beş saniyede bir /history adresini kontrol eder.</p></div>
                </div>
                <div className="connection-box">
                  <div className="connection-status">
                    <span className={connectionError ? 'offline-dot' : 'foot-dot'} />
                    <div><strong>{connectionError ? 'Bağlantı hatası' : 'Geçmiş endpoint durumu'}</strong><small>{connectionError || `Kayıtlı kullanıcı: ${records.length}`}</small></div>
                  </div>
                  <button className="primary-button" onClick={() => window.location.reload()}>Yenile</button>
                </div>
                <div className="setting-line"><div><strong>Son güncelleme</strong><p>{lastUpdate || 'Henüz başarılı istek yok'}</p></div></div>
                <div className="setting-line"><div><strong>Önemli bilgi</strong><p>Bu sistem yalnızca sohbette mesaj atan hesapları kaydedebilir. Sessiz izleyiciler bu yöntemle belirlenemez.</p></div></div>
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
          <div className="modal profile-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}><X size={18} /></button>
            <div className="profile-head">
              <div className="avatar profile-avatar" style={{ '--avatar-color': selected.color } as React.CSSProperties}>{selected.name[0]?.toUpperCase()}</div>
              <div><h2>{selected.name}</h2><p>Kayıtlı kullanıcı profili</p></div>
            </div>
            <div className="profile-stats">
              <div><strong>{selected.streak}</strong><span>Mevcut streak</span></div>
              <div><strong>{selected.best}</strong><span>En iyi streak</span></div>
              <div><strong>{selected.days.length}</strong><span>Bu ay katılım</span></div>
            </div>
            <div className="profile-detail"><span>İlk görüldüğü</span><strong>{selected.joined}</strong></div>
            <div className="profile-detail"><span>Toplam mesaj</span><strong>{fmt(selected.messages)}</strong></div>
          </div>
        </div>
      )}

      {toast && <div className="toast"><Activity size={16} />{toast}</div>}
    </div>
  );
}

function MenuIcon() {
  return <span style={{ fontSize: 20, lineHeight: 1 }}>☰</span>;
}

function PageHeading({ eyebrow, title, subtitle, action }: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function StatCard({ label, value, detail, icon: Icon }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
}) {
  return (
    <div className="stat-card accent-purple">
      <div className="stat-top"><span>{label}</span><div className="stat-icon"><Icon size={18} /></div></div>
      <div className="stat-value">{value}</div>
      <div className="stat-bottom"><span>{detail}</span></div>
    </div>
  );
}

export default App;
