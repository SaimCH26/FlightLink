import hmac
import os
import re
import sqlite3
from functools import wraps

from flask import (Flask, abort, flash, redirect, render_template, request,
                   session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from database import ROLES, close_db, create_user, get_user_by_email, init_db

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
app.config["AUTHORITY_ACCESS_CODE"] = os.environ.get(
    "AUTHORITY_ACCESS_CODE", "SKYROUTE-AUTH-2026"
)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.teardown_appcontext(close_db)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AIRPORT_RE = re.compile(r"^[A-Za-z]{3}$")
ROLE_LABELS = {"passenger": "Passenger", "authority": "Airport Authority"}
ERROR_MESSAGES = {
    403: "You don't have access to this page.",
    404: "This page doesn't exist.",
}


# ---------- access control ----------
def login_required(role=None):
    """Protect a page. Pass a role to also require that account type."""
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if "user_id" not in session:
                flash("Please sign in first.", "error")
                return redirect(url_for("signin"))
            if role and session.get("role") != role:
                abort(403)
            return view(*args, **kwargs)
        return wrapped
    return decorator


@app.errorhandler(403)
@app.errorhandler(404)
def error_page(error):
    return render_template(
        "error.html", code=error.code, message=ERROR_MESSAGES[error.code]
    ), error.code


# ---------- public pages ----------
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
                flash("Account created. Please sign in.", "ok")
                return redirect(url_for("signin"))

        flash(error, "error")

    return render_template(
        "signup.html", role=role, role_label=ROLE_LABELS[role], form=request.form
    )


@app.route("/signin", methods=["GET", "POST"])
def signin():
    if "user_id" in session:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")

        user = get_user_by_email(email)
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["name"] = user["name"]
            session["role"] = user["role"]
            session["airport"] = user["airport_code"]
            return redirect(url_for("dashboard"))

        flash("Invalid email or password.", "error")

    return render_template("signin.html", form=request.form)


@app.route("/signout")
def signout():
    session.clear()
    flash("You have been signed out.", "ok")
    return redirect(url_for("signin"))


# ---------- protected pages ----------
@app.route("/dashboard")
@login_required()
def dashboard():
    if session["role"] == "authority":
        return redirect(url_for("authority_dashboard"))
    return redirect(url_for("passenger_dashboard"))


@app.route("/passenger")
@login_required("passenger")
def passenger_dashboard():
    return render_template("passenger.html")


@app.route("/authority")
@login_required("authority")
def authority_dashboard():
    return render_template("authority.html")


if __name__ == "__main__":
    init_db()
    app.run(debug=True)