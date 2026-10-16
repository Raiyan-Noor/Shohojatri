"""End-to-end smoke test of a deployment (docs/DEPLOY.md).

    python scripts/smoke_test.py https://shohojatri.vercel.app
    python scripts/smoke_test.py https://shohojatri-api.onrender.com
    python scripts/smoke_test.py http://localhost:8011 --keep

Works against the web app (through its /api/v1 rewrite) or the API directly. Standard library
only. Needs the demo data (SEED_DEMO=true): it logs in as parent@demo.bd, runs a demo screening
for a seeded child (questionnaire + replayed camera tasks), finalizes it, fetches the parent and
doctor reports, creates a share link and opens it without logging in. Unless --keep is given,
it then revokes the link and deletes the screening, so the demo account looks as before.

Exit code 0 when every step passed.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from typing import Any

PARENT = "parent@demo.bd"
PASSWORD = "demo1234"  # Seeded demo account (CLAUDE.md §10), not a secret.
CONSENT_VERSION = "screening-consent-1"  # apps/web/src/lib/screening/rules.ts
DEMO_TASKS = ("calibration", "rtn", "joint_attention", "imitation", "gaze_preference", "free_play")


class StepFailed(Exception):
    pass


class Client:
    def __init__(self, base_url: str, *, with_cookies: bool = True) -> None:
        self.base = base_url.rstrip("/") + "/api/v1"
        handlers = [urllib.request.HTTPCookieProcessor(CookieJar())] if with_cookies else []
        self.opener = urllib.request.build_opener(*handlers)

    def call(self, method: str, path: str, body: Any = None, expect: int = 200) -> Any:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(request, timeout=90) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        except urllib.error.URLError as error:
            raise StepFailed(f"{method} {path}: {error.reason}") from error
        if status != expect:
            raise StepFailed(f"{method} {path}: HTTP {status} (expected {expect}): {raw[:300]!r}")
        return json.loads(raw) if raw else None


def step(name: str) -> None:
    print(f"  • {name} …", end=" ", flush=True)


def ok(detail: str = "") -> None:
    print(f"ok{f' ({detail})' if detail else ''}")


def pick_child(api: Client) -> dict[str, Any]:
    """A seeded child with no unfinished screening (only one may be open at a time)."""
    for child in api.call("GET", "/children"):
        screenings = api.call("GET", f"/children/{child['id']}/screenings")
        if not any(s["status"] == "in_progress" for s in screenings):
            return child
    raise StepFailed("every child of the demo parent has an unfinished screening")


def answer_all(api: Client, screening: dict[str, Any]) -> None:
    for item in screening["items"]:
        options = item["options"]
        option = "not_sure" if "not_sure" in options else options[0]
        api.call("PUT", f"/screenings/{screening['id']}/answers/{item['id']}", {"option": option})


def run(base_url: str, keep: bool) -> None:
    api = Client(base_url)
    started = time.monotonic()

    step("health")
    health = api.call("GET", "/health")
    if health != {"status": "ok", "database": "ok"}:
        raise StepFailed(f"unexpected health response: {health}")
    ok()

    step(f"log in as {PARENT}")
    me = api.call("POST", "/auth/login", {"identifier": PARENT, "password": PASSWORD})
    ok(me["name"])

    step("create a demo screening")
    child = pick_child(api)
    screening = api.call(
        "POST",
        "/screenings",
        {"child_id": child["id"], "locale": "en", "informant": "mother"},
        expect=201,
    )
    sid = screening["id"]
    try:
        api.call("POST", f"/screenings/{sid}/consent", {"version": CONSENT_VERSION})
        answer_all(api, screening)
        api.call("POST", f"/screenings/{sid}/questionnaire", {"note": None})
        for task in DEMO_TASKS:
            demo = api.call("GET", f"/demo/screening-tasks/{task}")
            api.call("POST", f"/screenings/{sid}/tasks/{demo['task']}", demo["upload"])
        ok(f"screening {sid} for child {child['id']}, {len(DEMO_TASKS)} tasks")

        step("finalize")
        final = api.call("POST", f"/screenings/{sid}/finalize")
        result = final["result"]
        if final["status"] != "finalized" or result is None:
            raise StepFailed(f"screening {sid} not finalized: {final['status']}")
        ok(f"developmental concern score {result['score']}%, class {result['risk_class']}")

        step("parent and doctor reports")
        for audience in ("parent", "clinician"):
            report = api.call("GET", f"/screenings/{sid}/report?audience={audience}")
            if not report:
                raise StepFailed(f"empty {audience} report")
        ok()

        step("share link")
        share = api.call("POST", f"/screenings/{sid}/shares", {"expires_in_days": 1}, expect=201)
        config = api.call("GET", "/client-config")
        anonymous = Client(base_url, with_cookies=False)
        shared = anonymous.call("GET", f"/share/{share['token']}")
        if not shared.get("report"):
            raise StepFailed("shared report has no content")
        web = config["public_web_url"] or base_url.rstrip("/")
        ok(f"{web}/en/share/<token> opens without login")
    finally:
        if not keep:
            step("clean up")
            for existing in api.call("GET", f"/screenings/{sid}/shares"):
                if existing["status"] == "active":
                    api.call("DELETE", f"/shares/{existing['id']}")
            api.call("DELETE", f"/screenings/{sid}")
            ok(f"screening {sid} deleted")

    print(f"\nAll steps passed in {time.monotonic() - started:.1f} s.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("base_url", help="web app or API origin, e.g. https://example.vercel.app")
    parser.add_argument("--keep", action="store_true", help="keep the screening and share link")
    args = parser.parse_args()
    print(f"Smoke test against {args.base_url}")
    try:
        run(args.base_url, args.keep)
    except StepFailed as error:
        print(f"FAILED\n\n{error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
