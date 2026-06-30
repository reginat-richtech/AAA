'use client';
import { useState } from 'react';

// A type-to-search dropdown combobox. `options` = [{ key, label, sub, data }].
// Typing filters by label+sub; clicking an option calls onPick(option).
//
// Default (free mode): free text is allowed — onChange fires on every keystroke,
// so the field can also hold a typed value.
//
// selectOnly: the field can ONLY hold a value chosen from `options`. Once a value
// is committed it shows as a LOCKED chip (NOT an editable input) — to change it the
// user clicks "Change" and must pick another option from the list. Typing only
// searches (onSearch fires for live/server-side search); the value is committed
// solely via onPick, so free text can never become the value. onClear (optional)
// resets the committed value and shows a ✕ on the chip.
export default function ComboSearch({ value, onChange, options = [], onPick, onClear, placeholder, disabled, selectOnly = false, onSearch }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');       // live search text (selectOnly)
  const [editing, setEditing] = useState(false); // selectOnly: searching vs showing the locked value

  // selectOnly with a committed value → locked display, never a free-text input.
  if (selectOnly && value && !editing) {
    return (
      <div className="combo">
        <div className="combo-selected">
          <span className="combo-selected-val" title={value}>{value}</span>
          {!disabled && (
            <span className="combo-selected-actions">
              <button type="button" className="combo-change"
                onClick={() => { setQuery(''); setEditing(true); setOpen(true); onSearch?.(''); }}>Change</button>
              {onClear && <button type="button" className="combo-clear" title="Clear" onClick={() => onClear()}>✕</button>}
            </span>
          )}
        </div>
      </div>
    );
  }

  // selectOnly while searching shows the query; free mode always shows the value.
  const shown = selectOnly ? query : (value || '');
  const q = String(shown).toLowerCase();
  const matches = (!q ? options : options.filter((o) => `${o.label} ${o.sub || ''}`.toLowerCase().includes(q))).slice(0, 40);

  const type = (text) => {
    setOpen(true);
    if (selectOnly) { setQuery(text); onSearch?.(text); }   // search only — never commit free text
    else { onChange?.(text); }
  };
  const pick = (o) => { onPick?.(o); setOpen(false); if (selectOnly) { setQuery(''); setEditing(false); } };
  // Leaving the search box without picking discards the typed text (selectOnly).
  const leave = () => { setOpen(false); if (selectOnly) { setQuery(''); setEditing(false); } };

  return (
    <div className="combo">
      <input
        value={shown}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={selectOnly && editing}
        onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(leave, 150)}
      />
      {open && !disabled && matches.length > 0 && (
        <div className="combo-drop">
          {matches.map((o, i) => (
            <div
              key={o.key ?? i}
              className="combo-opt"
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span className="combo-lbl">{o.label}</span>
              {o.sub && <span className="combo-sub">{o.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
