'use client';

import { useState, useRef, type ChangeEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';

interface MemberOption {
  userId: string;
  email: string;
  name: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  members: MemberOption[];
  placeholder?: string;
}

/**
 * A plain textarea that opens a member picker when the user types "@".
 * Selecting a member inserts a `@[Display Name](userId)` token into the
 * text — the server-side mention regex in the messages route matches this
 * exact shape. Rendering (replacing the token with a styled span) is done
 * by `renderMessageBody` below, used wherever a message/note body is
 * displayed.
 */
export function MentionInput({ value, onChange, members, placeholder }: MentionInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function onTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    const cursor = e.target.selectionStart;
    const uptoCursor = next.slice(0, cursor);
    const atMatch = /@([a-zA-Z0-9À-ſ ]{0,30})$/.exec(uptoCursor);
    if (atMatch) {
      setFilter(atMatch[1]!.toLowerCase());
      setPickerOpen(true);
    } else {
      setPickerOpen(false);
    }
  }

  function insertMention(member: MemberOption) {
    const label = member.name ?? member.email;
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    const before = value.slice(0, atIndex >= 0 ? atIndex : cursor);
    const after = value.slice(cursor);
    const token = `@[${label}](${member.userId})`;
    onChange(`${before}${token} ${after}`);
    setPickerOpen(false);
  }

  const filtered = members.filter((m) => (m.name ?? m.email).toLowerCase().includes(filter));

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={onTextChange}
        placeholder={placeholder}
        rows={3}
      />
      {pickerOpen && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-md">
          {filtered.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => insertMention(m)}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {m.name ?? m.email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MENTION_TOKEN = /@\[([^\]]+)\]\([a-zA-Z0-9]+\)/g;

/** Replaces every `@[Name](id)` token in a message/note body with `@Name`, for display. */
export function renderMessageBody(body: string): string {
  return body.replace(MENTION_TOKEN, '@$1');
}
