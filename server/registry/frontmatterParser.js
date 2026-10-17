/**
 * Frontmatter & YAML Parser for Universal AI Agent Registry
 *
 * Provides pure Node.js (zero external dependencies) parsing and stringification
 * of YAML frontmatter + Markdown content, as well as standalone YAML documents.
 */

/**
 * Strips comments from a YAML line unless enclosed in quotes.
 */
function stripComment(line) {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inSingle && (i === 0 || line[i - 1] !== '\\')) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '#' && !inDouble && !inSingle) {
      // Must be at start or preceded by whitespace
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i).trimEnd();
      }
    }
  }
  return line;
}

/**
 * Parses a scalar value (boolean, number, null, quoted string, unquoted string, inline array/object).
 */
function parseScalar(val) {
  if (val === undefined || val === null) return null;
  val = val.trim();
  if (val === '' || val === '~' || val.toLowerCase() === 'null') return null;
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;

  // Double quoted string
  if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
    try {
      return JSON.parse(val);
    } catch (_) {
      return val.slice(1, -1).replace(/\\"/g, '"');
    }
  }

  // Single quoted string
  if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
    return val.slice(1, -1).replace(/''/g, "'");
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(val)) {
    const num = Number(val);
    if (!Number.isNaN(num)) return num;
  }

  // Inline array [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineList(inner).map(parseScalar);
  }

  // Inline object { a: 1, b: 2 }
  if (val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return {};
    const obj = {};
    const pairs = splitInlineList(inner);
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > -1) {
        const k = parseScalar(pair.slice(0, colonIdx));
        const v = parseScalar(pair.slice(colonIdx + 1));
        obj[k] = v;
      }
    }
    return obj;
  }

  return val;
}

/**
 * Helper to split comma-separated items inside [...] or {...} respecting quotes.
 */
function splitInlineList(str) {
  const items = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"' && !inSingle && (i === 0 || str[i - 1] !== '\\')) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (!inDouble && !inSingle) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;

      if (ch === ',' && depth === 0) {
        items.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

/**
 * Robust line-by-line YAML parser
 */
function parseYaml(yamlString) {
  if (!yamlString || typeof yamlString !== 'string') return {};

  const rawLines = yamlString.split(/\r?\n/);
  const parsedLines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineWithNoComment = stripComment(rawLines[i]);
    const trimmed = lineWithNoComment.trim();
    if (!trimmed) continue; // skip blank lines
    const indent = lineWithNoComment.search(/\S/);
    parsedLines.push({
      lineIndex: i,
      raw: lineWithNoComment,
      indent,
      text: trimmed,
    });
  }

  if (parsedLines.length === 0) return {};

  let cursor = 0;

  function parseBlock(currentIndent) {
    let result = null;

    while (cursor < parsedLines.length) {
      const line = parsedLines[cursor];

      if (line.indent < currentIndent) {
        break;
      }

      // If at same indent:
      if (line.text.startsWith('- ') || line.text === '-') {
        // We are inside an array
        if (result === null) result = [];
        if (!Array.isArray(result)) break;

        const itemContent = line.text.slice(1).trim(); // text after "-"
        cursor++;

        if (!itemContent) {
          // Nested item on next line(s)
          if (cursor < parsedLines.length && parsedLines[cursor].indent > line.indent) {
            const child = parseBlock(parsedLines[cursor].indent);
            result.push(child);
          } else {
            result.push(null);
          }
        } else if (itemContent.includes(': ') || itemContent.endsWith(':')) {
          // Object item on same line: "- key: val" or "- key:"
          const colonIdx = itemContent.indexOf(':');
          const key = parseScalar(itemContent.slice(0, colonIdx));
          const valPart = itemContent.slice(colonIdx + 1).trim();

          const itemObj = {};
          if (valPart) {
            itemObj[key] = parseScalar(valPart);
          } else {
            // Nested under this key
            if (cursor < parsedLines.length && parsedLines[cursor].indent > line.indent) {
              itemObj[key] = parseBlock(parsedLines[cursor].indent);
            } else {
              itemObj[key] = null;
            }
          }

          // Check if subsequent lines belong to this same list object item!
          // They will have indent > line.indent (usually line.indent + 2 or + 4)
          while (cursor < parsedLines.length && parsedLines[cursor].indent > line.indent) {
            const subLine = parsedLines[cursor];
            if (subLine.text.startsWith('- ') || subLine.text === '-') {
              // It's a nested sub-list!
              break;
            }
            const subColon = subLine.text.indexOf(':');
            if (subColon > -1) {
              const subKey = parseScalar(subLine.text.slice(0, subColon));
              const subVal = subLine.text.slice(subColon + 1).trim();
              cursor++;
              if (subVal) {
                itemObj[subKey] = parseScalar(subVal);
              } else {
                if (cursor < parsedLines.length && parsedLines[cursor].indent > subLine.indent) {
                  itemObj[subKey] = parseBlock(parsedLines[cursor].indent);
                } else {
                  itemObj[subKey] = null;
                }
              }
            } else {
              cursor++;
            }
          }

          result.push(itemObj);
        } else {
          // Simple scalar list item: "- something"
          result.push(parseScalar(itemContent));
        }
      } else {
        // We are inside an object: "key: value"
        if (result === null) result = {};
        if (Array.isArray(result)) break;

        const colonIdx = line.text.indexOf(':');
        if (colonIdx === -1) {
          // Not a key-value pair, advance
          cursor++;
          continue;
        }

        const key = parseScalar(line.text.slice(0, colonIdx));
        const valPart = line.text.slice(colonIdx + 1).trim();
        cursor++;

        if (valPart) {
          result[key] = parseScalar(valPart);
        } else {
          // Value is on next line with greater indent
          if (cursor < parsedLines.length && parsedLines[cursor].indent > line.indent) {
            result[key] = parseBlock(parsedLines[cursor].indent);
          } else {
            result[key] = null;
          }
        }
      }
    }

    return result || {};
  }

  return parseBlock(0);
}

/**
 * Formats a JS value into YAML scalar representation
 */
function formatYamlScalar(val) {
  if (val === null || val === undefined) return '~';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    // Check if quotes are necessary
    if (
      val === '' ||
      val === 'true' ||
      val === 'false' ||
      val === 'null' ||
      val === '~' ||
      /^[0-9]+(\.[0-9]+)?$/.test(val) ||
      /[:#{}[\]>\s"'!&*?]/.test(val) ||
      val.startsWith('-')
    ) {
      return JSON.stringify(val);
    }
    return val;
  }
  return JSON.stringify(val);
}

/**
 * Serializes a JS object/array to YAML format
 */
function stringifyYaml(data, indentLevel = 0) {
  const pad = '  '.repeat(indentLevel);
  if (data === null || data === undefined) return `${pad}~\n`;

  if (Array.isArray(data)) {
    if (data.length === 0) return `${pad}[]\n`;
    let out = '';
    for (const item of data) {
      if (item !== null && typeof item === 'object') {
        if (Array.isArray(item)) {
          out += `${pad}- \n` + stringifyYaml(item, indentLevel + 1);
        } else {
          // Object in array
          const keys = Object.keys(item);
          if (keys.length === 0) {
            out += `${pad}- {}\n`;
          } else {
            const firstKey = keys[0];
            const firstVal = item[firstKey];
            if (firstVal !== null && typeof firstVal === 'object') {
              out += `${pad}- ${firstKey}:\n` + stringifyYaml(firstVal, indentLevel + 2);
            } else {
              out += `${pad}- ${firstKey}: ${formatYamlScalar(firstVal)}\n`;
            }
            for (let i = 1; i < keys.length; i++) {
              const k = keys[i];
              const v = item[k];
              if (v !== null && typeof v === 'object') {
                out += `${pad}  ${k}:\n` + stringifyYaml(v, indentLevel + 2);
              } else {
                out += `${pad}  ${k}: ${formatYamlScalar(v)}\n`;
              }
            }
          }
        }
      } else {
        out += `${pad}- ${formatYamlScalar(item)}\n`;
      }
    }
    return out;
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return `${pad}{}\n`;
    let out = '';
    for (const k of keys) {
      const v = data[k];
      if (v !== null && typeof v === 'object') {
        if (Array.isArray(v) && v.length === 0) {
          out += `${pad}${k}: []\n`;
        } else if (!Array.isArray(v) && Object.keys(v).length === 0) {
          out += `${pad}${k}: {}\n`;
        } else {
          out += `${pad}${k}:\n` + stringifyYaml(v, indentLevel + 1);
        }
      } else {
        out += `${pad}${k}: ${formatYamlScalar(v)}\n`;
      }
    }
    return out;
  }

  return `${pad}${formatYamlScalar(data)}\n`;
}

/**
 * Parses markdown containing YAML frontmatter.
 * Frontmatter format:
 * ---
 * key: value
 * ---
 * Markdown body...
 */
function parseFrontmatter(content) {
  if (typeof content !== 'string') {
    return { data: {}, body: '' };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      data: {},
      body: content.trim(),
    };
  }

  const yamlStr = match[1];
  const body = (match[2] || '').trim();

  let data = {};
  try {
    data = parseYaml(yamlStr);
  } catch (err) {
    console.warn('[frontmatterParser] Warning: failed to parse YAML frontmatter:', err.message);
  }

  return {
    data,
    body,
  };
}

/**
 * Serializes data and body into frontmatter markdown format
 */
function stringifyFrontmatter(data, body = '') {
  const yamlStr = stringifyYaml(data || {}).trimEnd();
  const trimmedBody = (body || '').trim();
  if (!yamlStr) {
    return trimmedBody;
  }
  // Frontmatter-only definitions end at the closing fence, as written by hand
  return trimmedBody ? `---\n${yamlStr}\n---\n\n${trimmedBody}\n` : `---\n${yamlStr}\n---\n`;
}

module.exports = {
  parseYaml,
  stringifyYaml,
  parseScalar,
  parseFrontmatter,
  stringifyFrontmatter,
};
