/** A late owner-UI response must not repopulate private data after logout. */
export async function accountRequest<T>(
  request: () => Promise<T>,
  events: EventTarget = window,
): Promise<T> {
  let changed = false;
  const invalidate = () => {
    changed = true;
  };
  events.addEventListener("frontvia-personal-change", invalidate);
  try {
    const result = await request();
    if (changed) throw new Error("PERSONAL_ACCOUNT_CHANGED");
    return result;
  } finally {
    events.removeEventListener("frontvia-personal-change", invalidate);
  }
}
