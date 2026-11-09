import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../../pap/test/fixtures/protocol.js";
import { hostedPayment } from "../src/hosted-payment.js";
test("hosted payment redeems only the original issuer checkout capability without forwarding PAP credentials", async () => {
  const f = fixture();
  f.config.sites[0].issuer = "https://auth.test/companies/a";
  const id = "00000000-0000-4000-8000-000000000001";
  const access = "v2.00000000-0000-4000-8000-000000000002." + "a".repeat(43);
  const expires = Math.floor(Date.now() / 1000) + 300;
  const link = `https://auth.test/companies/a/pay/${id}?expires=${expires}&access=${access}`;
  try {
    const { connectionRef } = await f.service.connect("a");
    await hostedPayment(f.service, connectionRef, link, id);
    const request = f.record.calls.at(-1);
    assert.equal(request.url, "https://auth.test/companies/a/hosted-payer/rpc");
    assert.deepEqual(request.headers, {
      "Content-Type": "application/json",
      Origin: "https://auth.test",
    });
    assert.deepEqual(JSON.parse(request.body), {
      method: "start",
      checkout_id: id,
      expires,
      access,
    });
    assert(!request.body.includes(f.record.token));
    assert.equal(request.maxResponseBytes, 512 * 1024);
    const count = f.record.calls.length;
    for (const invalid of [
      link.replace("auth.test", "evil.test"),
      link.replace("/companies/a/", "/companies/b/"),
      link.replace(id, "00000000-0000-4000-8000-000000000003"),
      link + "&access=extra",
      link + "#fragment",
      link.replace(`expires=${expires}`, "expires=1"),
      link.replace("https://", "http://"),
      link.replace("auth.test", "user:pass@auth.test"),
    ])
      await assert.rejects(
        hostedPayment(f.service, connectionRef, invalid, id),
        /INVALID_PAYMENT_LINK/,
      );
    assert.equal(f.record.calls.length, count);
    await f.service.disconnect(connectionRef);
    await assert.rejects(
      hostedPayment(f.service, connectionRef, link, id),
      /CONNECTION_DISCONNECTED/,
    );
  } finally {
    f.close();
  }
});
test("payment response is rejected when the connection binding changes during I/O", async () => {
  const f = fixture();
  f.config.sites[0].issuer = "https://auth.test/companies/a";
  try {
    const { connectionRef } = await f.service.connect("a");
    f.record.paymentBeforeReturn = () => {
      f.config.sites[0].resource = "https://other.test/rpc";
    };
    const id = "00000000-0000-4000-8000-000000000001";
    const link = `https://auth.test/companies/a/pay/${id}?expires=${Math.floor(Date.now() / 1000) + 300}&access=${"a".repeat(43)}`;
    await assert.rejects(
      hostedPayment(f.service, connectionRef, link, id),
      /CONNECTION_BINDING_CHANGED/,
    );
  } finally {
    f.close();
  }
});
