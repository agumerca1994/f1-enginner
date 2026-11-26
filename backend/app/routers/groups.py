"""Groups and leagues: create one, join with its code, and compare laps among its members.

The boards are the public lap records filtered to the group (see `/api/leaderboard?grupo=`),
so a lap counts everywhere the moment it is driven. An admin can set the track of the round.
"""

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models import Group, GroupMember, LapRecord, User
from app.routers.leaderboard import GAMES, public_name
from app.telemetry import constants as c

router = APIRouter(prefix="/api/groups", tags=["groups"])
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_GROUPS_PER_PLAYER = 20
MAX_MEMBERS = 300


def _code() -> str:
    return "G-" + "".join(secrets.choice(ALPHABET) for _ in range(6))


def _normalise(code: str) -> str:
    raw = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"G-{raw[1:]}" if raw.startswith("G") and len(raw) == 7 else raw


async def member_tenants(db: AsyncSession, group_id: int, user: User) -> list[int]:
    """The group's tenants; 404 unless the player is one of them."""
    tenants = list(await db.scalars(select(GroupMember.tenant_id).where(GroupMember.group_id == group_id)))
    if user.tenant_id not in tenants:
        raise HTTPException(404, "Group not found")
    return tenants


async def _membership(db: AsyncSession, group_id: int, user: User) -> tuple[Group, GroupMember]:
    g = await db.get(Group, group_id)
    m = await db.scalar(select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.tenant_id == user.tenant_id))
    if g is None or m is None:
        raise HTTPException(404, "Group not found")
    return g, m


def _round(g: Group) -> dict | None:
    if g.round_track_id is None:
        return None
    return {"track_id": g.round_track_id, "pista": c.TRACKS.get(g.round_track_id, f"Pista {g.round_track_id}"),
            "hasta": g.round_until.isoformat() if g.round_until else None}


class NewGroup(BaseModel):
    nombre: str = Field(min_length=2, max_length=60)


class Join(BaseModel):
    codigo: str = Field(min_length=4, max_length=20)


class Change(BaseModel):
    nombre: str | None = Field(None, min_length=2, max_length=60)
    pista_fecha: int | None = None  # -1 clears the round
    hasta: datetime | None = None


@router.get("")
async def my_groups(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(
        select(Group, GroupMember.admin).join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.tenant_id == user.tenant_id).order_by(Group.name)
    )).all()
    counts: dict[int, int] = {}
    if rows:
        counts = dict((await db.execute(
            select(GroupMember.group_id, func.count()).where(GroupMember.group_id.in_([g.id for g, _ in rows]))
            .group_by(GroupMember.group_id)
        )).all())
    return {"grupos": [{"id": g.id, "nombre": g.name, "miembros": counts.get(g.id, 1), "admin": admin, "fecha": _round(g)}
                       for g, admin in rows]}


@router.post("")
async def create(body: NewGroup, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    mine = await db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.tenant_id == user.tenant_id))
    if mine >= MAX_GROUPS_PER_PLAYER:
        raise HTTPException(400, "too_many_groups")
    code = _code()
    while await db.scalar(select(Group.id).where(Group.join_code == code)):
        code = _code()
    g = Group(name=body.nombre.strip(), join_code=code, created_by_tenant_id=user.tenant_id)
    db.add(g)
    await db.flush()
    db.add(GroupMember(group_id=g.id, tenant_id=user.tenant_id, admin=True))
    await db.commit()
    return {"id": g.id, "codigo": g.join_code}


@router.get("/code/{code}")
async def peek(code: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """What a join link opens: the group's name and size, before joining."""
    g = await db.scalar(select(Group).where(Group.join_code == _normalise(code)))
    if g is None:
        raise HTTPException(404, "Group not found")
    n = await db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == g.id))
    inside = await db.scalar(select(GroupMember.id).where(GroupMember.group_id == g.id, GroupMember.tenant_id == user.tenant_id))
    return {"id": g.id, "nombre": g.name, "miembros": n, "ya_estas": inside is not None}


@router.post("/join")
async def join(body: Join, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    g = await db.scalar(select(Group).where(Group.join_code == _normalise(body.codigo)))
    if g is None:
        raise HTTPException(400, "invalid_code")
    if await db.scalar(select(GroupMember.id).where(GroupMember.group_id == g.id, GroupMember.tenant_id == user.tenant_id)):
        return {"id": g.id}
    n = await db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == g.id))
    mine = await db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.tenant_id == user.tenant_id))
    if n >= MAX_MEMBERS or mine >= MAX_GROUPS_PER_PLAYER:
        raise HTTPException(400, "full")
    db.add(GroupMember(group_id=g.id, tenant_id=user.tenant_id))
    await db.commit()
    return {"id": g.id}


@router.get("/{group_id}")
async def detail(group_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """The group: who is in, the round, and who leads on each track the members have driven."""
    g, me = await _membership(db, group_id, user)
    members = (await db.execute(
        select(GroupMember, User).outerjoin(User, User.tenant_id == GroupMember.tenant_id)
        .where(GroupMember.group_id == group_id).order_by(GroupMember.joined_at)
    )).all()
    seen: set[int] = set()
    people = []
    names: dict[int, str] = {}
    for m, u in members:
        if m.tenant_id in seen:
            continue
        seen.add(m.tenant_id)
        names[m.tenant_id] = public_name(u, m.tenant_id)
        people.append({"id": m.id, "nombre": names[m.tenant_id], "admin": m.admin, "soy_yo": m.tenant_id == user.tenant_id})

    # Per track, the most contested board among the members (dry first, then more drivers), and its leader.
    recs = (await db.execute(select(LapRecord).where(LapRecord.tenant_id.in_(seen)))).scalars().all()
    boards: dict[tuple, list[LapRecord]] = {}
    for r in recs:
        boards.setdefault((r.track_id, r.packet_format, r.category, r.weather), []).append(r)
    tracks: dict[int, dict] = {}
    for (track, fmt, cat, weather), rs in boards.items():
        rs.sort(key=lambda r: r.lap_ms)
        mine = next((i for i, r in enumerate(rs) if r.tenant_id == user.tenant_id), None)
        entry = {"track_id": track, "pista": c.TRACKS.get(track, f"Pista {track}"), "juego": fmt, "juego_nombre": GAMES.get(fmt),
                 "categoria": cat, "clima": weather, "pilotos": len(rs),
                 "lider": {"nombre": names.get(rs[0].tenant_id, ""), "tiempo_ms": rs[0].lap_ms, "soy_yo": rs[0].tenant_id == user.tenant_id},
                 "mi_pos": mine + 1 if mine is not None else None}
        prev = tracks.get(track)
        rank = lambda e: (e["clima"] == "seco", e["pilotos"], e["categoria"] == "sin_ayudas")  # noqa: E731
        if prev is None or rank(entry) > rank(prev):
            tracks[track] = entry
    return {
        "id": g.id, "nombre": g.name, "codigo": g.join_code, "admin": me.admin,
        "fecha": _round(g), "miembros": people,
        "pistas": sorted(tracks.values(), key=lambda e: (-e["pilotos"], e["pista"])),
    }


@router.patch("/{group_id}")
async def change(group_id: int, body: Change, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    g, me = await _membership(db, group_id, user)
    if not me.admin:
        raise HTTPException(403, "admin_only")
    if body.nombre is not None:
        g.name = body.nombre.strip()
    if body.pista_fecha is not None:
        if body.pista_fecha == -1:
            g.round_track_id, g.round_until = None, None
        elif body.pista_fecha in c.TRACKS:
            g.round_track_id, g.round_until = body.pista_fecha, body.hasta
        else:
            raise HTTPException(422, "unknown_track")
    await db.commit()
    return {"ok": True}


@router.delete("/{group_id}/members/{member_id}")
async def remove(group_id: int, member_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Leave the group (your own row) or, as an admin, take someone out."""
    g, me = await _membership(db, group_id, user)
    target = await db.get(GroupMember, member_id)
    if target is None or target.group_id != group_id:
        raise HTTPException(404, "Member not found")
    if target.id != me.id and not me.admin:
        raise HTTPException(403, "admin_only")
    await db.delete(target)
    await db.flush()
    left = list(await db.scalars(select(GroupMember).where(GroupMember.group_id == group_id).order_by(GroupMember.joined_at)))
    if not left:
        await db.execute(delete(Group).where(Group.id == group_id))
    elif not any(m.admin for m in left):
        left[0].admin = True  # a group always keeps an admin: the oldest member
    await db.commit()
    return {"ok": True}
