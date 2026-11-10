import { useEffect, useState } from "react";

/** Clear rendered private results when the owner changes the personal login. */
export function useAccountRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((v) => v + 1);
    window.addEventListener("frontvia-identity-change", changed);
    return () => window.removeEventListener("frontvia-identity-change", changed);
  }, []);
  return revision;
}
