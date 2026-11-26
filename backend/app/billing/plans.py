"""What each plan includes, and the account's state: which plan, how many AI races are left.

Free: everything that runs without AI (history, telemetry, setup, boards, groups, the rules
engineer) and one linked screen. Subscription: the MCP, unlimited screens and a few AI races a
month. Race packs: AI races that do not expire. A courtesy plan includes everything.

An "AI race" is a game session's block of up to 45 minutes with the AI engineer. It is charged
the first time the AI speaks in that block, never for menus or sessions without AI calls.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import BillingAccount, BillingSetting, RaceUsage

RACE_MINUTES = 45
SUB_RACES_PER_MONTH = 3
FREE_SCREENS = 1
DEFAULT_USD_ARS = 1500.0

PRODUCTS = {
    "suscripcion": {"usd": 3.5, "titulo": "Suscripción mensual", "carreras": 0},
    "paquete5": {"usd": 5.0, "titulo": "5 carreras con ingeniero IA", "carreras": 5},
    "paquete12": {"usd": 10.0, "titulo": "12 carreras con ingeniero IA", "carreras": 12},
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def month_start(now: datetime | None = None) -> datetime:
    now = now or _now()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def usd_ars(db: AsyncSession) -> float:
    row = await db.get(BillingSetting, "usd_ars")
    try:
        return float(row.value) if row else DEFAULT_USD_ARS
    except ValueError:
        return DEFAULT_USD_ARS


async def set_usd_ars(db: AsyncSession, value: float) -> None:
    await db.execute(insert(BillingSetting).values(key="usd_ars", value=str(value))
                     .on_conflict_do_update(index_elements=["key"], set_={"value": str(value)}))


def ars(usd: float, rate: float) -> int:
    """The price in pesos, rounded up to the next 100 so it reads clean."""
    return int(math.ceil(usd * rate / 100.0) * 100)


async def account(db: AsyncSession, tenant_id: int) -> BillingAccount:
    acc = await db.get(BillingAccount, tenant_id)
    if acc is None:
        await db.execute(insert(BillingAccount).values(tenant_id=tenant_id).on_conflict_do_nothing())
        acc = await db.get(BillingAccount, tenant_id)
    return acc


def _comp(acc: BillingAccount, now: datetime) -> bool:
    return acc.comp and (acc.comp_until is None or acc.comp_until > now)


def _subscribed(acc: BillingAccount, now: datetime) -> bool:
    return acc.plan_until is not None and acc.plan_until > now


async def status(db: AsyncSession, tenant_id: int) -> dict:
    """The account's plan as the app shows it, and what it can use now."""
    now = _now()
    acc = await db.get(BillingAccount, tenant_id)
    comp = acc is not None and _comp(acc, now)
    sub = acc is not None and _subscribed(acc, now)
    used = await db.scalar(select(func.count()).select_from(RaceUsage).where(
        RaceUsage.tenant_id == tenant_id, RaceUsage.source == "suscripcion", RaceUsage.created_at >= month_start(now))) or 0
    credits = acc.race_credits if acc else 0
    plan = "cortesia" if comp else "suscripcion" if sub else "gratis"
    limits = settings.PLAN_LIMITS
    return {
        "plan": plan,
        "hasta": (acc.comp_until if comp else acc.plan_until if sub else None) if acc else None,
        "renovacion": acc.mp_preapproval_status if acc else None,
        "creditos": credits,
        "carreras_mes": {"incluidas": SUB_RACES_PER_MONTH if sub else 0, "usadas": used},
        "limites": limits,
        "puede": {
            "ingeniero_ia": not limits or comp or (sub and used < SUB_RACES_PER_MONTH) or credits > 0,
            "mcp": not limits or comp or sub,
            "pantallas": None if (not limits or comp or sub) else FREE_SCREENS,
        },
    }


async def can_mcp(db: AsyncSession, tenant_id: int) -> bool:
    return (await status(db, tenant_id))["puede"]["mcp"]


async def screen_limit(db: AsyncSession, tenant_id: int) -> int | None:
    return (await status(db, tenant_id))["puede"]["pantallas"]


async def charge_race(db: AsyncSession, tenant_id: int, game_session_id: int, block: int) -> str | None:
    """Use one AI race for this block of the session. Returns where it came from, or None if there is none.

    Charging the same block twice is free: the second call finds the first one.
    """
    already = await db.scalar(select(RaceUsage.source).where(
        RaceUsage.tenant_id == tenant_id, RaceUsage.game_session_id == game_session_id, RaceUsage.block == block))
    if already:
        return already
    now = _now()
    acc = await account(db, tenant_id)
    if not settings.PLAN_LIMITS or _comp(acc, now):
        source = "cortesia"
    else:
        used = await db.scalar(select(func.count()).select_from(RaceUsage).where(
            RaceUsage.tenant_id == tenant_id, RaceUsage.source == "suscripcion",
            RaceUsage.created_at >= month_start(now))) or 0
        if _subscribed(acc, now) and used < SUB_RACES_PER_MONTH:
            source = "suscripcion"
        elif acc.race_credits > 0:
            source = "paquete"
        else:
            return None
    db.add(RaceUsage(tenant_id=tenant_id, game_session_id=game_session_id, block=block, source=source))
    if source == "paquete":
        acc.race_credits -= 1
    try:
        await db.commit()
    except IntegrityError:  # another lane charged the same block first
        await db.rollback()
        return await db.scalar(select(RaceUsage.source).where(
            RaceUsage.tenant_id == tenant_id, RaceUsage.game_session_id == game_session_id, RaceUsage.block == block))
    return source


async def add_credits(db: AsyncSession, tenant_id: int, n: int) -> None:
    acc = await account(db, tenant_id)
    acc.race_credits += n


async def grant_comp(db: AsyncSession, tenant_id: int, days: int | None, note: str | None) -> BillingAccount:
    acc = await account(db, tenant_id)
    acc.comp = True
    acc.comp_until = _now() + timedelta(days=days) if days else None
    acc.comp_note = note
    return acc
