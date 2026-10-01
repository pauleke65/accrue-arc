"use client";
import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { LocalAccount } from "viem";

/**
 * An Arc account from a passkey: no seed phrase, no extension, no custody.
 * The passkey's PRF output is 32 secret bytes that never leave the device and
 * come back identical on any device holding the passkey, so the account
 * reappears wherever the person signs in. The derived key lives in a signing
 * session for a bounded time and is then dropped.
 */

const CREDENTIAL_KEY = "accrue-arc.passkey";
export const SESSION_MINUTES = 15;

export type PasskeyWallet = { account: LocalAccount; expiresAt: number; end: () => void };

export class PasskeyError extends Error {}

export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

function remembered(): { credentialId: string } | undefined {
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    return raw ? (JSON.parse(raw) as { credentialId: string }) : undefined;
  } catch {
    return undefined;
  }
}

function remember(credentialId: string) {
  try {
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify({ credentialId }));
  } catch {
    // Storage refused: signing in still works, it just prompts more.
  }
}

export function hasRememberedPasskey(): boolean {
  return !!remembered();
}

function fromPrf(prf: Uint8Array): PasskeyWallet {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prf, wordlist));
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new PasskeyError("That passkey did not produce a usable account.");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  node.wipePrivateData();
  master.wipePrivateData();
  const expiresAt = Date.now() + SESSION_MINUTES * 60_000;
  let ended = false;
  const end = () => {
    if (!ended) {
      ended = true;
      session.end();
    }
  };
  window.setTimeout(end, SESSION_MINUTES * 60_000);
  return { account: toViemAccount(session), expiresAt, end };
}

function translate(error: unknown): never {
  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE")
      throw new PasskeyError(
        "This device's passkey can't secure an account. Try iCloud Keychain, Google Password Manager or 1Password, or connect a wallet instead.",
      );
    if (error.code === "PASSKEY_OPERATION_FAILED") throw new PasskeyError("The passkey prompt was closed before it finished.");
  }
  throw error;
}

export async function createPasskeyAccount(label: string): Promise<PasskeyWallet> {
  if (!passkeysAvailable()) throw new PasskeyError("Passkeys need a secure connection and a supported browser.");
  try {
    const { credentialId, prfOutput } = await createPasskeyWithPrfOutput({
      rp: { id: window.location.hostname, name: "Accrue on Arc" },
      user: { name: label, displayName: label },
    });
    remember(credentialId);
    return fromPrf(prfOutput);
  } catch (error) {
    translate(error);
  }
}

export async function openPasskeyAccount(): Promise<PasskeyWallet> {
  if (!passkeysAvailable()) throw new PasskeyError("Passkeys need a secure connection and a supported browser.");
  try {
    const { prfOutput } = await getPasskeyPrfOutput({ rpId: window.location.hostname, credential: remembered() });
    return fromPrf(prfOutput);
  } catch (error) {
    translate(error);
  }
}
