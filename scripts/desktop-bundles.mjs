const identity = '@agent-network-protocol/dsh-anp-identity';
const pap = '@awiki/dsh-pap';
const customer = 'dsh-frontvia-customer';
/** Move only late prerequisites; preserve already-correct placement and other selections. */
export function orderFrontviaBundles(bundles) {
  if (!Array.isArray(bundles) || !bundles.includes(customer)) return bundles;
  const result = [...bundles];
  for (const [before, after] of [[pap, customer], [identity, pap]]) {
    const first = result.indexOf(before), last = result.indexOf(after);
    if (first >= 0 && last >= 0 && first > last) {
      result.splice(first, 1);
      result.splice(last, 0, before);
    }
  }
  return result;
}
