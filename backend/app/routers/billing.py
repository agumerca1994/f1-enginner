"""Plans: the player's plan and balance, checkouts with Mercado Pago, and the owner's courtesy plans.

Without Mercado Pago credentials, development uses a simulated checkout (`/api/billing/simulate`);
production answers that payments are not set up yet.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import mercadopago as mp
from app.billing import plans
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models import BillingAccount, BillingSetting, Payment, User
from app.routers.internal import require_internal_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["billing"])
GRACE = timedelta(days=3)  # a renewal a few days late keeps the plan


def _api_url() -> str:
    if settings.PUBLIC_API_URL:
        return settings.PUBLIC_API_URL.rstrip("/")
    return f"https://{settings.API_DOMAIN}" if settings.API_DOMAIN else "http://localhost:8000"


@router.get("/api/billing")
async def my_plan(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    rate = await plans.usd_ars(db)
    out = await plans.status(db, user.tenant_id)
    out["productos"] = [
        {"id": k, "titulo": p["titulo"], "usd": p["usd"], "ars": plans.ars(p["usd"], rate), "carreras": p["carreras"]}
        for k, p in plans.PRODUCTS.items()
    ]
    out["carreras_por_mes"] = plans.SUB_RACES_PER_MONTH
    out["avisos_por_mes"] = plans.FREE_RADIO_RACES_PER_MONTH
    out["prueba_inicial"] = plans.TRIAL_RACES
    out["minutos_por_carrera"] = plans.RACE_MINUTES
    out["suscripcion_pendiente"] = out["plan"] == "gratis" and await db.scalar(
        select(Payment.id).where(Payment.tenant_id == user.tenant_id, Payment.product == "suscripcion",
                                 Payment.status == "pendiente").limit(1)) is not None
    out["pagos"] = "mercadopago" if mp.configured() else ("simulado" if settings.AUTH_DEV_MODE else None)
    return out


class Checkout(BaseModel):
    producto: str = Field(pattern="^(suscripcion|paquete5|paquete12)$")


@router.post("/api/billing/checkout")
async def checkout(body: Checkout, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Start a payment: returns the URL to send the player to."""
    product = plans.PRODUCTS[body.producto]
    rate = await plans.usd_ars(db)
    amount = plans.ars(product["usd"], rate)
    ref = f"ing-{user.tenant_id}-{secrets.token_hex(6)}"
    pay = Payment(tenant_id=user.tenant_id, ref=ref, product=body.producto, amount_ars=amount, usd=product["usd"])
    db.add(pay)
    back = f"{settings.FRONTEND_URL.rstrip('/')}/planes?ref={ref}"
    notify = f"{_api_url()}/api/billing/mp/webhook"
    if mp.configured():
        try:
            if body.producto == "suscripcion":
                pay.mp_id, url = await _plan(db, amount, f"Pit en línea · {product['titulo']}")
            else:
                pay.mp_id, url = await mp.create_preference(ref=ref, title=f"Pit en línea · {product['titulo']}",
                                                            amount=amount, back_url=back, notify_url=notify)
        except mp.MercadoPagoError as e:
            logger.warning("mercado pago checkout failed", extra={"error": str(e), "tenant_id": user.tenant_id})
            raise HTTPException(502, "payment_provider_error")
    elif settings.AUTH_DEV_MODE:
        url = f"{settings.FRONTEND_URL.rstrip('/')}/planes?ref={ref}&simulado=1"
    else:
        raise HTTPException(503, "payments_not_configured")
    await db.commit()
    return {"url": url, "ref": ref, "ars": amount}


async def _plan(db: AsyncSession, amount: int, title: str) -> tuple[str, str]:
    """The subscription plan at this price, created once per price (the price follows the dollar)."""
    key = f"mp_plan_{amount}"
    row = await db.get(BillingSetting, key)
    if row is not None:
        plan_id, url = row.value.split("|", 1)
        return plan_id, url
    plan_id, url = await mp.create_plan(title=title, amount=amount,
                                        back_url=f"{settings.FRONTEND_URL.rstrip('/')}/planes?suscripcion=1")
    db.add(BillingSetting(key=key, value=f"{plan_id}|{url}"[:200]))
    return plan_id, url


async def _our_plans(db: AsyncSession) -> set[str]:
    rows = (await db.scalars(select(BillingSetting).where(BillingSetting.key.like("mp_plan_%")))).all()
    return {r.value.split("|", 1)[0] for r in rows}


def _extend(acc: BillingAccount, next_charge: datetime | None) -> None:
    until = (next_charge or datetime.now(timezone.utc) + timedelta(days=31)) + GRACE
    if acc.plan_until is None or until > acc.plan_until:
        acc.plan_until = until


async def _apply(db: AsyncSession, pay: Payment, *, next_charge: datetime | None = None) -> None:
    """Credit an approved payment once."""
    if pay.status == "aprobado" and pay.product != "suscripcion":
        return
    acc = await plans.account(db, pay.tenant_id)
    if pay.product == "suscripcion":
        acc.mp_preapproval_status = "authorized"
        _extend(acc, next_charge)
    else:
        await plans.add_credits(db, pay.tenant_id, plans.PRODUCTS[pay.product]["carreras"])
    pay.status = "aprobado"
    pay.approved_at = pay.approved_at or datetime.now(timezone.utc)


def _parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _sync_payment(db: AsyncSession, payment_id: str) -> None:
    p = await mp.get_payment(payment_id)
    pay = await db.scalar(select(Payment).where(Payment.ref == p.get("external_reference")))
    if pay is None or pay.product == "suscripcion":
        return
    if p.get("status") == "approved" and p.get("currency_id") == "ARS" and float(p.get("transaction_amount") or 0) + 0.01 >= float(pay.amount_ars):
        pay.mp_id = str(p.get("id"))
        await _apply(db, pay)
    elif p.get("status") in ("rejected", "cancelled", "refunded", "charged_back") and pay.status == "pendiente":
        pay.status = "rechazado"


async def _sync_preapproval(db: AsyncSession, preapproval_id: str) -> None:
    """A subscription changed (or charged its month): read it back and update the account bound to it."""
    pre = await mp.get_preapproval(preapproval_id)
    acc = await db.scalar(select(BillingAccount).where(BillingAccount.mp_preapproval_id == str(pre.get("id"))))
    if acc is None:
        return  # not bound yet: the player's return to /planes binds it
    acc.mp_preapproval_status = pre.get("status")
    if pre.get("status") == "authorized":
        _extend(acc, _parse_date(pre.get("next_payment_date")))
    # cancelled or paused: the plan simply runs until plan_until, already paid for.


@router.post("/api/billing/mp/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Mercado Pago's notifications. The body only says what changed; the truth is read back from Mercado Pago."""
    if not mp.configured():
        return {"ok": True}
    try:
        body = await request.json()
    except Exception:
        body = {}
    kind = body.get("type") or body.get("topic") or request.query_params.get("type") or request.query_params.get("topic")
    data_id = str((body.get("data") or {}).get("id") or request.query_params.get("data.id") or request.query_params.get("id") or "")
    if not data_id.isalnum():
        return {"ok": True}
    try:
        if kind == "payment":
            await _sync_payment(db, data_id)
        elif kind == "subscription_preapproval":
            await _sync_preapproval(db, data_id)
        elif kind == "subscription_authorized_payment":
            auth = await mp.get_authorized_payment(data_id)
            if auth.get("preapproval_id"):
                await _sync_preapproval(db, str(auth["preapproval_id"]))
        await db.commit()
    except mp.MercadoPagoError as e:
        logger.warning("mercado pago webhook could not be read back", extra={"error": str(e), "type": kind})
    return {"ok": True}


@router.post("/api/billing/sync")
async def sync(ref: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Back from the checkout: check the payment now instead of waiting for the notification."""
    pay = await db.scalar(select(Payment).where(Payment.ref == ref, Payment.tenant_id == user.tenant_id))
    if pay is None:
        raise HTTPException(404, "Payment not found")
    if mp.configured() and pay.status == "pendiente":
        try:
            if pay.product == "suscripcion":
                pass  # bound and confirmed by /api/billing/subscription/confirm
            else:
                found = await _search_payment(ref)
                if found:
                    await _sync_payment(db, found)
            await db.commit()
        except mp.MercadoPagoError as e:
            logger.warning("mercado pago sync failed", extra={"error": str(e)})
    return {"estado": pay.status, "producto": pay.product}


async def _search_payment(ref: str) -> str | None:
    body = await mp._call("GET", f"/v1/payments/search?external_reference={ref}&sort=date_created&criteria=desc")
    results = body.get("results") or []
    return str(results[0]["id"]) if results else None


@router.post("/api/billing/subscription/confirm")
async def confirm_subscription(preapproval_id: str | None = None, user: User = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)) -> dict:
    """Back from subscribing: bind the new subscription to this account, once it is ours and authorized.

    Mercado Pago usually adds preapproval_id to the way back. Without it, the newest authorized
    subscription to our plans that no account holds yet, made after this player's checkout, is taken.
    """
    if not mp.configured() or (preapproval_id is not None and not preapproval_id.isalnum()):
        raise HTTPException(404, "Not found")
    pay = await db.scalar(select(Payment).where(Payment.tenant_id == user.tenant_id, Payment.product == "suscripcion",
                                                Payment.status == "pendiente").order_by(Payment.id.desc()))
    ours = await _our_plans(db)
    try:
        if preapproval_id:
            pre = await mp.get_preapproval(preapproval_id)
        else:
            pre = await _find_new_subscription(db, ours, pay)
            if pre is None:
                return {"estado": "pendiente"}
    except mp.MercadoPagoError as e:
        logger.warning("mercado pago preapproval read failed", extra={"error": str(e)})
        raise HTTPException(502, "payment_provider_error")
    if str(pre.get("preapproval_plan_id")) not in ours:
        raise HTTPException(404, "Not our subscription")
    taken = await db.scalar(select(BillingAccount).where(BillingAccount.mp_preapproval_id == str(pre.get("id")),
                                                         BillingAccount.tenant_id != user.tenant_id))
    if taken is not None:
        raise HTTPException(409, "Subscription already bound")
    acc = await plans.account(db, user.tenant_id)
    acc.mp_preapproval_id, acc.mp_preapproval_status = str(pre.get("id")), pre.get("status")
    amount = float((pre.get("auto_recurring") or {}).get("transaction_amount") or 0)
    if pre.get("status") == "authorized" and pay is not None and amount + 0.01 >= float(pay.amount_ars):
        pay.mp_id = str(pre.get("id"))
        await _apply(db, pay, next_charge=_parse_date(pre.get("next_payment_date")))
    elif pre.get("status") == "authorized":
        _extend(acc, _parse_date(pre.get("next_payment_date")))
    await db.commit()
    return {"estado": "aprobado" if pre.get("status") == "authorized" else "pendiente"}


async def _find_new_subscription(db: AsyncSession, ours: set[str], pay: Payment | None) -> dict | None:
    if pay is None:
        return None
    since = pay.created_at - timedelta(minutes=1)
    for plan_id in ours:
        for pre in await mp.search_preapprovals(plan_id):
            created = _parse_date(pre.get("date_created"))
            if pre.get("status") != "authorized" or (created and created < since):
                continue
            if await db.scalar(select(BillingAccount).where(BillingAccount.mp_preapproval_id == str(pre.get("id")))):
                continue
            return pre
    return None


@router.post("/api/billing/simulate")
async def simulate(ref: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Development only, without Mercado Pago: approve a checkout as if it had been paid."""
    if mp.configured() or not settings.AUTH_DEV_MODE:
        raise HTTPException(404, "Not found")
    pay = await db.scalar(select(Payment).where(Payment.ref == ref, Payment.tenant_id == user.tenant_id))
    if pay is None:
        raise HTTPException(404, "Payment not found")
    await _apply(db, pay)
    await db.commit()
    return {"estado": pay.status}


@router.post("/api/billing/cancel")
async def cancel(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Stop the renewal. The month already paid stays."""
    acc = await db.get(BillingAccount, user.tenant_id)
    if acc is None or not acc.mp_preapproval_id:
        raise HTTPException(404, "No subscription")
    if mp.configured():
        try:
            await mp.cancel_preapproval(acc.mp_preapproval_id)
        except mp.MercadoPagoError as e:
            logger.warning("mercado pago cancel failed", extra={"error": str(e)})
            raise HTTPException(502, "payment_provider_error")
    acc.mp_preapproval_status = "cancelled"
    await db.commit()
    return {"ok": True}


# --- the owner: courtesy plans, gifted races, the reference dollar -------------------

class Grant(BaseModel):
    email: str
    cortesia: bool = False
    dias: int | None = Field(None, ge=1, le=3650)  # empty = no end
    carreras: int = Field(0, ge=0, le=1000)
    nota: str | None = Field(None, max_length=200)
    quitar: bool = False  # take the courtesy plan away


@router.post("/internal/billing/grant", dependencies=[Depends(require_internal_key)])
async def grant(body: Grant, db: AsyncSession = Depends(get_db)) -> dict:
    user = await db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user is None:
        raise HTTPException(404, "No account with that email")
    if body.quitar:
        acc = await plans.account(db, user.tenant_id)
        acc.comp, acc.comp_until = False, None
    elif body.cortesia:
        await plans.grant_comp(db, user.tenant_id, body.dias, body.nota)
    if body.carreras:
        await plans.add_credits(db, user.tenant_id, body.carreras)
    await db.commit()
    return {"email": user.email, **(await plans.status(db, user.tenant_id))}


class Rate(BaseModel):
    usd_ars: float = Field(gt=0, lt=1_000_000)


@router.post("/internal/billing/rate", dependencies=[Depends(require_internal_key)])
async def set_rate(body: Rate, db: AsyncSession = Depends(get_db)) -> dict:
    await plans.set_usd_ars(db, body.usd_ars)
    await db.commit()
    return {"usd_ars": body.usd_ars, "precios": {k: plans.ars(p["usd"], body.usd_ars) for k, p in plans.PRODUCTS.items()}}


@router.get("/internal/billing/accounts", dependencies=[Depends(require_internal_key)])
async def accounts(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(BillingAccount, User).join(User, User.tenant_id == BillingAccount.tenant_id))).all()
    out = []
    for acc, u in rows:
        out.append({"email": u.email, **(await plans.status(db, acc.tenant_id)), "nota": acc.comp_note})
    return {"usd_ars": await plans.usd_ars(db), "cuentas": out}
