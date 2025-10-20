from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import json

app = FastAPI()

# CORS para que React/Vite/HTML pueda acceder
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # o restringí a tu frontend
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"msg": "Black Swan Recon API 🦢"}

@app.get("/api/recon")
def get_recon_data():
    json_path = Path("recon_output.json")
    if not json_path.exists():
        return {"error": "Archivo recon_output.json no encontrado."}
    
    with open(json_path, "r") as f:
        data = json.load(f)
    
    return data
