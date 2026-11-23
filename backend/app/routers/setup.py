"""Starting setups: the app's base setup for a track and the player's best one there."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.engineer.base_setup import base_setup
from app.models import TrackKnowledge, User
from app.telemetry import constants as c

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/tracks")
async def tracks(user: User = Depends(get_current_user)):
    """Every track the game knows, for picking a base setup without a session."""
    return [{"id": tid, "pista": name} for tid, name in sorted(c.TRACKS.items(), key=lambda kv: kv[1])]


@router.get("/base")
async def base(track_id: int, lluvia: bool = False, user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    """The app's base setup for the track and, if the player has run there, the setup of their best clean lap."""
    row = await db.scalar(
        select(TrackKnowledge).where(TrackKnowledge.tenant_id == user.tenant_id, TrackKnowledge.track_id == track_id)
    )
    best = ((row.summary or {}).get("mejor_reglaje") or {}).get("lluvia" if lluvia else "seco") if row else None
    return {**base_setup(track_id, lluvia), "tu_mejor": best}
