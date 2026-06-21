import { ethers } from "ethers";

const AUTH_VALIDITY_SECONDS = Number.parseInt(
  process.env.X402_AUTH_VALIDITY_SECONDS ?? "",
  10
) || (30 * 24 * 60 * 60);

/**
 * Build an EIP-3009 TransferWithAuthorization payload and sign it.
 * This is what a real x402 client does — signs an off-chain authorization
 * that the facilitator later submits on-chain.
 */
export async function buildTransferAuthorization(wallet, {
  usdcAddress,
  to,
  value,
  chainId,
}) {
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const validAfter = 0;
  // Large local-chain sweeps mine thousands of blocks and can advance block
  // timestamps by more than an hour. Keep the authorization window wide
  // enough that expiry does not become the limiting factor in Attack I.
  const validBefore = Math.floor(Date.now() / 1000) + AUTH_VALIDITY_SECONDS;

  // EIP-712 domain (must match contract's DOMAIN_SEPARATOR)
  const domain = {
    name: "USD Coin",
    version: "1",
    chainId: chainId,
    verifyingContract: usdcAddress,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const message = {
    from: wallet.address,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await wallet.signTypedData(domain, types, message);
  const { v, r, s } = ethers.Signature.from(signature);

  // Encode as base64 JSON (the X-PAYMENT header value)
  const paymentPayload = {
    from: wallet.address,
    to,
    value: value.toString(),
    validAfter,
    validBefore,
    nonce,
    v,
    r,
    s,
    usdcAddress,
  };

  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  return { paymentPayload, encoded, nonce };
}

/**
 * Decode an X-PAYMENT header value.
 */
export function decodePaymentPayload(encoded) {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
}
