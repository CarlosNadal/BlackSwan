## **Black Swan: The Invisible Threat Visualizer**

> *"When the attack is silent, invisible, and real… you need a new way to see."*

* * *
![Logo de BlackSwan](/frontend/public/BlackSwan.png)

### 🦢 **Black Swan**

La primera herramienta de visualización ofensiva WiFi, inspirada en BloodHound, que te permite mapear redes inalámbricas en tiempo real, identificar objetivos críticos y lanzar ataques desde la propia interfaz gráfica.

* * *

## ❓ ¿Por qué nace Black Swan?

El WiFi sigue siendo el **eslabón más débil de la seguridad digital moderna**.  
Redes con WPA2/WPA3 mal configuradas, clientes expuestos, dispositivos IoT inseguros…

Y lo peor: **todo esto se puede escanear sin levantar una sola alarma.**

El Recon WiFi es:

- Pasivo
    
- Silencioso
    
- Invisible para el administrador de red
    

**Black Swan convierte ese silencio en visibilidad.**  
Con una visualización inspirada en el estilo gráfico de BloodHound, llevamos la guerra aérea digital a un nuevo nivel.

* * *

## 🧠 ¿Qué hace diferente a Black Swan?

| Característica | Descripción |
| --- | --- |
| 🔎 Visual Recon | Escanea redes y dispositivos con `airodump-ng`, parsea CSV y genera un grafo |
| 🧬 Score Inteligente | Calcula vulnerabilidad por señal, cifrado y clientes conectados |
| 🧠 Defensivo y Ofensivo | Sirve tanto para monitorear que no tenes una amenaza desconocida como para red team | |
| 🧿 Interfaz hacker moderna | Grafo real en D3.js + backend FastAPI + scripts shell/python |

* * *

## 🛡️ ¿Por qué importa esto?

> "Si tu red WiFi se ve vulnerable desde afuera… es porque **ya está siendo observada**."

Black Swan no es una amenaza.  
Es una **alerta visual**.

Una herramienta para entender cómo un atacante ve tu red.  

* * *

## Instalación

`git clone git@github.com:CarlosNadal/BlackSwan.git`


## 🛠️ Despliegue y modos de ejecución

Black Swan ofrece dos modos de despliegue: **desarrollo/laboratorio** y **producción segura**.

`cd backend/recon`

### 1️⃣ Modo desarrollo / laboratorio (`--dev`)

`./deploy.sh --dev`

- Crea un **entorno virtual (venv)** en tu repo si no existe.
    
- Instala dependencias Python necesarias (`flask`, `flask-socketio`, `flask-cors`, `eventlet`).
        
- Ideal para: **laboratorios, pruebas, desarrollo rápido**.
    

Ejecutar la app:

`source venv/bin/activatepython3 main.py`

> ⚠️ Todo corre con tu usuario actual. No hay restricciones adicionales.

* * *

### 2️⃣ Modo producción segura (`--prod`)

`sudo ./deploy.sh --prod`

- Crea un **usuario dedicado** (por defecto `black-swan`) para ejecutar el servicio.
    
- Instala dependencias del sistema y Python si no existen.
    
- Protege el **venv** y los scripts (`main.py`, `start.sh`, `stopservice.sh`, `restart.sh`) para que solo el usuario del servicio y root puedan ejecutarlos.
    
- Crea un **servicio systemd** con:
    
    - Hardening básico (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, `ProtectHome`).
        
    - Límites de reinicio (`StartLimitBurst`, `StartLimitIntervalSec`) y recursos (`LimitNOFILE`, `TasksMax`).
        
    - EnvironmentFile para cambiar `INTERFACE` y `PORT` sin modificar el unit.
        
- Logs separados en `/var/log/blackswan`.
    

Ejecutar o gestionar el servicio:

* `sudo systemctl status blackswan-wifi # Ver estado`
* `sudosystemctl restart blackswan-wifi # Reiniciarsudo`
* `systemctl stop blackswan-wifi # Detener`
* `sudo journalctl -u blackswan-wifi -f # Logs en tiempo real`

> ⚠️ Solo el usuario dedicado y root pueden ejecutar los scripts protegidos.

* * *

### 🔄 Cambiar interface o puerto

Edite el archivo `/etc/default/blackswan-wifi`:

`INTERFACE=wlan0`
`PORT=8000`

Luego reinicie el servicio:

`sudo systemctl restart blackswan-wifi`

* * *

### 📝 Recomendaciones

- Para **labs y desarrollo rápido**, usar `--dev` es suficiente.
    
- Para **simular un entorno seguro o red team**, usar `--prod`.
    
- Siempre revisa permisos y logs después del despliegue:
    

`ls -l venv main.py /var/log/blackswansudo journalctl -u blackswan-wifi -n 50`

* * *

## 📢 Llamado a la comunidad

Black Swan es **100% open source**.  
Está pensado para la comunidad WiFi, pentesters, docentes y entusiastas.

Si querés colaborar con visualización, scripting, backend o simplemente probar…  
Bienvenido al nido.
    

* * *

## 🖤 Porque los verdaderos ataques...

...no hacen ruido.  
Solo dejan vulnerabilidades al descubierto.

 **Black Swan** — visualizá lo invisible.

