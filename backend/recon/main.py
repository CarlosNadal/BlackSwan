# backend/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pathlib import Path
import subprocess
import os
import time
import logging
from typing import Optional

# --- Config ---
ROOT = Path(__file__).resolve().parent
ATTACK_DIR = ROOT / "attack"
LOGFILE = ROOT / "attack.log"

ATTACK_SCRIPTS = {
    "deauth": ATTACK_DIR / "deauth_attack.sh",
    "handshake": ATTACK_DIR / "capture_handshake.sh",
    "crack": ATTACK_DIR / "crack_handshake.sh",
    # extend if needed
}

# --- Logging ---
logging.basicConfig(filename=str(LOGFILE), level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Black Swan Backend")

# allow simple CORS for dev
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Models ---
class AttackRequest(BaseModel):
    type: str
    target: str
    interface: Optional[str] = "wlan0mon"
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
        # poll short time to give process something to output
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
        # fallback: try communicate with timeout (not preferred)
        try:
            o, e = proc.communicate(timeout=0.1)
            out += o or b""
            err += e or b""
        except Exception:
            pass
    # decode safely and limit length
    def safe_decode(b):
        try:
            return b.decode(errors="replace")
        except Exception:
            return str(b)
    o_dec = safe_decode(out)[:2000]
    e_dec = safe_decode(err)[:2000]
    return o_dec, e_dec

# --- Endpoints ---
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
    iface = safe_field(req.interface or "wlan0mon")

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
