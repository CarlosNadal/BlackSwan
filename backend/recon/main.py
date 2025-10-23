from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import subprocess
import os
import time
import logging
import json   
import asyncio
import shlex

# --- Config ---
ROOT = Path(__file__).resolve().parent
ATTACK_DIR = ROOT / "attack"
LOGFILE = ROOT / "attack.log"
RECON_FILE = ROOT / "recon_output.json"   

ATTACK_SCRIPTS = {
    "deauth": ATTACK_DIR / "deauth_attack.sh",
    "handshake": ATTACK_DIR / "capture_handshake.sh",
    "crack": ATTACK_DIR / "crack_handshake.sh",
    }

# --- Logging ---
logging.basicConfig(filename=str(LOGFILE), level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger().addHandler(logging.StreamHandler())  

app = FastAPI(title="Black Swan Backend")

# allow simple CORS for dev
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Models ---
class AttackRequest(BaseModel):
    type: str
    target: str
    interface: Optional[str] = "wlan0"
    extra: Optional[dict] = {}

# --- Helpers ---
def safe_field(val: str) -> str:
    # allow alnum, colon, dash, underscore
    return "".join([c for c in str(val) if c.isalnum() or c in ":-_"]).strip()

def read_initial_output(proc, max_lines=20, timeout=0.2):
    """Non-blocking attempt to read some stdout/stderr lines after starting process."""
    out = b""
    err = b""
    try:
        time.sleep(timeout)
        if proc.stdout:
            try:
                out = proc.stdout.read1(4096)
            except Exception:
                out = proc.stdout.read(4096) if proc.stdout else b""
        if proc.stderr:
            try:
                err = proc.stderr.read1(4096)
            except Exception:
                err = proc.stderr.read(4096) if proc.stderr else b""
    except Exception:
        try:
            o, e = proc.communicate(timeout=0.1)
            out += o or b""
            err += e or b""
        except Exception:
            pass
    def safe_decode(b):
        try:
            return b.decode(errors="replace")
        except Exception:
            return str(b)
    o_dec = safe_decode(out)[:2000]
    e_dec = safe_decode(err)[:2000]
    return o_dec, e_dec

# --- Recon endpoint ---
@app.get("/api/recon")
def get_recon():
    """
    Devuelve un JSON simple con campo 'aps' que el frontend espera.
    Busca RECON_FILE en backend/recon_output.json por defecto.
    """
    try:
        if not RECON_FILE.exists():
            logging.warning(f"Recon file not found: {RECON_FILE}")
            # devolver estructura vacía para que el frontend no rompa
            return {"aps": []}
        raw = RECON_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict) and "aps" in data:
            aps = data["aps"]
        elif isinstance(data, list):
            aps = data
        else:
            # intenta mapear keys conocidas de tu formato
            aps = data.get("aps", []) if isinstance(data, dict) else []
        return {"aps": aps}
    except Exception as e:
        logging.exception("Failed to read recon file")
        raise HTTPException(status_code=500, detail=f"Failed to load recon data: {e}")

@app.post("/api/attack")
def run_attack(req: AttackRequest):
    attack_type = req.type
    if attack_type not in ATTACK_SCRIPTS:
        raise HTTPException(status_code=400, detail="Unknown attack type")

    script = ATTACK_SCRIPTS[attack_type]
    if not script.exists():
        raise HTTPException(status_code=500, detail=f"Script for {attack_type} missing on server")

    if not os.access(script, os.X_OK):
        raise HTTPException(status_code=500, detail=f"Script {script} not executable. chmod +x required.")

    # sanitize inputs
    target = safe_field(req.target)
    iface = safe_field(req.interface or "wlan0")

    # build command list (no shell)
    cmd = [str(script), "--target", target, "--iface", iface]

    # add safe extras per type (explicit)
    if attack_type == "deauth":
        mode = req.extra.get("mode", "silent") if req.extra else "silent"
        if mode not in ("silent", "loud"):
            raise HTTPException(status_code=400, detail="Invalid mode")
        cmd += ["--mode", mode]
    if attack_type == "handshake":
        channel = req.extra.get("channel") if req.extra else None
        if channel:
            cmd += ["--channel", str(channel)]

    logging.info(f"Request run_attack type={attack_type} target={target} iface={iface} extra={req.extra}")

    try:
        # start process asynchronously, capture pipes
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        pid = proc.pid
        # read any immediate output to return for debug
        out_sample, err_sample = read_initial_output(proc)
        logging.info(f"Started {attack_type} pid={pid}")
        return {"status": "started", "pid": pid, "stdout_preview": out_sample, "stderr_preview": err_sample}
    except Exception as e:
        logging.exception("Failed to start attack")
        raise HTTPException(status_code=500, detail=f"Failed to start attack: {e}")

@app.get("/api/attack/status")
def attack_status(pid: int):
    try:
        # os.kill(pid, 0) checks existence without killing
        os.kill(pid, 0)
        return {"pid": pid, "alive": True}
    except ProcessLookupError:
        return {"pid": pid, "alive": False}
    except PermissionError:
        return {"pid": pid, "alive": True, "note": "process exists but permission-limited"}

@app.post("/api/attack/stop")
def attack_stop(payload: dict):
    pid = int(payload.get("pid", 0))
    if pid <= 0:
        raise HTTPException(status_code=400, detail="Invalid pid")
    try:
        os.kill(pid, 15)  # SIGTERM
        time.sleep(0.5)
        # if still alive, SIGKILL
        try:
            os.kill(pid, 0)
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
        logging.info(f"Stopped attack pid={pid}")
        return {"status": "stopped", "pid": pid}
    except Exception as e:
        logging.exception("Failed to stop attack")
        raise HTTPException(status_code=500, detail=f"Failed to stop process: {e}")

@app.websocket("/ws/attack")
async def ws_attack(websocket: WebSocket):
    """
    WebSocket en el que el cliente envía JSON:
      { "type": "<deauth|handshake|crack>", "target": "<BSSID or MAC>", "interface": "wlan0mon" }
    El servidor:
      - valida
      - lanza el script con subprocess
      - envía mensajes JSON por WebSocket: {"status":"started","pid":...} y luego {"output":"...text..."} por cada línea
      - al terminar envía {"status":"finished","returncode":int}
    """
    await websocket.accept()
    proc = None
    try:
        data = await websocket.receive_json()
        attack_type = data.get("type")
        target = data.get("target")
        iface = data.get("interface", "wlan0mon")

        if not attack_type or attack_type not in ATTACK_SCRIPTS:
            await websocket.send_json({"error": "unknown attack type"})
            await websocket.close()
            return

        script = ATTACK_SCRIPTS[attack_type]
        if not script.exists() or not os.access(script, os.X_OK):
            await websocket.send_json({"error": f"script missing or not executable: {script}"})
            await websocket.close()
            return

        # sanitize inputs (reuse safe_field)
        target_s = safe_field(target)
        iface_s = safe_field(iface)

        cmd = [str(script), "--target", target_s, "--iface", iface_s]
        # extras if provided in data.extra (optional)
        extra = data.get("extra") or {}
        if attack_type == "deauth":
            mode = extra.get("mode", "silent")
            if mode in ("silent", "loud"):
                cmd += ["--mode", mode]
        if attack_type == "handshake":
            channel = extra.get("channel")
            if channel:
                cmd += ["--channel", str(channel)]

        logging.info("WS executing: %s", " ".join(shlex.quote(x) for x in cmd))

        # start process; combine stdout+stderr to stream everything via stdout
        # text=True makes stdout.readline() return str (py3.7+)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1, text=True, start_new_session=True)

        # notify client started
        await websocket.send_json({"status": "started", "pid": proc.pid})

        # We will read lines in a threadpool to avoid blocking asyncio
        loop = asyncio.get_running_loop()
        while True:
            # read a line without blocking the event loop
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if line == "" and proc.poll() is not None:
                # process finished and no more output
                break
            if line:
                # send output chunk
                try:
                    await websocket.send_json({"output": line})
                except Exception:
                    # if send fails (client disconnected), break and try to terminate the process
                    break

        # wait for final returncode
        rc = proc.poll()
        if rc is None:
            rc = proc.wait(timeout=1)
        await websocket.send_json({"status": "finished", "returncode": rc})
        await websocket.close()
    except WebSocketDisconnect:
        logging.info("Client disconnected, attempting to kill process")
        # client disconnected; kill the process if running
        try:
            if proc and proc.poll() is None:
                proc.kill()
        except Exception as e:
            logging.exception("Failed to kill process after disconnect: %s", e)
    except Exception as e:
        logging.exception("ws_attack error")
        try:
            await websocket.send_json({"error": str(e)})
            await websocket.close()
        except Exception:
            pass
        # ensure child killed
        try:
            if proc and proc.poll() is None:
                proc.kill()
        except Exception:
            pass
