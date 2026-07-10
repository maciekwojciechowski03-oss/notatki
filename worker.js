// ============================================================
//  NOTATKI GŁOSOWE — Cloudflare Worker (v3: foldery dynamiczne)
//
//  MODEL DANYCH w KV:
//    "folders" -> [{ id, name, icon, grad, subs:[{id,name}] }]
//    "notes"   -> [{ id, text, ts, folder, subfolder, done }]
//        folder    = id folderu (np. "praca")
//        subfolder = id podfolderu lub null
//        done      = bool
//
//  ENDPOINTY:
//    GET  /list                          -> { notes, folders }
//    POST /add     { text }              -> Skrót iOS; AI wybiera folder po nazwie
//    POST /edit    { id, text }
//    POST /move    { id, folder, subfolder? }   subfolder opcjonalny (null kasuje)
//    POST /toggle  { id }                -> przełącza done
//    POST /delete  { id }
//    POST /folders { folders }           -> zapis całej listy folderów (z UI)
//
//  Bindingi/sekrety:
//    KV: NOTATKI_KV | Secret: GEMINI_API_NOTES | Secret(opc.): API_TOKEN
// ============================================================

const DEFAULT_FOLDERS = [
  { id: "praca",  name: "Praca HM", icon: "praca",  grad: "blue",  subs: [] },
  { id: "zakupy", name: "Zakupy", icon: "zakupy", grad: "green", subs: [] },
  { id: "inne",   name: "Inne",   icon: "inne",   grad: "gray",  subs: [] },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Token",
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname;

    if (env.API_TOKEN) {
      const t = request.headers.get("X-Token") || url.searchParams.get("token");
      if (t !== env.API_TOKEN) return json({ ok: false, error: "Brak autoryzacji" }, 401);
    }

    try {
      if (path === "/list" && request.method === "GET") {
        return json({ ok: true, notes: await getNotes(env), folders: await getFolders(env) });
      }

      if (path === "/add" && request.method === "POST") {
        const text = (await readText(request)).trim();
        if (!text) return json({ ok: false, error: "Pusty tekst" }, 400);
        const folders = await getFolders(env);
        const tmpFolder = folders.find((f) => f.id === "inne")?.id || folders[folders.length - 1]?.id || "inne";
        const noteId = crypto.randomUUID();
        const notes = await getNotes(env);
        notes.push({ id: noteId, text, ts: Date.now(), folder: tmpFolder, subfolder: null, done: false, star: false });
        await putNotes(env, notes);

        if (env.GEMINI_API_NOTES) {
          ctx.waitUntil((async () => {
            try {
              const folderId = await classify(text, folders, env);
              if (folderId && folderId !== tmpFolder) {
                const fresh = await getNotes(env);
                const n = fresh.find((x) => x.id === noteId);
                if (n) { n.folder = folderId; await putNotes(env, fresh); }
              }
            } catch (_) {}
          })());
        }
        return new Response("OK", { headers: CORS });
      }

      if (path === "/edit" && request.method === "POST") {
        const { id, text, title } = await request.json();
        const notes = await getNotes(env);
        const n = notes.find((x) => x.id === id);
        if (!n) return json({ ok: false, error: "Nie znaleziono" }, 404);
        if (text !== undefined) n.text = String(text).trim();
        if (title !== undefined) n.title = title ? String(title).trim() : null;
        await putNotes(env, notes);
        return json({ ok: true });
      }

      if (path === "/create" && request.method === "POST") {
        const { text, folder, subfolder, type, title } = await request.json();
        if (!folder) return json({ ok: false, error: "Brak folder" }, 400);
        const notes = await getNotes(env);
        const note = { id: crypto.randomUUID(), text: String(text||"").trim(), ts: Date.now(), folder, subfolder: subfolder || null, done: false, star: false, type: type||"note", title: title?String(title).trim():null };
        notes.push(note);
        await putNotes(env, notes);
        return json({ ok: true, note });
      }

      if (path === "/move" && request.method === "POST") {
        const { id, folder, subfolder } = await request.json();
        const notes = await getNotes(env);
        const n = notes.find((x) => x.id === id);
        if (!n) return json({ ok: false, error: "Nie znaleziono" }, 404);
        if (folder) n.folder = folder;
        n.subfolder = subfolder || null;
        await putNotes(env, notes);
        return json({ ok: true });
      }

      if (path === "/toggle" && request.method === "POST") {
        const { id } = await request.json();
        const notes = await getNotes(env);
        const n = notes.find((x) => x.id === id);
        if (!n) return json({ ok: false, error: "Nie znaleziono" }, 404);
        n.done = !n.done;
        await putNotes(env, notes);
        return json({ ok: true, done: n.done });
      }

      if (path === "/star" && request.method === "POST") {
        const { id } = await request.json();
        const notes = await getNotes(env);
        const n = notes.find((x) => x.id === id);
        if (!n) return json({ ok: false, error: "Nie znaleziono" }, 404);
        n.star = !n.star;
        await putNotes(env, notes);
        return json({ ok: true, star: n.star });
      }

      if (path === "/delete" && request.method === "POST") {
        const { id } = await request.json();
        let notes = await getNotes(env);
        notes = notes.filter((x) => x.id !== id);
        await putNotes(env, notes);
        return json({ ok: true });
      }

      if (path === "/folders" && request.method === "POST") {
        const { folders } = await request.json();
        if (!Array.isArray(folders)) return json({ ok: false, error: "Zła lista" }, 400);
        await env.NOTATKI_KV.put("folders", JSON.stringify(folders));
        return json({ ok: true });
      }

      if (path === "/deleteFolder" && request.method === "POST") {
        const { folderId } = await request.json();
        let folders = await getFolders(env);
        folders = folders.filter((f) => f.id !== folderId);
        await env.NOTATKI_KV.put("folders", JSON.stringify(folders));
        let notes = await getNotes(env);
        notes = notes.filter((n) => n.folder !== folderId);
        await putNotes(env, notes);
        return json({ ok: true });
      }

      if (path === "/deleteSub" && request.method === "POST") {
        const { folderId, subId } = await request.json();
        const folders = await getFolders(env);
        const f = folders.find((x) => x.id === folderId);
        if (f) f.subs = (f.subs || []).filter((s) => s.id !== subId);
        await env.NOTATKI_KV.put("folders", JSON.stringify(folders));
        const notes = await getNotes(env);
        notes.forEach((n) => { if (n.folder === folderId && n.subfolder === subId) n.subfolder = null; });
        await putNotes(env, notes);
        return json({ ok: true });
      }

      // ---- POBIERZ INSTRUKCJE AI ----
      if (path === "/classify-prompt" && request.method === "GET") {
        const prompt = await env.NOTATKI_KV.get("classify_prompt") || "";
        return json({ ok: true, prompt });
      }

      // ---- ZAPISZ INSTRUKCJE AI ----
      if (path === "/classify-prompt" && request.method === "POST") {
        const { prompt } = await request.json();
        await env.NOTATKI_KV.put("classify_prompt", prompt || "");
        return json({ ok: true });
      }

      if (path === "/test" && request.method === "GET") {
        const r = { hasKey: !!env.GEMINI_API_NOTES };
        if (env.GEMINI_API_NOTES) {
          const folders = await getFolders(env);
          r.folders = folders.map((f) => f.name);
          r.classifiedAs = await classify("kup mleko chleb i masło", folders, env);
        }
        return json(r);
      }

      return json({ ok: false, error: "Nieznany endpoint" }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500);
    }
  },
};

async function getNotes(env) {
  const raw = await env.NOTATKI_KV.get("notes");
  return raw ? JSON.parse(raw) : [];
}
async function putNotes(env, notes) {
  await env.NOTATKI_KV.put("notes", JSON.stringify(notes));
}
async function getFolders(env) {
  const raw = await env.NOTATKI_KV.get("folders");
  if (!raw) {
    await env.NOTATKI_KV.put("folders", JSON.stringify(DEFAULT_FOLDERS));
    return DEFAULT_FOLDERS;
  }
  return JSON.parse(raw);
}

async function classify(text, folders, env) {
  const fallback = folders.find((f) => f.id === "inne")?.id || folders[folders.length - 1]?.id || "inne";
  if (!env.GEMINI_API_NOTES) return fallback;
  try {
    const names = folders.map((f) => f.name);
    const customInstructions = await env.NOTATKI_KV.get("classify_prompt") || "";
    const prompt =
      (customInstructions ? customInstructions + "\n\n" : "") +
      `Zaklasyfikuj notatkę do JEDNEJ z tych kategorii: ${names.join(", ")}. ` +
      `Wybierz najlepiej pasującą. Jeśli nie masz pewności, wybierz "Inne" (jeśli istnieje). ` +
      `Odpowiedz TYLKO dokładną nazwą jednej kategorii z listy, bez niczego więcej.\n\nNotatka: "${text}"`;
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + env.GEMINI_API_NOTES,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 15, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    const d = await res.json();
    const out = (d?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toLowerCase();
    const hit = folders.find((f) => out.includes(f.name.toLowerCase()));
    return hit ? hit.id : fallback;
  } catch {
    return fallback;
  }
}

async function readText(request) {
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    const b = await request.json().catch(() => ({}));
    return b.text || "";
  }
  if (ct.includes("urlencoded") || ct.includes("form-data")) {
    const f = await request.formData();
    return f.get("text") || "";
  }
  return await request.text();
}
