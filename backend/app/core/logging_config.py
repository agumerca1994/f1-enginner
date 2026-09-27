"""JSON logs to stdout, plus WARNING+ copied to the app_logs table for the logs MCP.

Ported from registrapp (backend/app/core/logging_config.py).
"""

import asyncio
import logging
import traceback as tb_module
from typing import Any

_log_queue: asyncio.Queue | None = None
_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime"}


def _get_queue() -> asyncio.Queue:
    global _log_queue
    if _log_queue is None:
        _log_queue = asyncio.Queue(maxsize=2000)
    return _log_queue


class DBLogHandler(logging.Handler):
    """Puts WARNING+ records on a queue; `log_queue_consumer` writes them to the database."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            extra = {k: v for k, v in vars(record).items() if k not in _RESERVED and not k.startswith("_")}
            entry: dict[str, Any] = {
                "level": record.levelname,
                "logger_name": record.name,
                "message": self.format(record),
                "module": record.module,
                "traceback": None,
                "user_id": extra.pop("user_id", None),
                "tenant_id": extra.pop("tenant_id", None),
                "extra": {k: _jsonable(v) for k, v in extra.items()},
            }
            if record.exc_info and record.exc_info[0] is not None:
                entry["traceback"] = "".join(tb_module.format_exception(*record.exc_info))
            try:
                _get_queue().put_nowait(entry)
            except asyncio.QueueFull:
                pass
        except Exception:
            self.handleError(record)


def _jsonable(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


async def log_queue_consumer() -> None:
    """Background task started in the app lifespan that drains the queue into app_logs."""
    from app.core.database import AsyncSessionLocal
    from app.models import AppLog

    queue = _get_queue()
    while True:
        entry = await queue.get()
        try:
            async with AsyncSessionLocal() as db:
                db.add(AppLog(**entry))
                await db.commit()
        except Exception:
            pass
        finally:
            queue.task_done()


def setup_logging() -> None:
    try:
        from pythonjsonlogger import jsonlogger

        fmt: logging.Formatter = jsonlogger.JsonFormatter("%(asctime)s %(name)s %(levelname)s %(message)s")
    except ImportError:
        fmt = logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not any(type(h) is logging.StreamHandler for h in root.handlers):
        stdout = logging.StreamHandler()
        stdout.setFormatter(fmt)
        root.addHandler(stdout)
    if not any(isinstance(h, DBLogHandler) for h in root.handlers):
        db_handler = DBLogHandler()
        db_handler.setLevel(logging.WARNING)
        db_handler.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(db_handler)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
