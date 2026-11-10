import { hostedPayment } from "./hosted-payment.js";
import { GRANT, PROFILE, type AccountClient } from "dsh-frontvia-client/core";
import { fail, type PapService } from "dsh-frontvia-pap/core";

export type IntegrationHost = Pick<
  PapService,
  | "registerAuthentication"
  | "registerStatement"
  | "requestBound"
  | "signResourceStatement"
  | "identity"
>;

/** Frontvia policy lives here. PAP owns keys, transport binding and connection storage. */
export function attachFrontvia(pap: IntegrationHost, account: AccountClient) {
  const unregister = pap.registerAuthentication({
    id: PROFILE,
    legacyPersonal: true,
    matches: (_site, metadata) =>
      metadata.identity_assertion_profiles_supported?.includes(PROFILE) &&
      metadata.grant_types_supported?.includes(GRANT),
    current: () => ({
      identity: account.identity(),
      generation: account.current().generation,
    }),
    assert: (generation) => account.assert(generation),
    client: account.device,
    grant: async (site, _metadata, publicProofKey) => ({
      grant_type: GRANT,
      identity_assertion: await account.assertion(
        site.issuer,
        site.resource,
        publicProofKey,
      ),
    }),
  });
  let unregisterStatement: () => void;
  try {
    unregisterStatement = pap.registerStatement(
      "frontvia-personal-purchase+jwt",
      (binding) =>
        !!binding.personalSignedIn &&
        binding.authenticationProvider === PROFILE,
    );
  } catch (error) {
    unregister();
    throw error;
  }
  return {
    dispose() {
      unregisterStatement();
      unregister();
    },
    signResourceStatement: (
      ref: string,
      typ: string,
      claims: Record<string, unknown>,
    ) => {
      if (typ !== "frontvia-personal-purchase+jwt")
        fail("STATEMENT_BINDING_MISMATCH");
      return pap.signResourceStatement(ref, typ, claims);
    },
    hostedPayment: (ref: string, link: string, checkoutId: string) =>
      hostedPayment(pap, ref, link, checkoutId),
  };
}
