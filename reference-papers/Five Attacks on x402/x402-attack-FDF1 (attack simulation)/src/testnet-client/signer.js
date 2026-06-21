import { ethers } from "ethers";
import { TESTNET } from "./config.js";

export async function signPayment(wallet, { payTo, amount, extra, maxTimeoutSeconds = 300 }) {
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 300;

  const domain = {
    name: extra?.name || TESTNET.USDC_NAME,
    version: extra?.version || TESTNET.USDC_VERSION,
    chainId: TESTNET.CHAIN_ID,
    verifyingContract: TESTNET.USDC_ADDRESS,
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
    to: payTo,
    value: BigInt(amount),
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await wallet.signTypedData(domain, types, message);

  const paymentPayload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: TESTNET.CHAIN_CAIP2,
      amount: amount,
      asset: TESTNET.USDC_ADDRESS,
      payTo: payTo,
      maxTimeoutSeconds,
      extra: extra || { name: TESTNET.USDC_NAME, version: TESTNET.USDC_VERSION },
    },
    payload: {
      signature: signature,
      authorization: {
        from: wallet.address,
        to: payTo,
        value: amount,
        validAfter: validAfter,
        validBefore: validBefore,
        nonce: nonce,
      },
    },
  };

  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  return { paymentPayload, encoded, nonce, validBefore };
}
