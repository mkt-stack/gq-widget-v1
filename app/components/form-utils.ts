/** Polaris web-component events are typed as plain `Event`; read the field's value/checked. */
export const inputValue = (e: Event) =>
  String((e.currentTarget as unknown as { value?: unknown }).value ?? "");

export const inputChecked = (e: Event) =>
  Boolean((e.currentTarget as unknown as { checked?: unknown }).checked);

/** Seconds ⇄ whole minutes + remaining seconds for paired number fields. */
export const splitSeconds = (total: number) => ({ minutes: Math.floor(total / 60), seconds: total % 60 });
