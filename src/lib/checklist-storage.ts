const DEFAULT_CHECKLISTS_FUNCTION_URL = "https://tmnstuthbllnoqgepotn.supabase.co/functions/v1/event-checklists";

export function getChecklistFunctionUrl() {
  return process.env.SUPABASE_CHECKLISTS_FUNCTION_URL?.trim() || DEFAULT_CHECKLISTS_FUNCTION_URL;
}

export async function callChecklistFunction(init?: RequestInit) {
  const response = await fetch(getChecklistFunctionUrl(), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Checklist storage request failed.");
  }

  return response.json();
}
