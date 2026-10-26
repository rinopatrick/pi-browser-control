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

1. Buka `chrome://extensions`, aktifkan Developer mode, **Load unpacked** → folder `companion/`.
2. Selesai. Bridge server start otomatis saat Pi pertama kali memanggil `bc_bridge`.

Tidak ada registry, tidak ada Native Messaging, tidak ada relaunch Chrome.
Banner "is being debugged" tampil saat attach — syarat Chrome.
Satu debugger per tab: jangan rebutan tab dengan ChatGPT, pakai tab berbeda.

Jalankan server manual bila mau (opsional):
```bash
node native-host/bridge-server.mjs     # http://127.0.0.1:17832
```

### B. Remote debugging flag (fallback, profil terpisah)

Aktifkan remote debugging Chrome, lalu `/browser-setup` (dari harness) sekali.

## Pakai

- `/bc-attach` — attach ke Chrome utama via companion bridge.
- `/bc-view` — live view read-only tab agent.
- `/bc-policy` — policy efektif.
- Anotasi: klik elemen di live page, tinggalkan komentar, agent baca balik.

## Arsitektur

Engine CDP = harness (dependensi) untuk jalur B.

Jalur A:
```
Pi (bc_bridge) --HTTP--> bridge-server.mjs (persisten)
                              ^
                              | WebSocket /ext
                       companion extension (chrome.debugger)
                              |
                              v
                        Chrome tab (profil login utuh)
```

Bridge server hidup terpisah dari Chrome, jadi Chrome tidak bisa mematikannya.
Extension reconnect otomatis dengan backoff bila server belum jalan.

Lapisan Pi: guard policy, pin model aktif, command UX, skill, overlay anotasi.

## Credit

- [pi-browser-harness](https://github.com/amankumarsingh77/pi-browser-harness) — engine CDP (40 tools, ref-first, owned-tab).
- Pola anotasi + policy: `pi-browser-plus` (milik penulis).
