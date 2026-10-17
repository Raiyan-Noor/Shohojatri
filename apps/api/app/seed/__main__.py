"""`python -m app.seed`: loads demo data (CLAUDE.md §10). Each phase adds its seed step here.

Idempotent: safe to run on every start (docker-compose does).
"""

import logging

from app.core.db import SessionLocal
from app.seed.children import seed_children
from app.seed.companion import seed_companion
from app.seed.users import seed_users

logger = logging.getLogger("app.seed")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with SessionLocal() as db:
        logger.info("Demo accounts created: %d", seed_users(db))
        logger.info("Demo children created: %d", seed_children(db))
        logger.info("Demo timeline entries created: %d", seed_companion(db))


if __name__ == "__main__":
    main()
