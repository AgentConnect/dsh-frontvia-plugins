import { useEffect, useState } from "react";

/** Clear rendered private results when the owner changes the personal login. */
export function useAccountRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((v) => v + 1);
    window.addEventListener("frontvia-personal-change", changed);
    return () =>
      window.removeEventListener("frontvia-personal-change", changed);
  }, []);
  return revision;
}
