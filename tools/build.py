#!/usr/bin/env python3
"""Buduje index.html (aplikacja na GitHub Pages) z app.html (kod aplikacji z artifactu).

Użycie: python3 tools/build.py
- app.html: dokładna kopia artifactu https://claude.ai/artifact/U1dU7xbAjiyWWNGrL63oXS
- dokleja manifest, supabase-js, nh.css, nh.js, a końcowe `hub();` zamienia na start po zalogowaniu.
"""
import pathlib, re, sys, hashlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'app.html').read_text(encoding='utf-8')

head = '''<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#7A4ED4">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<link rel="stylesheet" href="nh.css?v={v}">
'''
tail = '''<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
<script src="nh.js?v={v}"></script>
'''
v = hashlib.sha1(((root / 'nh.js').read_bytes() + (root / 'nh.css').read_bytes())).hexdigest()[:8]

if src.count('\nhub();\n</script>') != 1:
    sys.exit('Nie znalazłem końcowego "hub();" w app.html – sprawdź koniec skryptu.')
out = src.replace('\nhub();\n</script>', '\n/* start: nh.js po zalogowaniu */\n</script>\n' + tail.format(v=v), 1)
out = out.replace('<title>Nauka Hani</title>', '<title>Nauka Hani</title>\n' + head.format(v=v), 1)
out = out.replace('<meta charset=utf8>', '<meta charset=utf-8>', 1)
(root / 'index.html').write_text(out, encoding='utf-8')
# wersja service workera = zmiana plików → odświeżenie pamięci podręcznej
sw = (root / 'sw.js').read_text(encoding='utf-8')
ver = hashlib.sha1(out.encode()).hexdigest()[:10]
sw = re.sub(r"const VER='[^']*'", f"const VER='{ver}'", sw)
(root / 'sw.js').write_text(sw, encoding='utf-8')
print('index.html gotowy, wersja', ver)
