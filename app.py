import hmac
import os
import re
import sqlite3

from flask import Flask, abort, flash, redirect, render_template, request, url_for
from werkzeug.security import generate_password_hash

from database import ROLES, close_db, create_user, init_db

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
app.config["AUTHORITY_ACCESS_CODE"] = os.environ.get(
    "AUTHORITY_ACCESS_CODE", "SKYROUTE-AUTH-2026"
)
app.teardown_appcontext(close_db)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AIRPORT_RE = re.compile(r"^[A-Za-z]{3}$")
ROLE_LABELS = {"passenger": "Passenger", "authority": "Airport Authority"}


@app.route("/")
def home():
    return render_template("home.html")


@app.route("/signup/<role>", methods=["GET", "POST"])
def signup(role):
    if role not in ROLES:
        abort(404)

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        airport_code = None

        if role == "authority":
            airport_code = request.form.get("airport_code", "").strip().upper()
            access_code = request.form.get("access_code", "")

        error = None
        if len(name) < 2:
            error = "Enter your full name."
        elif not EMAIL_RE.match(email):
            error = "Enter a valid email address."
        elif len(password) < 8:
            error = "Password must be at least 8 characters."
        elif password != confirm:
            error = "Passwords do not match."
        elif role == "authority" and not AIRPORT_RE.match(airport_code):
            error = "Enter a valid 3-letter airport code, for example LHE."
        elif role == "authority" and not hmac.compare_digest(
            access_code.encode(), app.config["AUTHORITY_ACCESS_CODE"].encode()
        ):
            error = "Invalid authority access code."

        if error is None:
            try:
                create_user(name, email, generate_password_hash(password), role, airport_code)
            except sqlite3.IntegrityError:
                error = "An account with this email already exists."
            else:
                flash("Account created. Signin comes in a later step.", "ok")
                return redirect(url_for("home"))

        flash(error, "error")

    return render_template(
        "signup.html", role=role, role_label=ROLE_LABELS[role], form=request.form
    )


if __name__ == "__main__":
    init_db()
    app.run(debug=True)