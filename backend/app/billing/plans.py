"""What each plan includes, and the account's state: which plan, how many races are left.

Two engineers. The alert radio ("Radio de avisos") is the rules engineer: short calls for clear
events. The Pro engineer is the AI: it talks, plans the race, remembers the weekend.

Free: everything that runs without the radio (history, telemetry, setup, boards, groups), the
alert radio for a few races a month, one linked screen, and a trial of a few Pro races.
Subscription: the alert radio without limit, a few Pro races a month, the MCP, unlimited screens.
Race packs: Pro races that do not expire. A courtesy plan includes everything.

A "race" is a game session's block of up to 45 minutes with the radio on. It is charged the
first time the engineer speaks in that block, never for menus or sessions where it says nothing.
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
SUB_RACES_PER_MONTH = 3  # Pro races included in the subscription
FREE_RADIO_RACES_PER_MONTH = 5  # alert-radio races on the free plan
TRIAL_RACES = 3  # Pro races gifted to a new account
FREE_SCREENS = 1
PRO_SOURCES = ("suscripcion", "paquete", "prueba", "cortesia")
DEFAULT_USD_ARS = 1500.0

PRODUCTS = {
    "suscripcion": {"usd": 3.5, "titulo": "Piloto profesional (mensual)", "carreras": 0},
    "paquete5": {"usd": 5.0, "titulo": "5 carreras con el ingeniero Pro", "carreras": 5},
    "paquete12": {"usd": 10.0, "titulo": "12 carreras con el ingeniero Pro", "carreras": 12},
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
        await db.execute(insert(BillingAccount).values(tenant_id=tenant_id, trial_races=TRIAL_RACES)
                         .on_conflict_do_nothing())
        acc = await db.get(BillingAccount, tenant_id)
    return acc


def _comp(acc: BillingAccount, now: datetime) -> bool:
    return acc.comp and (acc.comp_until is None or acc.comp_until > now)


def _subscribed(acc: BillingAccount, now: datetime) -> bool:
    return acc.plan_until is not None and acc.plan_until > now


async def _used_this_month(db: AsyncSession, tenant_id: int, source: str, now: datetime) -> int:
    return await db.scalar(select(func.count()).select_from(RaceUsage).where(
        RaceUsage.tenant_id == tenant_id, RaceUsage.source == source, RaceUsage.created_at >= month_start(now))) or 0


async def status(db: AsyncSession, tenant_id: int) -> dict:
    """The account's plan as the app shows it, and what it can use now."""
    now = _now()
    acc = await db.get(BillingAccount, tenant_id)
    comp = acc is not None and _comp(acc, now)
    sub = acc is not None and _subscribed(acc, now)
    used = await _used_this_month(db, tenant_id, "suscripcion", now)
    radio_used = await _used_this_month(db, tenant_id, "avisos", now)
    credits = acc.race_credits if acc else 0
    trial = acc.trial_races if acc else TRIAL_RACES
    plan = "cortesia" if comp else "suscripcion" if sub else "gratis"
    limits = settings.PLAN_LIMITS
    free_radio = not (limits and not comp and not sub)  # the alert radio without a monthly cap
    return {
        "plan": plan,
        "hasta": (acc.comp_until if comp else acc.plan_until if sub else None) if acc else None,
        "renovacion": acc.mp_preapproval_status if acc else None,
        "creditos": credits,
        "prueba": trial,
        "carreras_mes": {"incluidas": SUB_RACES_PER_MONTH if sub else 0, "usadas": used},
        "avisos_mes": {"incluidas": None if free_radio else FREE_RADIO_RACES_PER_MONTH, "usadas": radio_used},
        "limites": limits,
        "puede": {
            "ingeniero_ia": not limits or comp or (sub and used < SUB_RACES_PER_MONTH) or trial > 0 or credits > 0,
            "radio": free_radio or radio_used < FREE_RADIO_RACES_PER_MONTH,
            "mcp": not limits or comp or sub,
            "pantallas": None if (not limits or comp or sub) else FREE_SCREENS,
        },
    }


async def can_mcp(db: AsyncSession, tenant_id: int) -> bool:
    return (await status(db, tenant_id))["puede"]["mcp"]


async def screen_limit(db: AsyncSession, tenant_id: int) -> int | None:
    return (await status(db, tenant_id))["puede"]["pantallas"]


async def _usage(db: AsyncSession, tenant_id: int, game_session_id: int, block: int) -> RaceUsage | None:
    return await db.scalar(select(RaceUsage).where(
        RaceUsage.tenant_id == tenant_id, RaceUsage.game_session_id == game_session_id, RaceUsage.block == block))


async def charge_race(db: AsyncSession, tenant_id: int, game_session_id: int, block: int,
                      pro: bool = True) -> str | None:
    """Use one race for this block of the session. Returns what paid for it, or None if nothing can.

    pro=True asks for a Pro (AI) race: the subscription's monthly races, then the trial, then packs.
    pro=False asks for the alert radio: free with a subscription or courtesy, otherwise one of the
    free plan's monthly races. A block already charged is not charged again, except that an
    alert-radio block becomes a Pro one when a Pro race is asked for (a pack bought mid-session).
    """
    row = await _usage(db, tenant_id, game_session_id, block)
    if row is not None and (row.source in PRO_SOURCES or not pro):
        return row.source
    now = _now()
    acc = await account(db, tenant_id)
    comp, sub = not settings.PLAN_LIMITS or _comp(acc, now), _subscribed(acc, now)
    if not pro:
        if comp or sub:
            return "incluido"  # unlimited: nothing to count
        if await _used_this_month(db, tenant_id, "avisos", now) >= FREE_RADIO_RACES_PER_MONTH:
            return None
        source = "avisos"
    elif comp:
        source = "cortesia"
    elif sub and await _used_this_month(db, tenant_id, "suscripcion", now) < SUB_RACES_PER_MONTH:
        source = "suscripcion"
    elif acc.trial_races > 0:
        source = "prueba"
    elif acc.race_credits > 0:
        source = "paquete"
    else:
        return None
    if row is None:
        db.add(RaceUsage(tenant_id=tenant_id, game_session_id=game_session_id, block=block, source=source))
    else:
        row.source = source
    if source == "paquete":
        acc.race_credits -= 1
    elif source == "prueba":
        acc.trial_races -= 1
    try:
        await db.commit()
    except IntegrityError:  # another lane charged the same block first
        await db.rollback()
        row = await _usage(db, tenant_id, game_session_id, block)
        return row.source if row else None
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
