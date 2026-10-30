import sqlite3
from pathlib import Path

from flask import g

DB_PATH = Path(__file__).parent / "skyroute.db"

ROLES = ("passenger", "authority")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('passenger', 'authority')),
    airport_code  TEXT,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def get_db():
    """One connection per request, reused until the request ends."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create the tables if they don't exist yet."""
    with sqlite3.connect(DB_PATH) as db:
        db.executescript(SCHEMA)


def create_user(name, email, password_hash, role, airport_code=None):
    db = get_db()
    db.execute(
        "INSERT INTO users (name, email, password_hash, role, airport_code) "
        "VALUES (?, ?, ?, ?, ?)",
        (name, email.lower(), password_hash, role, airport_code),
    )
    db.commit()


def get_user_by_email(email):
    return get_db().execute(
        "SELECT * FROM users WHERE email = ?", (email.lower(),)
    ).fetchone()