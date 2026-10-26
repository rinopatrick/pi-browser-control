# pi-browser-control

Browser control ala Codex desktop untuk Pi: agent operasikan Chrome terlihat,
user menonton live, tab lain tidak terganggu. Bukan computer use.

## Install

```bash
pi install ./pi-browser-control   # lokal, atau
pi install npm:pi-browser-control # setelah publish
```

Aktifkan remote debugging Chrome, lalu `/browser-setup` (dari harness) sekali.

## Pakai

- `/browser-view` — live view read-only tab agent.
- `/browser-policy` — policy efektif.
- Anotasi: klik elemen di live page, tinggalkan komentar, agent baca balik.

## Arsitektur

Engine CDP = harness (dependensi). Lapisan ini: guard policy, command UX,
skill, overlay anotasi.

## Credit

- [pi-browser-harness](https://github.com/amankumarsingh77/pi-browser-harness) — engine CDP (40 tools, ref-first, owned-tab).
- Pola anotasi + policy: `pi-browser-plus` (milik penulis).
