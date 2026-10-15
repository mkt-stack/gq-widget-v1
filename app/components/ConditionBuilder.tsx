import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  CONDITION_TYPES,
  MAX_CONDITIONS,
  OPERATOR_LABELS,
  type Condition,
  type ConditionType,
  type DisplayRules,
} from "@gq/widget-core";
import { inputValue } from "./form-utils";
import type { loader as segmentsLoader } from "../routes/app.api.segments";

interface Props {
  rules: DisplayRules;
  onChange: (rules: DisplayRules) => void;
  /** Rule types this widget supports (default: all). */
  types?: ConditionType[];
  currencyCode?: string;
  /** Wording for the match selector, e.g. "Apply this rule when". */
  matchLabel?: string;
  /** Shown when there are no conditions. */
  emptyText?: string;
}

const newId = () => Math.random().toString(36).slice(2, 10);

const splitTags = (s: string) =>
  [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))];

export function ConditionBuilder({
  rules,
  onChange,
  types,
  currencyCode = "",
  matchLabel = "Show the widget when",
  emptyText = "No conditions: the widget shows on every checkout.",
}: Props) {
  const shopify = useAppBridge();
  const allowed = types ?? (Object.keys(CONDITION_TYPES) as ConditionType[]);

  // Load the shop's segments once, only when a segment condition is on screen.
  const segmentsFetcher = useFetcher<typeof segmentsLoader>();
  const usesSegments = rules.conditions.some((c) => c.type === "customer_segment");
  useEffect(() => {
    if (usesSegments && segmentsFetcher.state === "idle" && !segmentsFetcher.data) segmentsFetcher.load("/app/api/segments");
  }, [usesSegments, segmentsFetcher]);
  const segments = segmentsFetcher.data?.segments ?? [];

  const update = (id: string, patch: Partial<Condition>) =>
    onChange({
      ...rules,
      conditions: rules.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  const changeType = (id: string, type: ConditionType) =>
    update(id, {
      type,
      operator: CONDITION_TYPES[type].operators[0],
      values: [],
      labels: undefined,
      number: type === "subtotal" || type === "item_count" ? 0 : undefined,
    });

  const add = () =>
    onChange({
      ...rules,
      conditions: [
        ...rules.conditions,
        { id: newId(), type: allowed[0], operator: CONDITION_TYPES[allowed[0]].operators[0], values: [] },
      ],
    });

  const remove = (id: string) =>
    onChange({ ...rules, conditions: rules.conditions.filter((c) => c.id !== id) });

  const pick = async (c: Condition) => {
    const selected = await shopify.resourcePicker({
      type: c.type === "collection" ? "collection" : "product",
      multiple: true,
      action: "select",
      filter: c.type === "product" ? { variants: false } : undefined,
      selectionIds: c.values.map((id) => ({ id })),
    });
    if (!selected) return;
    const items = selected as unknown as Array<{ id: string; title: string }>;
    update(c.id, {
      values: items.map((i) => i.id),
      labels: Object.fromEntries(items.map((i) => [i.id, i.title])),
    });
  };

  return (
    <s-stack gap="base">
      {rules.conditions.length > 1 && (
        <s-select
          label={matchLabel}
          value={rules.match}
          onChange={(e) => onChange({ ...rules, match: inputValue(e) === "any" ? "any" : "all" })}
        >
          <s-option value="all">All conditions match</s-option>
          <s-option value="any">Any condition matches</s-option>
        </s-select>
      )}

      {rules.conditions.length === 0 && (
        <s-paragraph color="subdued">{emptyText}</s-paragraph>
      )}

      {rules.conditions.map((c) => {
        const spec = CONDITION_TYPES[c.type];
        const missingValues = spec.operators.includes("any") && c.values.length === 0;
        return (
          <s-box key={c.id} padding="base" border="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-grid gridTemplateColumns="1fr 1fr auto" gap="small-200" alignItems="end">
                <s-select
                  label="Condition"
                  value={c.type}
                  onChange={(e) => changeType(c.id, inputValue(e) as ConditionType)}
                >
                  {allowed.map((t) => (
                    <s-option key={t} value={t}>
                      {CONDITION_TYPES[t].label}
                    </s-option>
                  ))}
                </s-select>
                <s-select
                  label="Operator"
                  value={c.operator}
                  onChange={(e) => update(c.id, { operator: inputValue(e) as Condition["operator"] })}
                >
                  {spec.operators.map((op) => (
                    <s-option key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </s-option>
                  ))}
                </s-select>
                <s-button
                  icon="delete"
                  variant="tertiary"
                  tone="critical"
                  accessibilityLabel="Remove condition"
                  onClick={() => remove(c.id)}
                />
              </s-grid>

              {(c.type === "product" || c.type === "collection") && (
                <s-stack gap="small-200">
                  <s-stack direction="inline" gap="small-200">
                    {c.values.map((id) => (
                      <s-chip key={id}>{c.labels?.[id] ?? id.split("/").pop()}</s-chip>
                    ))}
                  </s-stack>
                  <s-stack direction="inline">
                    <s-button
                      icon={c.type === "product" ? "product" : "collection"}
                      onClick={() => pick(c)}
                    >
                      {c.values.length ? "Change selection" : `Select ${c.type === "product" ? "products" : "collections"}`}
                    </s-button>
                  </s-stack>
                </s-stack>
              )}

              {(c.type === "product_tag" || c.type === "customer_tag") && (
                <s-text-field
                  label="Tags"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="e.g. promed, vip"
                  details="Comma-separated, not case-sensitive."
                  value={c.values.join(", ")}
                  onChange={(e) => update(c.id, { values: splitTags(inputValue(e)) })}
                />
              )}

              {c.type === "shipping_method" && (
                <s-text-field
                  label="Shipping method names"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="e.g. VIP, Express"
                  details="Matches when the selected shipping method's name contains any of these. Comma-separated, not case-sensitive."
                  value={c.values.join(", ")}
                  onChange={(e) => update(c.id, { values: splitTags(inputValue(e)) })}
                />
              )}

              {c.type === "customer_segment" && (
                <s-stack gap="small-200">
                  {segmentsFetcher.state !== "idle" && !segmentsFetcher.data ? (
                    <s-spinner accessibilityLabel="Loading customer segments" size="base" />
                  ) : segments.length === 0 ? (
                    <s-text tone="caution">
                      {segmentsFetcher.data?.error ?? "No customer segments yet. Create one in Customers → Segments."}
                    </s-text>
                  ) : (
                    <s-choice-list
                      label="Segments"
                      labelAccessibilityVisibility="exclusive"
                      multiple
                      onChange={(e) => {
                        const ids = (e.currentTarget as unknown as { values?: string[] }).values ?? [];
                        const names = Object.fromEntries(segments.map((s) => [s.id, s.name]));
                        update(c.id, {
                          values: ids,
                          labels: Object.fromEntries(ids.map((id) => [id, names[id] ?? c.labels?.[id] ?? id])),
                        });
                      }}
                    >
                      {segments.map((s) => (
                        <s-choice key={s.id} value={s.id} selected={c.values.includes(s.id)}>
                          {s.name}
                        </s-choice>
                      ))}
                    </s-choice-list>
                  )}
                  {c.values
                    .filter((id) => segmentsFetcher.data && !segments.some((s) => s.id === id))
                    .map((id) => (
                      <s-text key={id} tone="caution">{`"${c.labels?.[id] ?? id}" no longer exists; reselect segments to remove it.`}</s-text>
                    ))}
                </s-stack>
              )}

              {(c.type === "subtotal" || c.type === "item_count") && (
                <s-number-field
                  label={c.type === "subtotal" ? "Amount" : "Quantity"}
                  labelAccessibilityVisibility="exclusive"
                  min={0}
                  step={1}
                  suffix={c.type === "subtotal" ? currencyCode : "items"}
                  value={String(c.number ?? 0)}
                  onChange={(e) => update(c.id, { number: Math.max(0, Number(inputValue(e)) || 0) })}
                />
              )}

              {c.type === "customer_tag" && (
                <s-text color="subdued">
                  Guests have no tags. Checked securely through the app backend.
                </s-text>
              )}
              {c.type === "customer_segment" && (
                <s-text color="subdued">
                  Guests are in no segment. Membership is checked live through the app backend.
                </s-text>
              )}
              {missingValues && (
                <s-text tone="caution">Add at least one value, otherwise this condition is removed when you save.</s-text>
              )}
            </s-stack>
          </s-box>
        );
      })}

      <s-stack direction="inline">
        <s-button icon="plus" onClick={add} disabled={rules.conditions.length >= MAX_CONDITIONS}>
          Add condition
        </s-button>
      </s-stack>
    </s-stack>
  );
}
