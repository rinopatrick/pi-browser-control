# pi-browser-control

Browser control ala Codex desktop untuk Pi: agent operasikan Chrome terlihat,
user menonton live, tab lain tidak terganggu. Bukan computer use.

## Install

```bash
pi install ./pi-browser-control   # lokal, atau
pi install npm:pi-browser-control # setelah publish
```

Dua jalur attach:

### A. Companion extension (tanpa relaunch, profil login utuh)

1. Buka `chrome://extensions`, aktifkan Developer mode, Load unpacked → folder `companion/`.
2. Catat extension ID, masukkan ke `allowed_origins` di `native-host/host-manifest.json`.
3. Jalankan sekali: `node native-host/register.mjs` (tulis registry HKCU).
4. Jalankan host tiap sesi: `node native-host/native-host.mjs` (atau autostart).
5. Di Pi: `/bc-attach` → `bc_bridge` listTabs → attach tab yang bebas.

Banner "is being debugged" tampil saat attach — syarat Chrome.
Satu debugger per tab: jangan rebutan tab dengan ChatGPT, pakai tab berbeda.

### B. Remote debugging flag (fallback, profil terpisah)

Aktifkan remote debugging Chrome, lalu `/browser-setup` (dari harness) sekali.

## Pakai

- `/bc-attach` — attach ke Chrome utama via companion bridge.
- `/bc-view` — live view read-only tab agent.
- `/bc-policy` — policy efektif.
- Anotasi: klik elemen di live page, tinggalkan komentar, agent baca balik.

## Arsitektur

Engine CDP = harness (dependensi) untuk jalur B.
Jalur A: companion extension (`chrome.debugger`, permission `debugger`)
→ Native Messaging host (`native-host/`) → WebSocket lokal → tool `bc_bridge`.
Lapisan Pi: guard policy, pin model aktif, command UX, skill, overlay anotasi.

## Credit

- [pi-browser-harness](https://github.com/amankumarsingh77/pi-browser-harness) — engine CDP (40 tools, ref-first, owned-tab).
- Pola anotasi + policy: `pi-browser-plus` (milik penulis).
