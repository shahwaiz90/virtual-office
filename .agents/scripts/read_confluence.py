#!/usr/bin/env python3
"""
Script to read Confluence wiki specifications from dm.stc.com.sa/wiki into Markdown.

Usage:
    export CONFLUENCE_PATH="your_personal_access_token"
    python3 android-ai-playbook/scripts/read_confluence.py <URL or Page ID> [-o output.md]

Examples:
    python3 android-ai-playbook/scripts/read_confluence.py "https://dm.stc.com.sa/wiki/pages/viewpage.action?pageId=421200037"
    python3 android-ai-playbook/scripts/read_confluence.py 421200037 -o .agents/scratch/spec.md
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.error
from html.parser import HTMLParser
from urllib.parse import urlparse, parse_qs

CONFLUENCE_BASE = "https://dm.stc.com.sa/wiki"


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
    """Fallback: inspect ~/.zshrc or ~/.zshenv for export CONFLUENCE_PATH="..."""
    home = os.path.expanduser("~")
    for fname in [".zshrc", ".zshenv", ".zprofile"]:
        fpath = os.path.join(home, fname)
        if os.path.isfile(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("export ") and ("CONFLUENCE_PATH" in line or "CONFLUENCE_PAT" in line):
                            parts = line[len("export "):].split("=", 1)
                            if len(parts) == 2:
                                k = parts[0].strip()
                                v = parts[1].strip().strip("'\"")
                                if k not in os.environ:
                                    os.environ[k] = v
            except Exception:
                pass


def get_token(cli_token=None):
    load_env_local()
    load_from_shell_profiles()
    if cli_token:
        return cli_token
    token = (
        os.getenv("CONFLUENCE_PATH")
        or os.getenv("CONFLUENCE_PAT")
        or os.getenv("ATLASSIAN_PAT")
    )
    if not token:
        print("ERROR: Confluence Personal Access Token not found.", file=sys.stderr)
        print("Please export CONFLUENCE_PATH in ~/.zshrc or provide --pat <token>.", file=sys.stderr)
        sys.exit(1)
    return token


def convert_wiki_markup_to_markdown(text):
    # Code blocks
    def replace_code(m):
        header = m.group(1) or ""
        lang_match = re.search(r"language=([a-zA-Z0-9_-]+)", header)
        lang = lang_match.group(1) if lang_match else ""
        return f"\n```{lang}\n{m.group(2).strip()}\n```\n"
    text = re.sub(r"\{code(?::([^}]*))?\}(.*?)\{code\}", replace_code, text, flags=re.DOTALL)

    # Note / Info / Tip blocks
    def replace_note(m):
        macro_type = m.group(1).upper()
        title = m.group(2) or ""
        body = m.group(3).strip()
        lines = [f"> [!{macro_type}]"]
        if title:
            lines.append(f"> **{title}**")
        for line in body.splitlines():
            lines.append(f"> {line}")
        return "\n" + "\n".join(lines) + "\n"
    text = re.sub(r"\{(note|info|tip|warning)(?::(?:title=)?([^}]*))?\}(.*?)\{\1\}", replace_note, text, flags=re.DOTALL)

    # Numbered lists (before headings)
    def replace_num(m):
        indent = "  " * (len(m.group(1)) - 1)
        return f"{indent}1. {m.group(2)}"
    text = re.sub(r"(?m)^(#+)\s+(.+)$", replace_num, text)

    # Headings
    text = re.sub(r"(?m)^h([1-6])\.\s*(.+)$", lambda m: f"{chr(35) * int(m.group(1))} {m.group(2)}", text)

    # Bullet lists
    def replace_bullet(m):
        indent = "  " * (len(m.group(1)) - 1)
        return f"{indent}- {m.group(2)}"
    text = re.sub(r"(?m)^(\*+)\s+(.+)$", replace_bullet, text)

    # Inline code
    text = re.sub(r"\{\{([^\n{}]+)\}\}", r"`\1`", text)

    # Bold: *text* -> **text**
    text = re.sub(r"(?<!\*)\*(\S[^*\n]*?\S|\S)\*(?!\*)", r"**\1**", text)
    return text


class ConfluenceStorageToMarkdown(HTMLParser):
    def __init__(self):
        super().__init__()
        self.output = []
        self.list_stack = []
        self.in_code = False
        self.code_lang = ""
        self.code_text = []
        self.in_table = False
        self.table_rows = []
        self.current_row = []
        self.current_cell = []
        self.in_link = False
        self.link_href = ""
        self.link_text = []
        self.current_macro = ""
        self.in_plain_text = False
        self.plain_text_body = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        tag_lower = tag.lower()

        if tag_lower in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            level = int(tag_lower[1])
            self.output.append(f"\n\n{'#' * level} ")
        elif tag_lower == "p":
            self.output.append("\n\n")
        elif tag_lower == "br":
            self.output.append("\n")
        elif tag_lower == "ul":
            self.list_stack.append("ul")
            self.output.append("\n")
        elif tag_lower == "ol":
            self.list_stack.append(1)
            self.output.append("\n")
        elif tag_lower == "li":
            indent = "  " * (len(self.list_stack) - 1)
            if self.list_stack and isinstance(self.list_stack[-1], int):
                num = self.list_stack[-1]
                self.list_stack[-1] += 1
                self.output.append(f"\n{indent}{num}. ")
            else:
                self.output.append(f"\n{indent}- ")
        elif tag_lower in ["strong", "b"]:
            self.output.append("**")
        elif tag_lower in ["em", "i"]:
            self.output.append("*")
        elif tag_lower in ["code", "tt"]:
            if not self.in_code:
                self.output.append("`")
        elif tag_lower == "a":
            self.in_link = True
            self.link_href = attrs_dict.get("href", "")
            self.link_text = []
        elif tag_lower == "table":
            self.in_table = True
            self.table_rows = []
        elif tag_lower == "tr":
            self.current_row = []
        elif tag_lower in ["td", "th"]:
            self.current_cell = []
        elif tag_lower == "ac:structured-macro":
            self.current_macro = attrs_dict.get("ac:name", "")
            if self.current_macro == "code":
                self.in_code = True
                self.code_text = []
                self.code_lang = ""
            elif self.current_macro in ["info", "tip", "note", "warning"]:
                self.output.append(f"\n\n> [!{self.current_macro.upper()}]\n> ")
            elif self.current_macro == "unmigrated-wiki-markup":
                self.plain_text_body = []
        elif tag_lower == "ac:plain-text-body":
            self.in_plain_text = True
        elif tag_lower == "ac:parameter" and self.in_code:
            param_name = attrs_dict.get("ac:name", "")
            if param_name == "language":
                self._recording_code_lang = True
        elif tag_lower == "hr":
            self.output.append("\n\n---\n\n")

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in ["strong", "b"]:
            self.output.append("**")
        elif tag_lower in ["em", "i"]:
            self.output.append("*")
        elif tag_lower in ["code", "tt"]:
            if not self.in_code:
                self.output.append("`")
        elif tag_lower == "a":
            self.in_link = False
            text = "".join(self.link_text).strip() or self.link_href
            if self.link_href:
                self.output.append(f"[{text}]({self.link_href})")
            else:
                self.output.append(text)
        elif tag_lower in ["ul", "ol"]:
            if self.list_stack:
                self.list_stack.pop()
            self.output.append("\n")
        elif tag_lower in ["td", "th"]:
            cell_content = "".join(self.current_cell).strip().replace("\n", " ")
            self.current_row.append(cell_content)
        elif tag_lower == "tr":
            self.table_rows.append(self.current_row)
        elif tag_lower == "table":
            self.in_table = False
            if self.table_rows:
                self.output.append("\n\n" + self._format_table(self.table_rows) + "\n\n")
        elif tag_lower == "ac:plain-text-body":
            self.in_plain_text = False
            if self.current_macro == "unmigrated-wiki-markup":
                raw_wiki = "".join(self.plain_text_body)
                parsed = convert_wiki_markup_to_markdown(raw_wiki)
                self.output.append(f"\n\n{parsed}\n\n")
        elif tag_lower == "ac:structured-macro":
            if self.in_code:
                self.in_code = False
                code_body = "".join(self.code_text).strip("\n")
                lang = getattr(self, "code_lang", "")
                self.output.append(f"\n\n```{lang}\n{code_body}\n```\n\n")
            self.current_macro = ""
        elif tag_lower == "ac:parameter":
            self._recording_code_lang = False

    def unknown_decl(self, data):
        if data.startswith("CDATA["):
            content = data[6:]
            if content.endswith("]]"):
                content = content[:-2]
            self.handle_data(content)

    def handle_data(self, data):
        if getattr(self, "_recording_code_lang", False):
            self.code_lang = data.strip()
            return
        if self.in_plain_text and self.current_macro == "unmigrated-wiki-markup":
            self.plain_text_body.append(data)
            return
        if self.in_code:
            self.code_text.append(data)
            return
        if self.in_table and hasattr(self, "current_cell"):
            self.current_cell.append(data)
            return
        if self.in_link:
            self.link_text.append(data)
            return
        self.output.append(data)

    def _format_table(self, rows):
        if not rows:
            return ""
        max_cols = max(len(row) for row in rows)
        norm_rows = [row + [""] * (max_cols - len(row)) for row in rows]
        lines = []
        header = norm_rows[0]
        lines.append("| " + " | ".join(header) + " |")
        lines.append("| " + " | ".join(["---"] * max_cols) + " |")
        for row in norm_rows[1:]:
            lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines)

    def get_markdown(self):
        text = "".join(self.output)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def parse_page_id(target):
    target = target.strip()
    if target.isdigit():
        return target
    parsed = urlparse(target)
    qs = parse_qs(parsed.query)
    if "pageId" in qs:
        return qs["pageId"][0]
    m = re.search(r"/pages/(\d+)", target)
    if m:
        return m.group(1)
    return None


def fetch_confluence_page(page_id, token):
    url = f"{CONFLUENCE_BASE}/rest/api/content/{page_id}?expand=body.storage,version,title,space"
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
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP Error {e.code} fetching Confluence page {page_id}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Failed to fetch Confluence page {page_id}: {e}", file=sys.stderr)
        sys.exit(1)


def format_confluence_page(data):
    title = data.get("title", "Untitled")
    page_id = data.get("id", "")
    space_key = data.get("space", {}).get("key", "")
    space_name = data.get("space", {}).get("name", "")
    version = data.get("version", {}).get("number", 1)
    storage_html = data.get("body", {}).get("storage", {}).get("value", "")

    parser = ConfluenceStorageToMarkdown()
    parser.feed(storage_html)
    content_md = parser.get_markdown()

    page_url = f"{CONFLUENCE_BASE}/spaces/{space_key}/pages/{page_id}"

    return f"""# {title}

- **Page ID**: `{page_id}`
- **Space**: {space_name} (`{space_key}`)
- **Version**: {version}
- **Confluence Link**: [{title}]({page_url})

---

{content_md}
"""


def main():
    parser = argparse.ArgumentParser(
        description="Fetch and format Confluence Wiki specifications into Markdown."
    )
    parser.add_argument("target", help="Confluence URL or Page ID (e.g. 421200037)")
    parser.add_argument("-t", "--token", "--pat", dest="token", help="Personal Access Token (overrides CONFLUENCE_PATH)")
    parser.add_argument("-o", "--output", dest="output", help="Output markdown file path (defaults to stdout)")

    args = parser.parse_args()
    token = get_token(args.token)
    page_id = parse_page_id(args.target)

    if not page_id:
        print(f"ERROR: Could not extract Confluence pageId from '{args.target}'", file=sys.stderr)
        sys.exit(1)

    print(f"[Fetching Confluence Page: {page_id}]", file=sys.stderr)
    data = fetch_confluence_page(page_id, token)
    result_md = format_confluence_page(data)

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
