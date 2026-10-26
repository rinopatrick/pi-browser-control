# pi-browser-control — Design Spec

Tanggal: 2026-10-24
Status: disetujui user, siap ke writing-plans
Pendekatan: A — bungkus + perbagus `pi-browser-harness` sebagai engine CDP, dengan credit eksplisit.

## 1. Tujuan

Paket pi agent berisi browser control ala Codex desktop app: agent mengendalikan
browser Chrome yang terlihat, user bisa menonton live dan tab lain tidak terganggu.
Bukan computer use (tanpa kendali OS / cursor global).

Keputusan terkunci:
- Scope: browser control ala Codex desktop (bukan computer use).
- Live view: user menonton, read-only mirror.
- Chrome: attach ke Chrome user yang sedang berjalan (remote debugging), profil
  dan login istniej dipakai ulang.
- Arsitektur: pendekatan A (harness sebagai engine, lapisan UX milik paket ini).
- Credit eksplisit ke paket upstream yang dipakai.
- Tanpa pause/resume: sentuhan user di tab agent = page change biasa.

## 2. Arsitektur (S1, disetujui)

- Extension `pi-browser-control` attach ke Chrome berjalan via CDP.
- Dependensi engine: `pi-browser-harness` (40 tools CDP, ref-first snapshot,
  owned-tab isolation, framework-safe fill).
- Lapisan milik paket ini: live view, policy per-site, command UX, credit docs.
- Engine CDP tidak ditulis ulang; fokus energi ke diferensiasi.

## 3. Live view (S2, disetujui)

- Command `/browser-view`: buka read-only mirror tab agent agar user menonton live.
- Mirror tidak menerima input; interaksi user dilakukan di Chrome asli.
- Render TUI ringkas default, detail penuh on-demand.

## 4. Model tab + tanpa pause (S3 final, disetujui)

- Agent bekerja di owned tab khusus miliknya (isolasi per-tab via harness).
- Aktivitas user di tab lain diabaikan; tidak memicu apa pun.
- Sentuhan user di tab agent bukan takeover istimewa: diperlakukan sebagai
  page change biasa.
- Respons: re-snapshot, deteksi URL/konten berubah, revisit URL bila konteks
  hilang, lanjutkan task.
- Tidak ada state pause, tidak ada command `/resume` atau `/lanjut`.

## 5. Scope dan non-goals (S4, disetujui)

In:
- Navigasi, snapshot ref-first, klik, isi form, wait/tunggu.
- Screenshot untuk verifikasi visual.
- Live view read-only.
- Anotasi komentar user pada live page.
- Policy per-site (deny + allow exception, opsional allowlist).
- Credit eksplisit ke harness dan paket upstream lain.

Out:
- Pause/resume otomatis maupun manual.
- Kendali OS / cursor global (computer use).
- Mode headless-only.
- Multi-tab paralel oleh satu agent run.
- Auth/login otomatis ke situs.

## 6. Komponen dan aliran (S5, disetujui)

Komponen:
- Extension `browser-control` (attach, owned tab, orkestrasi).
- Command `/browser-view` (live view) dan `/annotate` (anotasi user).
- Policy per-site (pola deny + allow exception).
- Credit harness di README dan package.json.

Aliran standar:
1. Attach ke Chrome berjalan (panduan `/browser-setup` bila belum).
2. Buka atau pakai ulang owned tab.
3. Snapshot ref-first, aksi via ref.
4. Baca page-change diff sebagai konfirmasi.
5. Verifikasi visual via screenshot bila perlu.
6. Sentuhan user terdeteksi sebagai page change → re-snapshot + revisit bila perlu.

## 7. Error handling dan testing (S6, disetujui)

- CDP disconnect: auto-reconnect; re-attach atau buka owned tab baru.
- Ref stale: re-snapshot sekali; masih gagal → lapor ke user.
- Navigasi timeout: retry 1x, lalu error + screenshot bukti.
- User pindah page di owned tab: deteksi URL berubah, revisit bila task butuh.
- Chrome tanpa remote debugging: arahkan ke `/browser-setup`, tanpa silent fail.
- Testing: selfcheck pure untuk policy dan pola match (tanpa browser) +
  checklist integrasi manual (attach, snapshot, klik, fill, live view).
- Verifikasi langkah via page-change diff, bukan asumsi.

## 8. Risiko dan batasan

- Bergantung pada Chrome remote debugging aktif dan maintenance upstream harness.
- Perilaku mirip Codex pada inti (attach, live view, tab khusus), bukan replika
  aplikasi desktop closed-source Codex.
- Nama command final perlu verifikasi bentrok bawaan pi saat implementasi.
