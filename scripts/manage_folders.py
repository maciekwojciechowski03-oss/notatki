import os, json, urllib.request, urllib.error, sys

url = os.environ['WORKER_URL']
action = os.environ['ACTION']
folder_id = os.environ['FOLDER_ID']
folder_name = os.environ.get('FOLDER_NAME', '')
folder_icon = os.environ.get('FOLDER_ICON', 'inne')
folder_color = os.environ.get('FOLDER_COLOR', 'blue')

print(f"Worker URL: {url}")
print(f"Akcja: {action} | ID: {folder_id} | Nazwa: {folder_name}")

# Pobierz aktualne dane
try:
    req = urllib.request.Request(url + '/list')
    with urllib.request.urlopen(req) as r:
        body = r.read()
        print(f"GET /list → {r.status}")
        data = json.loads(body)
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"BLAD GET /list → HTTP {e.code}: {body}")
    sys.exit(1)
except Exception as e:
    print(f"BLAD GET /list → {type(e).__name__}: {e}")
    sys.exit(1)

folders = data.get('folders', [])
print(f"Aktualne foldery: {[f['name'] for f in folders]}")

if action == 'add':
    if not any(f['id'] == folder_id for f in folders):
        folders.append({
            'id': folder_id,
            'name': folder_name,
            'icon': folder_icon,
            'grad': folder_color,
            'subs': []
        })
        print(f"Dodaje folder: {folder_name}")
    else:
        print(f"Folder {folder_id} juz istnieje — koniec")
        sys.exit(0)

elif action == 'remove':
    before = len(folders)
    folders = [f for f in folders if f['id'] != folder_id]
    print(f"Usuwam folder: {folder_id} (bylo {before}, teraz {len(folders)})")

# Zapisz
try:
    payload = json.dumps({'folders': folders}).encode()
    req2 = urllib.request.Request(
        url + '/folders',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req2) as r:
        body = r.read()
        print(f"POST /folders → {r.status}")
        result = json.loads(body)
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"BLAD POST /folders → HTTP {e.code}: {body}")
    sys.exit(1)
except Exception as e:
    print(f"BLAD POST /folders → {type(e).__name__}: {e}")
    sys.exit(1)

if result.get('ok'):
    print('Sukces!')
else:
    print(f'Blad odpowiedzi: {result}')
    sys.exit(1)
