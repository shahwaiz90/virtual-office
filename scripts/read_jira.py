#!/usr/bin/env python3
"""
Script to read Jira tickets from dm.stc.com.sa into Markdown.

Usage:
    export JIRA_PATH="your_personal_access_token"
    python3 android-ai-playbook/scripts/read_jira.py <Ticket Key or URL> [-o output.md]

Examples:
    python3 android-ai-playbook/scripts/read_jira.py DXDT-25243
    python3 android-ai-playbook/scripts/read_jira.py "https://dm.stc.com.sa/browse/DXDT-25243" -o .agents/scratch/DXDT-25243.md
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.error

JIRA_BASE = "https://dm.stc.com.sa"


def load_env_local():
    """Load variables from .env.local or .env in the project workspace or cwd if present."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    search_dirs = [
        os.getcwd(),
        current_dir,
        os.path.abspath(os.path.join(current_dir, "..")),
        os.path.abspath(os.path.join(current_dir, "..", "..")),
    ]
    seen = set()
    for directory in search_dirs:
        if directory in seen:
            continue
        seen.add(directory)
        for filename in [".env.local", ".env"]:
            env_file = os.path.join(directory, filename)
            if os.path.isfile(env_file):
                try:
                    with open(env_file, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                k = k.strip()
                                v = v.strip().strip("'\"")
                                if k not in os.environ:
                                    os.environ[k] = v
                except Exception:
                    pass


def load_from_shell_profiles():
    """Fallback: inspect ~/.zshrc or ~/.zshenv for export JIRA_PATH="..."""
    home = os.path.expanduser("~")
    for fname in [".zshrc", ".zshenv", ".zprofile"]:
        fpath = os.path.join(home, fname)
        if os.path.isfile(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("export ") and "JIRA_PATH" in line:
                            parts = line[len("export "):].split("=", 1)
                            if len(parts) == 2:
                                k = parts[0].strip()
                                v = parts[1].strip().strip("'\"")
                                if k not in os.environ:
                                    os.environ[k] = v
            except Exception:
                pass


def setup_help(product, env_var, flag, example, where):
    """What to do when the token is missing: every way the script can find it."""
    return "\n".join([
        f"ERROR: {product} Personal Access Token not found ({env_var} is not set).",
        "Set it one of these ways, then run the command again:",
        f"  1. Project file: add {env_var}=\"<token>\" to .env.local in the project root (gitignored; see .env.example).",
        f"  2. Shell: export {env_var}=\"<token>\"  (add the line to ~/.zshrc to keep it).",
        f"  3. One run only: python3 scripts/{example} {flag} <token>",
        f"Create a token {where[0].lower() + where[1:]}",
    ])


def get_token(cli_token=None):
    load_env_local()
    load_from_shell_profiles()
    if cli_token:
        return cli_token
    token = os.getenv("JIRA_PATH")
    if not token:
        print(setup_help("Jira", "JIRA_PATH", "--token", "read_jira.py DXDT-25243",
                         "In Jira: your avatar > Profile > Personal Access Tokens > Create token."), file=sys.stderr)
        sys.exit(1)
    return token


def parse_issue_key(target):
    target = target.strip()
    m = re.search(r"([A-Z0-9]+-\d+)", target, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return None


def fetch_jira_issue(issue_key, token):
    url = f"{JIRA_BASE}/rest/api/2/issue/{issue_key}?expand=names,renderedFields,schema"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "mystc-agent/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read().decode("utf-8")
            if "text/html" in content_type or raw.strip().startswith("<!DOCTYPE") or raw.strip().startswith("<html"):
                print(f"ERROR: Jira returned HTML SSO login instead of JSON for {issue_key}.", file=sys.stderr)
                print("Please verify your JIRA_PATH token is valid.", file=sys.stderr)
                sys.exit(1)
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP Error {e.code} fetching Jira issue {issue_key}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Failed to fetch Jira issue {issue_key}: {e}", file=sys.stderr)
        sys.exit(1)


def format_jira_issue(data):
    key = data.get("key", "")
    fields = data.get("fields", {})
    names = data.get("names", {})
    summary = fields.get("summary", "")
    issue_type = fields.get("issuetype", {}).get("name", "Unknown")
    status = fields.get("status", {}).get("name", "Unknown")
    priority = fields.get("priority", {}).get("name", "Unknown")
    assignee = fields.get("assignee")
    assignee_name = assignee.get("displayName", "Unassigned") if assignee else "Unassigned"
    reporter = fields.get("reporter")
    reporter_name = reporter.get("displayName", "Unknown") if reporter else "Unknown"
    description = fields.get("description") or "No description provided."

    components = [c.get("name") for c in fields.get("components", []) if c.get("name")]
    labels = fields.get("labels", [])
    fix_versions = [v.get("name") for v in fields.get("fixVersions", []) if v.get("name")]

    jira_url = f"{JIRA_BASE}/browse/{key}"

    # Search custom fields for Acceptance Criteria, Environment, etc.
    custom_details = []
    for field_key, field_val in fields.items():
        if field_key.startswith("customfield_") and field_val:
            display_name = names.get(field_key, "").strip()
            if any(term in display_name.lower() for term in ["acceptance criteria", "ac", "reproduce", "steps"]):
                if isinstance(field_val, str) and field_val.strip():
                    custom_details.append((display_name, field_val.strip()))

    md = f"""# [{key}] {summary}

- **Key**: `{key}`
- **Type**: {issue_type}
- **Status**: {status}
- **Priority**: {priority}
- **Assignee**: {assignee_name}
- **Reporter**: {reporter_name}
- **Jira URL**: [{key}]({jira_url})
"""
    if components:
        md += f"- **Components**: {', '.join(components)}\n"
    if labels:
        md += f"- **Labels**: {', '.join(labels)}\n"
    if fix_versions:
        md += f"- **Fix Versions**: {', '.join(fix_versions)}\n"

    md += f"\n---\n\n## Description\n\n{description}\n"

    if custom_details:
        for title, val in custom_details:
            md += f"\n---\n\n## {title}\n\n{val}\n"

    # Add comments if any
    comments = fields.get("comment", {}).get("comments", [])
    if comments:
        md += "\n---\n\n## Recent Comments\n\n"
        for c in comments[-5:]:
            author = c.get("author", {}).get("displayName", "Unknown")
            created = c.get("created", "")
            body = c.get("body", "")
            md += f"### {author} ({created})\n{body}\n\n"

    return md


def main():
    parser = argparse.ArgumentParser(description="Fetch and format Jira tickets into Markdown.")
    parser.add_argument("target", help="Jira Ticket Key or Browse URL (e.g. DXDT-25243)")
    parser.add_argument("-t", "--token", dest="token", help="Personal Access Token (overrides JIRA_PATH)")
    parser.add_argument("-o", "--output", dest="output", help="Output markdown file path (defaults to stdout)")

    args = parser.parse_args()
    token = get_token(args.token)
    issue_key = parse_issue_key(args.target)

    if not issue_key:
        print(f"ERROR: Could not extract Jira issue key from '{args.target}'", file=sys.stderr)
        sys.exit(1)

    print(f"[Fetching Jira Issue: {issue_key}]", file=sys.stderr)
    data = fetch_jira_issue(issue_key, token)
    result_md = format_jira_issue(data)

    if args.output:
        out_path = os.path.abspath(args.output)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(result_md)
        print(f"SUCCESS: Saved markdown to {out_path}", file=sys.stderr)
    else:
        print(result_md)


if __name__ == "__main__":
    main()
