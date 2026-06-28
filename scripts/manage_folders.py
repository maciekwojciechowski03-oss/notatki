import os, json, urllib.request, urllib.error, sys

CF_TOKEN = os.environ['CF_API_TOKEN']
CF_ACCOUNT = os.environ['CF_ACCOUNT_ID']
KV_NAMESPACE = os.environ['KV_NAMESPACE_ID']
action = os.environ['ACTION']
folder_id = os.environ['FOLDER_ID']
folder_name = os.environ.get('FOLDER_NAME', '')
folder_icon = os.environ.get('FOLDER_ICON', 'inne')
folder_color = os.environ.get('FOLDER_COLOR', 'blue')

BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/storage/kv/namespaces/{KV_NAMESPACE}"
HEADERS = {"Authorization": f"Bearer {CF_TOKEN}"}

print(f"Akcja: {action} | ID: {folder_id} | Nazwa: {folder_name}")

# Odczyt folderów z KV
try:
    req = urllib.request.Request(f"{BASE}/values/folders", headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        folders = json.loads(r.read())
        print(f"Aktualne foldery: {[f['name'] for f in folders]}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"BLAD KV GET → HTTP {e.code}: {body}")
    sys.exit(1)

# Modyfikacja
if action == 'add':
    if not any(f['id'] == folder_id for f in folders):
        folders.append({'id': folder_id, 'name': folder_name,
                        'icon': folder_icon, 'grad': folder_color, 'subs': []})
        print(f"Dodaje: {folder_name}")
    else:
        print(f"Folder {folder_id} juz istnieje")
        sys.exit(0)
elif action == 'remove':
    folders = [f for f in folders if f['id'] != folder_id]
    print(f"Usuwam: {folder_id}")

# Zapis do KV
try:
    payload = json.dumps(folders).encode()
    req2 = urllib.request.Request(
        f"{BASE}/values/folders",
        data=payload,
        headers={**HEADERS, 'Content-Type': 'application/json'},
        method='PUT'
    )
    with urllib.request.urlopen(req2) as r:
        result = json.loads(r.read())
        if result.get('success'):
            print(f"Sukces! Foldery: {[f['name'] for f in folders]}")
        else:
            print(f"Blad zapisu: {result}")
            sys.exit(1)
except urllib.error.HTTPError as e:
    print(f"BLAD KV PUT → HTTP {e.code}: {e.read().decode()}")
    sys.exit(1)
