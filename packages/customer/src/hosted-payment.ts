import { fail, type PapService } from "dsh-frontvia-pap/core";
export async function hostedPayment(
  pap: Pick<PapService, "identity" | "requestBound">,
  ref: string,
  link: string,
  checkoutId: string,
) {
  const issuer = new URL(pap.identity(ref).issuer);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return fail("INVALID_PAYMENT_LINK");
  }
  const entries = [...url.searchParams.keys()];
  const expires = Number(url.searchParams.get("expires"));
  const access = url.searchParams.get("access") ?? "";
  if (
    url.protocol !== "https:" ||
    url.origin !== issuer.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !/^[a-f0-9-]{36}$/i.test(checkoutId) ||
    !/^\/companies\/[^/]+$/.test(issuer.pathname) ||
    url.pathname !== `${issuer.pathname}/pay/${checkoutId}` ||
    entries.length !== 2 ||
    new Set(entries).size !== 2 ||
    !entries.includes("expires") ||
    !entries.includes("access") ||
    !Number.isSafeInteger(expires) ||
    expires <= now() ||
    !/^(?:[A-Za-z0-9_-]{43}|v2\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43})$/i.test(
      access,
    )
  )
    fail("INVALID_PAYMENT_LINK");
  return pap.requestBound(ref, {
    url: `${issuer.origin}${issuer.pathname}/hosted-payer/rpc`,
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: issuer.origin },
    body: JSON.stringify({
      method: "start",
      checkout_id: checkoutId,
      expires,
      access,
    }),
    timeoutMs: 45000,
    maxResponseBytes: 512 * 1024,
  });
}
const now = () => Math.floor(Date.now() / 1000);
