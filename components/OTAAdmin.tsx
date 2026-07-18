'use client'

import { useEffect, useMemo, useState } from 'react'

interface OTARelease {
  id: string
  version: string
  file_size: number
  sha256: string
  notes: string
  active: boolean
  created_at: string
}

interface OTADevice {
  current_version: string | null
  target_version: string | null
  status: 'unknown' | 'idle' | 'downloading' | 'installing' | 'success' | 'failed'
  last_seen: string | null
  last_error: string | null
}

const statusLabels: Record<OTADevice['status'], string> = {
  unknown: 'Henüz bağlanmadı',
  idle: 'Güncelleme bekleniyor',
  downloading: 'Firmware indiriliyor',
  installing: 'Firmware kuruluyor',
  success: 'Güncelleme başarılı',
  failed: 'Güncelleme başarısız',
}

function nextPatchVersion(current?: string | null): string {
  const match = current?.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return '1.0.0'
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export default function OTAAdmin() {
  const adminKey = process.env.NEXT_PUBLIC_OTA_ADMIN_KEY || ''
  const [firmware, setFirmware] = useState<File | null>(null)
  const [device, setDevice] = useState<OTADevice | null>(null)
  const [releases, setReleases] = useState<OTARelease[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const endpoint = useMemo(() => {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xfqdjpwczublqdlfhgfm.supabase.co').replace(/\/$/, '')
    return `${base}/functions/v1/ota`
  }, [])

  const nextVersion = useMemo(() => {
    const latest = releases[0]?.version || device?.target_version || device?.current_version
    return nextPatchVersion(latest)
  }, [releases, device])

  const loadStatus = async () => {
    if (!endpoint || !adminKey) {
      setMessage({ text: 'NEXT_PUBLIC_OTA_ADMIN_KEY tanımlı değil.', type: 'error' })
      return
    }
    try {
      const response = await fetch(`${endpoint}/status`, {
        headers: { 'x-ota-admin-key': adminKey },
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'OTA bilgileri alınamadı.')
      setDevice(result.device)
      setReleases(result.releases ?? [])
    } catch (error) {
      setMessage({ text: (error as Error).message, type: 'error' })
    }
  }

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => void loadStatus(), 15_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, adminKey])

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)

    if (!adminKey) {
      setMessage({ text: 'NEXT_PUBLIC_OTA_ADMIN_KEY tanımlı değil.', type: 'error' })
      return
    }
    if (!firmware || !firmware.name.toLowerCase().endsWith('.bin')) {
      setMessage({ text: 'Derlenmiş ESP32 .bin dosyasını seçin.', type: 'error' })
      return
    }
    if (!confirm(`${nextVersion} sürümü cihaza gönderilsin mi?`)) return

    setLoading(true)
    try {
      const form = new FormData()
      form.set('firmware', firmware)
      form.set('version', nextVersion)
      form.set('notes', '')

      const response = await fetch(`${endpoint}/upload`, {
        method: 'POST',
        headers: { 'x-ota-admin-key': adminKey },
        body: form,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Firmware yüklenemedi.')

      setMessage({
        text: `${nextVersion} yüklendi. ESP32 çevrimiçiyse en geç bir dakika içinde kuruluma başlayacak.`,
        type: 'success',
      })
      setFirmware(null)
      const input = document.getElementById('ota-firmware') as HTMLInputElement | null
      if (input) input.value = ''
      await loadStatus()
    } catch (error) {
      setMessage({ text: (error as Error).message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const lastSeen = device?.last_seen
    ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(device.last_seen))
    : 'Henüz bağlantı yok'

  return (
    <div className="space-y-4">
      <div className="glass-card" style={{ padding: '28px' }}>
        <h2 style={{ marginBottom: '6px' }}>📡 ESP32 OTA Güncelleme</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
          Arduino IDE’den derlediğiniz <strong>.bin</strong> dosyasını seçip yükleyin.
          Sürüm otomatik atanır: <strong style={{ color: '#00f2fe' }}>{nextVersion}</strong>
        </p>

        {message && <div className={`alert-box ${message.type}`} style={{ marginBottom: '16px' }}>{message.text}</div>}

        <form onSubmit={handleUpload} className="space-y-4">
          <div className="input-group">
            <label htmlFor="ota-firmware">FIRMWARE DOSYASI</label>
            <input
              id="ota-firmware"
              type="file"
              accept=".bin,application/octet-stream"
              className="input-field"
              onChange={(event) => setFirmware(event.target.files?.[0] ?? null)}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading || !firmware}>
            {loading ? 'YÜKLENİYOR...' : `YÜKLE (${nextVersion})`}
          </button>
        </form>
      </div>

      <div className="glass-card" style={{ padding: '24px' }}>
        <h3 style={{ marginBottom: '14px' }}>Cihaz Durumu</h3>
        <div className="form-grid-2" style={{ fontSize: '0.86rem' }}>
          <div><span style={{ color: 'var(--text-secondary)' }}>Durum:</span> <strong>{device ? statusLabels[device.status] : 'Yükleniyor...'}</strong></div>
          <div><span style={{ color: 'var(--text-secondary)' }}>Son bağlantı:</span> <strong>{lastSeen}</strong></div>
          <div><span style={{ color: 'var(--text-secondary)' }}>Kurulu sürüm:</span> <strong>{device?.current_version ?? '—'}</strong></div>
          <div><span style={{ color: 'var(--text-secondary)' }}>Hedef sürüm:</span> <strong>{device?.target_version ?? '—'}</strong></div>
        </div>
        {device?.last_error && (
          <p style={{ marginTop: '14px', color: '#ff809b', fontSize: '0.82rem' }}>{device.last_error}</p>
        )}
      </div>

      {releases.length > 0 && (
        <div className="glass-card" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '14px' }}>Son Firmware Sürümleri</h3>
          <div className="logs-table-wrapper">
            <table className="logs-table">
              <thead><tr><th>Sürüm</th><th>Boyut</th><th>Durum</th><th>Tarih</th></tr></thead>
              <tbody>
                {releases.map((release) => (
                  <tr key={release.id}>
                    <td><strong>{release.version}</strong></td>
                    <td>{(release.file_size / 1024).toFixed(0)} KB</td>
                    <td><span className={`badge ${release.active ? 'completed' : 'pending'}`}>{release.active ? 'Aktif' : 'Arşiv'}</span></td>
                    <td>{new Date(release.created_at).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
