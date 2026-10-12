import type { ReactNode } from "react";
import { MAX_RANKED_NAME_LENGTH } from "@gq/widget-core";
import { inputChecked, inputValue } from "./form-utils";

interface Props {
  index: number;
  count: number;
  name: string;
  enabled: boolean;
  /** Index of the first enabled catch-all item (no conditions), or -1. */
  catchAll: number;
  noun: string;
  onChange: (patch: { name?: string; enabled?: boolean }) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  children: ReactNode;
}

/** One entry in a ranked list (delivery rules, countdown variants, callouts). */
export function RankedCard({ index, count, name, enabled, catchAll, noun, onChange, onMove, onRemove, children }: Props) {
  const shadowed = catchAll !== -1 && index > catchAll && enabled;
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
          <s-badge tone={enabled ? "info" : "neutral"}>{`#${index + 1}`}</s-badge>
          <s-text-field
            label={`${noun} name`}
            labelAccessibilityVisibility="exclusive"
            placeholder={`${noun} name (only you see this)`}
            maxLength={MAX_RANKED_NAME_LENGTH}
            value={name}
            onInput={(e) => onChange({ name: inputValue(e) })}
          />
          <s-stack direction="inline" gap="small-100">
            <s-button icon="arrow-up" variant="tertiary" accessibilityLabel={`Move ${noun} up`} disabled={index === 0} onClick={() => onMove(-1)} />
            <s-button
              icon="arrow-down"
              variant="tertiary"
              accessibilityLabel={`Move ${noun} down`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            />
            <s-button icon="delete" variant="tertiary" tone="critical" accessibilityLabel={`Delete ${noun}`} onClick={onRemove} />
          </s-stack>
        </s-grid>
        <s-switch label={`${noun} is on`} checked={enabled} onChange={(e) => onChange({ enabled: inputChecked(e) })} />
        {children}
        {shadowed && (
          <s-text tone="caution">
            {`Never shown: #${catchAll + 1} has no conditions and matches every checkout first.`}
          </s-text>
        )}
      </s-stack>
    </s-box>
  );
}

/** Immutable helpers for ranked lists in admin state. */
export const ranked = {
  move<T>(items: T[], index: number, by: -1 | 1): T[] {
    const next = [...items];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    return next;
  },
  patch<T extends { id: string }>(items: T[], id: string, patch: Partial<T>): T[] {
    return items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  },
  remove<T extends { id: string }>(items: T[], id: string): T[] {
    return items.filter((i) => i.id !== id);
  },
  newId: () => Math.random().toString(36).slice(2, 10),
};

/** Intro shown above each ranked list. */
export function RankedIntro({ children }: { children: ReactNode }) {
  return (
    <s-paragraph color="subdued">
      Checked from top to bottom; the <s-text type="strong">first match wins</s-text>. {children}
    </s-paragraph>
  );
}
