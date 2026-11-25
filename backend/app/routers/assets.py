"""Licensed 3D assets for the app (the setup viewer's car).

The model's licence forbids redistributing the file, so it is not in git and not on a
public URL: an operator uploads it once to the server's data volume
(`PUT /internal/assets/{name}` with `x-internal-key`), and the app fetches it here with
the player's session. Without the file the viewer falls back to the car built in code.
"""

import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from app.core.auth import get_current_user
from app.core.config import settings
from app.models import User
from app.routers.internal import require_internal_key

router = APIRouter(tags=["assets"])

ALLOWED = re.compile(r"^[a-z0-9_-]{1,40}\.glb$")
MAX_BYTES = 20 * 1024 * 1024


def _dir() -> Path:
    # Next to the captures, on the same persistent volume.
    return Path(settings.CAPTURE_DIR) / "_assets"


def _path(name: str) -> Path:
    if not ALLOWED.match(name):
        raise HTTPException(404, "Unknown asset")
    return _dir() / name


@router.get("/api/assets/{name}")
async def get_asset(name: str, user: User = Depends(get_current_user)):
    path = _path(name)
    if not path.is_file():
        raise HTTPException(404, "Asset not uploaded")
    # Private: browsers may keep it, shared caches may not.
    return FileResponse(path, media_type="model/gltf-binary", headers={"Cache-Control": "private, max-age=86400"})


@router.put("/internal/assets/{name}", dependencies=[Depends(require_internal_key)], status_code=204)
async def put_asset(name: str, request: Request):
    path = _path(name)
    body = await request.body()
    if not body or len(body) > MAX_BYTES or body[:4] != b"glTF":
        raise HTTPException(422, "Expected a binary glTF (.glb) under 20 MB")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(path)
