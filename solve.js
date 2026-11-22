// Fast drop-in for make.fun's csv-reader 1.0.0: returns exactly its answer for every input,
// but scans in bulk instead of one character at a time.
//
// Semantics (csv-reader 1.0.0, see the competition's RULES):
// - a U+FEFF at the very start is dropped; the text is read once, left to right;
// - a record ends at LF or CRLF; a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (stray_cr);
// - a field that opens with a quote runs to the next quote that is not doubled: "" inside it is
//   one quote, each CRLF or lone CR inside it is read as LF; what follows its closing quote, up to
//   the next comma or line break, is appended as it stands (quote_junk, when the field ends);
//   a quote that never closes is a literal character, and the text after it is read again as
//   unquoted (unterminated_quote); a quote inside an unquoted field is a literal character;
// - fields stay strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds the records after it
//   (every record when header is false), each padded with "" (short_row, with fields: its field
//   count) or cut (long_row, with extra: the cut fields) to the first record's width;
// - each error is {code, line, row}, in the order met; line is the 1-based line its record starts
//   on, counting every LF, CRLF and lone CR inside quotes, and row is its record's index in rows
//   (null for the header).
//
// Speed: fields are located with tight charCodeAt scans and materialised with single slice() calls
// wherever the field holds no dropped CR, doubled quote or line break of its own; only the rare
// broken fields pay for segment assembly. Nothing is allocated per character.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Reads an unquoted field starting at pos, onto the prefix `pre` ('' for a plain field, the
  // quoted value for junk after a closing quote, '"' for an unterminated quote's re-read).
  // Returns {value, ended, added}: added counts the characters this scan kept, not the prefix.
  // Updates pos/line and records stray_cr errors as they are met.
  function scanUnquoted(pre) {
    let fstart = pos;
    let parts = null;
    let added = 0;
    for (;;) {
      let p = pos;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44 || c === 10 || c === 13) break;
        p++;
      }
      if (p >= n) {
        const tail = text.slice(fstart, n);
        added += tail.length;
        pos = n;
        const value = parts === null ? (pre === '' ? tail : pre + tail) : pre + parts.join('') + tail;
        return { value, ended: END, added };
      }
      const c = text.charCodeAt(p);
      if (c === 44) {
        const tail = text.slice(fstart, p);
        added += tail.length;
        pos = p + 1;
        const value = parts === null ? (pre === '' ? tail : pre + tail) : pre + parts.join('') + tail;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        const tail = text.slice(fstart, p);
        added += tail.length;
        pos = p + 1;
        line++;
        const value = parts === null ? (pre === '' ? tail : pre + tail) : pre + parts.join('') + tail;
        return { value, ended: BREAK, added };
      }
      if (text.charCodeAt(p + 1) === 10) {
        const tail = text.slice(fstart, p);
        added += tail.length;
        pos = p + 2;
        line++;
        const value = parts === null ? (pre === '' ? tail : pre + tail) : pre + parts.join('') + tail;
        return { value, ended: BREAK, added };
      }
      // A lone CR: dropped, recorded, and the field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (parts === null) parts = [];
      const seg = text.slice(fstart, p);
      added += seg.length;
      parts.push(seg);
      pos = p + 1;
      fstart = pos;
    }
  }

  // The record being read: the line it starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;

    while (ended === COMMA) {
      let value;
      if (pos < n && text.charCodeAt(pos) === 34) {
        // ---- a quoted field ----
        quoted = true;
        const open = pos;
        const openLine = line;
        let segStart = pos + 1;
        let parts = null;
        let p = pos + 1;
        let closed = -1;
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c === 34) {
            if (text.charCodeAt(p + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(text.slice(segStart, p), '"');
              p += 2;
              segStart = p;
              continue;
            }
            closed = p;
            break;
          }
          if (c === 10 || c === 13) {
            // A line break inside quotes is one LF in the value.
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, p), '\n');
            if (c === 13 && text.charCodeAt(p + 1) === 10) p += 2;
            else p += 1;
            line++;
            segStart = p;
            continue;
          }
          p++;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the text after it is
          // read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = scanUnquoted('"');
          value = r.value;
          ended = r.ended;
        } else {
          value = parts === null ? text.slice(segStart, closed) : parts.join('') + text.slice(segStart, closed);
          if (closed + 1 >= n) {
            pos = n;
            ended = END;
          } else {
            const c = text.charCodeAt(closed + 1);
            if (c === 44) {
              pos = closed + 2;
              ended = COMMA;
            } else if (c === 10) {
              pos = closed + 2;
              line++;
              ended = BREAK;
            } else if (c === 13 && text.charCodeAt(closed + 2) === 10) {
              pos = closed + 3;
              line++;
              ended = BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              pos = closed + 1;
              const r = scanUnquoted(value);
              if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = r.value;
              ended = r.ended;
            }
          }
        }
      } else {
        // ---- a plain unquoted field ----
        quoted = false;
        const r = scanUnquoted('');
        value = r.value;
        ended = r.ended;
      }
      fields.push(value);
    }

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
