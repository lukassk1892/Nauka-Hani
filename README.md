# Nauka Hani – aplikacja z kontem

Adres: https://lukassk1892.github.io/nauka-hani/ (GitHub Pages z gałęzi `main`, katalog główny).

## Pliki
- `app.html` – dokładna kopia aplikacji z artifactu https://claude.ai/artifact/U1dU7xbAjiyWWNGrL63oXS (przedmioty, pytania, rundy).
- `nh.js`, `nh.css` – konto (logowanie e-mail + hasło), synchronizacja localStorage ↔ Supabase (`kv`), monety, skarbonka, skrzynki, joker, odznaki, widok rodzica, powiadomienia push.
- `tools/build.py` – skleja `index.html` z `app.html` + `nh.js` (zamienia końcowe `hub();` na start po zalogowaniu) i podbija wersję w `sw.js`.
- `sw.js`, `manifest.webmanifest`, `icons/` – instalacja na telefonie i praca offline.
- `supabase/` – schemat bazy, funkcja `notify` (web push, co 15 min z pg_cron), test uprawnień.

## Jak zaktualizować aplikację po zmianie artifactu
1. Zapisz aktualny HTML artifactu jako `app.html` (bez zmian w kluczach zapisu).
2. `python3 tools/build.py`
3. Commit + push na `main`. Telefon dostanie nową wersję po odświeżeniu.

## Zasady
- Klucze postępów w localStorage są te same co w artifakcie – synchronizacja kopiuje je 1:1 do tabeli `kv`.
- Klucze `nh-*` i `sb-*` są tylko lokalne. `gry-v1` (monety, skrzynki, jokery) synchronizuje się jak postępy.
- Supabase: projekt `nauka-hani` (ref `pzzfpqrlauljsxrbpnxd`), plan Free.
