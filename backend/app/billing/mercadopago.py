"""Mercado Pago over plain HTTPS: Checkout Pro for race packs, a subscription plan for the subscription.

Nothing in a notification is trusted: every change is read back from Mercado Pago with our
access token, and a payment counts only if its external_reference and amount match ours.
"""

from __future__ import annotations

import httpx

from app.core.config import settings

API = "https://api.mercadopago.com"


class MercadoPagoError(Exception):
    pass


def configured() -> bool:
    return bool(settings.MP_ACCESS_TOKEN)


async def _call(method: str, path: str, json: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {settings.MP_ACCESS_TOKEN}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.request(method, f"{API}{path}", json=json, headers=headers)
    if r.status_code >= 400:
        raise MercadoPagoError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
    return r.json()


def _checkout_url(body: dict) -> str:
    if settings.MP_SANDBOX and body.get("sandbox_init_point"):
        return body["sandbox_init_point"]
    return body["init_point"]


async def create_preference(*, ref: str, title: str, amount: float, back_url: str, notify_url: str) -> tuple[str, str]:
    """A one-off checkout (race packs). Returns (preference id, URL to send the player to)."""
    body = await _call("POST", "/checkout/preferences", {
        "items": [{"id": ref, "title": title, "quantity": 1, "currency_id": "ARS", "unit_price": amount}],
        "external_reference": ref,
        "back_urls": {"success": back_url, "pending": back_url, "failure": back_url},
        "auto_return": "approved",
        "notification_url": notify_url,
    })
    return str(body["id"]), _checkout_url(body)


async def get_payment(payment_id: str) -> dict:
    return await _call("GET", f"/v1/payments/{payment_id}")


async def create_plan(*, title: str, amount: float, back_url: str) -> tuple[str, str]:
    """A monthly subscription plan. Returns (plan id, URL where a player subscribes to it).

    The player subscribes with whatever Mercado Pago account they choose, so no payer email is
    sent; Mercado Pago adds the new subscription's preapproval_id to back_url on the way back.
    """
    body = await _call("POST", "/preapproval_plan", {
        "reason": title,
        "auto_recurring": {"frequency": 1, "frequency_type": "months", "transaction_amount": amount,
                           "currency_id": "ARS"},
        "back_url": back_url,
    })
    return str(body["id"]), body["init_point"]


async def search_preapprovals(plan_id: str) -> list[dict]:
    """The latest subscriptions to one of our plans, newest first."""
    body = await _call("GET", f"/preapproval/search?preapproval_plan_id={plan_id}&sort=date_created:desc&limit=20")
    return body.get("results") or []


async def get_preapproval(preapproval_id: str) -> dict:
    return await _call("GET", f"/preapproval/{preapproval_id}")


async def get_authorized_payment(payment_id: str) -> dict:
    return await _call("GET", f"/authorized_payments/{payment_id}")


async def cancel_preapproval(preapproval_id: str) -> dict:
    return await _call("PUT", f"/preapproval/{preapproval_id}", {"status": "cancelled"})
