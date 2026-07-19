"""
Deploy the RacketCoach backend (a Hono API) on Modal, with its SQLite database
on a Modal Volume. One deploy, one container, data persisted on the Volume.

Run this from the backend/ directory.

Usage:
    pip install modal
    modal token new
    # store the backend secrets (AUTH_SECRET, and the URLs for magic-link redirects):
    modal secret create racketcoach-env \\
        AUTH_SECRET=$(openssl rand -base64 33) \\
        FRONTEND_URL=https://your-frontend-url \\
        PUBLIC_BACKEND_URL=https://your-workspace--racketcoach-backend.modal.run
    modal deploy modal_app.py

The deployed URL looks like:
    https://<your-workspace>--racketcoach-backend.modal.run
Point the frontend's BACKEND_URL at that.

Note: this file was not executed from the repo. Run it against your own Modal
account. The API is verified locally; the Modal deploy is yours to run.
"""

import os
import subprocess

import modal

APP_NAME = "racketcoach-backend"

app = modal.App(APP_NAME)

# Node 20 base image with Python added (Modal's function body is Python).
# Backend files are copied in with copy=True so `npm ci` runs at build time.
# The service runs via tsx (a devDependency), so devDependencies are installed.
# DATABASE_URL points at the Volume mount; PORT matches @modal.web_server below.
image = (
    modal.Image.from_registry("node:20-slim", add_python="3.12")
    .workdir("/app")
    .env(
        {
            "DATABASE_URL": "file:/data/racketcoach.db",
            "PORT": "3001",
            "RAW_DIR": "/data/raw",  # raw sensor files on the Volume
        }
    )
    .add_local_dir(
        ".",
        "/app",
        copy=True,
        ignore=[
            "node_modules",
            ".git",
            ".env",
            ".env.local",
            "racketcoach.db",
            "racketcoach.db-*",
            "modal_app.py",
            "__pycache__",
        ],
    )
    .run_commands("npm ci")
)

# Persistent SQLite lives here.
volume = modal.Volume.from_name("racketcoach-data", create_if_missing=True)


@app.function(
    image=image,
    volumes={"/data": volume},
    # AUTH_SECRET (+ FRONTEND_URL, PUBLIC_BACKEND_URL, optional RESEND_API_KEY).
    secrets=[modal.Secret.from_name("racketcoach-env")],
    min_containers=1,  # keep one container warm (no cold start for the demo)
    max_containers=1,  # SQLite is single-writer: never scale past one container
    timeout=60 * 60,
)
@modal.concurrent(max_inputs=100)  # one container, many concurrent HTTP inputs
@modal.web_server(3001, startup_timeout=120, label=APP_NAME)
def api():
    # The Volume is mounted only at runtime, so migrate + seed happen here.
    subprocess.run("npm run db:migrate", shell=True, cwd="/app", check=True)
    # Seed only when explicitly asked (SEED_DEMO=1). Keep this flag OUT of the
    # Modal secret so a restart against a non-empty prod DB changes nothing.
    if os.environ.get("SEED_DEMO") == "1":
        subprocess.run("npm run db:seed", shell=True, cwd="/app", check=False)
    # Start the Hono API. It binds 0.0.0.0 on $PORT. Non-blocking.
    subprocess.Popen("npm run start", shell=True, cwd="/app")
