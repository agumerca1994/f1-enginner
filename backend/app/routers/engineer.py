from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.engineer.runner import engineer_hub
from app.models import User

router = APIRouter(prefix="/api/engineer", tags=["engineer"])


class ToggleIn(BaseModel):
    active: bool


@router.get("/live")
async def live_engineer(user: User = Depends(get_current_user)):
    return engineer_hub.runner(user.tenant_id).state()


@router.post("/live")
async def toggle_live_engineer(body: ToggleIn, user: User = Depends(get_current_user)):
    """Turn the race engineer on or off for the player's live sessions."""
    runner = engineer_hub.runner(user.tenant_id)
    runner.active = body.active
    if not body.active:
        runner.discard_pending()
    return runner.state()
