"""
Deploy RacketCoach (a Next.js app) on Modal, with its SQLite database on a
Modal Volume. One deploy, one container, data persisted on the Volume.

Usage:
    pip install modal
    modal token new
    # store your Auth.js secret (and optionally Resend keys):
    modal secret create racketcoach-env AUTH_SECRET=$(openssl rand -base64 33)
    modal deploy modal_app.py

The deployed URL looks like:  https://<your-workspace>--racketcoach.modal.run
Set NEXT_PUBLIC_APP_URL below to that URL so the pairing QR code encodes the
right host (it is baked into the client bundle at build time). If you do not
know the URL yet, deploy once, read it from the output, set it, and redeploy.

Note: this file was not executed from the project repo. Run it against your own
Modal account. The rest of the app is verified locally.
"""

import subprocess

import modal

APP_NAME = "racketcoach"

# Public base URL, baked into the client bundle at BUILD time. Change this to
# your Modal URL before (or on the second) deploy.
PUBLIC_URL = "https://your-workspace--racketcoach.modal.run"

app = modal.App(APP_NAME)

# Node 20 base image with Python added (Modal's function body is Python).
# App files are copied in with copy=True so `npm ci` / `npm run build` can see
# them at build time. DATABASE_URL points at the Volume mount.
image = (
    modal.Image.from_registry("node:20-slim", add_python="3.12")
    .workdir("/app")
    .env(
        {
            "NEXT_PUBLIC_APP_URL": PUBLIC_URL,
            "DATABASE_URL": "file:/data/racketcoach.db",
        }
    )
    .add_local_dir(
        ".",
        "/app",
        copy=True,
        ignore=[
            "node_modules",
            ".next",
            ".git",
            ".env",
            ".env.local",
            "racketcoach.db",
            "racketcoach.db-*",
            "modal_app.py",
            "__pycache__",
        ],
    )
    .run_commands("npm ci", "npm run build")
)

# Persistent SQLite lives here.
volume = modal.Volume.from_name("racketcoach-data", create_if_missing=True)


@app.function(
    image=image,
    volumes={"/data": volume},
    # AUTH_SECRET (and optional RESEND_API_KEY / EMAIL_FROM) come from here.
    secrets=[modal.Secret.from_name("racketcoach-env")],
    min_containers=1,  # keep one container warm (no cold start for the demo)
    max_containers=1,  # SQLite is single-writer: never scale past one container
    timeout=60 * 60,
)
@modal.concurrent(max_inputs=100)  # one container, many concurrent HTTP inputs
@modal.web_server(3000, startup_timeout=120, label=APP_NAME)
def web():
    # The Volume is mounted only at runtime, so migrate + seed happen here,
    # not at image build time.
    subprocess.run("npm run db:migrate", shell=True, cwd="/app", check=True)
    subprocess.run("npm run db:seed", shell=True, cwd="/app", check=False)
    # Start Next. Must bind 0.0.0.0 so Modal can route to it. Non-blocking.
    subprocess.Popen(
        "npx next start -H 0.0.0.0 -p 3000",
        shell=True,
        cwd="/app",
    )
