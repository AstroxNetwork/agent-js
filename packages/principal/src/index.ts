import { decode, encode } from './utils/base32';
import { getCrc32 } from './utils/getCrc';
import { sha224 } from './utils/sha224';

const SELF_AUTHENTICATING_SUFFIX = 2;
const ANONYMOUS_SUFFIX = 4;

const MANAGEMENT_CANISTER_PRINCIPAL_HEX_STR = 'aaaaa-aa';

const fromHexString = (hexString: string) =>
  new Uint8Array((hexString.match(/.{1,2}/g) ?? []).map(byte => parseInt(byte, 16)));

const toHexString = (bytes: Uint8Array) =>
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

/**
 * Base class for a Principal. Use this as the signature to ensure compatibility in your API's
 */
export abstract class PrincipalLike {
  abstract _isPrincipal: boolean;
  abstract toString(): string;
  abstract toText(): string;
  abstract toUint8Array(): Uint8Array;
}

export class Principal implements PrincipalLike {
  public static anonymous(): Principal {
    return new this(new Uint8Array([ANONYMOUS_SUFFIX]));
  }

  /**
   * Utility method, returning the principal representing the management canister, decoded from the hex string `'aaaaa-aa'`
   * @returns {Principal} principal of the management canister
   */
  public static managementCanister(): Principal {
    return this.fromHex(MANAGEMENT_CANISTER_PRINCIPAL_HEX_STR);
  }

  public static selfAuthenticating(publicKey: Uint8Array): Principal {
    const sha = sha224(publicKey);
    return new this(new Uint8Array([...sha, SELF_AUTHENTICATING_SUFFIX]));
  }

  public static from(other: unknown): Principal {
    if (typeof other === 'string') {
      return Principal.fromText(other);
    } else if (Principal.isPrincipal(other)) {
      return new Principal((other as PrincipalLike).toUint8Array());
    }

    throw new Error(`Impossible to convert ${JSON.stringify(other)} to Principal.`);
  }

  public static fromHex(hex: string): Principal {
    return new this(fromHexString(hex));
  }

  public static fromText(text: string): Principal {
    const canisterIdNoDash = text.toLowerCase().replace(/-/g, '');

    let arr = decode(canisterIdNoDash);
    arr = arr.slice(4, arr.length);

    const principal = new this(arr);
    if (principal.toText() !== text) {
      throw new Error(
        `Principal "${principal.toText()}" does not have a valid checksum (original value "${text}" may not be a valid Principal ID).`,
      );
    }

    return principal;
  }

  public static fromUint8Array(arr: Uint8Array): Principal {
    return new this(arr);
  }

  /**
   * Utility to check if a provided value is a Principal
   * @param maybePrincipal unknown type
   * @returns boolean
   */
  public static isPrincipal(maybePrincipal: unknown): maybePrincipal is Principal {
    if (maybePrincipal instanceof Principal) return true;

    if (typeof maybePrincipal === 'object' && maybePrincipal !== null) {
      if (
        'toText' in maybePrincipal &&
        'toString' in maybePrincipal &&
        'toUint8Array' in maybePrincipal &&
        '_isPrincipal' in maybePrincipal
      ) {
        return (maybePrincipal as PrincipalLike)['_isPrincipal'];
      }
    }

    return false;
  }

  /**
   * Utility to check if a provided value is a Principal-encoded string
   * @param maybeValid unknown type
   * @returns boolean
   */
  public static isPrincipalString(maybeValid: unknown): boolean {
    if (typeof maybeValid === 'string') {
      try {
        Principal.fromText(maybeValid);
        return true;
      } catch (_) {
        // errors are expected and deliberately suppressed
        return false;
      }
    }
    return false;
  }

  public readonly _isPrincipal = true;

  protected constructor(private _arr: Uint8Array) {}

  public isAnonymous(): boolean {
    return this._arr.byteLength === 1 && this._arr[0] === ANONYMOUS_SUFFIX;
  }

  public toUint8Array(): Uint8Array {
    return this._arr;
  }

  public toHex(): string {
    return toHexString(this._arr).toUpperCase();
  }

  public toText(): string {
    const checksumArrayBuf = new ArrayBuffer(4);
    const view = new DataView(checksumArrayBuf);
    view.setUint32(0, getCrc32(this._arr));
    const checksum = new Uint8Array(checksumArrayBuf);

    const bytes = Uint8Array.from(this._arr);
    const array = new Uint8Array([...checksum, ...bytes]);

    const result = encode(array);
    const matches = result.match(/.{1,5}/g);
    if (!matches) {
      // This should only happen if there's no character, which is unreachable.
      throw new Error();
    }
    return matches.join('-');
  }

  public toString(): string {
    return this.toText();
  }

  /**
   * Utility method taking a Principal to compare against. Used for determining canister ranges in certificate verification
   * @param {Principal} other - a {@link Principal} to compare
   * @returns {'lt' | 'eq' | 'gt'} `'lt' | 'eq' | 'gt'` a string, representing less than, equal to, or greater than
   */
  public compareTo(other: PrincipalLike): 'lt' | 'eq' | 'gt' {
    return Principal.compare(this, other);
  }

  public static compare(p1: PrincipalLike, p2: PrincipalLike): 'lt' | 'eq' | 'gt' {
    const p1Arr = p1.toUint8Array();
    const p2Arr = p2.toUint8Array();
    for (let i = 0; i < Math.min(p1Arr.length, p2Arr.length); i++) {
      if (p1Arr[i] < p2Arr[i]) return 'lt';
      else if (p1Arr[i] > p2Arr[i]) return 'gt';
    }
    // Here, at least one principal is a prefix of the p2 principal (they could be the same)
    if (p1Arr.length < p2Arr.length) return 'lt';
    if (p1Arr.length > p2Arr.length) return 'gt';
    return 'eq';
  }

  /**
   * Utility method checking whether a provided Principal is less than or equal to the current one using the {@link Principal.compareTo} method
   * @param other a {@link Principal} to compare
   * @returns {boolean} boolean
   */
  public ltEq(other: Principal): boolean {
    const cmp = this.compareTo(other);
    return cmp == 'lt' || cmp == 'eq';
  }

  /**
   * Utility method checking whether a provided Principal is greater than or equal to the current one using the {@link Principal.compareTo} method
   * @param other a {@link Principal} to compare
   * @returns {boolean} boolean
   */
  public gtEq(other: PrincipalLike): boolean {
    const cmp = this.compareTo(other);
    return cmp == 'gt' || cmp == 'eq';
  }
}
