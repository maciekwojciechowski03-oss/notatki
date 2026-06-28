import os, json, urllib.request, sys

url = os.environ['WORKER_URL']
action = os.environ['ACTION']
folder_id = os.environ['FOLDER_ID']
folder_name = os.environ.get('FOLDER_NAME', '')
folder_icon = os.environ.get('FOLDER_ICON', 'inne')
folder_color = os.environ.get('FOLDER_COLOR', 'blue')

# Pobierz aktualne dane
with urllib.request.urlopen(url + '/list') as r:
    data = json.loads(r.read())

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
        print(f"Folder {folder_id} juz istnieje")

elif action == 'remove':
    before = len(folders)
    folders = [f for f in folders if f['id'] != folder_id]
    print(f"Usuwam folder: {folder_id} (bylo {before}, teraz {len(folders)})")

# Zapisz
payload = json.dumps({'folders': folders}).encode()
req = urllib.request.Request(
    url + '/folders',
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
with urllib.request.urlopen(req) as r:
    result = json.loads(r.read())

if result.get('ok'):
    print('Sukces!')
else:
    print(f'Blad: {result}')
    sys.exit(1)
