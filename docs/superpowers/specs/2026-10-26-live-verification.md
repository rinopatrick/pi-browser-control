# Verifikasi Live — 2026-10-26

Hasil verifikasi end-to-end paket `pi-browser-control` + engine `pi-browser-harness@0.13.0`
terhadap Chrome dengan `--remote-debugging-port=9222`.

## Lingkungan

- Chrome instance debug mandiri via `--user-data-dir=$HOME/.chrome-debug`
  (profil utama tidak bisa direlaunch dengan flag karena single-instance lock;
  flag hanya nempel di renderer, bukan browser utama).
- Port 9222 LISTENING, endpoint CDP valid.

## Hasil

1. `browser_setup` — konek. 2 owned tab (`about:blank`, `github.com`). Viewport 1037x639.
2. `browser_snapshot` — 1067 node, ref-first `[eN]` + koordinat. Output truncate 50KB wajar.
3. `browser_click` ref e13 Sign in — navigasi `github.com` → `github.com/login`, re-snapshot bersih, no stale ref.
4. Guard policy paket — `browser_navigate` ke `github.com` LOLOS karena `deny: []`.
   Perilaku benar sesuai desain opt-in (default allow). Bukan bug.
5. Load bersama `browser-control.ts` + `harness/src/index.ts` — exit 0, tanpa error compile.

## Batasan terkonfirmasi

- Verifikasi live butuh instance Chrome debug terpisah (`--user-data-dir`),
  bukan profil utama yang sedang jalan. Untuk profil utama: tutup Chrome dulu,
  relaunch dengan flag, tab pulih via `--restore-last-session`.
- `browser_snapshot` halaman besar terpotong di 50KB; sisa di temp file.
- Auto-reconnect CDP + retry navigasi milik engine harness, bukan paket ini.
