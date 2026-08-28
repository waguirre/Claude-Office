# Claude-Office :: instalador multi-cliente idempotente.
#   python install.py          -> instala/actualiza
#   python install.py --remove -> desinstala
# Respalda cada archivo antes de tocarlo. Fail-open: los hooks no bloquean nada.
import io, json, os, re, shutil, sys, datetime

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
EMIT = os.path.join(HERE, "office-emit.mjs").replace("\\", "/")
MARK = "office-emit.mjs"
REMOVE = "--remove" in sys.argv
STATUS = "--status" in sys.argv

def cmd(phase, client):
    return 'node "%s" --phase %s --client %s' % (EMIT, phase, client)

def backup(p):
    if os.path.exists(p):
        shutil.copy2(p, p + ".bak-office-" +
                     datetime.datetime.now().strftime("%Y%m%dT%H%M%S"))

def load_json(p, default):
    try:
        return json.load(io.open(p, encoding="utf-8"))
    except Exception:
        return default

def save_json(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    io.open(p, "w", encoding="utf-8", newline="\n").write(
        json.dumps(d, indent=2, ensure_ascii=False) + "\n")

def strip(groups):
    """Quita entradas nuestras de una lista de grupos de hooks."""
    out = []
    for g in groups or []:
        g = dict(g)
        g["hooks"] = [h for h in g.get("hooks", []) if MARK not in h.get("command", "")]
        if g["hooks"]:
            out.append(g)
    return out

def wire_claude_style(path, root_key, client):
    """Claude Code y Codex comparten estructura y payload."""
    d = load_json(path, {})
    node = d.setdefault(root_key, {}) if root_key else d
    for ev, ph in (("PreToolUse", "pre"), ("PostToolUse", "post")):
        node[ev] = strip(node.get(ev, []))
        if not REMOVE:
            node[ev].append({"hooks": [{"type": "command", "command": cmd(ph, client)}]})
        if not node[ev]:
            node.pop(ev, None)
    backup(path); save_json(path, d)
    return path

def wire_antigravity(path):
    """hooks.json con nombre de hook al tope; payload toolCall.* lo adapta el emisor."""
    d = load_json(path, {})
    d.pop("claude-office", None)
    if not REMOVE:
        d["claude-office"] = {
            ev: [{"matcher": "", "hooks": [{"type": "command", "command": cmd(ph, "antigravity"), "timeout": 5}]}]
            for ev, ph in (("PreToolUse", "pre"), ("PostToolUse", "post"))
        }
    backup(path); save_json(path, d)
    return path

def wire_kimi(path):
    """config.toml: hooks = [ {event, command, matcher, timeout}, ... ]"""
    if not os.path.exists(path):
        return None
    s = io.open(path, encoding="utf-8").read()
    entries = "" if REMOVE else ", ".join(
        '{event = "%s", command = "%s", matcher = "", timeout = 5}' % (ev, cmd(ph, 'kimi').replace('"', '\\"'))
        for ev, ph in (("PreToolUse", "pre"), ("PostToolUse", "post")))
    new = "hooks = [%s]" % entries
    if re.search(r"^hooks = \[.*\]$", s, re.M):
        s2 = re.sub(r"^hooks = \[.*\]$", new.replace("\\", "\\\\"), s, count=1, flags=re.M)
    else:
        return None
    backup(path)
    io.open(path, "w", encoding="utf-8", newline="\n").write(s2)
    return path

def wire_gemini(path):
    """Gemini CLI: hooks van en settings.json (NO en config/hooks.json, que es de
    Antigravity) y los eventos se llaman BeforeTool/AfterTool. Payload compatible
    con el esquema de Claude Code (hook_event_name/tool_name/tool_input)."""
    if not os.path.exists(path):
        return None
    d = load_json(path, {})
    node = d.setdefault("hooks", {})
    for ev, ph in (("BeforeTool", "pre"), ("AfterTool", "post")):
        node[ev] = strip(node.get(ev, []))
        if not REMOVE:
            node[ev].append({"matcher": "", "hooks": [
                {"type": "command", "command": cmd(ph, "gemini"), "timeout": 5}]})
        if not node[ev]:
            node.pop(ev, None)
    if not node:
        d.pop("hooks", None)
    backup(path); save_json(path, d)
    return path

def wire_opencode(plugdir):
    """Plugin JS in-process: sin spawn de procesos.

    OpenCode solo carga los archivos *.js* del directorio de plugins: un .mjs
    se ignora en silencio. Por eso el destino es .js y el contenido es un shim
    que reexporta el plugin real por ruta absoluta (sin symlink, que exige
    privilegio en Windows, ni copia, que rompe el import relativo)."""
    if not os.path.isdir(plugdir):
        return None
    for legacy in ("claude-office.mjs", "claude-office.js"):
        q = os.path.join(plugdir, legacy)
        if os.path.lexists(q):
            os.remove(q)
    dst = os.path.join(plugdir, "claude-office.js")
    if REMOVE:
        return dst
    src = os.path.join(HERE, "opencode-plugin.mjs").replace("\\", "/")
    io.open(dst, "w", encoding="utf-8", newline=chr(10)).write(
        "// Claude-Office :: shim generado por install.py. No editar." + chr(10) +
        "export { ClaudeOfficePlugin } from 'file:///%s'" % src + chr(10))
    return dst

def report():
    """Solo lectura: dice que cliente tiene el hook cableado."""
    import glob
    targets = [
        ("claude (sync)", os.path.join(HOME, ".dev", "claude-sync", "claude-config", "settings.json")),
        ("claude (vivo)", os.path.join(HOME, ".claude", "settings.json")),
        ("codex",         os.path.join(HOME, ".codex", "hooks.json")),
        ("antigravity",   os.path.join(HOME, ".gemini", "config", "hooks.json")),
        ("gemini",        os.path.join(HOME, ".gemini", "settings.json")),
        ("kimi",          os.path.join(HOME, ".kimi", "config.toml")),
        ("opencode",      os.path.join(HOME, ".config", "opencode", "plugins", "claude-office.js")),
    ]
    for name, p in targets:
        if not os.path.exists(p):
            print("  %-14s -- no instalado" % name); continue
        try:
            txt = io.open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            txt = ""
        ok = (MARK in txt) or (name == "opencode")
        print("  %-14s %s" % (name, "OK cableado" if ok else "!! SIN hook"))

    import glob as _g
    profs = _g.glob(os.path.join(os.environ.get("APPDATA", ""), "Code", "User", "profiles", "*", "extensions.json"))
    hit = 0
    for f in profs:
        try:
            if any(e.get("identifier", {}).get("id") == "claude-sync.claude-office-panel"
                   for e in json.load(io.open(f, encoding="utf-8"))):
                hit += 1
        except Exception:
            pass
    print("  %-14s %d/%d perfiles de VS Code" % ("extension", hit, len(profs)))


if STATUS:
    report()
    sys.exit(0)

done = []
# claude-config/ es la fuente que claude-stack-sync.ps1 restaura hacia ~/.claude,
# pero ~/.claude/settings.json es una copia real: hay que tocar los dos.
done.append(("claude (sync)", wire_claude_style(
    os.path.join(HOME, ".dev", "claude-sync", "claude-config", "settings.json"), "hooks", "claude")))
done.append(("claude (vivo)", wire_claude_style(
    os.path.join(HOME, ".claude", "settings.json"), "hooks", "claude")))
done.append(("codex", wire_claude_style(os.path.join(HOME, ".codex", "hooks.json"), "hooks", "codex")))
done.append(("antigravity", wire_antigravity(os.path.join(HOME, ".gemini", "config", "hooks.json"))))
done.append(("gemini", wire_gemini(os.path.join(HOME, ".gemini", "settings.json"))))
done.append(("kimi", wire_kimi(os.path.join(HOME, ".kimi", "config.toml"))))
done.append(("opencode", wire_opencode(os.path.join(HOME, ".config", "opencode", "plugins"))))

verb = "desinstalado" if REMOVE else "instalado"
for name, path in done:
    print("%-12s %s %s" % (name, verb if path else "OMITIDO (no encontrado)", path or ""))
