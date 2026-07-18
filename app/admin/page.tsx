'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import OTAAdmin from '@/components/OTAAdmin'
import {
  adminGetUsers, adminCreateUserAction, adminDeleteUserAction,
  adminGetFlats, adminCreateFlatAction, adminLinkUserToFlatAction,
  getGeofenceSettings, saveGeofenceSettings,
  getCurrentUser,
  type MappedUser, type Flat, type GeofenceSettings,
} from '../actions'

// Leaflet SSR'da çalışmaz → sadece client-side yükle
const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '340px', borderRadius: '14px',
      background: 'rgba(10,10,15,0.6)',
      border: '1px solid rgba(0,242,254,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-secondary)', fontSize: '0.9rem',
    }}>
      🗺️ Harita yükleniyor...
    </div>
  ),
})

// ─── Yardımcı: Haversine mesafe (metre) ──────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Alert ────────────────────────────────────────────────────────────────────
function Alert({ message }: { message: { text: string; type: string } }) {
  if (!message.text) return null
  return (
    <div className={`alert-box ${message.type}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {message.type === 'error'
          ? <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
          : <polyline points="20 6 9 17 4 12" />
        }
      </svg>
      <span>{message.text}</span>
    </div>
  )
}

// ─── Tab 1: Kullanıcı Ekle ────────────────────────────────────────────────────
function AddUserTab({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole]         = useState<'user' | 'admin'>('user')
  const [loading, setLoading]   = useState(false)
  const [message, setMessage]   = useState({ text: '', type: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage({ text: '', type: '' })
    if (!/^\d{6}$/.test(password)) {
      setMessage({ text: 'Şifre tam olarak 6 haneli rakam olmalıdır (örn: 125414)!', type: 'error' })
      return
    }
    if (/[A-Z]/.test(username)) {
      setMessage({ text: 'Kullanıcı adı sadece küçük harflerden oluşmalıdır!', type: 'error' })
      return
    }
    setLoading(true)
    const result = await adminCreateUserAction(username, password, fullName, role)
    if (result.success) {
      setMessage({ text: 'Kullanıcı başarıyla oluşturuldu.', type: 'success' })
      setUsername(''); setPassword(''); setFullName(''); setRole('user')
      onSuccess()
    } else {
      setMessage({ text: result.error || 'Kullanıcı oluşturulurken hata oluştu.', type: 'error' })
    }
    setLoading(false)
  }

  return (
    <div className="glass-card" style={{ padding: '28px' }}>
      <h2 style={{ marginBottom: '20px' }}>Yeni Kullanıcı Ekle</h2>
      <Alert message={message} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="form-grid-2">
          <div className="input-group">
            <label htmlFor="add-username">KULLANICI ADI</label>
            <input id="add-username" type="text" value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="input-field" placeholder="örn: mehmet" required disabled={loading} />
          </div>
          <div className="input-group">
            <label htmlFor="add-password">ŞİFRE (6 HANELİ SAYI)</label>
            <input id="add-password" type="text" inputMode="numeric"
              pattern="[0-9]{6}" maxLength={6} value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
              className="input-field" placeholder="örn: 125414" required disabled={loading} />
          </div>
        </div>
        <div className="input-group">
          <label htmlFor="add-fullname">AD SOYAD</label>
          <input id="add-fullname" type="text" value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-field" placeholder="örn: Mehmet Demir" required disabled={loading} />
        </div>
        <div className="input-group">
          <label htmlFor="add-role">KULLANICI YETKİSİ</label>
          <select id="add-role" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
            className="input-field" style={{ appearance: 'none', background: 'rgba(10, 10, 15, 0.8)' }} disabled={loading}>
            <option value="user">Normal Kullanıcı (Sadece kapı açabilir)</option>
            <option value="admin">Yönetici (Kullanıcı yönetebilir ve kapı açabilir)</option>
          </select>
        </div>
        <button type="submit" className="btn-primary" style={{ marginTop: '16px' }} disabled={loading}>
          {loading ? 'KAYDEDİLİYOR...' : 'KULLANICI EKLE'}
        </button>
      </form>
    </div>
  )
}

// ─── Tab 2: Daire Ekle ────────────────────────────────────────────────────────
function AddFlatTab({ onSuccess }: { onSuccess: () => void }) {
  const [block, setBlock]   = useState('')
  const [flatNo, setFlatNo] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [flats, setFlats]   = useState<Flat[]>([])
  const [flatsLoading, setFlatsLoading] = useState(true)

  const fetchFlats = useCallback(async () => {
    setFlatsLoading(true)
    const r = await adminGetFlats()
    if (r.success && r.data) setFlats(r.data)
    setFlatsLoading(false)
  }, [])

  useEffect(() => { fetchFlats() }, [fetchFlats])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage({ text: '', type: '' })
    setLoading(true)
    const result = await adminCreateFlatAction(block, flatNo)
    if (result.success) {
      setMessage({ text: `Daire oluşturuldu: ${block.toUpperCase()} Blok, No: ${flatNo}`, type: 'success' })
      setBlock(''); setFlatNo('')
      fetchFlats(); onSuccess()
    } else {
      setMessage({ text: result.error || 'Daire oluşturulurken hata oluştu.', type: 'error' })
    }
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="glass-card" style={{ padding: '28px' }}>
        <h2 style={{ marginBottom: '20px' }}>Yeni Daire Ekle</h2>
        <Alert message={message} />
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-grid-2">
            <div className="input-group">
              <label htmlFor="flat-block">BLOK</label>
              <input id="flat-block" type="text" value={block}
                onChange={(e) => setBlock(e.target.value)}
                className="input-field" placeholder="örn: A" required disabled={loading} />
            </div>
            <div className="input-group">
              <label htmlFor="flat-no">DAİRE NO</label>
              <input id="flat-no" type="text" value={flatNo}
                onChange={(e) => setFlatNo(e.target.value)}
                className="input-field" placeholder="örn: 4" required disabled={loading} />
            </div>
          </div>
          <button type="submit" className="btn-primary" style={{ marginTop: '8px' }} disabled={loading}>
            {loading ? 'KAYDEDİLİYOR...' : 'DAİRE EKLE'}
          </button>
        </form>
      </div>
      <div className="glass-card" style={{ padding: '28px' }}>
        <h2 style={{ marginBottom: '16px' }}>Kayıtlı Daireler</h2>
        <div className="logs-table-wrapper">
          <table className="logs-table">
            <thead><tr><th>Blok</th><th>Daire No</th><th>ID</th></tr></thead>
            <tbody>
              {flatsLoading ? (
                <tr><td colSpan={3} className="text-center" style={{ color: 'var(--text-secondary)', padding: '20px' }}>Yükleniyor...</td></tr>
              ) : flats.length === 0 ? (
                <tr><td colSpan={3} className="text-center" style={{ color: 'var(--text-secondary)', padding: '20px' }}>Henüz daire tanımlanmamış.</td></tr>
              ) : flats.map((f) => (
                <tr key={f.id}>
                  <td><span style={{ fontWeight: 600 }}>{f.block} Blok</span></td>
                  <td>Daire {f.flat_no}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{f.id.toString().slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Tab 3: Eşleştir ─────────────────────────────────────────────────────────
function LinkTab({ users, flats, onSuccess }: { users: MappedUser[]; flats: Flat[]; onSuccess: () => void }) {
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedFlat, setSelectedFlat] = useState('')
  const [loading, setLoading]           = useState(false)
  const [message, setMessage]           = useState({ text: '', type: '' })

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) { setMessage({ text: 'Lütfen bir kullanıcı seçin.', type: 'error' }); return }
    setMessage({ text: '', type: '' })
    setLoading(true)
    const result = await adminLinkUserToFlatAction(selectedUser, selectedFlat || null)
    if (result.success) {
      const user = users.find((u) => u.id === selectedUser)
      const flat = flats.find((f) => f.id === selectedFlat)
      const msg = flat
        ? `${user?.full_name || user?.username} → ${flat.block} Blok Daire ${flat.flat_no} eşleştirildi.`
        : `${user?.full_name || user?.username} daire bağlantısı kaldırıldı.`
      setMessage({ text: msg, type: 'success' })
      setSelectedUser(''); setSelectedFlat('')
      onSuccess()
    } else {
      setMessage({ text: result.error || 'Eşleştirme başarısız.', type: 'error' })
    }
    setLoading(false)
  }

  return (
    <div className="glass-card" style={{ padding: '28px' }}>
      <h2 style={{ marginBottom: '20px' }}>Kullanıcı ↔ Daire Eşleştir</h2>
      <Alert message={message} />
      <form onSubmit={handleLink} className="space-y-4">
        <div className="input-group">
          <label htmlFor="link-user">KULLANICI</label>
          <select id="link-user" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}
            className="input-field" style={{ appearance: 'none', background: 'rgba(10, 10, 15, 0.8)' }} required disabled={loading}>
            <option value="">-- Kullanıcı Seçin --</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ? `${u.full_name} (${u.username})` : u.username}
                {u.flat_id ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label htmlFor="link-flat">DAİRE (boş = bağlantıyı kaldır)</label>
          <select id="link-flat" value={selectedFlat} onChange={(e) => setSelectedFlat(e.target.value)}
            className="input-field" style={{ appearance: 'none', background: 'rgba(10, 10, 15, 0.8)' }} disabled={loading}>
            <option value="">-- Daire Seçmeyin (Bağlantıyı Kaldır) --</option>
            {flats.map((f) => (
              <option key={f.id} value={f.id}>{f.block} Blok — Daire {f.flat_no}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary" style={{ marginTop: '16px' }} disabled={loading || !selectedUser}>
          {loading ? 'EŞLEŞTİRİLİYOR...' : 'EŞLEŞTİR'}
        </button>
      </form>
      <div style={{ marginTop: '28px' }}>
        <h3 style={{ marginBottom: '12px', fontSize: '1rem', color: 'var(--text-secondary)' }}>Mevcut Eşleştirmeler</h3>
        <div className="logs-table-wrapper">
          <table className="logs-table">
            <thead><tr><th>Kullanıcı</th><th>Ad Soyad</th><th>Daire</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><span style={{ fontWeight: 600 }}>{u.username}</span></td>
                  <td>{u.full_name || '-'}</td>
                  <td>
                    {u.apartment_no
                      ? <span className="badge completed">{u.apartment_no}</span>
                      : <span className="badge pending">Daire Yok</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Tab 4: GPS Konum Kısıtı ──────────────────────────────────────────────────
function GeofenceTab() {
  const [settings, setSettings] = useState<GeofenceSettings>({
    enabled: false, lat: 0, lng: 0, radius_meters: 100,
  })
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [locating, setLocating]   = useState(false)
  const [message, setMessage]     = useState({ text: '', type: '' })
  const [liveDistance, setLiveDistance] = useState<number | null>(null)
  const watchRef = useRef<number | null>(null)

  // Ayarları yükle
  useEffect(() => {
    getGeofenceSettings().then((r) => {
      if (r.success && r.data) setSettings(r.data)
      setLoading(false)
    })
  }, [])

  // Canlı mesafe izleme (ayarlar aktifse)
  useEffect(() => {
    if (!settings.enabled || settings.lat === 0) {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
      setLiveDistance(null)
      return
    }
    if (!navigator.geolocation) return

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const d = haversineDistance(pos.coords.latitude, pos.coords.longitude, settings.lat, settings.lng)
        setLiveDistance(Math.round(d))
      },
      () => setLiveDistance(null),
      { enableHighAccuracy: true }
    )

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
    }
  }, [settings.enabled, settings.lat, settings.lng])

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setMessage({ text: 'Tarayıcınız konum desteklemiyor.', type: 'error' })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSettings((prev) => ({ ...prev, lat: pos.coords.latitude, lng: pos.coords.longitude }))
        setLocating(false)
        setMessage({ text: `Konum alındı: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`, type: 'success' })
      },
      () => {
        setLocating(false)
        setMessage({ text: 'Konum alınamadı. Tarayıcı izni kontrol edin.', type: 'error' })
      },
      { enableHighAccuracy: true }
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (settings.enabled && settings.lat === 0 && settings.lng === 0) {
      setMessage({ text: 'Konum aktifleştirmeden önce geçerli koordinat girin veya "Mevcut Konumumu Kullan" butonuna basın.', type: 'error' })
      return
    }
    setSaving(true)
    const result = await saveGeofenceSettings(settings)
    if (result.success) {
      setMessage({ text: 'Konum kısıtı ayarları kaydedildi.', type: 'success' })
    } else {
      setMessage({ text: result.error || 'Kayıt sırasında hata oluştu.', type: 'error' })
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="glass-card" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-secondary)' }}>
      Ayarlar yükleniyor...
    </div>
  )

  const isInside = liveDistance !== null && liveDistance <= settings.radius_meters

  return (
    <div className="space-y-4">
      <div className="glass-card" style={{ padding: '28px' }}>
        <h2 style={{ marginBottom: '6px' }}>📍 GPS Konum Kısıtı</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Aktif edilirse, kullanıcılar yalnızca belirlenen alan içindeyken kapıyı açabilir.
        </p>
        <Alert message={message} />

        <form onSubmit={handleSave} className="space-y-4">
          {/* Aktif / Pasif Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              type="button"
              id="geofence-toggle"
              onClick={() => setSettings((p) => ({ ...p, enabled: !p.enabled }))}
              style={{
                width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                background: settings.enabled ? 'var(--accent-green, #00f2a0)' : 'rgba(255,255,255,0.15)',
                position: 'relative', transition: 'background 0.3s',
              }}
            >
              <span style={{
                position: 'absolute', top: '4px',
                left: settings.enabled ? '26px' : '4px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: '#fff', transition: 'left 0.3s',
              }} />
            </button>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                Konum Kısıtı {settings.enabled ? '— AKTİF' : '— PASİF'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {settings.enabled ? 'Kullanıcılar belirlenen alan dışında kapıyı açamaz.' : 'Tüm konumlardan erişim açık.'}
              </div>
            </div>
          </div>

          {/* ─── Leaflet Harita ─── */}
          <div className="input-group">
            <label>HARİTA ÜZERİNDEN ALAN BELİRLE</label>
            <GeofenceMap
              lat={settings.lat || 41.015137}
              lng={settings.lng || 28.979530}
              radius={settings.radius_meters}
              onCenterChange={(lat, lng) => setSettings((p) => ({ ...p, lat, lng }))}
              onRadiusChange={(r) => setSettings((p) => ({ ...p, radius_meters: r }))}
            />
          </div>

          {/* Koordinat özeti (salt okunur) */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '10px',
            padding: '12px 16px',
            background: 'rgba(0,242,254,0.04)',
            border: '1px solid rgba(0,242,254,0.12)',
            borderRadius: '10px',
            fontSize: '0.82rem',
          }}>
            <div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>ENLEM</div>
              <div style={{ fontWeight: 600, color: '#00f2fe' }}>{settings.lat ? settings.lat.toFixed(6) : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>BOYLAM</div>
              <div style={{ fontWeight: 600, color: '#00f2fe' }}>{settings.lng ? settings.lng.toFixed(6) : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>YARICAP</div>
              <div style={{ fontWeight: 600, color: '#00f2fe' }}>{settings.radius_meters} m</div>
            </div>
          </div>

          {/* Mevcut Konumu Al */}
          <button
            type="button"
            id="get-location-btn"
            onClick={handleGetLocation}
            className="btn-secondary"
            disabled={locating}
            style={{ width: '100%' }}
          >
            {locating ? '📡 Konum Alınıyor...' : '📍 Mevcut Konumumu Merkez Olarak Kullan'}
          </button>

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'KAYDEDİLİYOR...' : 'AYARLARI KAYDET'}
          </button>
        </form>
      </div>

      {/* Canlı Konum Test Kartı */}
      {settings.enabled && settings.lat !== 0 && (
        <div className="glass-card" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '1rem' }}>🔴 Canlı Konum Testi</h3>
          {liveDistance === null ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Konum izni bekleniyor... (Tarayıcıdan izin verin)
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  background: isInside ? '#00f2a0' : '#ff3366',
                  boxShadow: isInside ? '0 0 12px #00f2a0' : '0 0 12px #ff3366',
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600, fontSize: '1.05rem', color: isInside ? '#00f2a0' : '#ff3366' }}>
                  {isInside ? '✅ Alan İçinde — Erişim Açık' : '❌ Alan Dışında — Erişim Kapalı'}
                </span>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Merkeze uzaklık: <strong style={{ color: '#fff' }}>{liveDistance} m</strong>
                {' / '}
                İzin verilen yarıçap: <strong style={{ color: '#fff' }}>{settings.radius_meters} m</strong>
              </div>
              {/* Progress bar */}
              <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min((liveDistance / settings.radius_meters) * 100, 100)}%`,
                  background: isInside ? '#00f2a0' : '#ff3366',
                  transition: 'width 0.5s, background 0.3s',
                  borderRadius: '3px',
                }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bilgi Kartı */}
      <div className="glass-card" style={{ padding: '20px', borderColor: 'rgba(0, 242, 254, 0.2)', background: 'rgba(0, 242, 254, 0.04)' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
          <strong style={{ color: 'var(--accent-blue)' }}>ℹ️ Nasıl Çalışır?</strong><br />
          Kullanıcı kapıyı açmak istediğinde, tarayıcısından GPS konumu istenir.
          İzin verilmezse veya konum belirlenen alanın dışındaysa buton engellenir.
          Konum izni reddetmek de erişimi engeller.
        </p>
      </div>
    </div>
  )
}

// ─── Tab 5: Tüm Kullanıcılar ──────────────────────────────────────────────────
function UsersListTab({ users, loading, onDelete }: {
  users: MappedUser[]; loading: boolean; onDelete: (id: string, username: string) => void
}) {
  return (
    <div className="glass-card" style={{ padding: '28px' }}>
      <h2 style={{ marginBottom: '20px' }}>Kayıtlı Hesaplar</h2>
      <div className="logs-table-wrapper">
        <table className="logs-table">
          <thead>
            <tr>
              <th>Kullanıcı Adı</th><th>Ad Soyad</th><th>Daire</th><th>Yetki</th>
              <th style={{ textAlign: 'center' }}>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center" style={{ color: 'var(--text-secondary)', padding: '20px' }}>Yükleniyor...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="text-center" style={{ color: 'var(--text-secondary)', padding: '20px' }}>Henüz kullanıcı bulunmuyor.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id}>
                <td><span style={{ fontWeight: 600 }}>{u.username}</span></td>
                <td>{u.full_name || '-'}</td>
                <td>{u.apartment_no || <span style={{ color: 'var(--text-secondary)' }}>-</span>}</td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'completed' : 'pending'}`}>
                    {u.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    onClick={() => onDelete(u.id, u.username)}
                    className="btn-secondary"
                    style={{
                      padding: '4px 8px', fontSize: '0.75rem',
                      borderColor: u.username === 'admin' ? 'transparent' : 'rgba(255, 51, 102, 0.3)',
                      color: u.username === 'admin' ? 'var(--text-secondary)' : '#ff809b',
                      cursor: u.username === 'admin' ? 'not-allowed' : 'pointer',
                    }}
                    disabled={u.username === 'admin'}
                  >
                    Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Ana Admin Paneli ─────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('users')
  const [users, setUsers]         = useState<MappedUser[]>([])
  const [flats, setFlats]         = useState<Flat[]>([])
  const [loading, setLoading]     = useState(true)
  const router = useRouter()

  useEffect(() => {
    const checkSession = async () => {
      let deviceId = localStorage.getItem('haci_device_id')
      if (!deviceId) {
        deviceId = crypto.randomUUID()
        localStorage.setItem('haci_device_id', deviceId)
      }
      const res = await getCurrentUser(deviceId)
      if (!res.success) {
        router.push('/login' + (res.error === 'another_device' ? '?reason=another_device' : ''))
        router.refresh()
      } else if (res.data?.profile?.role !== 'admin') {
        router.push('/')
        router.refresh()
      }
    }
    checkSession()
  }, [router])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [usersRes, flatsRes] = await Promise.all([adminGetUsers(), adminGetFlats()])
    if (usersRes.success && usersRes.data) setUsers(usersRes.data)
    if (flatsRes.success && flatsRes.data) setFlats(flatsRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleDeleteUser = async (userId: string, username: string) => {
    if (username === 'admin') { alert('Süper admin hesabı silinemez!'); return }
    if (!confirm('Bu kullanıcıyı tamamen silmek istediğinize emin misiniz?')) return
    const result = await adminDeleteUserAction(userId)
    if (result.success) fetchAll()
    else alert(result.error || 'Kullanıcı silinirken hata oluştu.')
  }

  const tabs = [
    { id: 'users',    emoji: '👤', label: 'Kullanıcı Ekle', sub: 'Yeni hesap oluştur' },
    { id: 'flats',    emoji: '🏠', label: 'Daire Ekle',     sub: 'Bina & daire tanımla' },
    { id: 'link',     emoji: '🔗', label: 'Eşleştir',       sub: 'Kullanıcı ↔ Daire' },
    { id: 'geofence', emoji: '📍', label: 'Konum Kısıtı',   sub: 'GPS alan belirle' },
    { id: 'ota',      emoji: '📡', label: 'OTA Güncelleme', sub: 'ESP32 firmware yükle' },
    { id: 'list',     emoji: '📋', label: 'Hesaplar',        sub: 'Tüm kullanıcılar' },
  ]

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      padding: '0',
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%',
    }}>

      {/* ── Top Header ── */}
      <div className="glass-card admin-header" style={{
        margin: '20px 20px 0 20px',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: '20px',
        flexShrink: 0,
      }}>
        <div>
          <h2 className="neon-text" style={{ fontSize: '1.3rem', marginBottom: '2px' }}>Hacıveyiszade</h2>
          <p style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: 'var(--accent-blue)', fontWeight: 700, margin: 0 }}>
            YÖNETİM PANELİ
          </p>
        </div>
        <Link href="/" className="btn-secondary" style={{ textDecoration: 'none', fontSize: '0.82rem' }}>
          ← Kontrol Paneli
        </Link>
      </div>

      {/* ── Body: Sidebar + Content ── */}
      <div className="admin-body" style={{
        display: 'flex',
        flex: 1,
        gap: '16px',
        padding: '16px 20px 24px 20px',
        alignItems: 'flex-start',
      }}>

        {/* ── Sol Sidebar ── */}
        <aside style={{
          width: '210px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'sticky',
          top: '20px',
        }}
          className="admin-sidebar"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="admin-tab-btn"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '16px',
                  border: isActive
                    ? '1px solid rgba(0,242,254,0.4)'
                    : '1px solid rgba(255,255,255,0.06)',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(0,242,254,0.12) 0%, rgba(79,172,254,0.08) 100%)'
                    : 'rgba(18,18,29,0.5)',
                  backdropFilter: 'blur(12px)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                  boxShadow: isActive
                    ? '0 4px 20px rgba(0,242,254,0.1), inset 0 1px 0 rgba(0,242,254,0.1)'
                    : 'none',
                  transform: isActive ? 'translateX(2px)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                {/* Emoji badge */}
                <div style={{
                  width: '36px', height: '36px',
                  borderRadius: '10px',
                  background: isActive
                    ? 'rgba(0,242,254,0.15)'
                    : 'rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.1rem',
                  flexShrink: 0,
                  transition: 'background 0.25s',
                }}>
                  {tab.emoji}
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    color: isActive ? '#00f2fe' : '#e2e8f0',
                    whiteSpace: 'nowrap',
                    marginBottom: '1px',
                  }}>
                    {tab.label}
                  </div>
                  <div className="admin-tab-sub" style={{
                    fontSize: '0.7rem',
                    color: isActive ? 'rgba(0,242,254,0.7)' : 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}>
                    {tab.sub}
                  </div>
                </div>
                {/* Aktif göstergesi */}
                {isActive && (
                  <div className="admin-tab-active-bar" style={{
                    marginLeft: 'auto',
                    width: '3px', height: '20px',
                    borderRadius: '2px',
                    background: 'linear-gradient(180deg, #00f2fe 0%, #4facfe 100%)',
                    flexShrink: 0,
                  }} />
                )}
              </button>
            )
          })}

          {/* Sidebar alt bilgi */}
          <div className="admin-sidebar-footer" style={{
            marginTop: '8px',
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.04)',
            fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.2)',
            lineHeight: 1.6,
          }}>
            {users.length} kullanıcı · {flats.length} daire
          </div>
        </aside>

        {/* ── İçerik Alanı ── */}
        <main style={{ flex: 1, minWidth: 0 }}>
          {activeTab === 'users'    && <AddUserTab onSuccess={fetchAll} />}
          {activeTab === 'flats'    && <AddFlatTab onSuccess={fetchAll} />}
          {activeTab === 'link'     && <LinkTab users={users} flats={flats} onSuccess={fetchAll} />}
          {activeTab === 'geofence' && <GeofenceTab />}
          {activeTab === 'ota'      && <OTAAdmin />}
          {activeTab === 'list'     && <UsersListTab users={users} loading={loading} onDelete={handleDeleteUser} />}
        </main>
      </div>
    </div>
  )
}
